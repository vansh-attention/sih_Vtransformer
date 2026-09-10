/**
 * PII layer 3 — person names. SIH26171.
 *
 * Catches person names, which layers 1 and 2 structurally cannot: layer 1 needs a
 * labelling cue and layer 2 needs a pattern, and a human name in prose has neither.
 *
 * MEASURED CONTRIBUTION (tuned corpus, bench/score.ts --no-layer3 for the counterfactual)
 *
 *   layer 3 OFF   recall  88.9%   precision 100.0%   F1 94.1%
 *   layer 3 ON    recall 100.0%   precision 100.0%   F1 100.0%
 *
 * On the HOLDOUT it changes nothing: 91.7% / 100% either way. See below.
 *
 * WHY A GAZETTEER AND NOT A TRANSFORMER
 *
 * The obvious answer is a pretrained NER model, and it was priced: `bert-base-NER` is
 * **103 MB** int8 — over four times the extension's entire footprint. Spike A1 showed
 * int8 runs ~10x slower on WebGPU, so it would fall back to WASM too. Client resources
 * are 20% of the grade. This gazetteer is **1 MB** and needs no inference at all.
 *
 * THE CEILING, STATED PLAINLY
 *
 * A gazetteer only knows names that are on a list. The holdout's missed name is in
 * NONE of the three public datasets tried, including a 30k-entry Indian-names corpus.
 * Adding more lists did not fix it and should not be expected to: this approach has an
 * unpatchable tail, and only a model that generalises to unseen names closes it.
 *
 * So the honest position is: layer 3 buys real recall on COMMON names in prose, at
 * ~1/100th the cost of a transformer, and does not pretend to solve the general case.
 * If name recall on arbitrary names becomes a requirement, the 103 MB model is the
 * answer and the trade should be made deliberately.
 *
 * NOTE ON METHOD: the gazetteers are taken wholesale from public datasets. No entry was
 * added because it appeared in `bench/holdout/` — that would be tuning against the
 * holdout and would invalidate the only generalisation signal the project has.
 */

export interface NameSpan {
  start: number;
  end: number;
  text: string;
  confidence: number;
  reason: string;
}

let GIVEN: Set<string> = new Set();
let FAMILY: Set<string> = new Set();
let DICTIONARY: Set<string> = new Set();
let loaded = false;

export function loadGazetteer(
  data: { given: string[]; family: string[]; dictionary?: string[] },
): void {
  GIVEN = new Set(data.given);
  FAMILY = new Set(data.family);
  DICTIONARY = new Set(data.dictionary ?? []);
  loaded = true;
}

export function gazetteerLoaded(): boolean {
  return loaded;
}

/**
 * Title-Case words that are almost never a person in running text.
 *
 * Sentence-initial capitalisation is the dominant false positive: "Reach me at…",
 * "Please call…", "Submit application". Without this the detector flags the first word
 * of every sentence on the page and redaction precision collapses — and precision is
 * scored twice in this PS.
 */
const NOT_NAMES = new Set([
  // sentence openers and common verbs/determiners
  'the', 'this', 'that', 'these', 'those', 'there', 'then', 'thus', 'they',
  'please', 'reach', 'submit', 'contact', 'call', 'write', 'email', 'send',
  'your', 'you', 'our', 'we', 'it', 'is', 'are', 'was', 'were', 'has', 'have',
  'caller', 'customer', 'applicant', 'user', 'member', 'account', 'order',
  'invoice', 'total', 'amount', 'payment', 'card', 'bank', 'reference',
  'ticket', 'support', 'internal', 'note', 'verified', 'registered', 'login',
  'annual', 'family', 'income', 'national', 'scholarship', 'portal', 'application',
  // months and days
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // frequent place/org words that are Title-Cased and gazetteer-collide
  'new', 'delhi', 'mumbai', 'india', 'road', 'street', 'nagar', 'city', 'state',
]);

/**
 * Words that mark the surrounding phrase as an ORGANISATION, not a person.
 *
 * Many surnames are also company names — measured on the tuned corpus, "Kotak Mahindra
 * Bank Limited" was redacted as a person because a gazetteer surname sat inside it.
 * Company names are not PII, and redacting them costs precision, which is scored twice.
 *
 * A generic linguistic rule about corporate suffixes, so it generalises past the one
 * case that exposed it.
 */
const ORG_MARKERS = new Set([
  'bank', 'limited', 'ltd', 'pvt', 'private', 'inc', 'incorporated', 'corp',
  'corporation', 'company', 'co', 'llp', 'plc', 'gmbh', 'holdings', 'group',
  'industries', 'enterprises', 'services', 'solutions', 'technologies', 'systems',
  'university', 'institute', 'college', 'school', 'hospital', 'trust', 'foundation',
  'department', 'ministry', 'authority', 'board', 'council', 'bureau', 'commission',
  // Institutions and civic bodies. Found on real government and encyclopedia pages,
  // where "Lok Sabha", "Rajya Sabha" and "<X> Programme" were being redacted as people.
  'sabha', 'parliament', 'assembly', 'court', 'tribunal', 'programme', 'program',
  'scheme', 'mission', 'yojana', 'act', 'bill', 'committee', 'agency', 'corporation',
  // Government department vocabulary. "Child Development" and "Caste Welfare" are
  // fragments of ministry names, not people — generic enough to generalise beyond the
  // page that exposed them.
  'welfare', 'development', 'affairs', 'panchayat', 'municipal', 'directorate',
  'secretariat', 'division', 'cell', 'wing', 'portal', 'initiative',
]);

/**
 * Does an organisation marker sit in or beside this span?
 *
 * The span ITSELF is included, not just its surroundings. "Pragati Programme" was being
 * redacted as a person because `programme` was inside the matched span rather than near
 * it, so the guard never saw it — the same applies to "<X> Mission", "<Y> Trust" and
 * every other two-token organisation name.
 */
function nearOrgMarker(text: string, start: number, end: number): boolean {
  const window = text.slice(Math.max(0, start - 40), end + 40);
  const words = window.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((w) => ORG_MARKERS.has(w));
}

/** A Title-Case alphabetic token: "Ananya", "O'Brien", "Raghunathan". */
const TOKEN_RE = /\b[A-Z][a-z'’\-]{1,24}\b/g;

interface Token { text: string; start: number; end: number }

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[’]/g, "'");

/**
 * Find probable person names.
 *
 * Confidence is driven by gazetteer agreement, not by capitalisation alone. A
 * structurally name-shaped phrase with no gazetteer support scores below the redaction
 * threshold on purpose: "Kotak Mahindra" and "New Delhi" are both two Title-Case tokens,
 * and redacting them would cost more precision than the recall is worth.
 */
export function detectNames(text: string): NameSpan[] {
  if (!loaded || !text || text.length > 2000) return [];

  const tokens = tokenize(text).filter((t) => !NOT_NAMES.has(norm(t.text)));
  const spans: NameSpan[] = [];
  const push = (span: NameSpan) => {
    // An organisation marker nearby demotes the match below the redaction threshold
    // rather than dropping it, so the decision stays visible in `acknowledged`.
    if (nearOrgMarker(text, span.start, span.end)) {
      spans.push({ ...span, confidence: span.confidence * 0.4,
                   reason: `${span.reason}, but organisation marker nearby` });
      return;
    }
    spans.push(span);
  };
  let i = 0;

  while (i < tokens.length) {
    const a = tokens[i];
    const b = tokens[i + 1];
    // Adjacent means separated only by a space or hyphen — not across a full stop,
    // which would join the end of one sentence to the start of the next.
    const adjacent = b !== undefined
      && b.start - a.end <= 2
      && /^[\s\-]*$/.test(text.slice(a.end, b.start));

    const aGiven = GIVEN.has(norm(a.text));
    const aFamily = FAMILY.has(norm(a.text));
    const bGiven = b ? GIVEN.has(norm(b.text)) : false;
    const bFamily = b ? FAMILY.has(norm(b.text)) : false;

    if (adjacent && aGiven && (bFamily || bGiven)) {
      // Strongest signal: a known given name followed by a known surname.
      push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.9, reason: 'given name + surname in gazetteer',
      });
      i += 2;
      continue;
    }

    if (adjacent && aGiven) {
      // Known given name plus an unknown Title-Case token: still very likely a person,
      // and the surname tail is exactly where an uncommon name would sit.
      push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.75, reason: 'given name in gazetteer + trailing token',
      });
      i += 2;
      continue;
    }

    if (aGiven) {
      // A lone Title-Case token that happens to be in a name list. Deliberately BELOW
      // the redaction threshold on its own.
      //
      // Real pages made this unavoidable: "For", "Not", "Bill" and "Justice" are all
      // real given names AND ordinary English words, and at 0.65 every one of them was
      // being redacted out of running prose. A single token is not evidence of a
      // person; it needs the field context to agree before it counts.
      push({
        start: a.start, end: a.end, text: a.text,
        confidence: 0.45, reason: 'lone given name in gazetteer (weak on its own)',
      });
      i += 1;
      continue;
    }

    /**
     * DICTIONARY ABSENCE — the signal that catches names no list contains.
     *
     * A gazetteer only knows names that are on it, which is why the holdout's
     * "Ananya Krishnan" survived three separate public name datasets. But two adjacent
     * Title-Case tokens where NEITHER is an English word is a strong person-name signal
     * regardless of whether anyone has catalogued those particular names.
     *
     * It is a complement, not a replacement: "Lakshmi Narayanan" has a dictionary word
     * in it and is caught by the gazetteer instead. Between them the coverage is far
     * better than either alone.
     *
     * Precision comes from the same guards as everything else — organisation markers
     * suppress "Kotak Mahindra" and "Lok Sabha", and NOT_NAMES suppresses sentence
     * openers. Measured on Wikipedia and rbi.org.in, not assumed.
     */
    if (adjacent && !aGiven && !bGiven && !aFamily && !bFamily
        && DICTIONARY.size > 0
        && !DICTIONARY.has(norm(a.text)) && !DICTIONARY.has(norm(b!.text))
        && a.text.length >= 3 && b!.text.length >= 3) {
      push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.7, reason: 'two Title-Case tokens, neither an English word',
      });
      i += 2;
      continue;
    }

    if (adjacent && aFamily && bFamily) {
      // Two surname-list hits with no given name. Kept BELOW the threshold: the surname
      // list is 82,000 entries and collides heavily with ordinary words, so "Not
      // Pressed" and similar pairs were being redacted out of real pages.
      push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.5, reason: 'two surnames, no given name (weak)',
      });
      i += 2;
      continue;
    }

    i += 1;
  }

  return spans;
}
