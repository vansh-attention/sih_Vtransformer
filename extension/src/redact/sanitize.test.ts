/**
 * Field-value redaction — the cases he hit on live pages, 18 Sep.
 *
 * He typed an Aadhaar, a bank account number and a PAN into search boxes on
 * cloud.dify.ai and eportal.incometax.gov.in and watched most of them sail through.
 * Every row below is one of those values.
 *
 * The two rules being protected here:
 *   1. A digit run that is the WHOLE VALUE of a form control is not an invoice
 *      number. The "unverified digits are probably an invoice" lesson was learned
 *      from PROSE and TABLE CELLS and must not cost recall inside an input.
 *   2. Redaction may fail safe; a KIND may not be guessed. Naming a kind needs two
 *      signals — shape plus a checksum, the printed grouping, or the field label.
 */
import { sanitize } from './sanitize.ts';
import { Vault } from './vault.ts';

const SEARCH = { tag: 'input', label: 'Search', name: 'search', id: 'search' };
const ACCT = { tag: 'input', label: 'Account Number', name: 'acct', id: 'acct' };
const CELL = { tag: 'td', contextLabel: 'Order Total' };

function tokenFor(value: string, sig: unknown): { token: string; leaked: boolean } {
  const structure = {
    url: 'https://example.test/', title: 'T', capturedAt: 0,
    viewport: { w: 1200, h: 800, scrollX: 0, scrollY: 0 },
    root: { role: 'main', tag: 'main', children: [{
      role: 'textbox', tag: 'input', id: 'el_1', value,
      box: { x: 0, y: 0, w: 200, h: 30 }, children: [],
    }] },
  } as never;
  const r = sanitize(structure, { goal: '', vault: new Vault(), signals: () => sig } as never);
  const blob = JSON.stringify(r.payload);
  return { token: blob.match(/<PII_[A-Z_]+_\d+>/)?.[0] ?? '', leaked: blob.includes(value) };
}

const cases: Array<{ name: string; value: string; sig: unknown; want: string }> = [
  // Grouped as UIDAI prints it: shape + formatting = two signals, so it may be named.
  { name: 'aadhaar, printed grouping', value: '4540 2012 2334', sig: SEARCH, want: '<PII_AADHAAR_1>' },
  { name: 'aadhaar, hyphenated',       value: '4540-2012-2334', sig: SEARCH, want: '<PII_AADHAAR_1>' },
  // Checksum fails and nothing corroborates: redacted, but NOT named.
  { name: 'aadhaar, unformatted',      value: '454020122334',  sig: SEARCH, want: '<PII_SENSITIVE_1>' },
  // 15 digits is a card length AND an account length. The field settles it.
  { name: 'account no, labelled',      value: '496402120001084', sig: ACCT,  want: '<PII_BANK_ACCOUNT_1>' },
  { name: 'account no, unlabelled',    value: '496402120001084', sig: SEARCH, want: '<PII_SENSITIVE_1>' },
  // Luhn-valid: the checksum is the second signal.
  { name: 'card, Luhn-valid',          value: '4111 1111 1111 1111', sig: SEARCH, want: '<PII_CARD_1>' },
  { name: 'PAN, structurally valid',   value: 'IMQPB9685C',     sig: SEARCH, want: '<PII_PAN_1>' },
];

let fail = 0;
for (const c of cases) {
  const { token, leaked } = tokenFor(c.value, c.sig);
  const ok = token === c.want && !leaked;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(28)} ${c.value.padEnd(20)} -> ${(token || '(none)').padEnd(23)} leaked=${leaked}`);
}

/**
 * THE PRECISION SIDE. This must NOT be redacted, or the promotion above has simply
 * traded one failure for another — over-redaction costs exactly as much as leaking.
 */
{
  const { token } = tokenFor('999999999999', CELL);
  const ok = token === '';
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${'order total in a table cell'.padEnd(28)} ${'999999999999'.padEnd(20)} -> ${(token || '(not redacted)')}`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall field-value cases pass');
if (fail) process.exit(1);
