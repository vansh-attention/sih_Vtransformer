"""
The AgentAction JSON schema — SIH26171.

Mirrors `AgentAction` in extension/src/contracts.ts. If you change one, change both.

This schema is not documentation. It is handed to the model as a *constraint*, so the
model is structurally incapable of returning anything else. That matters more than it
sounds: an agent whose output is free-form text needs a parser, and a parser needs
error handling, and error handling on a 7B model's prose is where agent projects go to
die. Constrained decoding removes the failure mode instead of handling it.
"""

ACTION_KINDS = ["click", "type", "scroll", "select", "wait", "ask_user", "done"]

AGENT_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ACTION_KINDS},
                    # An element id the CLIENT minted this turn ("el_42"). The client
                    # rejects anything else, so a hallucinated id fails closed rather
                    # than clicking something arbitrary.
                    "target": {"type": "string"},
                    # Literal text, or a "<PII_*>" token the client resolves locally at
                    # execution time. This is how the model can say "put the PAN here"
                    # while never having seen a PAN.
                    "value": {"type": "string"},
                    "scrollDelta": {"type": "integer"},
                    # Surfaced in the Privacy Ledger so the user can see WHY the agent
                    # did something, not just that it did.
                    "reasoning": {"type": "string"},
                },
                "required": ["kind", "reasoning"],
            },
        },
        "needsMoreContext": {"type": "boolean"},
    },
    "required": ["actions"],
}
