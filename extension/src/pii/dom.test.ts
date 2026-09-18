import { classifyField, reconcile, type FieldSignals } from './dom.ts';
import { scanText } from './patterns.ts';

function firstDetection(text: string) { return scanText(text)[0] ?? null; }

const cases: Array<{ name: string; field: FieldSignals | null; text: string; wantRedact: boolean }> = [
  // The regression that started this file.
  { name: 'order total, checksum-valid Aadhaar', field: { tag:'input', name:'order_total', label:'Order Total' }, text:'999999999999', wantRedact:false },
  { name: 'aadhaar field, same digits',          field: { tag:'input', name:'aadhaar_no', label:'Aadhaar Number' }, text:'999999999999', wantRedact:true },
  // Password is unconditional.
  { name: 'password input',                      field: { tag:'input', type:'password', name:'pwd' }, text:'hunter2', wantRedact:true },
  // Browser-provided purpose hints.
  { name: 'autocomplete cc-number',              field: { tag:'input', autocomplete:'billing cc-number' }, text:'4111111111111111', wantRedact:true },
  { name: 'autocomplete tel',                    field: { tag:'input', autocomplete:'tel' }, text:'9876543210', wantRedact:true },
  // Field says PII, value unparseable.
  { name: 'aadhaar field, garbage value',        field: { tag:'input', label:'Aadhaar' }, text:'not-a-number', wantRedact:true },
  // Free text, no field context.
  { name: 'PAN in body text',                    field: null, text:'PAN ABCPE1234F on file', wantRedact:true },
  { name: 'invoice no in body text',             field: null, text:'Invoice 123456789012', wantRedact:false },
  // Value beats a wrong label.
  { name: 'card value in field named email',     field: { tag:'input', label:'Email' }, text:'4111111111111111', wantRedact:true },
  // Word-boundary guard: "company" contains the substring "pan" and must not fire it.
  { name: 'invalid-PAN value, label "Company"',  field: { tag:'input', label:'Company' }, text:'ACMEX1234Z', wantRedact:false },
  { name: 'real PAN value, label "Company"',     field: { tag:'input', label:'Company' }, text:'ABCPE1234F', wantRedact:true },
];

let fail = 0;
for (const c of cases) {
  const hint = c.field ? classifyField(c.field) : null;
  const det = firstDetection(c.text);
  const r = reconcile(hint, det, c.text);
  const got = r?.redact ?? false;
  const ok = got === c.wantRedact;
  if (!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${c.name.padEnd(38)} redact=${String(got).padEnd(5)} conf=${(r?.confidence??0).toFixed(2)}  ${r?.rationale ?? '(no detection)'}`);
}
// Direct assertion on the word-boundary guard itself.
const companyHint = classifyField({ tag:'input', label:'Company' });
const boundaryOk = companyHint === null;
if (!boundaryOk) fail++;
console.log(`${boundaryOk?'ok  ':'FAIL'}  ${'classifyField("Company") === null'.padEnd(38)} got=${JSON.stringify(companyHint)}`);

/**
 * THE KIND MUST NOT BE GUESSED — eportal.incometax.gov.in, found 18 Sep.
 *
 * These signals are not invented. They were dumped from the live login page:
 *   id/name     = "panAdhaarUserId"
 *   placeholder = "PAN/ Aadhaar/ Other User ID"
 *   label       = "Enter your User ID*"
 *
 * Both PAN and AADHAAR keywords fire, so the reported kind used to be whichever sat
 * earlier in KEYWORD_MAP. It reported a PAN-shaped User ID as <PII_AADHAAR_1> in front
 * of him. Redacting was right; naming was not.
 */
const ITD_FIELD = {
  tag: 'input',
  label: 'Enter your User ID*',
  name: 'panAdhaarUserId',
  id: 'panAdhaarUserId',
  placeholder: 'PAN/ Aadhaar/ Other User ID',
} as never;

const kindCases: Array<{ name: string; field: unknown; text: string; wantKind: string }> = [
  // His exact value: 11 characters, so it is neither a PAN nor an Aadhaar.
  { name: 'ITD User ID, malformed value', field: ITD_FIELD, text: 'IMQPB9685CT',
    wantKind: 'SENSITIVE' },
  // A real PAN in the same ambiguous field: the value settles it.
  { name: 'ITD User ID, valid PAN',       field: ITD_FIELD, text: 'ABCPE1234F',
    wantKind: 'PAN' },
  // A real Aadhaar in the same field settles it the other way.
  { name: 'ITD User ID, valid Aadhaar',   field: ITD_FIELD, text: '2345 6789 0123',
    wantKind: 'AADHAAR' },
  // An unambiguous Aadhaar field with an impossible value must NOT claim AADHAAR.
  { name: 'Aadhaar field, lettered value',
    field: { tag: 'input', label: 'Aadhaar Number' } as never, text: 'not-an-aadhaar',
    wantKind: 'SENSITIVE' },
  // ...but it must still be redacted. Failing open here would be a leak.
  { name: 'Aadhaar field, lettered value still redacts',
    field: { tag: 'input', label: 'Aadhaar Number' } as never, text: 'not-an-aadhaar',
    wantKind: 'SENSITIVE' },
];

for (const c of kindCases) {
  const hint = classifyField(c.field as never);
  const r = reconcile(hint, firstDetection(c.text), c.text);
  const ok = r?.kind === c.wantKind && r?.redact === true;
  if (!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${c.name.padEnd(42)} kind=${String(r?.kind).padEnd(9)} redact=${String(r?.redact).padEnd(5)} ${r?.rationale ?? ''}`);
}

// `uid` alone must no longer mean Aadhaar — it means "user id" on most portals.
const uidHint = classifyField({ tag: 'input', id: 'uid' } as never);
const uidOk = uidHint?.kind !== 'AADHAAR';
if (!uidOk) fail++;
console.log(`${uidOk?'ok  ':'FAIL'}  ${'id="uid" is not an Aadhaar field'.padEnd(42)} got=${JSON.stringify(uidHint)}`);

console.log(fail ? `\n${fail} FAILURES` : '\nall reconciliation cases pass');
