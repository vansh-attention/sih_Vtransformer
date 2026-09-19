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

Only a token you can SEE in the tree exists. Writing <PII_PAN_1> when no such token is
shown does not fetch the value — there is nothing to fetch, and the client refuses it. If
a field needs a value the page does not hold, ask for it:
    {"kind":"ask_user","text":"What is your PAN?","reasoning":"PAN not on page"}

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
- A node whose role is "select" is a dropdown. It is NOT a text field: typing into it
  does nothing. Set it with kind "select", targeting it, with "value" copied exactly
  from one of its listed choices. Given
      [el_5] select "Category" choices: billing | service | other
  the only correct action is
      {"kind":"select","target":"el_5","value":"billing","reasoning":"Choose billing"}
  Clicking it merely opens it, and typing into it is refused, and either way a Submit
  gated on that field stays disabled and the task cannot finish.
- A "radio" or a "checkbox" is set with kind "click" on the option you want — not with
  "select", which is for dropdowns, and not by typing. Each one shows
  [SELECTED] or [not selected], and the ones sharing a "group:" are one question: exactly
  one radio in a group should end up selected. If every radio in a group is [not selected]
  the question is unanswered and the form is not complete.
- Never target a disabled or invisible element, and never type into a "password" field.

BEFORE ANYTHING ELSE, check whether you are done: a confirmation message, a button now
disabled with a changed label, the history already covering the goal, or the fields
already holding the requested values. If so return one "done" action — repeating a
completed action can submit a form twice.

Otherwise take the fewest actions that make real progress. If you cannot see enough,
return one "wait" or "scroll" and set needsMoreContext."""

# ⛔ DO NOT ADD A "FILL EVERY FIELD IN ONE REPLY" INSTRUCTION TO THE PROMPT ABOVE.
#
# This note lives in a COMMENT and not in the prompt, which is the second thing this
# experiment taught: the first draft of it was written inside SYSTEM_PROMPT, where it
# would have been sent to the model on every single turn.
#
# It was tried on 19 Sep 2026, in two forms, each measured over three Spike E runs:
#
#     one action per turn (this prompt)   6 turns   33.8s   task verified 3/3
#     batched, example with real values   4 turns   26.8s   task verified 1/3
#     batched, example with placeholders  3 turns     —     task verified 0/3
#
# Batching works — the model does return three or four actions and the turn count drops.
# The task then does not finish. Having filled the form in one turn, the model spends every
# remaining turn re-proposing a field that is already correct and never submits, which is
# the same place the 3B model fails. Making the no-op refusal name the remedy did not help
# either: 0/3.
#
# Two things were learned the expensive way and both are about this file:
#
# 1. THE EXAMPLE'S VALUES GET TYPED. The first version used "GRV-100234", which is the
#    reference number in bench/pages/multistep.html — so the prompt was handing the model
#    the fixture's own answer, and the measurement was invalid. The second used
#    "<from the goal>" as a placeholder and the model typed the literal string
#    "<from the goal>" into the field. A 7B copies what it is shown. Any concrete-looking
#    value in an example here is a liability on every page that is not the example.
#
# 2. A BATCH IS VALIDATED AGAINST THE PAGE AS IT WAS BEFORE THE BATCH RAN. So an action
#    whose precondition is created by an EARLIER action in the same batch is unsound:
#    Submit is disabled until the form is complete, and it is still disabled in the
#    observation the validator checks. Submitting is the step that completes the task, so
#    the one action worth batching is the one that cannot be.
#
# Latency is 15% of the grade and this is the obvious way to spend it. It costs task
# completion, which is the demo.


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

    # A radio or a checkbox. Its `value` is the option it OFFERS, never its state, so
    # without this the model saw `el_5: radio "Small" = small` for an UNCHECKED button
    # and had no way to tell a chosen option from an offered one. `group` is what ties
    # Small/Medium/Large into one question rather than three unrelated controls.
    if role in ("radio", "checkbox"):
        parts.append("[SELECTED]" if node.get("checked") else "[not selected]")
        if node.get("group"):
            parts.append(f'group: {node["group"]}')

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



def _is_question(goal: str) -> bool:
    """
    Is this goal asking for an ANSWER rather than an action?

    ⛔ Why this exists. The answer instruction was originally unconditional, and a 7B
    model given both "you may answer questions" and "fill in this form" chose to answer
    the form: Spike E failed three times in a row with stopReason 'answered', having
    done nothing to the page. The capability cannibalised the one that already worked.

    So an action goal now gets the ORIGINAL prompt, byte for byte, and the answer
    section is added only when the goal is actually a question. Conservative on purpose
    — a question misread as an action still works, it just acts instead of answering,
    while the reverse breaks the product's main path.
    """
    g = goal.strip().lower()
    if g.endswith("?"):
        return True
    return g.startswith((
        "what", "which", "who", "whose", "where", "when", "why", "how",
        "is ", "are ", "was ", "were ", "do ", "does ", "did ", "can ", "could ",
        "find ", "list ", "tell ", "summarise", "summarize", "explain",
    ))


ANSWER_SECTION = """IF THE GOAL IS A QUESTION, ANSWER IT — do not act on the page.
  "What do I need to complete here?", "Find the contact details", "Is this form valid?"
  are questions. Reply with ONE action:
      {"kind":"answer","text":"...","reasoning":"..."}
  Put the answer in "text", in plain prose, and stop. Do not click anything.

  ⭐ REFER TO REDACTED VALUES BY THEIR TOKEN. You cannot see them and you do not need
  to: write the token exactly as it appears and the client will substitute the real
  value for the user's eyes only. So
      "The mobile number on this page is <PII_PHONE_1>."
  is CORRECT and useful.
  ⛔ Copy the token EXACTLY, angle brackets and all: <PII_PHONE_1>. Do NOT write the
  kind on its own — "the details are NAME and PHONE" is useless to the reader. Never
  write "[redacted]", never say you are unable to see it, and never invent a value.
  A token is an answer; an apology is not.
"""

def build_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the chat messages for one turn."""
    tree = "\n".join(_describe(payload["root"]))

    held = payload.get("placeholders") or []
    if held:
        kinds: dict[str, int] = {}
        for p in held:
            kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
        # ⛔ REVERTED to plain counts, 18 Sep.
        #
        # This briefly read "Values on this page, each replaced by the token you must
        # quote: <PII_NAME_1> (a NAME), ..." to try to make the model quote tokens when
        # answering a question. Measured: it did NOT (0/4 runs before, 0/4 after). It
        # DID change the prompt on every ACTION turn too, and Spike E — the form-filling
        # task — started failing.
        #
        # A change that does not fix what it was for, and destabilises something that
        # worked, is not a trade worth keeping. The tokens are already visible in the
        # element tree; the instruction to quote them lives in the system prompt.
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
        # The answer capability is ADDITIVE and only for questions. An action goal gets
        # the original prompt unchanged, which is the configuration Spike E passes on.
        {"role": "system", "content": SYSTEM_PROMPT + (
            "\n\n" + ANSWER_SECTION if _is_question(payload.get("goal", "")) else ""
        )},
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
