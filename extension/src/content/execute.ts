/**
 * Action executor — SIH26171. The only code that changes the page.
 *
 * Everything reaching here has already been validated against the payload we sent
 * (see agent/validate.ts). This file re-checks the two things that can change between
 * validation and execution — the element vanishing, and the vault token resolving — and
 * otherwise stays deliberately dumb. Logic here would be logic outside the validator.
 *
 * Token resolution happens HERE, at the last possible moment, so the real value exists
 * for exactly as long as it takes to type it.
 *
 * ⚠ This file uses `instanceof HTMLInputElement` and friends. Those constructors are
 * BROWSER GLOBALS and do not exist under Node, so this module must never be imported by
 * a Node test. The same mistake in `extractor.ts` threw ReferenceError and took out
 * seven suites at once. If you need to test this logic outside a browser, switch to
 * `el.tagName.toLowerCase()` checks first.
 */

import type { AgentAction } from '../contracts.ts';
import { resolveElement } from './extractor.ts';

export interface ExecutionResult {
  action: AgentAction;
  executed: boolean;
  error?: string;
}

/** Fire the events a real user's interaction would produce. */
function dispatchInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // React and Vue track the value on the DOM node and ignore plain assignment, so the
  // native setter has to be called explicitly or the framework never sees the change.
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function executeAction(
  action: AgentAction,
  resolveToken: (token: string) => string | undefined,
): Promise<ExecutionResult> {
  const fail = (error: string): ExecutionResult => ({ action, executed: false, error });

  try {
    switch (action.kind) {
      case 'wait':
        await new Promise((r) => setTimeout(r, 500));
        return { action, executed: true };

      case 'done':
      case 'ask_user':
        return { action, executed: true };

      case 'scroll':
        window.scrollBy({ top: action.scrollDelta ?? 400, behavior: 'smooth' });
        return { action, executed: true };

      case 'click': {
        const el = resolveElement(action.target!);
        // Re-checked at execution time: the page may have re-rendered since the
        // payload was built, and clicking a detached node silently does nothing.
        if (!el) return fail(`element ${action.target} is gone`);
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        (el as HTMLElement).click();
        return { action, executed: true };
      }

      case 'type': {
        const el = resolveElement(action.target!);
        if (!el) return fail(`element ${action.target} is gone`);

        let value = action.value ?? '';
        if (/^<PII_[A-Z]+_\d+>$/.test(value)) {
          // The server directed this value without ever seeing it. Resolve locally,
          // at the last possible moment.
          const real = resolveToken(value);
          if (real === undefined) return fail(`cannot resolve ${value} from the vault`);
          value = real;
        }

        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
          if ((el as HTMLElement).isContentEditable) {
            (el as HTMLElement).focus();
            (el as HTMLElement).textContent = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return { action, executed: true };
          }
          return fail(`${action.target} is not a text field`);
        }

        el.focus();
        dispatchInput(el, value);
        return { action, executed: true };
      }

      case 'select': {
        const el = resolveElement(action.target!);
        if (!(el instanceof HTMLSelectElement)) return fail(`${action.target} is not a select`);
        el.value = action.value ?? '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { action, executed: true };
      }

      default:
        return fail(`unsupported action kind: ${action.kind}`);
    }
  } catch (e) {
    return fail(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
}
