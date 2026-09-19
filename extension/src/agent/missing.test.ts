/**
 * What the page is still waiting for — SIH26171.
 *
 * From his report on httpbin's pizza form: the agent asked for his email, took it, put it
 * in the right field, then asked for his NAME — which was already on the page — and never
 * mentioned Pizza Size, the toppings, the delivery time or the instructions at all.
 *
 *   node --experimental-strip-types extension/src/agent/missing.test.ts
 */

import { missingFields, type MissingField } from './missing.ts';
import type { SanitizedNode, SanitizedPayload } from '../contracts.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)}${ok ? '' : ` ${detail}`}`);
};

const node = (n: Partial<SanitizedNode>): SanitizedNode => ({
  id: 'x', role: 'other', box: { x: 0, y: 0, w: 10, h: 10 },
  visible: true, enabled: true, ...n,
} as SanitizedNode);

const page = (children: SanitizedNode[]): SanitizedPayload => ({
  origin: 'https://httpbin.org', title: 'form', capturedAt: 0,
  viewport: { w: 1200, h: 800, scrollX: 0, scrollY: 0 },
  root: node({ id: 'el_0', role: 'form', children }),
  placeholders: [], acknowledged: [], goal: '', history: [],
} as unknown as SanitizedPayload);

const labels = (m: MissingField[]) => m.map((f) => f.label);

console.log('--- the pizza form, empty ---');
{
  const m = missingFields(page([
    node({ id: 'el_1', role: 'textbox', label: 'Customer name:', value: '' }),
    node({ id: 'el_3', role: 'textbox', label: 'E-mail address:', value: '' }),
    node({ id: 'el_5', role: 'radio', label: 'Small', group: 'size', contextLabel: 'Pizza Size' }),
    node({ id: 'el_6', role: 'radio', label: 'Medium', group: 'size', contextLabel: 'Pizza Size' }),
    node({ id: 'el_10', role: 'checkbox', label: 'Bacon', group: 'topping', contextLabel: 'Pizza Toppings' }),
    node({ id: 'el_11', role: 'checkbox', label: 'Onion', group: 'topping', contextLabel: 'Pizza Toppings' }),
  ]));

  check('every empty field is asked for, in one list', m.length === 4, JSON.stringify(labels(m)));
  check('a trailing colon is stripped from the label',
    labels(m).includes('Customer name'), JSON.stringify(labels(m)));

  /**
   * The grouping is the point. Three radios are ONE question called Pizza Size, named by
   * the fieldset's legend — not three unrelated controls called Small, Medium and Large.
   */
  const size = m.find((f) => f.label === 'Pizza Size');
  check('radios collapse into one question named by the legend',
    !!size && size.kind === 'choice' && size.options?.length === 2, JSON.stringify(size));
  check('a radio group is single-choice', size?.multiple !== true, JSON.stringify(size));

  const topping = m.find((f) => f.label === 'Pizza Toppings');
  check('a checkbox group allows more than one', topping?.multiple === true,
    JSON.stringify(topping));
}

console.log('\n--- nothing already answered is asked for again ---');
{
  /**
   * ⛔ THE BUG HE REPORTED. A field holding a TOKEN is FULL: `<PII_EMAIL_1>` means his
   * email is in that box and was withheld from us. Reading a token as emptiness is how
   * the agent came to ask for a name that was on screen in front of him.
   */
  const m = missingFields(page([
    node({ id: 'el_1', role: 'textbox', label: 'Customer name', value: 'Harsh Bajpai' }),
    node({ id: 'el_3', role: 'textbox', label: 'E-mail address', value: '<PII_EMAIL_1>' }),
    node({ id: 'el_15', role: 'textbox', label: 'Delivery time', value: '' }),
    node({ id: 'el_5', role: 'radio', label: 'Small', group: 'size', checked: false,
           contextLabel: 'Pizza Size' }),
    node({ id: 'el_6', role: 'radio', label: 'Medium', group: 'size', checked: true,
           contextLabel: 'Pizza Size' }),
  ]));

  check('a filled field is not asked for', !labels(m).includes('Customer name'),
    JSON.stringify(labels(m)));
  check('a field holding a TOKEN is full, not empty',
    !labels(m).includes('E-mail address'), JSON.stringify(labels(m)));
  check('an answered choice is not asked again', !labels(m).includes('Pizza Size'),
    JSON.stringify(labels(m)));
  check('CONTROL: the genuinely empty one IS still asked',
    labels(m).includes('Delivery time'), JSON.stringify(labels(m)));
}

console.log('\n--- things it must never ask for ---');
{
  const m = missingFields(page([
    node({ id: 'el_1', role: 'password', label: 'Password', value: '' }),
    node({ id: 'el_2', role: 'button', label: 'Submit order' }),
    node({ id: 'el_3', role: 'textbox', label: 'Hidden field', value: '', visible: false }),
    node({ id: 'el_4', role: 'textbox', label: 'Disabled field', value: '', enabled: false }),
    node({ id: 'el_5', role: 'textbox', label: 'Real one', value: '' }),
  ]));
  check('never asks for a password', !labels(m).includes('Password'), JSON.stringify(labels(m)));
  check('a button is not a field', !labels(m).includes('Submit order'), JSON.stringify(labels(m)));
  check('invisible fields are not asked for', !labels(m).includes('Hidden field'),
    JSON.stringify(labels(m)));
  check('disabled fields are not asked for', !labels(m).includes('Disabled field'),
    JSON.stringify(labels(m)));
  check('CONTROL: the ordinary field is still asked', labels(m).includes('Real one'),
    JSON.stringify(labels(m)));
}

console.log('\n--- a finished form asks for nothing ---');
{
  const m = missingFields(page([
    node({ id: 'el_1', role: 'textbox', label: 'Name', value: 'Harsh Bajpai' }),
    node({ id: 'el_6', role: 'radio', label: 'Medium', group: 'size', checked: true }),
  ]));
  check('nothing left to ask', m.length === 0, JSON.stringify(labels(m)));
}

console.log(fail ? `\n${fail} FAILURES` : '\nall missing-field cases pass');
process.exit(fail ? 1 : 0);
