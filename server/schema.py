"""
The AgentAction JSON schema — SIH26171.

Mirrors `AgentAction` in extension/src/contracts.ts. If you change one, change both.

This schema is not documentation. It is handed to the model as a *constraint*, so the
model is structurally incapable of returning anything else. That matters more than it
sounds: an agent whose output is free-form text needs a parser, and a parser needs
error handling, and error handling on a 7B model's prose is where agent projects go to
die. Constrained decoding removes the failure mode instead of handling it.

WHY THE KINDS ARE SPLIT INTO A oneOf
A `type` action without a value is not an action. The client refuses it, correctly, but
the refusal costs a whole turn and ended the task outright.

Measured on the multi-step grievance fixture: turn 1 typed the reference number, turn 2
returned {"kind":"type","target":"el_7"} with no value, the validator refused it, and
the run stopped two fields short of submitting. A single flat `required` list cannot
express "value is mandatory, but only for one of the seven kinds", so the schema
permitted it and constrained decoding faithfully permitted it too.

The first attempt at a fix used JSON Schema `if`/`then`. Ollama ACCEPTED it and
IGNORED it: the model returned an action carrying `value` but missing `target`, which
the `then` clause required. llama.cpp's schema-to-grammar conversion silently drops the
conditional keywords, so the constraint looked stricter without being stricter — the
same shape as a green test that cannot fail. `oneOf` is converted into a real grammar
alternation and was verified to hold for both branches before being adopted here.
"""

ACTION_KINDS = ["click", "type", "scroll", "select", "wait", "ask_user", "done"]

# An element id the CLIENT minted this turn ("el_42"). The client rejects anything
# else, so a hallucinated id fails closed rather than clicking something arbitrary.
_TARGET = {"type": "string"}
# Surfaced in the Privacy Ledger so the user can see WHY the agent did something.
_REASONING = {"type": "string"}

# Kinds that put text somewhere. Both the destination and the text are mandatory.
# `value` may be a literal, or a "<PII_*>" token the client resolves locally at
# execution time — which is how the model says "put the PAN here" without ever
# having seen a PAN.
_TEXT_ACTION = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["type", "select"]},
        "target": _TARGET,
        "value": {"type": "string"},
        "reasoning": _REASONING,
    },
    "required": ["kind", "target", "value", "reasoning"],
}

# Kinds that act on an element but carry no text.
_TARGET_ACTION = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["click"]},
        "target": _TARGET,
        "reasoning": _REASONING,
    },
    "required": ["kind", "target", "reasoning"],
}

# Answering a question rather than acting on the page.
#
# Its own branch because `text` is mandatory here and meaningless everywhere else —
# the same reason `type` and `click` are separate branches. ⚠ `oneOf` is what ollama
# actually converts into a grammar; an `if`/`then` is accepted and SILENTLY IGNORED,
# which this project has already been bitten by once.
_ANSWER_ACTION = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["answer"]},
        "text": {"type": "string", "minLength": 1},
        "reasoning": _REASONING,
    },
    "required": ["kind", "text", "reasoning"],
}

# Kinds that need neither a target nor a value.
_BARE_ACTION = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["scroll", "wait", "ask_user", "done"]},
        "target": _TARGET,
        "value": {"type": "string"},
        "scrollDelta": {"type": "integer"},
        "reasoning": _REASONING,
    },
    "required": ["kind", "reasoning"],
}

AGENT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "actions": {
            "type": "array",
            "items": {"oneOf": [_TEXT_ACTION, _TARGET_ACTION, _BARE_ACTION, _ANSWER_ACTION]},
        },
        "needsMoreContext": {"type": "boolean"},
    },
    "required": ["actions"],
}
