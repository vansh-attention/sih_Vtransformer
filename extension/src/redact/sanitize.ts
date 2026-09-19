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
import {
  classifyField, reconcile, canBe, isOrgContact, REDACT_THRESHOLD, type FieldSignals,
} from '../pii/dom.ts';
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
  /**
   * Counts per kind, for the Privacy Ledger. Never the values themselves.
   *
   * EXCLUDES the site's own published contact addresses, which are counted separately
   * below. They are still redacted and still leave as tokens — they are just not
   * somebody's personal data, and counting them here made the panel claim two personal
   * values on a page that held one.
   */
  withheld: Array<{ kind: PiiKind; count: number }>;
  /**
   * The site's own contact addresses, withheld but not personal.
   *
   * A separate number rather than a separate kind, so no token changes shape. See
   * `isOrgContact` in `pii/dom.ts` for the three conditions and for the far more
   * dangerous rule that was rejected.
   */
  orgContacts: number;
  /**
   * Distinct person names found in PROSE across the page, and whether that crossed the
   * threshold at which the page reads as being about people rather than holding one
   * person's data.
   *
   * Reported because a damper nobody can see is a damper nobody can audit: the panel and
   * the ledger need to be able to say "14 names on this page were left alone, and here is
   * why". The individual decisions are in `acknowledged`.
   */
  proseNameCandidates: number;
  referenceDocument: boolean;
  /**
   * Viewport boxes (CSS px) of every VISIBLE node something was redacted out of.
   *
   * Redacting the JSON does not erase the value from the user's screen, and the
   * screenshot is a photograph of that screen. Without these boxes a PAN is replaced by
   * `<PII_PAN_1>` in the payload and transmitted in full as pixels in the same request —
   * the fourth instance of this project's recurring leak shape, and the one the leak
   * test could never see because it only inspects the JSON.
   *
   * The caller masks these regions in the image before transmitting it.
   */
  piiBoxes: Array<{ x: number; y: number; w: number; h: number }>;
}

/**
 * Redact a FIELD VALUE. The field's own hint applies here, so a value sitting in a
 * field labelled "Aadhaar" is redacted even when no pattern recognises its format.
 */
/**
 * A field holds a value; a paragraph holds prose. 120 characters is the boundary, and it
 * is the same one the wholesale-replacement rule below uses — one number, one meaning.
 */
const FIELD_VALUE_MAX = 120;

/**
 * Tags that present a value somebody entered or that a record states about them.
 *
 * `dd` is here for the same reason it is in the wholesale-replacement rule: a `<dt>`/`<dd>`
 * pair is a labelling relationship in the accessibility tree, and read-only government
 * and banking records are marked up that way when there is no form to fill in.
 */
function isFieldPosition(signals: FieldSignals | undefined): boolean {
  return signals !== undefined
    && ['input', 'textarea', 'select', 'dd', 'output'].includes(signals.tag);
}

/**
 * Is this text PROSE rather than the value of a field?
 *
 * Used in exactly two places — the reference-document pre-pass and the layer-3 demotion
 * it feeds — so that the pass which COUNTS candidates and the pass which ACTS on the
 * count cannot drift apart. Two copies of this predicate would be the underscore-regex
 * bug again, in a place where the consequence is silently redacting less.
 */
function isProsePosition(text: string, signals: FieldSignals | undefined): boolean {
  return text.length > FIELD_VALUE_MAX && !isFieldPosition(signals);
}

function redactValue(
  text: string,
  signals: FieldSignals | undefined,
  vault: Vault,
  kept?: Array<{ kind: PiiKind; reason: string }>,
  /** Host of the page being sanitized. Absent means no address can be judged the
   *  site's own, so everything stays a personal finding — the safe direction. */
  pageHost?: string,
  /**
   * True when the PAGE as a whole reads as a reference document — see
   * `REFERENCE_DOC_NAMES` in `sanitize`. Only ever demotes, and only layer-3 names in
   * prose. Absent means the damper is off, which is the behaviour every existing caller
   * and every test had before it existed.
   */
  referenceDocument?: boolean,
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

  /**
   * A DIGIT RUN THAT IS THE WHOLE VALUE OF A FIELD IS NOT AN INVOICE NUMBER.
   *
   * The corpus lesson "an unverified 12-digit run is more likely an invoice than an
   * Aadhaar" was learned from digits sitting in PROSE and in TABLE CELLS — an order
   * total, a bank-statement reference. It was then applied everywhere, including to a
   * value a person had typed into an input, where it is plainly wrong: somebody who
   * types twelve digits into a box has entered a number that means something, and if
   * it is shaped like an Aadhaar it must not be transmitted just because its checksum
   * fails. A real Aadhaar with one digit mistyped is still the person's Aadhaar.
   *
   * So: when the detection covers essentially the entire value of a FORM CONTROL, an
   * unverified digit-kind is promoted to the redact threshold. In prose it is not.
   * This keeps the precision win where it was earned and stops it costing recall
   * where it never applied.
   */
  const isFormValue = signals !== undefined
    && ['input', 'textarea', 'select', 'output'].includes(signals.tag);
  const trimmed = text.trim();
  const DIGIT_KINDS = new Set<PiiKind>(['AADHAAR', 'CARD', 'PHONE']);
  const coversWholeField = (d: { start: number; end: number; raw: string }) =>
    isFormValue && d.raw.trim() === trimmed && trimmed.length > 0;

  for (const det of detections) {
    const resolved = reconcile(hint, det);
    /**
     * ⛔ NEVER over a NON_PII field. This condition was missing and it cost precision
     * immediately: an "application number" decoy on the Hindi fixtures is twelve digits
     * filling a whole input, so the promotion redacted it and the scorer caught two
     * over-redactions that had not been there before.
     *
     * A field the classifier has positively identified as commercial context is EVIDENCE,
     * and stronger evidence than "these digits are Aadhaar-shaped". Over-redaction is
     * scored exactly as heavily as leaking.
     */
    if (resolved && !resolved.redact && !det.verified
        && hint?.kind !== 'NON_PII'
        && DIGIT_KINDS.has(det.kind) && coversWholeField(det)) {
      /**
       * NAMING IT STILL NEEDS TWO SIGNALS.
       *
       * Reaching here means the SHAPE matched and the checksum did NOT, and that the
       * printed grouping gave no corroboration either — a grouped `4540 2012 2334`
       * already clears the threshold above and never arrives here.
       *
       * Shape alone is one signal. A 15-digit run is a card length AND an account
       * length; calling it a CARD because the card rule has the higher priority is the
       * same guess that published a PAN as an Aadhaar. So the field decides if it can,
       * and otherwise this is redacted as SENSITIVE.
       */
      /**
       * NON_PII is a CLASSIFICATION, not a kind, and must never become a token.
       *
       * Removing this check once produced `<PII_NON_PII_1>` — an incoherent token that
       * also happened to be INVISIBLE to the scorer, whose token regex could not match
       * an underscore inside the kind. The decoy was destroyed and the scorecard
       * reported it clean. Belt and braces, because the cost of being wrong here is a
       * silent one.
       */
      const hinted = hint && hint.kind !== 'NON_PII'
        ? (hint.kind as PiiKind) : undefined;
      const kind: PiiKind = hinted && canBe(hinted, det.raw) ? hinted : 'SENSITIVE';
      spans.push({ start: det.start, end: det.end, kind });
      placeholders.push({
        token: '',
        kind,
        source: 'dom',
        confidence: REDACT_THRESHOLD,
        verified: false,
      });
      continue;
    }
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
      // Still redacted, still tokenised — this only decides what it is CALLED.
      ...(resolved.kind === 'EMAIL' && isOrgContact(det.raw, signals, pageHost)
        ? { orgContact: true } : {}),
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
      /**
       * THE PAGE IS ABOUT PEOPLE, SO NONE OF THEM ARE YOU.
       *
       * No per-value signal separates "Vikram Sharma called this morning to dispute the
       * charge" from "Kapil Sibal argued for the petitioners". Both are a person's name
       * in a sentence, both score 0.9 through the gazetteer, and one is the user's data
       * while the other is an encyclopedia's subject matter. The separation has to come
       * from the page, and the claim is that your own data appears on a page in SMALL
       * NUMBERS — a form names you once, a statement names an account holder, a case note
       * names a customer and whoever it was escalated to.
       *
       * Three conditions, all required, the same shape as `isOrgContact`: the page as a
       * whole carries many prose name candidates, this text is prose rather than a
       * field's value, and confidence already cleared the bar. Demoted into
       * `acknowledged` rather than dropped, so the decision is visible in the ledger and
       * a reviewer can see what was NOT withheld and why.
       */
      if (referenceDocument && isProsePosition(text, signals)) {
        kept?.push({ kind: 'NAME',
                     reason: `name in prose on a page about many people: ${n.reason}` });
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
  //
  // ONLY FOR SHORT VALUES. A form field holds a value; a paragraph holds prose. On a
  // real Wikipedia article this rule replaced entire paragraphs with a single token
  // because some nearby text mentioned a name — destroying the page content the server
  // needs to read. Long text gets span-level redaction or nothing.
  // AND only where something genuinely LABELS the value. A label vouches for the value
  // of a field; a paragraph has no label vouching for it, and a nearby name-ish heading
  // is not permission to replace an article's prose with a token.
  //
  // `<dd>` counts. A <dt>/<dd> pair is a labelling relationship in the same sense as
  // <label for> — the browser, the accessibility tree and every reader treat the <dt> as
  // naming the <dd>, and it is how read-only government and banking records are marked
  // up when there is no form to fill in. Restricting this to form controls meant
  //
  //   <dt>Address</dt><dd>22 Rashbehari Avenue, Kolkata 700029</dd>
  //
  // went out in full: the hint said ADDRESS, no pattern matched, and the rule declined
  // to act. Reproduced in plain English before being fixed, so it was never a
  // Bengali-specific bug — bengali-opaque.html just happened to be the first fixture in
  // the corpus that displayed values instead of editing them.
  //
  // <td> is deliberately NOT here. A table cell takes meaning from a column header
  // shared with every other row, and on a bank statement that route already redacted
  // references and balances as Aadhaar numbers once.
  if (spans.length === 0 && isFieldPosition(signals) && text.length <= FIELD_VALUE_MAX
      && hint && hint.kind !== 'NON_PII') {
    // `text` is the field's own value — reconcile needs it to rule out a hinted kind
    // the value cannot possibly be.
    const resolved = reconcile(hint, null, text);
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
  pageHost?: string,
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
      // The footer address in the original report arrives here, not through
      // redactValue — it is page text, and nobody typed it.
      ...(resolved.kind === 'EMAIL' && isOrgContact(det.raw, signals, pageHost)
        ? { orgContact: true } : {}),
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
  /**
   * Taken from the structure rather than added as an option, so every existing caller
   * — the content script, all five bench drills, the tests — gets it for free. An
   * unparseable URL yields undefined, and undefined means no address can be judged the
   * site's own: the rule simply never fires and everything stays as it was.
   */
  let pageHost: string | undefined;
  try { pageHost = new URL(structure.url).hostname || undefined; } catch { pageHost = undefined; }
  const allPlaceholders: Placeholder[] = [];
  const acknowledged: Acknowledgement[] = [];
  const piiBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];

  /**
   * HOW MANY DISTINCT PEOPLE DOES THIS PAGE TALK ABOUT IN PROSE?
   *
   * A pre-pass, not a post-pass, because the alternative is un-redacting after the fact:
   * the value would already be in the vault and the token already in the payload, and
   * reversing a redaction is the direction that creates leaks.
   *
   * It counts what the walk would actually redact — same `detectNames`, same threshold,
   * same `isProsePosition` predicate — over the structure the extractor KEPT, not over
   * the raw document. Counting the document instead reports 10 names on mygov.html where
   * the pipeline withholds none, because most of those nodes never survive extraction.
   * Measuring the stage instead of the operation is this project's most repeated mistake.
   *
   * Cost is one extra `detectNames` per prose node. On wikipedia.html, the heaviest page
   * in any corpus, that is the difference reported in the drill rather than assumed.
   */
  function countProseNames(node: ElementNode, seen: Set<string>): Set<string> {
    if (node.value && gazetteerLoaded() && isProsePosition(node.value, signals(node.id))) {
      for (const n of detectNames(node.value)) {
        if (n.confidence >= REDACT_THRESHOLD) seen.add(n.text);
      }
    }
    node.children?.forEach((c) => countProseNames(c, seen));
    return seen;
  }

  /**
   * The threshold, and why it is six.
   *
   * Measured with `bench/name-density.ts` and printed per page by
   * `bench/realpages-drill.ts --list`. Every transactional page in every corpus sits at
   * 0-2 distinct prose names; the encyclopedia articles sit at 14-15. Six is chosen to
   * leave a wide margin on BOTH sides rather than to make one page pass: a case note
   * naming half a dozen people is still treated as holding personal data, and it would
   * take a sevenfold increase over anything observed in a transactional page to trip
   * this. The gap it exploits is an order of magnitude, which is why the exact number
   * barely matters — and if it ever does start to matter, the design is wrong rather
   * than the constant.
   */
  const REFERENCE_DOC_NAMES = 6;
  const proseNames = countProseNames(structure.root, new Set<string>());
  const referenceDocument = proseNames.size > REFERENCE_DOC_NAMES;

  /**
   * Record a node's box if this pass redacted anything out of it AND it is on screen.
   * Invisible nodes are skipped deliberately: they contribute nothing to the screenshot,
   * and masking them would blank regions of the image for no privacy gain.
   */
  function noteRedaction(node: { box?: { x: number; y: number; w: number; h: number };
                                visible?: boolean }, before: number): void {
    if (allPlaceholders.length === before) return;
    if (!node.visible || !node.box) return;
    if (node.box.w <= 0 || node.box.h <= 0) return;
    piiBoxes.push(node.box);
  }

  function walk(node: ElementNode): SanitizedNode {
    const sig = signals(node.id);

    const kept: Array<{ kind: PiiKind; reason: string }> = [];
    const placeholdersBefore = allPlaceholders.length;

    let value = node.value;
    if (value) {
      const r = redactValue(value, sig, vault, kept, pageHost, referenceDocument);
      value = r.text;
      allPlaceholders.push(...r.placeholders);
    }

    let label = node.label;
    if (label) {
      const r = redactLabel(label, sig, vault, kept, pageHost);
      label = r.text;
      allPlaceholders.push(...r.placeholders);
    }

    // Neighbouring text is still text on the user's screen and can carry PII.
    let contextLabel = node.contextLabel;
    if (contextLabel) {
      const r = redactLabel(contextLabel, undefined, vault, kept, pageHost);
      contextLabel = r.text;
      /**
       * CONTEXT THAT IS ITSELF REDACTED IS NOT CONTEXT.
       *
       * The nearest neighbour of a value is sometimes another value. On the demo page a
       * PAN sits immediately after the user's name, so the PAN's context label was the
       * name, and once the name was correctly redacted the PAN arrived at the model
       * described as "<PII_NAME_1>". That tells it nothing whatsoever, and the scorecard
       * counted it as surrounding context destroyed, which is exactly what it was.
       *
       * Dropping it is strictly better than sending it. The model loses a string it
       * could not read anyway, and the useful word is usually still present nearby: on
       * the same page the enclosing sentence, "Logged in as . PAN", survives intact and
       * carries the meaning.
       *
       * This is the companion to the rule that evidence about a value must not come from
       * the value. Here, evidence about a value must not consist solely of another
       * value's placeholder.
       */
      if (contextLabel && /^\s*(<PII_[A-Z_]+_\d+>\s*)+$/.test(contextLabel)) {
        contextLabel = undefined;
      }
      allPlaceholders.push(...r.placeholders);
    }

    for (const k of kept) acknowledged.push({ id: node.id, kind: k.kind, reason: k.reason });

    noteRedaction(node, placeholdersBefore);

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
      fieldKind: node.fieldKind,
      checked: node.checked,
      group: node.group,
      crossOriginForm: node.crossOriginForm,
      options: node.options?.map((o) => ({
        value: o.value,
        label: redactLabel(o.label, undefined, vault).text,
      })),
      contextLabel,
      children: node.children?.map(walk),
    };
  }

  const root = walk(structure.root);

  // Second pass, over the already-sanitized tree. Must run after the first walk has
  // finished, because only then is the vault complete — a secret discovered in the
  // last form field still has to be scrubbed from text that appeared near the top.
  (function sweep(node: SanitizedNode) {
    const before = allPlaceholders.length;
    let swept = false;
    if (node.value) {
      const r = sweepVaultLeaks(node.value, vault);
      node.value = r.text;
      for (const { token, kind } of r.swept) {
        allPlaceholders.push({ token, kind, source: 'dom', confidence: 1, verified: true });
      }
    }
    // The label/contextLabel sweeps mint no placeholders, so a changed string is the
    // only evidence they fired. Without this check a value caught ONLY by the second
    // pass would be masked in the JSON and left legible in the image.
    if (node.label) {
      const t = sweepVaultLeaks(node.label, vault).text;
      if (t !== node.label) swept = true;
      node.label = t;
    }
    if (node.contextLabel) {
      const t = sweepVaultLeaks(node.contextLabel, vault).text;
      if (t !== node.contextLabel) swept = true;
      node.contextLabel = t;
    }
    if (swept) piiBoxes.push(...(node.visible && node.box
      && node.box.w > 0 && node.box.h > 0 ? [node.box] : []));
    else noteRedaction(node, before);
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
  let orgContacts = 0;
  for (const p of allPlaceholders) {
    if (p.orgContact) { orgContacts++; continue; }
    counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  }

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
    orgContacts,
    proseNameCandidates: proseNames.size,
    referenceDocument,
    // De-duplicated: a node redacted in both passes would otherwise be masked twice.
    piiBoxes: [...new Map(piiBoxes.map((b) => [`${b.x},${b.y},${b.w},${b.h}`, b])).values()],
  };
}
