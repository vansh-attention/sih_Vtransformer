/**
 * The sanitizer — SIH26171. The privacy boundary itself.
 *
 * `PageStructure` (has real values) goes in. `SanitizedPayload` (has only tokens)
 * comes out. Nothing else in the extension is allowed to build a network payload.
 *
 * Guiding rule: REPLACE THE VALUE, KEEP THE SHAPE. We never black out a region. A
 * typed token — `<PII_PAN_1>` — lets the server reason "the PAN field is populated
 * and valid" while staying blind to it. That is the PS's requirement that the server
 * be "aware of the redaction scheme", and it is why redaction precision (20%) and
 * visual-context accuracy (25%) do not have to fight each other.
 */

import type {
  Acknowledgement, AgentAction, ElementId, ElementNode, PageStructure, PiiKind,
  Placeholder, SanitizedNode, SanitizedPayload,
} from '../contracts.ts';
import { classifyField, reconcile, REDACT_THRESHOLD, type FieldSignals } from '../pii/dom.ts';
import { scanText } from '../pii/patterns.ts';
import { detectNames, gazetteerLoaded } from '../pii/names.ts';
import { applyRedactions, Vault } from './vault.ts';

export type SignalsLookup = (id: ElementId) => FieldSignals | undefined;

export interface SanitizeOptions {
  goal: string;
  vault: Vault;
  /** Supplies DOM signals per element. In the content script this wraps
   *  `resolveElement` + `signalsFor`; in tests it is a plain map. */
  signals: SignalsLookup;
  history?: AgentAction[];
  /** Already face-blurred by the vision layer before it reaches here. */
  screenshot?: string;
}

export interface SanitizeResult {
  payload: SanitizedPayload;
  /** Counts per kind, for the Privacy Ledger. Never the values themselves. */
  withheld: Array<{ kind: PiiKind; count: number }>;
}

/**
 * Redact a FIELD VALUE. The field's own hint applies here, so a value sitting in a
 * field labelled "Aadhaar" is redacted even when no pattern recognises its format.
 */
function redactValue(
  text: string,
  signals: FieldSignals | undefined,
  vault: Vault,
  kept?: Array<{ kind: PiiKind; reason: string }>,
): { text: string; placeholders: Placeholder[] } {
  const hint = signals ? classifyField(signals) : null;
  const placeholders: Placeholder[] = [];

  // Passwords are unconditional and never partially redacted.
  if (hint?.kind === 'PASSWORD') {
    const token = vault.mint('PASSWORD', text);
    return {
      text: token,
      placeholders: [{ token, kind: 'PASSWORD', source: 'dom', confidence: 1, verified: true }],
    };
  }

  const detections = scanText(text);
  const spans: Array<{ start: number; end: number; kind: PiiKind }> = [];

  for (const det of detections) {
    const resolved = reconcile(hint, det);
    if (!resolved?.redact) {
      // Detected, examined, deliberately kept. Record WHY so the server can trust it.
      if (resolved) kept?.push({ kind: resolved.kind, reason: resolved.rationale });
      continue;
    }
    spans.push({ start: det.start, end: det.end, kind: resolved.kind });
    placeholders.push({
      token: '', // filled in below, once the token is minted
      kind: resolved.kind,
      source: det.verified ? 'pattern' : 'dom',
      confidence: resolved.confidence,
      verified: resolved.verified,
    });
  }

  // LAYER 3: person names, which have no pattern and may have no labelling cue.
  // Runs only where layers 1 and 2 found nothing, so it never overrides a checksum-
  // verified match and never fires inside a commercial-context field.
  if (spans.length === 0 && hint?.kind !== 'NON_PII' && gazetteerLoaded()) {
    for (const n of detectNames(text)) {
      if (n.confidence < REDACT_THRESHOLD) {
        kept?.push({ kind: 'NAME', reason: `name-shaped but low confidence: ${n.reason}` });
        continue;
      }
      spans.push({ start: n.start, end: n.end, kind: 'NAME' });
      placeholders.push({
        token: '', kind: 'NAME', source: 'model',
        confidence: n.confidence, verified: false,
      });
    }
  }

  // The field is labelled sensitive but nothing in the value parsed. Trust the label
  // and replace the whole thing — an unrecognised format in a field called "Aadhaar"
  // is still somebody's Aadhaar.
  if (spans.length === 0 && hint && hint.kind !== 'NON_PII') {
    const resolved = reconcile(hint, null);
    if (resolved?.redact) {
      const token = vault.mint(resolved.kind, text);
      return {
        text: token,
        placeholders: [{
          token, kind: resolved.kind, source: 'dom',
          confidence: resolved.confidence, verified: false,
        }],
      };
    }
  }

  if (spans.length === 0) return { text, placeholders: [] };

  const { text: redacted, tokens } = applyRedactions(text, spans, vault);
  tokens.forEach((t, i) => { if (placeholders[i]) placeholders[i].token = t.token; });
  return { text: redacted, placeholders };
}

/**
 * Redact a LABEL. Deliberately runs with no field hint.
 *
 * A label describes a field; it is not the field's value. Applying the hint here would
 * make the label "Aadhaar Number" match rule 2 of `reconcile` and get replaced
 * wholesale — destroying exactly the context the server needs to act, and tanking both
 * visual-context accuracy and redaction precision. Only PII genuinely present in the
 * label text ("Welcome, Harsh Bajpai") is removed.
 */
function redactLabel(
  text: string,
  signals: FieldSignals | undefined,
  vault: Vault,
  kept?: Array<{ kind: PiiKind; reason: string }>,
): { text: string; placeholders: Placeholder[] } {
  // Demotion-only use of the hint. A commercial-context hint may SUPPRESS a match
  // (the "Order Total 999999999999" case), but a positive hint may never promote or
  // wholesale-replace label text — that would blank the label "Aadhaar Number" and
  // destroy the very context the server needs.
  const hint = signals ? classifyField(signals) : null;
  const demotingHint = hint?.kind === 'NON_PII' ? hint : null;

  const detections = scanText(text);
  const spans: Array<{ start: number; end: number; kind: PiiKind }> = [];
  const placeholders: Placeholder[] = [];

  for (const det of detections) {
    const resolved = reconcile(demotingHint, det);
    if (!resolved?.redact) {
      if (resolved) kept?.push({ kind: resolved.kind, reason: resolved.rationale });
      continue;
    }
    spans.push({ start: det.start, end: det.end, kind: resolved.kind });
    placeholders.push({
      token: '', kind: resolved.kind, source: 'pattern',
      confidence: resolved.confidence, verified: resolved.verified,
    });
  }

  if (spans.length === 0) return { text, placeholders: [] };

  const { text: redacted, tokens } = applyRedactions(text, spans, vault);
  tokens.forEach((t, i) => { if (placeholders[i]) placeholders[i].token = t.token; });
  return { text: redacted, placeholders };
}

/**
 * Final sweep: nothing in the vault may survive anywhere in the payload.
 *
 * Per-node redaction is not enough. If the same value appears twice on a page and only
 * one occurrence sits in a PII context — a card number that is also printed in an
 * order-summary line, an email in both a form field and a footer — the per-node pass
 * redacts one and leaves the other. The value has still leaked.
 *
 * So the vault is treated as the source of truth: once a value is known to be secret,
 * every occurrence of it goes, regardless of local context. Matching tolerates
 * separators, because "4111 1111 1111 1111" and "4111111111111111" are the same secret.
 *
 * Found by `bench/leak-test.ts`, which flagged a NORMALISED leak the per-node pass had
 * no way to see.
 */
function sweepVaultLeaks(
  text: string,
  vault: Vault,
): { text: string; swept: Array<{ token: string; kind: PiiKind }> } {
  const swept: Array<{ token: string; kind: PiiKind }> = [];
  let out = text;

  for (const token of vault.tokens()) {
    const secret = vault.resolve(token);
    // Short secrets are skipped: matching a 3-character value everywhere would shred
    // unrelated text and cost far more redaction precision than it protects.
    if (!secret || secret.length < 6) continue;

    // Allow optional separators between characters so spaced and unspaced forms of the
    // same number both match.
    const pattern = [...secret]
      .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s\\-]*');
    const re = new RegExp(pattern, 'gi');

    if (re.test(out)) {
      out = out.replace(re, token);
      const kind = token.match(/^<PII_(.+)_\d+>$/)?.[1] as PiiKind | undefined;
      if (kind) swept.push({ token, kind });
    }
  }

  return { text: out, swept };
}

export function sanitize(structure: PageStructure, opts: SanitizeOptions): SanitizeResult {
  const { vault, signals } = opts;
  const allPlaceholders: Placeholder[] = [];
  const acknowledged: Acknowledgement[] = [];

  function walk(node: ElementNode): SanitizedNode {
    const sig = signals(node.id);

    const kept: Array<{ kind: PiiKind; reason: string }> = [];

    let value = node.value;
    if (value) {
      const r = redactValue(value, sig, vault, kept);
      value = r.text;
      allPlaceholders.push(...r.placeholders);
    }

    let label = node.label;
    if (label) {
      const r = redactLabel(label, sig, vault, kept);
      label = r.text;
      allPlaceholders.push(...r.placeholders);
    }

    // Neighbouring text is still text on the user's screen and can carry PII.
    let contextLabel = node.contextLabel;
    if (contextLabel) {
      const r = redactLabel(contextLabel, undefined, vault, kept);
      contextLabel = r.text;
      allPlaceholders.push(...r.placeholders);
    }

    for (const k of kept) acknowledged.push({ id: node.id, kind: k.kind, reason: k.reason });

    return {
      id: node.id,
      role: node.role,
      label,
      value,
      box: node.box,
      visible: node.visible,
      enabled: node.enabled,
      required: node.required,
      focused: node.focused,
      contextLabel,
      children: node.children?.map(walk),
    };
  }

  const root = walk(structure.root);

  // Second pass, over the already-sanitized tree. Must run after the first walk has
  // finished, because only then is the vault complete — a secret discovered in the
  // last form field still has to be scrubbed from text that appeared near the top.
  (function sweep(node: SanitizedNode) {
    if (node.value) {
      const r = sweepVaultLeaks(node.value, vault);
      node.value = r.text;
      for (const { token, kind } of r.swept) {
        allPlaceholders.push({ token, kind, source: 'dom', confidence: 1, verified: true });
      }
    }
    if (node.label) node.label = sweepVaultLeaks(node.label, vault).text;
    if (node.contextLabel) node.contextLabel = sweepVaultLeaks(node.contextLabel, vault).text;
    node.children?.forEach(sweep);
  })(root);

  // Origin only. The path and query string routinely carry identifiers — session
  // tokens, order ids, sometimes an email — and the server does not need them.
  let origin: string;
  try {
    origin = new URL(structure.url).origin;
  } catch {
    origin = 'about:blank';
  }

  const counts = new Map<PiiKind, number>();
  for (const p of allPlaceholders) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);

  return {
    payload: {
      origin,
      title: redactLabel(structure.title, undefined, vault).text,
      capturedAt: structure.capturedAt,
      viewport: structure.viewport,
      root,
      screenshot: opts.screenshot,
      placeholders: allPlaceholders,
      acknowledged,
      goal: opts.goal,
      history: opts.history ?? [],
    },
    withheld: [...counts].map(([kind, count]) => ({ kind, count })),
  };
}
