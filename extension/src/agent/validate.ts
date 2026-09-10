/**
 * Action validator — SIH26171. The client's last line of defence.
 *
 * The server is a 7B model that has just been fed a description of the user's screen.
 * It is not malicious, but it is not trusted either: it hallucinates element ids, it
 * will occasionally invent a value, and if the page it is looking at is hostile then
 * whatever it returns is downstream of an attacker's text.
 *
 * So NOTHING the server sends is executed unchecked. Every action is validated against
 * the payload we actually sent, on the client, before it touches the page.
 *
 * The three things this exists to stop:
 *   1. Acting on an element we never described (hallucinated or stale id).
 *   2. Typing into a password or other sensitive field. The agent has no business
 *      filling those, and prompt injection on a hostile page would target exactly this.
 *   3. Echoing back raw PII. The server never saw any, so any real-looking PAN or card
 *      number in a response means something has gone badly wrong upstream.
 */

import type { AgentAction, ElementId, SanitizedNode, SanitizedPayload } from '../contracts.ts';

export interface ValidationResult {
  action: AgentAction;
  allowed: boolean;
  reason?: string;
}

/** Actions the client knows how to execute. Anything else is refused. */
const KNOWN_KINDS = new Set([
  'click', 'type', 'scroll', 'select', 'wait', 'ask_user', 'done',
]);

/** Roles the agent may never type into, whatever the model says. */
const NEVER_TYPE_ROLES = new Set(['password']);

/**
 * Roles that can actually accept typed text.
 *
 * Found end to end: the model returned `type` against a BUTTON, the validator allowed
 * it (a button is neither a password field nor disabled), and it only failed at
 * execution with "not a text field". A refusal belongs at validation time — that is the
 * layer that is supposed to know what is safe, and an action that reaches the page and
 * fails leaves the loop unsure whether the page changed.
 */
const TYPEABLE_ROLES = new Set(['textbox']);

const TOKEN_RE = /^<PII_[A-Z]+_\d+>$/;

/**
 * Raw-PII shapes that must never appear in a server response. Deliberately loose:
 * a false positive here costs one refused action, while a false negative means the
 * model is echoing real data and we did not notice.
 */
// Ordered longest/most-specific FIRST. A 16-digit card contains a 12-digit run, so
// checking AADHAAR first denies card numbers with the reason "AADHAAR-shaped" — the
// right call for the wrong stated reason. That string is shown to the user in the
// Privacy Ledger, so it has to be accurate. Same ordering rule as pii/patterns.ts.
const RAW_PII_PATTERNS: Array<[string, RegExp]> = [
  ['CARD', /\b(?:\d[ -]?){13,19}\b/],
  ['AADHAAR', /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/],
  ['PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/],
  ['EMAIL', /\b[^\s@]+@[^\s@.]+\.[^\s@,;]{2,}\b/],
];

function indexNodes(root: SanitizedNode): Map<ElementId, SanitizedNode> {
  const map = new Map<ElementId, SanitizedNode>();
  (function walk(n: SanitizedNode) {
    map.set(n.id, n);
    n.children?.forEach(walk);
  })(root);
  return map;
}

/** Does this element currently hold a redacted value? */
function holdsRedactedValue(node: SanitizedNode): boolean {
  return typeof node.value === 'string' && /<PII_[A-Z]+_\d+>/.test(node.value);
}

export function validateAction(
  action: AgentAction,
  payload: SanitizedPayload,
  nodes: Map<ElementId, SanitizedNode>,
): ValidationResult {
  const deny = (reason: string): ValidationResult => ({ action, allowed: false, reason });

  if (!action || typeof action.kind !== 'string' || !KNOWN_KINDS.has(action.kind)) {
    return deny(`unknown action kind: ${String(action?.kind)}`);
  }

  // The server never sees real values, so a real-looking one in its response means
  // either the sanitizer leaked or the model invented it. Both are refusals.
  if (typeof action.value === 'string' && !TOKEN_RE.test(action.value)) {
    for (const [kind, re] of RAW_PII_PATTERNS) {
      if (re.test(action.value)) {
        return deny(`server response contains raw ${kind}-shaped value; refusing`);
      }
    }
  }

  // Actions that need no target.
  if (action.kind === 'wait' || action.kind === 'done' || action.kind === 'ask_user') {
    return { action, allowed: true };
  }

  if (action.kind === 'scroll') {
    const delta = action.scrollDelta ?? 0;
    if (!Number.isFinite(delta) || Math.abs(delta) > 20000) {
      return deny(`implausible scrollDelta: ${delta}`);
    }
    return { action, allowed: true };
  }

  if (!action.target) return deny(`${action.kind} requires a target`);

  const node = nodes.get(action.target);
  // Ids are minted per extraction. An unknown id is a hallucination or a stale
  // reference to a page that has since changed; either way we must not guess.
  if (!node) return deny(`unknown element id: ${action.target}`);

  if (!node.visible) return deny(`element ${action.target} is not visible`);
  if (!node.enabled) return deny(`element ${action.target} is disabled`);

  if (action.kind === 'type') {
    if (NEVER_TYPE_ROLES.has(node.role)) {
      return deny(`refusing to type into a ${node.role} field (${action.target})`);
    }
    if (!TYPEABLE_ROLES.has(node.role)) {
      return deny(`${action.target} is a ${node.role}, not a text field`);
    }

    if (typeof action.value !== 'string' || action.value.length === 0) {
      return deny('type action requires a value');
    }

    // A token is fine: the client resolves it locally from the vault, so the model
    // directed the value without ever knowing it. But it must be a token WE minted,
    // AND the destination must be a field that actually wants that kind of value.
    if (TOKEN_RE.test(action.value)) {
      const known = payload.placeholders.some((p) => p.token === action.value);
      if (!known) return deny(`unknown placeholder token: ${action.value}`);

      // KIND AGREEMENT. Without this a hostile page can simply ask the agent to put
      // <PII_PAN_1> into a box labelled "Optional feedback" that posts to the
      // attacker's server. The model emits only a token, so nothing looks wrong — but
      // the CLIENT resolves that token to the real PAN at execution time and types it
      // in. That was a working exfiltration path, found by bench/injection-test.ts.
      //
      // A token may only be resolved into a field layer 1 classified as the same kind.
      // The page cannot forge that: `fieldKind` comes from our own classifier, not from
      // anything the page asserts.
      const tokenKind = action.value.match(/^<PII_([A-Z]+)_\d+>$/)?.[1];
      if (tokenKind && node.fieldKind !== tokenKind) {
        return deny(
          `refusing to place a ${tokenKind} value into a field classified as ` +
          `${node.fieldKind ?? 'unclassified'} (${action.target})`,
        );
      }
    } else if (holdsRedactedValue(node)) {
      // The field already holds redacted content. Overwriting it with literal text
      // would destroy the user's real data on the strength of a model's guess.
      return deny(`refusing to overwrite redacted value in ${action.target} with literal text`);
    }
  }

  return { action, allowed: true };
}

export interface ValidationReport {
  results: ValidationResult[];
  allowed: AgentAction[];
  denied: ValidationResult[];
}

export function validateActions(
  actions: AgentAction[],
  payload: SanitizedPayload,
): ValidationReport {
  const nodes = indexNodes(payload.root);
  const results = actions.map((a) => validateAction(a, payload, nodes));
  return {
    results,
    allowed: results.filter((r) => r.allowed).map((r) => r.action),
    denied: results.filter((r) => !r.allowed),
  };
}
