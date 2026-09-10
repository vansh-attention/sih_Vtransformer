/**
 * The vault — SIH26171.
 *
 * Holds the token -> real-value mapping for one page session. This is the single most
 * sensitive object in the extension: it is, by construction, a tidy collection of
 * every secret on the user's screen.
 *
 * It must NEVER leave the client. Three defences, in order of how much they help:
 *
 *   1. `#private` fields — the values are genuinely unreachable from outside, so no
 *      amount of spreading, `Object.assign` or structured-cloning a payload can pick
 *      them up by accident.
 *   2. `toJSON()` THROWS. If anyone ever puts a vault inside something that gets
 *      serialized, `JSON.stringify` fails loudly at the call site instead of quietly
 *      shipping every secret to the server. Loud failure beats silent leak.
 *   3. `bench/` fuzzes real pages and asserts no vault value appears in any outbound
 *      body. That is the test that actually proves the 40%.
 *
 * Deliberately not a plain object and deliberately not exported as a singleton — one
 * vault per page session, cleared on navigation.
 */

import type { PiiKind } from '../contracts.ts';

export class Vault {
  #byToken = new Map<string, string>();
  #byValue = new Map<string, string>();
  #counters = new Map<PiiKind, number>();

  /**
   * Mint a stable token for a value. The same value always yields the same token
   * within a session, so the server can tell "this is the same person as in the
   * previous turn" without ever learning who.
   */
  mint(kind: PiiKind, value: string): string {
    const existing = this.#byValue.get(value);
    if (existing) return existing;

    const n = (this.#counters.get(kind) ?? 0) + 1;
    this.#counters.set(kind, n);
    const token = `<PII_${kind}_${n}>`;

    this.#byToken.set(token, value);
    this.#byValue.set(value, token);
    return token;
  }

  /** Resolve a token back to its value. Only ever called at action-execution time. */
  resolve(token: string): string | undefined {
    return this.#byToken.get(token);
  }

  has(token: string): boolean {
    return this.#byToken.has(token);
  }

  get size(): number {
    return this.#byToken.size;
  }

  /** Token list is safe to expose — tokens are not secrets. */
  tokens(): string[] {
    return [...this.#byToken.keys()];
  }

  /**
   * Raw secrets, for the leak-detection test in `bench/` ONLY.
   *
   * Named to be impossible to call by accident and impossible to miss in review. If
   * you find this in production code, that is a bug — the caller wants `resolve()`.
   */
  secretsForLeakTestOnly(): string[] {
    return [...this.#byToken.values()];
  }

  clear(): void {
    this.#byToken.clear();
    this.#byValue.clear();
    this.#counters.clear();
  }

  /**
   * Tripwire. A vault must never be serialized, so make the attempt fail loudly.
   * @throws always
   */
  toJSON(): never {
    throw new Error(
      'Vault must never be serialized. Something is trying to send secrets to the ' +
      'server. Send tokens (vault.tokens()) instead.',
    );
  }
}

/**
 * Replace detected spans inside a string with minted tokens.
 *
 * Spans are applied RIGHT TO LEFT so earlier offsets stay valid as the string length
 * changes underneath. Getting this backwards corrupts every span after the first — a
 * classic and very quiet bug.
 */
export function applyRedactions(
  text: string,
  spans: Array<{ start: number; end: number; kind: PiiKind }>,
  vault: Vault,
): { text: string; tokens: Array<{ token: string; kind: PiiKind }> } {
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  const tokens: Array<{ token: string; kind: PiiKind }> = [];

  let out = text;
  for (const span of ordered) {
    const raw = text.slice(span.start, span.end);
    const token = vault.mint(span.kind, raw);
    tokens.push({ token, kind: span.kind });
    out = out.slice(0, span.start) + token + out.slice(span.end);
  }

  // Reverse so the reported order matches reading order.
  return { text: out, tokens: tokens.reverse() };
}
