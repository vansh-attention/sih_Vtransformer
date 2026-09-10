"""
The reasoning server — SIH26171.

Receives a SanitizedPayload (tokens only, never real values), asks an open-weight VLM
what to do, and returns a strictly-schema'd AgentAction list.

MODEL BACKEND
Ollama by default, because it runs open-weight VLMs on Apple Silicon Metal — so the
whole system is demonstrable on a laptop with the network off. That is not a
convenience: the PS requires the server model to be open-weight and offline-deployable,
and "here it is running with no internet" is a far stronger demonstration than a URL
pointing at somebody's cloud.

The same code targets vLLM for the finale (both speak an OpenAI-compatible API); only
BACKEND_URL changes.

WHAT THIS SERVER MUST NEVER DO
- Log a payload to disk. Even sanitized, it is a map of a user's screen.
- Ask the user to reveal a redacted value.
- Accept a request carrying anything that looks like un-redacted PII — see the
  tripwire below.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
import httpx

from prompt import build_messages
from schema import AGENT_RESPONSE_SCHEMA

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("AGENT_MODEL", "qwen2.5vl:7b")
REQUEST_TIMEOUT = float(os.environ.get("AGENT_TIMEOUT", "180"))

app = FastAPI(title="SIH26171 reasoning server")

# The client is a browser extension, so its origin is chrome-extension://<id>.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Server-side tripwire
# ---------------------------------------------------------------------------

# Patterns for values that should NEVER reach this server. The client is supposed to
# have removed them; this is a second, independent check.
#
# Defence in depth on purpose: the client and the server are written by different people
# on this team, and "the other layer handles it" is how leaks ship. If this ever fires,
# the client has a bug and we want to know loudly rather than quietly serve the request.
_LEAK_PATTERNS = [
    ("AADHAAR", re.compile(r"\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b")),
    ("PAN", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("EMAIL", re.compile(r"\b[^\s@]+@[^\s@.]+\.[^\s@,;]{2,}\b")),
]


def _node_texts(node: dict[str, Any], out: list[tuple[str, str]] | None = None) -> list[tuple[str, str]]:
    """Every piece of text in the tree, paired with the id of the node it came from."""
    if out is None:
        out = []
    for field in ("value", "label", "contextLabel"):
        text = node.get(field)
        if text:
            out.append((node["id"], text))
    for child in node.get("children") or []:
        _node_texts(child, out)
    return out


def detect_inbound_leak(payload: dict[str, Any]) -> list[dict[str, str]]:
    """
    Scan for values that should have been redacted — PER NODE, not over a flattened blob.

    Node-level matters because of acknowledgements. The client has DOM context this
    server does not: it can see that "999999999999" sits in a field labelled "Order
    Total" and is an order total, not an Aadhaar. It records that decision in
    `acknowledged`, and we honour it.

    Without this the tripwire fires on every legitimate decoy and refuses valid requests
    — which is exactly what happened the first time the loop was closed end to end. A
    security check that cries wolf gets switched off, and then it protects nothing.

    What still fires: a pattern in a node the client never acknowledged. That means the
    client did not examine it, which is the client bug this exists to catch.
    """
    acknowledged = {
        (a["id"], a["kind"]) for a in payload.get("acknowledged", [])
    }

    found: list[dict[str, str]] = []
    for node_id, text in _node_texts(payload["root"]):
        # Tokens are the expected, correct form; strip them so they cannot self-trigger.
        clean = re.sub(r"<PII_[A-Z]+_\d+>", "", text)
        for kind, pattern in _LEAK_PATTERNS:
            if pattern.search(clean) and (node_id, kind) not in acknowledged:
                found.append({"id": node_id, "kind": kind})
    return found


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


class ActRequest(BaseModel):
    payload: dict[str, Any]
    # Set by the bench harness to assert the tripwire fires; never set by the client.
    allow_leaky_payload: bool = False


# ---------------------------------------------------------------------------
# Fault injection — for the failure drills only
# ---------------------------------------------------------------------------

# Fault injection is read from a FILE, per request, not from the environment.
#
# The env-var form worked locally and silently failed to propagate on every CI runner:
# the server came up healthy while the harness believed it had injected a fault. Two
# attempts to fix the propagation (bare assignments, then `env`) both looked correct and
# neither worked, so the mechanism itself was the problem.
#
# A file is unambiguous, inspectable, and settable only by something with filesystem
# access — so a hostile page still cannot reach it, which was the point of avoiding a
# request parameter.
FAULT_FILE = os.environ.get("AGENT_FAULT_FILE", "")


def current_fault() -> str:
    if os.environ.get("AGENT_FAULT"):
        return os.environ["AGENT_FAULT"]
    if FAULT_FILE and os.path.exists(FAULT_FILE):
        try:
            return open(FAULT_FILE).read().strip()
        except OSError:
            return ""
    return ""


async def _inject_fault() -> Any:
    """Simulate the ways this server actually fails in the field."""
    fault = current_fault()
    if fault == "500":
        raise HTTPException(status_code=500, detail={"error": "injected server fault"})
    if fault == "hang":
        # Longer than any sane client timeout: proves the client gives up rather than
        # waiting forever with a frozen UI.
        await asyncio.sleep(600)
    if fault == "garbage":
        # A 200 carrying non-JSON. This is what a captive portal or misrouted proxy
        # looks like, and it is far more confusing than an honest 500.
        return PlainTextResponse("<html>200 OK but not JSON</html>", status_code=200)
    if fault == "empty":
        return {"actions": []}
    return None


@app.on_event("startup")
async def warm_model() -> None:
    """
    Load the model at startup rather than on the user's first request.

    Otherwise the first thing anyone sees — including a judge — is a ~5s reload plus a
    cold inference. The runbook says to pre-warm manually; doing it here means nobody
    has to remember.
    """
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            await c.post(f"{OLLAMA_URL}/api/chat", json={
                "model": MODEL,
                "messages": [{"role": "user", "content": "ok"}],
                "stream": False,
                "keep_alive": os.environ.get("AGENT_KEEP_ALIVE", "30m"),
                "options": {"num_predict": 1},
            })
        print(f"[startup] {MODEL} warmed and held resident")
    except Exception as e:      # never block startup on this
        print(f"[startup] could not warm {MODEL}: {e}")


@app.get("/health")
async def health() -> dict[str, Any]:
    """Reports whether the backend is reachable AND the model is actually present."""
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            tags = (await c.get(f"{OLLAMA_URL}/api/tags")).json()
        names = [m["name"] for m in tags.get("models", [])]
        return {
            "ok": MODEL in names,
            "fault": current_fault() or None,
            "keepAlive": os.environ.get("AGENT_KEEP_ALIVE", "30m"),
            "model": MODEL,
            "modelPresent": MODEL in names,
            "available": names,
            "backend": OLLAMA_URL,
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "backend": OLLAMA_URL}


@app.post("/act")
async def act(req: ActRequest) -> Any:
    injected = await _inject_fault()
    if injected is not None:
        return injected

    payload = req.payload

    leaks = detect_inbound_leak(payload)
    if leaks and not req.allow_leaky_payload:
        # Fail closed. Serving the request anyway would mean a client bug silently
        # became a privacy incident.
        raise HTTPException(
            status_code=422,
            detail={
                "error": "unredacted PII detected in inbound payload",
                "found": leaks,
                "hint": (
                    "the client sanitizer neither redacted nor acknowledged these; "
                    "this request was refused"
                ),
            },
        )

    messages = build_messages(payload)

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": MODEL,
                    "messages": messages,
                    # KEEP THE MODEL RESIDENT.
                    #
                    # Ollama unloads after 5 minutes idle by default, and reloading 7GB
                    # costs ~5 SECONDS — which was showing up as "the model is slow"
                    # and dominating every measurement. Measured directly:
                    #   first call   total 5.12s  (load 4.90s, inference 0.22s)
                    #   second call  total 0.27s  (load 0.17s)
                    #
                    # A demo has gaps between runs longer than the default idle window,
                    # so without this the judge sees the reload every single time.
                    "keep_alive": os.environ.get("AGENT_KEEP_ALIVE", "30m"),
                    # Constrained decoding: the model cannot return anything that is
                    # not a valid AgentResponse. No parser, no repair loop.
                    "format": AGENT_RESPONSE_SCHEMA,
                    "stream": False,
                    "options": {
                        # Deterministic-ish. This is UI control, not creative writing;
                        # the same screen should produce the same action.
                        "temperature": 0.1,
                        "num_ctx": 8192,
                        # A hard ceiling on generation.
                        #
                        # Measured on this machine: ~11 tokens/second, for both the
                        # vision model and a text-only one, at every context size. That
                        # is the hardware, not something the code can fix — so the only
                        # lever left is generating FEWER tokens. A verbose model was
                        # spending 5s on 58 tokens, most of them prose in `reasoning`.
                        #
                        # Generous enough for several actions with short reasoning;
                        # tight enough that a rambling response cannot cost 10 seconds.
                        "num_predict": 160,
                    },
                },
            )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"model backend error: {e}") from e

    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    body = resp.json()
    content = body.get("message", {}).get("content", "")

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        # Should be unreachable given constrained decoding — but if the backend ever
        # ignores `format`, say so plainly instead of returning something malformed.
        raise HTTPException(
            status_code=502,
            detail=f"backend returned non-JSON despite schema constraint: {e}",
        ) from e

    return {
        "actions": parsed.get("actions", []),
        "needsMoreContext": parsed.get("needsMoreContext", False),
        "meta": {
            "model": MODEL,
            "latencyMs": elapsed_ms,
            "promptEvalCount": body.get("prompt_eval_count"),
            "evalCount": body.get("eval_count"),
            # Where the time actually goes. Without these, "the model is slow" is not a
            # diagnosis and every optimisation is a guess.
            "loadMs": round(body.get("load_duration", 0) / 1e6),
            "promptEvalMs": round(body.get("prompt_eval_duration", 0) / 1e6),
            "genMs": round(body.get("eval_duration", 0) / 1e6),
        },
    }
