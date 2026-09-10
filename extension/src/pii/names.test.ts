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

// A name-shaped phrase with no gazetteer support must stay BELOW the threshold rather
// than being redacted on capitalisation alone.
const unknown = detectNames('Zzyrix Qwarblen').filter((s) => s.confidence >= 0.6);
check('unknown Title-Case pair stays below threshold', unknown.length === 0,
  unknown.length ? `flagged "${unknown[0].text}"` : '');

console.log(fail ? `\n${fail} FAILURES` : '\nall name-detection cases pass');
process.exit(fail ? 1 : 0);
