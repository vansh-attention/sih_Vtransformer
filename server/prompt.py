"""
Prompt construction — SIH26171.

Turns a SanitizedPayload into something a 7B VLM can act on.

THE CENTRAL IDEA: the model is told the redaction scheme, so it can reason about values
it is structurally forbidden from seeing. "<PII_PAN_1>" is not a hole in the data — it
is a typed assertion that the PAN field is populated and checksum-valid. The model can
therefore conclude "the PAN is filled in, the blocker is elsewhere" without ever
learning the number.

That is the PS's requirement that the server be "aware of this redaction scheme and can
process data accordingly", and it is why redaction precision and task accuracy do not
have to fight each other.
"""

from typing import Any

SYSTEM_PROMPT = """You are the reasoning half of a privacy-preserving browser agent.

A small model runs on the user's own machine. It reads their screen, removes every
piece of personal information, and sends you only what is left. You never receive the
user's real data and you must never ask for it.

REDACTION SCHEME
Personal values are replaced by typed tokens: <PII_PAN_1>, <PII_AADHAAR_2>,
<PII_EMAIL_1>, <PII_PASSWORD_1>, and so on.

A token means: THIS FIELD IS ALREADY FILLED IN, with a valid value of that type.

THE MOST IMPORTANT RULE ON THIS PAGE
A field whose value shows a token is DONE. Do not type into it. Do not "complete" it.
Do not re-enter it. It already contains the user's real data, and writing to it would
overwrite that data with a guess.

  el_14: textbox "Email" = <PII_EMAIL_1>     <- FINISHED. Leave it alone.
  el_15: textbox "Email" =                   <- genuinely empty. This one may need filling.

If every field the goal mentions already shows a token, the form is filled and your job
is whatever comes next — usually submitting it, or "done".

Never ask the user to reveal a redacted value. That defeats the entire system.

VALUES YOU TYPE
Type the LITERAL TEXT the goal asks for. If the goal says enter "GRV-100234", the value
is "GRV-100234". If it says write a description, write the description.

A token is NOT a generic placeholder meaning "a value goes here". It names one specific
item already on the page. Emitting a token as a value is almost always wrong, and is
only ever right when copying a redacted value into a DIFFERENT, EMPTY field of the same
type. The client rejects any token placed in a field whose purpose does not match it.

WHAT YOU RECEIVE
- The page origin (host only; path and query are stripped)
- A tree of visible elements, each with a stable id like "el_42", a role, a label, and
  its on-screen box
- [image: ...] annotations on regions the page structure could not describe, produced by
  a small model on the user's machine. Where it says "low confidence" or "unrecognised",
  treat it as a weak hint, not a fact.
- Optionally a screenshot with faces blurred and sensitive regions masked
- The user's goal
- The actions already taken this session

WHAT YOU RETURN
A JSON object with an "actions" array. Every action must carry a "reasoning" string
that will be shown to the user.

Reference elements ONLY by the exact id given in the tree, e.g. "el_42" — the bare id,
with no brackets or quotes around it. Never invent an id, never use a CSS selector,
never use pixel coordinates: the client rejects all three.

ACTION RULES
- To set a dropdown, use kind "select" with "value" set to one of the listed choice
  values. Do NOT "click" a dropdown — that opens it and changes nothing, and any
  Submit button gated on the field stays disabled.
- "type" MUST include a "value". A type action without one is rejected by the client.
- "click" and "type" MUST include a "target" id.
- Never target a disabled or invisible element; both are rejected.
- Never type into a field whose role is "password".

RECOGNISING THAT YOU ARE FINISHED
Check this BEFORE proposing anything else. Signals that the goal is already met:
- a confirmation message on the page ("Submitted", "Thank you", "Success")
- the button you were going to press is now disabled and its label has changed
- the actions already taken this session cover the whole goal
- the fields the goal asked you to fill already contain those values

If any of those hold, return a single "done" action and stop. Repeating a completed
action is worse than doing nothing: it can submit a form twice.

Prefer the smallest number of actions that makes real progress. If you cannot see
enough to act, return a single "wait" or "scroll" action and set needsMoreContext."""


def _describe(node: dict[str, Any], depth: int = 0, lines: list[str] | None = None) -> list[str]:
    """
    Flatten the element tree into indented text.

    Text, not JSON: a 7B model follows an indented outline far more reliably than nested
    braces, and it costs a third of the tokens. Token budget matters because end-to-end
    latency is 15% of the grade.
    """
    if lines is None:
        lines = []

    role = node.get("role", "other")
    # Bare id, no brackets. Rendering "[el_5]" made the model return "[el_5]" as the
    # target, which the client then rejected as an unknown element.
    parts = [f"{node['id']}: {role}"]

    if node.get("label"):
        parts.append(f'"{node["label"]}"')
    if node.get("contextLabel"):
        parts.append(f'(near: "{node["contextLabel"]}")')
    if node.get("value"):
        parts.append(f"= {node['value']}")

    opts = node.get("options")
    if opts:
        shown = ", ".join(f'"{o["label"]}"={o["value"]}' for o in opts[:12])
        more = "" if len(opts) <= 12 else f" (+{len(opts) - 12} more)"
        parts.append(f"choices: {shown}{more}")

    # On-device vision output, for regions the DOM cannot describe. The confidence is
    # rendered too: this is an ImageNet classifier looking at UI, so a 12% guess is
    # noise and the model should be able to tell that from an 80% one rather than
    # treating every label as fact.
    vis = node.get("vision")
    if vis:
        conf = vis.get("confidence", 0)
        if conf >= 0.35:
            parts.append(f'[image: {vis["label"]}]')
        elif conf >= 0.12:
            parts.append(f'[image: possibly {vis["label"]}, low confidence]')
        else:
            parts.append("[image: contents unrecognised]")
        if vis.get("likelyPerson"):
            parts.append("[a person appears to be present; any face has been blurred]")

    flags = []
    if node.get("required"):
        flags.append("required")
    if not node.get("enabled", True):
        flags.append("DISABLED")
    if node.get("focused"):
        flags.append("focused")
    if flags:
        parts.append(f"<{', '.join(flags)}>")

    # Skip pure structural wrappers that carry nothing themselves; their children still
    # get rendered, so no information is lost and the outline stays readable.
    interesting = (
        node.get("label")
        or node.get("value")
        or node.get("vision")
        or role not in ("other", "form", "list", "table")
    )
    if interesting:
        lines.append("  " * depth + " ".join(parts))
        depth += 1

    for child in node.get("children") or []:
        _describe(child, depth, lines)

    return lines


def build_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the chat messages for one turn."""
    tree = "\n".join(_describe(payload["root"]))

    held = payload.get("placeholders") or []
    if held:
        kinds: dict[str, int] = {}
        for p in held:
            kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
        withheld_line = "Withheld on this page: " + ", ".join(
            f"{n}x {k}" for k, n in sorted(kinds.items())
        )
    else:
        withheld_line = "Nothing was withheld on this page."

    history = payload.get("history") or []
    if history:
        hist = "\n".join(
            f"  {i + 1}. {a['kind']}"
            + (f" {a['target']}" if a.get("target") else "")
            + f" — {a.get('reasoning', '')}"
            for i, a in enumerate(history)
        )
        history_block = f"\nAlready done this session:\n{hist}\n"
    else:
        history_block = ""

    viewport = payload.get("viewport", {})
    user_text = f"""GOAL: {payload['goal']}

Page: {payload['origin']} — "{payload.get('title', '')}"
Viewport: {viewport.get('w')}x{viewport.get('h')} (scrolled to y={viewport.get('scrollY', 0)})
{withheld_line}
{history_block}
Visible elements:
{tree}

What should the agent do next?"""

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
    ]

    user_msg: dict[str, Any] = {"role": "user", "content": user_text}
    screenshot = payload.get("screenshot")
    if screenshot:
        # Ollama takes bare base64, without the data-URL prefix.
        if screenshot.startswith("data:"):
            screenshot = screenshot.split(",", 1)[1]
        user_msg["images"] = [screenshot]

    messages.append(user_msg)
    return messages
