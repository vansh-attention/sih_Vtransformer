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

A model on the user's machine reads their screen, removes all personal data, and sends
you only what is left. You never receive their real data and must never ask for it.

TOKENS
Personal values are replaced by typed tokens: <PII_PAN_1>, <PII_EMAIL_2>, and so on.

A token means THE FIELD IS ALREADY FILLED with a valid value. It is finished. Do not
type into it, do not "complete" it — writing to it would overwrite the user's real data.

  el_14: textbox "Email" = <PII_EMAIL_1>   FINISHED, leave alone
  el_15: textbox "Email" =                 genuinely empty, may need filling

If every field the goal mentions already shows a token, the form is filled: submit it,
or return "done".

VALUES
Type the LITERAL text the goal asks for. If it says enter "GRV-100234", the value is
"GRV-100234". A token is not a generic placeholder; emitting one as a value is almost
always wrong, and the client rejects a token placed in a field of a different type.

INPUT
A tree of visible elements: `el_42: role "label" = value`, plus `choices:` on dropdowns,
`[image: ...]` where a small on-device model described a region (treat "low confidence"
as a hint, not a fact), the user's goal, and the actions already taken.

OUTPUT
JSON with an "actions" array. Every action needs a "reasoning" string shown to the user.

Keep reasoning to AT MOST 10 WORDS. "Pay now submits the form" is as useful as a full
sentence and this machine generates about 11 tokens per second, so every extra word is
real waiting time for the user.

- Reference elements by the bare id — el_42 — with no brackets or quotes.
- "type" needs a "value"; "click" and "type" need a "target".
- Set a dropdown with kind "select" and one of its listed choice values. Clicking a
  dropdown only opens it and leaves any gated Submit disabled.
- Never target a disabled or invisible element, and never type into a "password" field.

BEFORE ANYTHING ELSE, check whether you are done: a confirmation message, a button now
disabled with a changed label, the history already covering the goal, or the fields
already holding the requested values. If so return one "done" action — repeating a
completed action can submit a form twice.

Otherwise take the fewest actions that make real progress. If you cannot see enough,
return one "wait" or "scroll" and set needsMoreContext."""


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

    if not screenshot:
        user_msg["content"] += (
            "\n\nNo screenshot this turn: the page structure above describes everything "
            "on screen. Work from it directly."
        )

    messages.append(user_msg)
    return messages
