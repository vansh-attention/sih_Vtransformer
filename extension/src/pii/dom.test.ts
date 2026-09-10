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
  const r = reconcile(hint, det);
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

console.log(fail ? `\n${fail} FAILURES` : '\nall reconciliation cases pass');
