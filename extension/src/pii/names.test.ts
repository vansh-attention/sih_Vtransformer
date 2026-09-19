import { readFileSync } from 'node:fs';
import { loadGazetteer, detectNames } from './names.ts';
import { classifyField } from './dom.ts';

loadGazetteer(JSON.parse(readFileSync(
  new URL('../../models/name-gazetteer.json', import.meta.url), 'utf8')));

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)}${detail}`);
};

// Names deliberately chosen to appear in NEITHER bench/pages NOR bench/holdout, so this
// file cannot become a way of tuning against the holdout.
const shouldDetect: Array<[string, string]> = [
  ['full name alone',            'Vikram Sharma'],
  ['name in prose',              'Please contact Arjun Nair before Friday.'],
  ['name after a label word',    'Raised by Kavita Reddy'],
  ['three-word sentence start',  'Sunita Iyer called twice.'],
];
for (const [label, text] of shouldDetect) {
  const spans = detectNames(text);
  check(`detects: ${label}`, spans.length > 0 && spans[0].confidence >= 0.6,
    spans.length ? `"${spans[0].text}" ${spans[0].confidence} (${spans[0].reason})` : 'NOTHING FOUND');
}

// Precision guards. Over-redaction costs as much as leaking in this rubric.
const shouldNotDetect: Array<[string, string]> = [
  ['sentence opener',            'Please submit the application form today.'],
  ['company name',               'Kotak Mahindra Bank Limited'],
  ['UI labels',                  'Submit Application'],
  ['month and day',              'Due Monday March'],
  ['commercial context words',   'Order Total Amount'],
  ['plain lowercase prose',      'the quick brown fox jumps'],
];
for (const [label, text] of shouldNotDetect) {
  const spans = detectNames(text).filter((s) => s.confidence >= 0.6);
  check(`rejects: ${label}`, spans.length === 0,
    spans.length ? `WRONGLY FLAGGED "${spans[0].text}" (${spans[0].reason})` : '');
}

// A name-shaped pair that appears in NO name list is exactly what dictionary-absence
// exists to catch — the holdout's missed name was of precisely this shape. This
// expectation was inverted when the signal was added; it is a design change, not a
// regression.
const unknown = detectNames('Zzyrix Qwarblen').filter((s) => s.confidence >= 0.6);
check('unknown name-shaped pair IS detected', unknown.length === 1,
  unknown.length ? `"${unknown[0].text}" (${unknown[0].reason})` : 'not detected');

// ...but only when nothing marks it as an organisation.
const org = detectNames('Zzyrix Qwarblen Holdings Limited').filter((s) => s.confidence >= 0.6);
check('same pair suppressed by an organisation marker', org.length === 0,
  org.length ? `WRONGLY FLAGGED "${org[0].text}"` : '');

// Ordinary English phrases must not be swept up by absence-of-dictionary logic.
for (const phrase of ['Statement Of Accounts', 'Download Annual Report', 'New Delhi Office']) {
  const f = detectNames(phrase).filter((s) => s.confidence >= 0.6);
  check(`rejects English phrase: ${phrase}`, f.length === 0,
    f.length ? `WRONGLY FLAGGED "${f[0].text}"` : '');
}

/**
 * A GIVEN NAME THAT IS ALSO AN ORDINARY WORD MUST NOT DRAG IN THE NEXT WORD.
 *
 * Every phrase below was redacted on a real public page before the fix. "Master" and
 * "Not" are both genuine given names and ordinary English words, so the weak
 * "given name + trailing token" branch fired and took the following dictionary word
 * with it. These came off rbi.gov.in, which is precisely the kind of page this system
 * is meant to be useful on, and they were invisible to the scorecard because every
 * scored fixture is one we wrote ourselves.
 *
 * The expectations are written from the phrases, never read back from the detector,
 * so breaking the detector cannot move expectation and actual together.
 */
for (const phrase of ['Master Directions', 'Master Circulars', 'Not Pressed',
                      'Annual Returns', 'Press Releases']) {
  const f = detectNames(phrase).filter((s) => s.confidence >= 0.6);
  check(`real-page false positive rejected: ${phrase}`, f.length === 0,
    f.length ? `WRONGLY FLAGGED "${f[0].text}" (${f[0].reason})` : '');
}

// The guard must only withdraw the WEAK inference. A real name whose surname happens
// to be an ordinary word still has family-list evidence and must survive at full
// strength, or the fix above would trade three false positives for a leak.
for (const name of ['Amit Shah', 'Harsh Bajpai', 'Priya Raghunathan']) {
  const f = detectNames(name).filter((s) => s.confidence >= 0.6);
  check(`real name still detected: ${name}`, f.length === 1,
    f.length ? `${f[0].reason}` : 'MISSED — this would be a leak');
}

/**
 * GOVERNMENT REFERENCE NUMBERS ARE NOT PEOPLE.
 *
 * A twelve-digit number passes the Aadhaar checksum roughly one time in ten by pure
 * chance, so on an Indian government form the ONLY thing separating a citizen's Aadhaar
 * from a departmental receipt number is the word next to it. Two were caught being
 * redacted as Aadhaar: a "Scheme Code" on a citizen services page and an
 * "Acknowledgement number" on a tax refund form.
 *
 * Over-redaction is scored as heavily as leaking, and an agent that hides the reference
 * number cannot fill in the form that asks for it.
 */
console.log('\n--- government reference vocabulary ---');
{
  const verhoeffValid = '567890123458';   // passes the Aadhaar check digit
  const labels = ['Acknowledgement number', 'Scheme Code', 'Application No',
                  'Challan', 'Enrolment ID', 'Registration No'];
  for (const label of labels) {
    const hint = classifyField({ label } as never);
    const ok = hint?.kind === 'NON_PII';
    check(`"${label}" reads as non-personal`, ok, hint ? `got ${hint.kind}` : 'no hint');
  }
  // And the control: the same digits under an Aadhaar label must still be caught, or
  // the fix above would have bought precision by giving away recall.
  const aadhaarHint = classifyField({ label: 'Aadhaar Number' } as never);
  check('"Aadhaar Number" still reads as AADHAAR', aadhaarHint?.kind === 'AADHAAR',
    aadhaarHint ? `got ${aadhaarHint.kind}` : 'no hint');
  void verhoeffValid;
}

/**
 * TRANSLITERATED INDIC VOCABULARY IS NOT A PERSON.
 *
 * The dictionary-absence rule is backed by an ENGLISH word list, so an ordinary Hindi
 * word in Latin script looks exactly like an uncatalogued surname. Measured on
 * `bench/realpages/`: "Seva Kendra", "Bharat Mandapam", "Bharat Ka" and "Meri Pehchaan"
 * were all withheld as people, and transliterated scheme names are what Indian
 * government portals are built out of.
 *
 * Each case is asserted SEPARATELY, and each is followed by its own control, because a
 * suppression list that also eats real names buys precision with recall — the expensive
 * direction, and the exact trade this project has already paid for once.
 */
console.log('\n--- transliterated Indic vocabulary ---');
{
  const notPeople = [
    'Seva Kendra', 'Bharat Mandapam', 'Meri Pehchaan', 'Gram Sadan',
    'Jan Seva Kendra', 'Rashtriya Swasthya Bima', 'Digital Seva',
    'Shiksha Kosh', 'Nagrik Sahayata', 'Shikayat Nivaran',
  ];
  for (const phrase of notPeople) {
    const f = detectNames(phrase).filter((s) => s.confidence >= 0.6);
    check(`"${phrase}" is not a person`, f.length === 0,
      f.length ? `redacted as ${JSON.stringify(f[0].text)}` : '');
  }

  /**
   * THE CONTROLS. Every one of these shares a token with the vocabulary above or sits in
   * the same Indic-name space, and every one must still be caught — otherwise the list
   * above is not a precision fix, it is a recall regression wearing one.
   */
  const stillPeople = [
    'Saurabh Vijay',        // the honorific "Shri" used to swallow the real name
    'Lakshmi Narayanan',    // gazetteer path, contains a dictionary word
    'Ananya Krishnan',      // dictionary-absence path — in none of the three name lists
    'Sudipto Chatterjee',   // unknown given token + known surname
    'Vikram Sharma',        // both halves known
  ];
  for (const name of stillPeople) {
    const f = detectNames(name).filter((s) => s.confidence >= 0.6);
    check(`"${name}" is STILL detected`, f.length > 0, f.length ? '' : 'MISSED');
  }

  /**
   * A title is not part of the name. Stripping "Shri" is what turned the mis-span
   * "Shri Saurabh" into the actual name "Saurabh Vijay" on the Aadhaar article — so this
   * asserts the SPAN, not merely that something was found.
   */
  const withTitle = detectNames('Shri Saurabh Vijay').filter((s) => s.confidence >= 0.6);
  check('an honorific is excluded from the span',
    withTitle.length === 1 && withTitle[0].text === 'Saurabh Vijay',
    withTitle.length ? JSON.stringify(withTitle.map((s) => s.text)) : 'nothing found');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall name-detection cases pass');
process.exit(fail ? 1 : 0);
