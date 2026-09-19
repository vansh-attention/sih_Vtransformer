import { validateActions } from './validate.ts';
import type { AgentAction, SanitizedPayload } from '../contracts.ts';

const box = { x: 0, y: 0, w: 100, h: 20 };
const payload: SanitizedPayload = {
  origin: 'https://shop.example.com',
  title: 'Checkout',
  capturedAt: Date.now(),
  viewport: { w: 1200, h: 800, scrollX: 0, scrollY: 0 },
  goal: 'Submit the payment form',
  history: [],
  placeholders: [
    { token: '<PII_PAN_1>', kind: 'PAN', source: 'pattern', confidence: 0.99, verified: true },
    { token: '<PII_EMAIL_1>', kind: 'EMAIL', source: 'pattern', confidence: 0.95, verified: true },
    // A MULTIWORD kind. `<PII_BANK_ACCOUNT_1>` cleared TOKEN_RE but the inline
    // kind regex used `[A-Z]+`, so tokenKind came back undefined and the
    // kind-agreement check — the one that closes the exfiltration path — was
    // skipped entirely for it.
    { token: '<PII_BANK_ACCOUNT_1>', kind: 'BANK_ACCOUNT', source: 'dom', confidence: 0.9, verified: false },
  ],
  root: {
    id: 'el_1', role: 'form', box, visible: true, enabled: true,
    children: [
      { id: 'el_2', role: 'button',   label: 'Pay now', box, visible: true,  enabled: true },
      { id: 'el_3', role: 'button',   label: 'Cancel',  box, visible: true,  enabled: false },
      { id: 'el_4', role: 'password', label: 'PIN',     box, visible: true,  enabled: true, value: '<PII_PASSWORD_1>' },
      { id: 'el_5', role: 'textbox',  label: 'PAN',     box, visible: true,  enabled: true, value: '<PII_PAN_1>', fieldKind: 'PAN' },
      { id: 'el_6', role: 'textbox',  label: 'Coupon',  box, visible: true,  enabled: true },
      { id: 'el_8', role: 'textbox',  label: 'PAN (empty)', box, visible: true, enabled: true, fieldKind: 'PAN' },
      { id: 'el_9', role: 'textbox',  label: 'Account number', box, visible: true, enabled: true, fieldKind: 'BANK_ACCOUNT' },
      { id: 'el_7', role: 'button',   label: 'Hidden',  box, visible: false, enabled: true },
    ],
  },
};

const A = (a: Partial<AgentAction>): AgentAction =>
  ({ kind: 'click', reasoning: 'test', ...a } as AgentAction);

const cases: Array<[string, AgentAction, boolean]> = [
  ['click an enabled visible button',        A({ kind: 'click', target: 'el_2' }), true],
  ['click a DISABLED button',                A({ kind: 'click', target: 'el_3' }), false],
  ['click an INVISIBLE button',              A({ kind: 'click', target: 'el_7' }), false],
  ['click a HALLUCINATED id',                A({ kind: 'click', target: 'el_999' }), false],
  ['bracketed id from the prompt format',     A({ kind: 'click', target: '[el_2]' }), true],
  ['quoted id',                               A({ kind: 'click', target: '\"el_2\"' }), true],
  ['bracketed HALLUCINATED id still refused', A({ kind: 'click', target: '[el_999]' }), false],
  ['click with no target',                   A({ kind: 'click' }), false],
  ['unknown action kind',                    A({ kind: 'explode' as never, target: 'el_2' }), false],

  ['type into a PASSWORD field',             A({ kind: 'type', target: 'el_4', value: 'hunter2' }), false],
  ['type a known token into a PAN field',    A({ kind: 'type', target: 'el_8', value: '<PII_PAN_1>' }), true],
  ['token into a MISMATCHED field (exfil)',   A({ kind: 'type', target: 'el_6', value: '<PII_PAN_1>' }), false],
  ['multiword token into its OWN field',      A({ kind: 'type', target: 'el_9', value: '<PII_BANK_ACCOUNT_1>' }), true],
  // ⛔ The case that was passing silently: a BANK_ACCOUNT token aimed at a coupon box.
  ['multiword token into a MISMATCHED field', A({ kind: 'type', target: 'el_6', value: '<PII_BANK_ACCOUNT_1>' }), false],
  ['type an UNKNOWN token',                  A({ kind: 'type', target: 'el_5', value: '<PII_PAN_9>' }), false],
  ['overwrite a redacted value with text',   A({ kind: 'type', target: 'el_5', value: 'ABCPE1234F' }), false],
  ['type plain text into an empty field',    A({ kind: 'type', target: 'el_6', value: 'SAVE10' }), true],
  ['type with no value',                     A({ kind: 'type', target: 'el_6' }), false],

  ['server echoes a raw PAN',                A({ kind: 'type', target: 'el_6', value: 'ABCPE1234F' }), false],
  ['server echoes a raw card number',        A({ kind: 'type', target: 'el_6', value: '4111 1111 1111 1111' }), false],
  ['server echoes a raw email',              A({ kind: 'type', target: 'el_6', value: 'hb@example.com' }), false],

  ['type into a BUTTON (not a text field)',   A({ kind: 'type', target: 'el_2', value: 'hello' }), false],
  ['scroll a sane amount',                   A({ kind: 'scroll', scrollDelta: 400 }), true],
  ['scroll an absurd amount',                A({ kind: 'scroll', scrollDelta: 999999 }), false],
  ['done needs no target',                   A({ kind: 'done' }), true],
  ['wait needs no target',                   A({ kind: 'wait' }), true],

  // ask_user is the way out of "I do not have that value", so the question is mandatory.
  // Without it the panel has nothing to render and the run stops for no stated reason.
  ['ask_user WITH a question',                A({ kind: 'ask_user', text: 'What is your PAN?' }), true],
  ['ask_user with no question',               A({ kind: 'ask_user' }), false],
  ['ask_user with a blank question',          A({ kind: 'ask_user', text: '   ' }), false],
];

const report = validateActions(cases.map((c) => c[1]), payload);
let fail = 0;
cases.forEach(([name, , want], i) => {
  const got = report.results[i].allowed;
  const ok = got === want;
  if (!ok) fail++;
  const reason = report.results[i].reason ?? '';
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(38)} ${got ? 'ALLOW' : 'DENY '}  ${reason}`);
});

// A validator that allows everything would pass every ALLOW case above; assert it
// actually refuses things.
const denyCount = cases.filter((c) => !c[2]).length;
const ok = report.denied.length === denyCount;
if (!ok) fail++;
console.log(`\n${ok ? 'ok  ' : 'FAIL'}  refused ${report.denied.length}/${denyCount} expected denials`);


/**
 * A RETRY IS NOT A NO-OP WHEN THE PAGE DISAGREES — demoqa.com, 18 Sep.
 *
 * The no-op rule used to fire on the history of ATTEMPTS alone, and report it as
 * "already has that value" — a claim about the element that nothing had checked.
 * Refused actions are pushed into that same history, so one attempt that failed to
 * stick became a permanent, self-reinforcing refusal.
 *
 * Live consequence: the Subjects box on demoqa is a React autocomplete that ignores a
 * scripted value assignment. The type never landed, the model correctly retried, and
 * the run was killed after two refusals carrying an untrue explanation.
 */
{
  const mkPayload = (value: string) => ({
    origin: 'demoqa.com', title: 'x', capturedAt: 0,
    viewport: { w: 1200, h: 800, scrollX: 0, scrollY: 0 }, placeholders: [],
    root: { id: 'root', role: 'form', box: { x: 0, y: 0, w: 10, h: 10 },
      visible: true, enabled: true,
      children: [{ id: 'el_49', role: 'textbox', label: 'Subjects', value,
        box: { x: 0, y: 0, w: 10, h: 10 }, visible: true, enabled: true }] },
  } as never);

  const act = { kind: 'type', target: 'el_49', value: 'GRV-100234', reasoning: 'x' } as never;

  const rows: Array<{ name: string; value: string; done: never[]; allow: boolean }> = [
    { name: 'first attempt, field empty',            value: '',           done: [],              allow: true },
    { name: 'retry after it did NOT stick',          value: '',           done: [act],           allow: true },
    { name: 'retry when the field really holds it',  value: 'GRV-100234', done: [act],           allow: false },
    { name: 'third attempt, still not sticking',     value: '',           done: [act, act],      allow: false },
  ];

  for (const r of rows) {
    const rep = validateActions([act], mkPayload(r.value), r.done);
    const got = rep.allowed.length === 1;
    const ok = got === r.allow;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(36)} ${got ? 'ALLOW' : 'DENY '}`
      + (rep.denied[0]?.reason ? `  ${rep.denied[0].reason.slice(0, 64)}` : ''));
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nall validator cases pass');
process.exit(fail ? 1 : 0);
