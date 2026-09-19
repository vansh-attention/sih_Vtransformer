import {
  classifyField, reconcile, isOrgContact, registrableDomain, type FieldSignals,
} from './dom.ts';
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

// ---------------------------------------------------------------------------
// Organisation contact addresses — the pmvidyalaxmi.co.in report, 18 Sep
// ---------------------------------------------------------------------------
//
// The whole value of this rule is in what it REFUSES. The proposed version keyed on
// "the address is already public on the page", which describes every value we protect;
// these cases are the four personal addresses from our own corpus that such a rule
// would have stopped protecting, pinned so that can never be reintroduced quietly.

const PMV = 'www.pmvidyalaxmi.co.in';
const orgCases: Array<{ name: string; raw: string; sig: FieldSignals | undefined;
                        host?: string; want: boolean }> = [
  // The reported case: role account, site's own domain, page text.
  { name: 'support@ in the portal footer', raw: 'support@pmvidyalaxmi.co.in',
    sig: { tag: 'p' }, host: PMV, want: true },
  { name: 'same address inside a mailto link', raw: 'support@pmvidyalaxmi.co.in',
    sig: { tag: 'span', linkHref: 'mailto:support@pmvidyalaxmi.co.in' }, host: PMV, want: true },
  { name: 'grievance@ on a .gov.in host', raw: 'grievance@mygov.gov.in',
    sig: { tag: 'td' }, host: 'services.mygov.gov.in', want: true },

  // ⛔ The student's own address, on the very same page. Typed into the login box.
  { name: 'user address in the login field', raw: 'bvmanas@gmail.com',
    sig: { tag: 'input', name: 'username' }, host: PMV, want: false },
  /**
   * ⛔ THE CASE THAT ISOLATES THE "NOBODY TYPED IT" CONDITION.
   *
   * Staff signing in to their own organisation's portal: a role local-part, on the
   * site's own domain, in a login box. The first two conditions both PASS here, so
   * this is the only case in which the form-control check decides the answer — and
   * it must decide it, because a credential somebody typed is theirs.
   *
   * Added because sabotage found nothing: deleting the form-control check left every
   * other case green. A guard no test can fail is not a guard.
   */
  { name: 'staff signs in with the org role account', raw: 'admin@pmvidyalaxmi.co.in',
    sig: { tag: 'input', name: 'username' }, host: PMV, want: false },
  { name: 'same address in a textarea', raw: 'support@pmvidyalaxmi.co.in',
    sig: { tag: 'textarea', name: 'message' }, host: PMV, want: false },
  // ⛔ ...and the same address once the portal RENDERS it back after login. This is
  //    the case the rejected rule got wrong: nobody typed it, it is page text, and it
  //    is still entirely personal.
  { name: 'user address rendered as page text', raw: 'bvmanas@gmail.com',
    sig: { tag: 'span' }, host: PMV, want: false },

  // ⛔ The four personal prose addresses from bench/. Every one of them is "public
  //    content outside a form field" and every one of them must stay protected.
  { name: 'corpus: priya.r@ in a profile bio', raw: 'priya.r@example.org',
    sig: { tag: 'p' }, host: 'example.org', want: false },
  { name: 'corpus: rajesh.sharma@ in prose', raw: 'rajesh.sharma@example.in',
    sig: { tag: 'p' }, host: 'example.in', want: false },
  { name: 'corpus: s.chatterjee@ in a <dd>', raw: 's.chatterjee@example.com',
    sig: { tag: 'dd' }, host: 'example.com', want: false },
  { name: 'corpus: contact in shadow DOM text', raw: 'ravi.k@example.org',
    sig: { tag: 'span' }, host: 'example.org', want: false },

  // ⛔ A role account belonging to somebody ELSE's domain is not ours to excuse.
  { name: 'support@ from a different domain', raw: 'support@othersite.co.in',
    sig: { tag: 'p' }, host: PMV, want: false },
  // ⛔ A lookalike domain must not pass as the site's own.
  { name: 'support@ on a lookalike domain', raw: 'support@evil-pmvidyalaxmi.co.in',
    sig: { tag: 'p' }, host: PMV, want: false },
  // ⛔ Unknown host means unknown provenance: stay personal.
  { name: 'no page host available', raw: 'support@pmvidyalaxmi.co.in',
    sig: { tag: 'p' }, host: undefined, want: false },
  { name: 'no signals available', raw: 'support@pmvidyalaxmi.co.in',
    sig: undefined, host: PMV, want: false },
];

for (const c of orgCases) {
  const got = isOrgContact(c.raw, c.sig, c.host);
  const ok = got === c.want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(42)} orgContact=${String(got).padEnd(5)} ${c.raw}`);
}

// A subdomain is still the same site; a neighbouring registrable domain is not.
for (const [host, want] of [['pmvidyalaxmi.co.in', 'pmvidyalaxmi.co.in'],
                            ['www.pmvidyalaxmi.co.in', 'pmvidyalaxmi.co.in'],
                            ['mail.services.pmvidyalaxmi.co.in', 'pmvidyalaxmi.co.in'],
                            ['example.com', 'example.com'],
                            ['a.b.example.co.uk', 'example.co.uk']] as const) {
  const got = registrableDomain(host);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${`registrable(${host})`.padEnd(42)} ${got}`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall reconciliation cases pass');
