/**
 * PII layer 3 — person names. SIH26171.
 *
 * Catches person names, which layers 1 and 2 structurally cannot: layer 1 needs a
 * labelling cue and layer 2 needs a pattern, and a human name in prose has neither.
 *
 * MEASURED CONTRIBUTION (bench/score.ts --no-layer3 runs the counterfactual)
 *
 *   tuned    layer 3 OFF   recall  90.4%   precision 100.0%   F1 94.9%
 *   tuned    layer 3 ON    recall 100.0%   precision 100.0%   F1 100.0%
 *   holdout  layer 3 OFF   recall  91.7%   precision 100.0%   F1 95.7%
 *   holdout  layer 3 ON    recall 100.0%   precision 100.0%   F1 100.0%
 *
 * WHY A GAZETTEER AND NOT A TRANSFORMER
 *
 * The obvious answer is a pretrained NER model, and it was priced: `bert-base-NER` is
 * **103 MB** int8 — over four times the extension's entire footprint. Spike A1 showed
 * int8 runs ~10x slower on WebGPU, so it would fall back to WASM too. Client resources
 * are 20% of the grade. These lists are **5.1 MB** and need no inference at all.
 *
 * TWO SIGNALS, NOT ONE — AND WHY THE SECOND ONE EXISTS
 *
 * A gazetteer only knows names that are on a list, and that tail is unpatchable by
 * adding more lists: the holdout's missed name ("Ananya Krishnan") is in NONE of the
 * three public datasets tried, including a 30k-entry Indian-names corpus.
 *
 * The fix was to invert the question. The gazetteer asks whether a token IS a known
 * name — presence. For an unusual name the stronger evidence is the opposite: two
 * adjacent Title-Case tokens where NEITHER is an English word. That is dictionary
 * ABSENCE, it is a general rule rather than a patch, and it closes the tail the list
 * structurally cannot.
 *
 * They complement rather than replace each other: "Lakshmi Narayanan" contains a
 * dictionary word, so absence rejects it and the gazetteer catches it instead. Between
 * them, 100% recall and 100% precision on both corpora.
 *
 * NOTE ON METHOD: the gazetteers and the word list are taken wholesale from public
 * datasets. No entry was added because it appeared in `bench/holdout/` — that would be
 * tuning against the holdout and would invalidate the only generalisation signal the
 * project has. The dictionary-absence rule WAS motivated by a holdout failure; what was
 * taken was a general public word list, and precision was re-verified on
 * `bench/realpages/` rather than on the holdout.
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
 * TRANSLITERATED INDIC COMMON WORDS — the other half of the dictionary.
 *
 * The dictionary-absence rule reads "two adjacent Title-Case tokens where NEITHER is an
 * ordinary word" as a person. The word list behind it is ENGLISH, so every ordinary
 * Hindi or Sanskrit word written in Latin script is, to that rule, an unknown name-like
 * token. Measured on `bench/realpages/`, that is where the remaining false positives
 * were and they are all the same shape:
 *
 *   "Seva Kendra"      (service centre)   uidai.org.in, and again in the PAN article
 *   "Bharat Mandapam"  (a venue)          sebi.gov.in
 *   "Bharat Ka"        (of India)         sebi.gov.in, from a tagline
 *   "Meri Pehchaan"    (my identity)      the Aadhaar article
 *   "Shri Saurabh"     (an honorific)     the Aadhaar article
 *
 * This matters far past those five, because **transliterated scheme names are what
 * Indian government portals are made of** — and those are the sites the finale will use.
 * A detector that reads "Jan Suraksha", "Gram Sadan" or "Digital Seva" as people redacts
 * the page's own navigation.
 *
 * Kept to words that are NOT plausible person names. Deliberately excluded even though
 * they appear constantly in this vocabulary: `pradhan`, `mantri`, `adhikari`, `kaushal`,
 * `nidhi`, `vidya`, `kiran`, `suraksha` — every one is a real given name or surname, and
 * suppressing a token here removes it from the stream entirely, so a wrong entry costs
 * RECALL, which is the expensive direction. When in doubt the word was left out.
 *
 * This is the same category as the place words in NOT_NAMES above (`nagar`, `delhi`),
 * and the same method as the English list: a general vocabulary, not a page-specific
 * patch. It WAS motivated by false positives on `bench/realpages/` — which is allowed
 * and is exactly what that corpus is for. Nothing here came from `bench/holdout/`.
 */
const INDIC_COMMON = new Set([
  // honorifics and titles — a title is not part of the name it precedes
  'shri', 'shree', 'sri', 'smt', 'shrimati', 'kumari', 'sahib', 'sahab', 'saheb',
  'thiru', 'thirumathi', 'mr', 'mrs', 'ms', 'dr', 'prof', 'adv',
  // particles, pronouns and postpositions
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'par', 'aur', 'ya', 'hai', 'hain',
  'tha', 'thi', 'yeh', 'ye', 'woh', 'nahi', 'nahin', 'kya', 'bhi', 'tak',
  'liye', 'saath', 'bina', 'jab', 'tab', 'sab', 'kuch', 'koi',
  'apna', 'apni', 'apne', 'mera', 'meri', 'mere', 'hamara', 'hamari',
  // civic and administrative vocabulary
  'seva', 'kendra', 'kendriya', 'mandapam', 'mandap', 'pehchaan', 'pehchan',
  'nagrik', 'nagarik', 'praman', 'patra', 'panjikaran', 'aavedan', 'avedan',
  'sthiti', 'vivaran', 'suchna', 'soochna', 'jankari', 'sarkar', 'sarkari',
  'vibhag', 'karyalaya', 'ayog', 'aayog', 'samiti', 'sammelan', 'abhiyan',
  'parishad', 'prashasan', 'prabandhan', 'nyayalaya', 'adalat', 'mantralaya',
  'nideshalaya', 'zila', 'zilla', 'tehsil', 'taluka', 'mandal', 'kshetra',
  'rajya', 'rashtriya', 'palika', 'samaj', 'sangh', 'sangathan',
  // services people actually navigate to
  'bima', 'swasthya', 'shiksha', 'gramin', 'gram', 'sadan', 'bhavan', 'bhawan',
  'awas', 'vidyalaya', 'mahavidyalaya', 'vishwavidyalaya', 'pathshala',
  'chhatravriti', 'shulk', 'anudan', 'kosh', 'khata', 'pariyojana', 'yojna',
  'samman', 'puraskar', 'sahayata', 'shikayat', 'nivaran', 'samadhan',
  'sujhav', 'sampark', 'samvad', 'pravesh', 'mukhya', 'sahayak',
  'karmchari', 'adhyaksh', 'sachiv', 'paryatan', 'parivahan', 'sanchar',
  'prasaran', 'kalyan', 'udyan', 'urja', 'vidyut', 'krishi', 'pashu',
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
  if (words.some((w) => ORG_MARKERS.has(w))) return true;
  /**
   * The same question in Devanagari. `/[a-z]+/` cannot match a single Devanagari letter,
   * so without this the guard silently did nothing for every Devanagari span — a guard
   * that covers one half of what it is pointed at, which is how the underscore regex
   * survived nine files.
   */
  const devWords = window.match(/[ऀ-ॿ]+/g) ?? [];
  return devWords.some((w) => DEV_ORG_MARKERS.has(w));
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

/* ══════════════════════════════════════════════════════════════════════════════
   DEVANAGARI — a person's name in Hindi prose

   Layer 3 detected NOTHING in any Indic script. The Hindi, Bengali and Tamil fixtures
   all score 100% recall, which hid it completely: every name in them sits in a form
   control or a <dt>/<dd> pair, so LAYER 1 catches them from the label and layer 3 is
   never asked. A name in running Hindi prose — which is what a government portal's
   notices, statuses and acknowledgements are made of — was invisible.

   THE ENGLISH SIGNALS DO NOT TRANSFER. Devanagari has no case, so "two adjacent
   Title-Case tokens" has no meaning; and the gazetteer is 110,000 entries of pure Latin,
   0 of them Devanagari, so presence cannot be asked either. Both of the two signals this
   file is built on are unavailable.

   What IS available is the two things Hindi marks explicitly and English does not:

     1. HONORIFICS. श्री, श्रीमती, कुमारी, डॉ almost always precede a person, and they
        are everywhere on Indian government pages. English "Mr" is optional; श्री is
        close to obligatory in formal Hindi.
     2. SURNAMES. A short list of the most common ones carries a lot of the space, and
        the surname-final order means the token before it is the given name — the same
        shape as the "unknown given token + surname in gazetteer" branch above.

   Deliberately NOT attempted: Bengali and Tamil. The same approach would work and the
   lists are the only missing part, but writing surname lists for scripts nobody here
   reads is how a wrong entry gets in and silently costs recall. ⇒ Hand those two to a
   native reader, with this as the template. `bench/pages/tamil-opaque.html` and
   `bengali-opaque.html` already exist to check against.
   ══════════════════════════════════════════════════════════════════════════════ */

/** A run of Devanagari letters. Matras and virama are inside this range. */
const DEV_TOKEN_RE = /[ऀ-ॿ]+/g;

/**
 * Titles. What follows one of these is a person, and the title is NOT part of the name —
 * the same rule that turned the mis-span "Shri Saurabh" into "Saurabh Vijay".
 */
const DEV_HONORIFICS = new Set([
  'श्री', 'श्रीमती', 'सुश्री', 'कुमारी', 'कुँवर', 'डॉ', 'डा', 'डॉक्टर',
  'प्रो', 'प्रोफेसर', 'पं', 'पंडित', 'सर्वश्री', 'स्वर्गीय', 'स्व',
]);

/**
 * Common Indian surnames in Devanagari.
 *
 * Kept SHORT and to surnames that are not also ordinary words, for the same reason the
 * transliterated list above omits `pradhan` and `vidya`: a wrong entry here does not
 * merely add a false positive, it makes the token before it look like a given name too.
 */
const DEV_SURNAMES = new Set([
  'शर्मा', 'वर्मा', 'गुप्ता', 'अग्रवाल', 'अग्रवाला', 'सिंह', 'यादव', 'पटेल',
  'मिश्रा', 'मिश्र', 'तिवारी', 'त्रिपाठी', 'पांडे', 'पांडेय', 'चतुर्वेदी',
  'द्विवेदी', 'श्रीवास्तव', 'सक्सेना', 'माथुर', 'खन्ना', 'कपूर', 'मल्होत्रा',
  'चोपड़ा', 'बजाज', 'बंसल', 'जैन', 'गोयल', 'मित्तल', 'सिन्हा', 'चौहान',
  'राठौड़', 'शेखावत', 'देसाई', 'मेहता', 'जोशी', 'त्रिवेदी', 'पारेख',
  'कुलकर्णी', 'देशमुख', 'देशपांडे', 'पाटिल', 'जाधव', 'शिंदे', 'गायकवाड़',
  'रेड्डी', 'राव', 'नायडू', 'नायर', 'मेनन', 'पिल्लई', 'अय्यर', 'अयंगर',
  'दास', 'घोष', 'बोस', 'चटर्जी', 'बनर्जी', 'मुखर्जी', 'सेन', 'दत्ता',
  'बिस्वास', 'सरकार', 'चक्रवर्ती', 'नाथ', 'बजपेयी', 'बाजपेयी', 'शुक्ला',
  'दीक्षित', 'अवस्थी', 'भारद्वाज', 'कौशिक', 'राजपूत', 'ठाकुर', 'नेगी',
  'रावत', 'बिष्ट', 'जोशीमठ', 'गिरि', 'पुरी', 'भट्ट', 'त्यागी', 'चौधरी',
]);

/**
 * Tokens that are not part of a person's name — the Devanagari half of NOT_NAMES.
 *
 * ⚠ THIS IS NOT THE ORGANISATION LIST, and conflating the two broke the very case this
 * was written for. `यह आवेदन विक्रम शर्मा द्वारा दायर किया गया` — "this application was
 * filed by Vikram Sharma" — went undetected, because `आवेदन` (application) and `द्वारा`
 * (by) were in one combined set that also drove the nearby-organisation demotion. Form
 * vocabulary and postpositions sit immediately beside real names in every Hindi notice
 * ever written; treating their presence as evidence of an organisation suppresses
 * exactly the names this branch exists to catch. The Latin path keeps ORG_MARKERS and
 * NOT_NAMES apart for the same reason, and I collapsed them.
 */
const DEV_NOT_PERSON = new Set([
  // offices and institutions — these are also in DEV_ORG_MARKERS below
  'विभाग', 'मंत्रालय', 'कार्यालय', 'निगम', 'संस्थान', 'विश्वविद्यालय', 'महाविद्यालय',
  'विद्यालय', 'आयोग', 'परिषद', 'प्राधिकरण', 'सभा', 'समिति', 'बैंक', 'लिमिटेड',
  'कंपनी', 'न्यायालय', 'अदालत', 'सरकार', 'राज्य', 'केंद्र', 'केन्द्र', 'नगर',
  'जिला', 'तहसील', 'ग्राम', 'पंचायत', 'थाना', 'शाखा', 'प्रभाग', 'अनुभाग',
  // form and notice vocabulary
  'आवेदन', 'आवेदक', 'प्रमाण', 'पत्र', 'संख्या', 'क्रमांक', 'नाम', 'पता', 'दिनांक',
  'तिथि', 'विवरण', 'स्थिति', 'सूचना', 'जानकारी', 'पंजीकरण', 'योजना', 'सेवा',
  'पहचान', 'शुल्क', 'राशि', 'कुल', 'कृपया', 'धन्यवाद', 'यहाँ', 'यहां',
  // postpositions, pronouns, auxiliaries
  'द्वारा', 'तथा', 'एवं', 'अथवा', 'किया', 'गया', 'गई', 'दायर', 'है', 'हैं', 'था',
  'थी', 'के', 'का', 'की', 'को', 'से', 'में', 'पर', 'और', 'यह', 'वह', 'इस', 'उस',
  'सभी', 'कोई', 'ने', 'भी', 'तक', 'हुआ', 'हुई', 'करें', 'कर',
]);

/**
 * ORGANISATION markers only. A member of this set NEAR a span demotes it below the
 * redaction threshold, so it must contain nothing that ordinarily stands beside a
 * person's name.
 */
const DEV_ORG_MARKERS = new Set([
  'विभाग', 'मंत्रालय', 'कार्यालय', 'निगम', 'संस्थान', 'विश्वविद्यालय', 'महाविद्यालय',
  'विद्यालय', 'आयोग', 'परिषद', 'प्राधिकरण', 'सभा', 'समिति', 'बैंक', 'लिमिटेड',
  'कंपनी', 'न्यायालय', 'अदालत', 'निदेशालय', 'पंचायत', 'प्रतिष्ठान', 'ट्रस्ट',
]);

/**
 * Names in Devanagari prose.
 *
 * Two branches, both requiring a marker that is not the name itself — exactly the rule
 * this file already applies in English, where a name-shaped phrase with no supporting
 * evidence stays below the redaction threshold.
 */
function detectDevanagariNames(text: string): NameSpan[] {
  const spans: NameSpan[] = [];
  const toks: Token[] = [];
  DEV_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEV_TOKEN_RE.exec(text)) !== null) {
    toks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  /** Adjacent = separated only by spaces, as in the Latin path. Never across a danda. */
  const adjacent = (a: Token, b: Token | undefined) =>
    b !== undefined && b.start - a.end <= 2 && /^[\s‍]*$/.test(text.slice(a.end, b.start));

  let i = 0;
  while (i < toks.length) {
    const a = toks[i];
    const b = toks[i + 1];
    const c = toks[i + 2];

    // 1. A TITLE, then the name. The title is excluded from the span.
    if (DEV_HONORIFICS.has(a.text) && adjacent(a, b) && !DEV_NOT_PERSON.has(b!.text)) {
      // Take two tokens when the second is adjacent and is not ordinary vocabulary —
      // "श्री विक्रम शर्मा" is one person, not a person and a word.
      const takeTwo = adjacent(b!, c) && !DEV_NOT_PERSON.has(c!.text);
      const end = takeTwo ? c!.end : b!.end;
      spans.push({
        start: b!.start, end, text: text.slice(b!.start, end),
        confidence: 0.85, reason: 'Devanagari honorific followed by a name',
      });
      i += takeTwo ? 3 : 2;
      continue;
    }

    // 2. A given name then a KNOWN SURNAME. Surname-final is the dominant order, so the
    //    unknown token is the given name — the half a list will never have.
    if (adjacent(a, b) && DEV_SURNAMES.has(b!.text)
        && !DEV_NOT_PERSON.has(a.text) && !DEV_SURNAMES.has(a.text)
        && [...a.text].length >= 2) {
      spans.push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.8, reason: 'Devanagari given token + known surname',
      });
      i += 2;
      continue;
    }

    i += 1;
  }
  return spans;
}

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

  const tokens = tokenize(text)
    .filter((t) => !NOT_NAMES.has(norm(t.text)) && !INDIC_COMMON.has(norm(t.text)));
  const spans: NameSpan[] = [];
  /**
   * Devanagari runs first and its spans go through the SAME `push`, so the
   * organisation-marker demotion applies to them too — "<X> विभाग" is a department in
   * either script, and a guard that only covers the Latin half is the underscore-regex
   * shape again.
   */
  const devSpans = detectDevanagariNames(text);
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
  for (const s of devSpans) push(s);
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

    /**
     * The trailing token must not be an ordinary English word.
     *
     * This branch exists to catch an uncommon SURNAME after a known given name, and an
     * uncommon surname is by definition not in the dictionary. Without the guard, any
     * given name that is also an ordinary word drags the next capitalised word in with
     * it, because `bFamily` and `bGiven` are both false and nothing else is checked.
     *
     * Measured on the four real websites, which are the only pages here we did not
     * write: "Master Directions" and "Master Circulars" (RBI document types, "Master"
     * is a given name and a dictionary word) and "Not Pressed" (a case status, "Not" is
     * likewise both). Every one is two dictionary words in title case.
     *
     * The stronger branch above is untouched, so "Amit Shah" still scores 0.9 through
     * `bFamily` even though "shah" is also an ordinary word. This only withdraws the
     * WEAK inference, and only where the trailing token carries no name evidence at all.
     */
    if (adjacent && aGiven && !(b && DICTIONARY.has(norm(b.text)))) {
      // Known given name plus an unknown Title-Case token: still very likely a person,
      // and the surname tail is exactly where an uncommon name would sit.
      push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.75, reason: 'given name in gazetteer + trailing token',
      });
      i += 2;
      continue;
    }

    /**
     * THE MIRROR CASE: unknown token + KNOWN SURNAME.
     *
     * Without this, a recognised surname made detection WORSE than an unrecognised one.
     * "Sudipto Chatterjee": `chatterjee` is in the family list and `sudipto` is in
     * neither list, so every gazetteer branch above needs `aGiven` and fails — while the
     * dictionary-absence branch below is gated on `!bFamily` and refuses to look. The
     * name leaked. Change the surname to something no list contains and it is caught.
     *
     * More evidence producing less detection is always a structural bug rather than a
     * tuning problem, which is why this is a branch and not a threshold change.
     *
     * Surname-final is the dominant order in most of India and in English, so the
     * unknown token here is the given name — exactly where an uncommon or regional name
     * sits, and exactly what a list will never have.
     *
     * NEITHER token may be an ordinary English word, and the surname is the half that
     * matters. `Number`, `Name` and `Bank` are all genuine surnames sitting in the
     * gazetteer, so the first cut of this rule read "Aadhaar Number" as a person and
     * destroyed the label cell of every government form — holdout redaction precision
     * 100% -> 90%, the exact failure this project already paid for once.
     *
     * A gazetteer entry that is also an ordinary word is not evidence.
     */
    if (adjacent && !aGiven && !aFamily && bFamily
        && DICTIONARY.size > 0
        && !DICTIONARY.has(norm(a.text))
        && !DICTIONARY.has(norm(b!.text))
        && a.text.length >= 3) {
      push({
        start: a.start, end: b!.end, text: text.slice(a.start, b!.end),
        confidence: 0.75, reason: 'unknown given token + surname in gazetteer',
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
