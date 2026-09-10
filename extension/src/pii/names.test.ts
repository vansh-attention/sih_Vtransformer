import { readFileSync } from 'node:fs';
import { loadGazetteer, detectNames } from './names.ts';

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

console.log(fail ? `\n${fail} FAILURES` : '\nall name-detection cases pass');
process.exit(fail ? 1 : 0);
