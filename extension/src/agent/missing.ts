/**
 * WHAT IS STILL MISSING FROM THIS FORM — SIH26171.
 *
 * He asked the agent to fill in and submit httpbin's pizza form. It asked for his email,
 * he typed it, it went into the field correctly — and then it asked for his NAME, which
 * was already on the page, and never mentioned Pizza Size, the toppings, the delivery
 * time or the instructions at all. One question per run, the wrong question, and no
 * check at the end.
 *
 * THE CLIENT IS THE ONE THAT KNOWS. It is holding the payload: every control, its label,
 * its value, whether it is checked, and which choice it belongs to. Asking a 7B model to
 * keep track of that across turns is asking the weakest component in the system to do the
 * one job the strongest component can do exactly. The model decides what to DO; the
 * client can simply read what is not yet filled in.
 *
 * So this enumerates it directly, all of it at once, from the payload the run already
 * produced. No model call, no extra turn, and no possibility of asking for a value that
 * is already on screen.
 */

import type { SanitizedNode, SanitizedPayload } from '../contracts.ts';

export interface MissingField {
  /** The control to fill, or for a choice, the option to click. */
  id: string;
  /** What to show the person. */
  label: string;
  /** 'text' needs typing; 'choice' needs one of `options` clicked. */
  kind: 'text' | 'choice';
  /** True when the page marks it required — shown, and used for the final check. */
  required: boolean;
  /** For a choice: every option in the group, so the panel can render the real thing. */
  options?: Array<{ id: string; label: string }>;
  /**
   * The HTML input type to render: "time", "date", "email", "number", "text"…
   *
   * A clock field needs a clock. He filled five of six questions correctly and the sixth
   * — Preferred delivery time — was offered as a plain text box, so whatever he typed was
   * rejected by the control and the field stayed empty. `<input type=time>` accepts
   * "HH:MM" and nothing else; a browser's own time picker cannot produce anything else.
   */
  inputType: string;
  /**
   * True for a CHECKBOX group, where more than one answer is allowed.
   *
   * Pizza Size is three radios and exactly one is right. Pizza Toppings is four
   * checkboxes and any number is right, including all four. Rendering both as radios
   * would quietly forbid a second topping, and the person would assume the form said so.
   */
  multiple?: boolean;
}

/** Roles that hold typed text. */
const TEXTY = new Set(['textbox']);

/**
 * Types a browser gives a real editor for, and that we are willing to put in the panel.
 *
 * An allow-list rather than a pass-through: `inputType` comes off the page, and handing
 * an arbitrary string to `type="..."` lets a page choose the control we render — a
 * `type="password"` would turn our own question box into a password prompt, which is
 * exactly the shape this product exists to argue against. Anything not named here falls
 * back to a plain text box, which always works.
 */
const RENDERABLE = new Set([
  'time', 'date', 'datetime-local', 'month', 'week',
  'email', 'number', 'tel', 'url', 'search', 'color', 'range', 'text',
]);

function renderableType(t: string | undefined): string {
  return t && RENDERABLE.has(t) ? t : 'text';
}

function walk(root: SanitizedNode, fn: (n: SanitizedNode) => void): void {
  (function rec(n: SanitizedNode) { fn(n); n.children?.forEach(rec); })(root);
}

/**
 * Every value the page is still waiting for.
 *
 * ⛔ A field that already holds something is NEVER returned, including one holding a
 * redaction token. `<PII_EMAIL_1>` means the user's email is in that box and was withheld
 * from us — the field is FULL. Treating a token as emptiness is how the agent came to ask
 * for a name that was sitting on screen in front of him.
 *
 * ⛔ Nor is a password ever asked for here. The agent has no business filling one, the
 * validator refuses to type into one, and a panel that asks for a password is the exact
 * shape of the thing this product exists to argue against.
 */
export function missingFields(payload: SanitizedPayload): MissingField[] {
  const out: MissingField[] = [];
  const groups = new Map<string, { label: string; options: Array<{ id: string; label: string }>;
                                   anyChecked: boolean; required: boolean;
                                   multiple: boolean }>();

  walk(payload.root, (n) => {
    if (!n.visible || n.enabled === false) return;

    if (TEXTY.has(n.role)) {
      const filled = typeof n.value === 'string' && n.value.trim().length > 0;
      if (filled) return;
      out.push({
        id: n.id,
        label: (n.label || n.contextLabel || 'this field').replace(/\s*:\s*$/, ''),
        kind: 'text',
        required: n.required === true,
        inputType: renderableType(n.inputType),
      });
      return;
    }

    if (n.role === 'radio' || n.role === 'checkbox') {
      /**
       * Grouped by `group` — the shared `name` — so Small/Medium/Large arrive as ONE
       * question. Falling back to the id means an ungrouped checkbox is still offered
       * rather than silently dropped, which is the direction that loses information.
       */
      const key = n.group ?? `#${n.id}`;
      const g = groups.get(key) ?? {
        label: n.contextLabel || n.group || 'Choose one',
        options: [], anyChecked: false, required: false, multiple: n.role === 'checkbox',
      };
      g.options.push({ id: n.id, label: n.label || n.value || n.id });
      if (n.checked) g.anyChecked = true;
      if (n.required) g.required = true;
      // The legend, when we have it, names the question better than any single option.
      if (n.contextLabel) g.label = n.contextLabel;
      groups.set(key, g);
    }
  });

  for (const g of groups.values()) {
    // Something already chosen means the question is answered. Not our business.
    if (g.anyChecked) continue;
    out.push({
      id: g.options[0]?.id ?? '',
      label: g.label.replace(/\s*:\s*$/, ''),
      kind: 'choice',
      required: g.required,
      options: g.options,
      multiple: g.multiple,
      // A choice is rendered as radios or checkboxes, never as an input, so this is
      // unused for it. Required rather than optional on the type, so a TEXT field cannot
      // quietly lose its type and fall back to a box that rejects the answer.
      inputType: 'text',
    });
  }

  return out.filter((f) => f.id);
}

/**
 * WHAT IS STILL WRONG AFTER THE USER FILLED THINGS IN.
 *
 * His second ask, and the more important half: "check also once after entering the
 * entered details by user so that nothing is left or wrongly entered."
 *
 * Run against a FRESH observation, never against the values we believe we typed. A field
 * that silently refused a scripted value — a React-controlled input is the usual
 * culprit, and this project has already been bitten by one on demoqa.com — looks
 * perfectly filled from the caller's side and is empty on the page. The only honest check
 * reads the page back.
 */
export function stillMissing(
  payload: SanitizedPayload,
  /** What we asked the person for, so the report can say which of those did not land. */
  asked: MissingField[] = [],
): { outstanding: MissingField[]; askedButEmpty: MissingField[] } {
  const outstanding = missingFields(payload);
  const askedIds = new Set(asked.map((f) => f.id));
  return {
    outstanding,
    askedButEmpty: outstanding.filter((f) => askedIds.has(f.id)),
  };
}
