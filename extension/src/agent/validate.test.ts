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
  ],
  root: {
    id: 'el_1', role: 'form', box, visible: true, enabled: true,
    children: [
      { id: 'el_2', role: 'button',   label: 'Pay now', box, visible: true,  enabled: true },
      { id: 'el_3', role: 'button',   label: 'Cancel',  box, visible: true,  enabled: false },
      { id: 'el_4', role: 'password', label: 'PIN',     box, visible: true,  enabled: true, value: '<PII_PASSWORD_1>' },
      { id: 'el_5', role: 'textbox',  label: 'PAN',     box, visible: true,  enabled: true, value: '<PII_PAN_1>' },
      { id: 'el_6', role: 'textbox',  label: 'Coupon',  box, visible: true,  enabled: true },
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
  ['click with no target',                   A({ kind: 'click' }), false],
  ['unknown action kind',                    A({ kind: 'explode' as never, target: 'el_2' }), false],

  ['type into a PASSWORD field',             A({ kind: 'type', target: 'el_4', value: 'hunter2' }), false],
  ['type a known token into its field',      A({ kind: 'type', target: 'el_5', value: '<PII_PAN_1>' }), true],
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

console.log(fail ? `\n${fail} FAILURES` : '\nall validator cases pass');
process.exit(fail ? 1 : 0);
