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
  /**
   * A refusal the CLIENT already knows the answer to, in machine-readable form.
   *
   * Set only where the refusal identifies a definite next step rather than merely a
   * mistake. Today that is one case: the model asked for a value that was never withheld
   * from this page, so the value does not exist here and the only way forward is to ask
   * the person for it.
   *
   * It exists because the model will not be talked into this. A general rule in the system
   * prompt plus a PAN example produced `ask_user` on a PAN page 4/4 — and 0/4 on a driving
   * licence field, where it invented `<PII_LICENSE_1>` instead; handing it the exact
   * action to copy in the refusal text did not help either, 0/4 again. It was matching the
   * example, not the rule. So the loop stops depending on the model for something it can
   * work out for itself: the field's label is right here, in our own extractor's output.
   */
  remedy?: {
    kind: 'ask_user';
    question: string;
    /**
     * The field the value belongs in. Carried so the answer needs no further reasoning:
     * the user replied to a question about THIS field, so the client fills THIS field and
     * the model is never consulted about where it goes.
     */
     target: ElementId;
  };
}

/** Actions the client knows how to execute. Anything else is refused. */
const KNOWN_KINDS = new Set([
  'click', 'type', 'scroll', 'select', 'wait', 'ask_user', 'done', 'answer',
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

const TOKEN_RE = /^<PII_[A-Z_]+_\d+>$/;

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
  return typeof node.value === 'string' && /<PII_[A-Z_]+_\d+>/.test(node.value);
}

export function validateAction(
  action: AgentAction,
  payload: SanitizedPayload,
  nodes: Map<ElementId, SanitizedNode>,
  /** Actions already executed successfully in this run, for the no-op rule below. */
  done: AgentAction[] = [],
): ValidationResult {
  const deny = (
    reason: string,
    remedy?: ValidationResult['remedy'],
  ): ValidationResult => ({ action, allowed: false, reason, ...(remedy ? { remedy } : {}) });

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
  if (action.kind === 'wait' || action.kind === 'done') {
    return { action, allowed: true };
  }

  /**
   * `ask_user` NEEDS A QUESTION, for the same reason `answer` needs text.
   *
   * This kind sat in the contract, the JSON schema, this validator and the executor
   * without a single line describing what it does, and executing it returned
   * `executed: true` and moved the loop on — so the agent could "ask the user" something
   * and the user was never asked anything. A capability present in five files and absent
   * from behaviour reads as working to every test that only checks the action was
   * allowed.
   *
   * The question is the entire payload of this action. Without it the panel has nothing
   * to render and the run stops for no stated reason, which is worse than not stopping.
   */
  if (action.kind === 'ask_user') {
    if (!(action.text ?? '').trim()) {
      return deny('ask_user carried no question; put the question in "text"');
    }
    return { action, allowed: true };
  }

  /**
   * `answer` acts on nothing, so it belongs with the target-less kinds and must be
   * checked BEFORE the target requirement below — placed after it, the rule was dead
   * code that refused every answer for having no target.
   *
   * Still validated: an empty answer is worse than none, because the panel would render
   * a blank card and the user could not tell whether the agent failed or said nothing.
   */
  if (action.kind === 'answer') {
    if (!(action.text ?? '').trim()) return deny('answer action carried no text');
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

  // Strip decoration a small model tends to carry over from the prompt: "[el_5]",
  // "\"el_5\"", "el_5.". This is NOT a security relaxation — the id must still be one
  // we minted this turn, and an unknown id is still refused.
  const targetId = action.target.trim().replace(/^[[("'`]+|[\])"'`.,]+$/g, '');
  const node = nodes.get(targetId);
  // Ids are minted per extraction. An unknown id is a hallucination or a stale
  // reference to a page that has since changed; either way we must not guess.
  if (!node) return deny(`unknown element id: ${action.target}`);
  // Normalise the action itself, so the executor resolves the same element we checked.
  action.target = targetId;

  if (!node.visible) return deny(`element ${action.target} is not visible`);
  if (!node.enabled) return deny(`element ${action.target} is disabled`);

  /**
   * DOING THE SAME THING TWICE IS NEVER PROGRESS.
   *
   * Typing the same value into the same field again is legal, harmless and completely
   * pointless. It is also what the model does once a task is finished: having submitted
   * the form, it goes back and refills boxes that are already correct, because it will
   * not emit the action that says it has finished. Measured over five runs of the
   * multi-step fixture, this wasted a turn in two of them, and a turn is about five
   * seconds of a twenty-six second task.
   *
   * Refusing it is safe because it changes nothing: the field already holds that exact
   * value. And the refusal is what lets the loop upstream recognise that every remaining
   * proposal is a repeat, which is the signal that the work is done.
   */
  /**
   * ⛔ ASK THE PAGE, NOT THE HISTORY.
   *
   * This used to refuse on the history of ATTEMPTS alone and report it as
   * "`${target}` already has that value" — a claim about the element that nothing had
   * checked. Refused actions are themselves pushed into that history, so one attempt
   * that failed to stick produced a permanent, self-reinforcing refusal.
   *
   * It broke a live run on demoqa.com: the Subjects box is a React autocomplete that
   * does not keep a plain value assignment, so the type never took effect, the model
   * correctly retried, and we blocked it twice with an untrue explanation and gave up.
   *
   * So the ELEMENT decides. If it really holds the value, this is a genuine no-op and
   * refusing it is right. If it does not, the retry is legitimate — the first attempt
   * simply did not land.
   */
  const repeats = done.filter((d) => d.kind === action.kind && d.target === action.target
                    && (d.value ?? null) === (action.value ?? null)).length;
  const nodeHasIt = (node.value ?? null) === (action.value ?? null);

  if (repeats > 0 && nodeHasIt) {
    return deny(`${action.target} already has that value; this action would change nothing`);
  }
  /**
   * Tried twice and the page still does not show it. Refuse — but say what is actually
   * true, because "already has that value" would be the opposite of the truth here, and
   * a custom widget that ignores a scripted value is a real and common thing.
   */
  if (repeats >= 2 && !nodeHasIt) {
    return deny(`typing into ${action.target} is not taking effect after ${repeats} `
      + `attempts — it is likely a custom widget that ignores a scripted value; `
      + `try a different element or action`);
  }

  /**
   * A click on a dropdown is legal, useless, and costs a whole turn.
   *
   * The prompt already tells the model to set a dropdown with kind "select" and one of
   * its listed choice values. On the multi-step grievance fixture the 7B model ignored
   * that and opened turn 1 with click(el_5) on the category <select>. Nothing in the
   * validator objected, because clicking a visible enabled element is permitted, so the
   * action was executed, changed nothing, and the category stayed empty. Three turns
   * later Submit was still disabled and the task was abandoned one field short.
   *
   * Telling the model again was not the answer; it had already been told. Refusing the
   * action puts the reason into the history the model sees next turn, which is a
   * correction it cannot skim past. The options are already on the node, so it has
   * everything it needs to choose one.
   */
  if (action.kind === 'click' && node.role === 'select') {
    const choices = (node.options ?? []).map((o) => o.value).filter(Boolean);
    return deny(
      `${action.target} is a dropdown: use kind "select" with one of its values`
      + (choices.length ? ` (${choices.slice(0, 6).join(', ')})` : ''),
    );
  }

  /**
   * "type" into a dropdown, where the value IS one of that dropdown's own choices.
   *
   * Normalised to a select rather than refused. This is not a guess about what the
   * model meant. Across repeated runs of the multi-step fixture the 7B model reliably
   * identified the right element and the right option — {"kind":"type","target":"el_5",
   * "value":"billing"} — and simply would not emit the word "select", through a prompt
   * rule, a worked example in the prompt, and a schema that offered the kind. Refusing
   * it cost the task: category stayed empty, Submit stayed disabled, and the run ended
   * three turns in having filled two fields of three.
   *
   * It is bounded, which is why it is safe to normalise. The value must match one of
   * the options ALREADY on the node, so the only reachable outcome is a state the page
   * itself offers. It cannot place a token in the wrong field, which is the risk the
   * kind-agreement rule below exists to stop.
   *
   * `normalised` is recorded so the Privacy Ledger shows the rewrite. A correction the
   * user cannot see is indistinguishable from the agent doing something it was not
   * asked to do.
   */
  if (action.kind === 'type' && node.role === 'select' && typeof action.value === 'string') {
    const match = (node.options ?? []).find(
      (o) => o.value === action.value
          || o.value.toLowerCase() === action.value!.toLowerCase()
          || o.label.toLowerCase() === action.value!.toLowerCase(),
    );
    if (match) {
      action.kind = 'select';
      action.value = match.value;
      (action as { normalised?: string }).normalised = 'type on a dropdown read as select';
    }
  }

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
      /**
       * AN INVENTED TOKEN IS A REQUEST FOR A VALUE THAT IS NOT ON THIS PAGE.
       *
       * Manas reported this on mca.gov.in: the "Income Tax PAN" box is empty, every turn
       * correctly reports nothing withheld, and the model emits `<PII_PAN_1>` anyway.
       * Detection is fine and the refusal is right — typing an unresolvable token would
       * put the literal string "<PII_PAN_1>" into the form, and resolving it is
       * impossible because no such value was ever vaulted.
       *
       * What was wrong was the refusal TEXT. "unknown placeholder token: <PII_PAN_1>"
       * describes the model's mistake and names no alternative, so the re-plan it feeds
       * produces the same action again, and the run ends on a message no user can act on.
       * The same shape as the dropdown refusal that stopped a task at two fields of
       * three: a refusal the model cannot act on is a refusal that will be retried.
       *
       * So the reason states the fact, the cause and the two ways out. It is deliberately
       * one sentence — it is prepended to the history of every following turn, and this
       * machine generates about 11 tokens a second.
       */
      if (!known) {
        /**
         * THE REFUSAL HANDS OVER THE EXACT ACTION, BECAUSE A 7B MODEL COPIES AND DOES
         * NOT GENERALISE.
         *
         * Measured against the live model. A general rule in the system prompt, with a
         * PAN example, made it emit `ask_user` on the PAN page 4 times out of 4 — and the
         * control killed the result: swap the field for "Driving Licence Number", which
         * the prompt never mentions, and it invented `<PII_LICENSE_1>` 3 times out of 3
         * instead of asking. It was copying the example, not applying the rule, and the
         * first test could not tell the difference because the treatment was inside it.
         *
         * The client does not need the model to generalise. It is holding the node, so it
         * knows what the field is called, and it can write the whole action out for the
         * model to copy — which is the one thing a small model does reliably.
         *
         * The label is OUR text, from our own extractor, not something the page asserts
         * about itself; and a label that is itself redacted would produce a question with
         * a token in it, so that falls back to neutral phrasing.
         */
        const rawLabel = (node.label ?? '').trim();
        const usable = rawLabel && !/<PII_[A-Z_]+_\d+>/.test(rawLabel) && rawLabel.length <= 60;
        const question = usable ? `What is your ${rawLabel}?` : 'What value should go here?';
        return deny(
          `no value like ${action.value} was withheld on this page, so you do not have `
          + `it — either ask for it with {"kind":"ask_user","text":"${question}",`
          + '"reasoning":"not on page"} or leave the field empty and continue',
          { kind: 'ask_user', question, target: node.id },
        );
      }

      // KIND AGREEMENT. Without this a hostile page can simply ask the agent to put
      // <PII_PAN_1> into a box labelled "Optional feedback" that posts to the
      // attacker's server. The model emits only a token, so nothing looks wrong — but
      // the CLIENT resolves that token to the real PAN at execution time and types it
      // in. That was a working exfiltration path, found by bench/injection-test.ts.
      //
      // A token may only be resolved into a field layer 1 classified as the same kind.
      // The page cannot forge that: `fieldKind` comes from our own classifier, not from
      // anything the page asserts.
      // ⚠ `[A-Z_]+`, NOT `[A-Z]+`. A multiword kind — `<PII_BANK_ACCOUNT_1>` —
      // left this undefined, so the kind-agreement check below silently did
      // nothing and the injection path it exists to close was open for every
      // multiword kind. TOKEN_RE above was widened when BANK_ACCOUNT landed;
      // this copy was missed. Tenth instance of the same regex.
      const tokenKind = action.value.match(/^<PII_([A-Z_]+)_\d+>$/)?.[1];
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
  done: AgentAction[] = [],
): ValidationReport {
  const nodes = indexNodes(payload.root);
  const results = actions.map((a) => validateAction(a, payload, nodes, done));
  return {
    results,
    allowed: results.filter((r) => r.allowed).map((r) => r.action),
    denied: results.filter((r) => !r.allowed),
  };
}
