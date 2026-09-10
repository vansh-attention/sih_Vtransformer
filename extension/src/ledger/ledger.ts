/**
 * The Privacy Ledger — SIH26171.
 *
 * 40% of the rubric is privacy handling. Every team will CLAIM their pipeline is
 * private. The ledger is how we make a judge able to CHECK it, in the room, without
 * taking our word for anything: side by side, what was on the screen against the exact
 * bytes that left the machine.
 *
 * THE HARD PART: the ledger must not itself become the leak.
 *
 * A naive "before and after" view stores the before — which is a tidy, persistent,
 * searchable collection of every secret on the user's screen. That is strictly worse
 * than the problem we set out to solve.
 *
 * So the ledger stores MASKED PREVIEWS only. `ABCPE1234F` is recorded as `AB•••••••F`:
 * enough for a human to confirm we caught the right field, never enough to reconstruct
 * the value. The full original is only ever rendered live, from memory the client
 * already holds, and is never persisted.
 */

import type { LedgerEntry, PiiKind, SanitizedPayload } from '../contracts.ts';

/**
 * Mask a value for display. Keeps the first two and last one character so a human can
 * recognise the field; everything else is destroyed.
 *
 * Short values are masked completely — revealing 3 of 4 characters of a PIN is not a
 * preview, it is a disclosure.
 */
export function maskPreview(value: string, kind?: PiiKind): string {
  const trimmed = value.trim();

  // Secrets with no recognition value reveal NOTHING. Showing "hu****2" for the
  // password "hunter2" hands over 3 of 7 characters, and unlike a card number there is
  // no legitimate reason a user needs to recognise which password it was.
  if (kind === 'PASSWORD') return '•'.repeat(8);

  if (trimmed.length <= 4) return '•'.repeat(Math.max(trimmed.length, 3));
  const head = trimmed.slice(0, 2);
  const tail = trimmed.slice(-1);
  return `${head}${'•'.repeat(Math.min(trimmed.length - 3, 12))}${tail}`;
}

/** Token plus a masked shadow of what it replaced. Never the value itself. */
export interface Preview {
  token: string;
  masked: string;
}

export interface WithheldGroup {
  kind: PiiKind;
  count: number;
  /** Masked only. Never the real values. Capped so one page cannot bloat storage. */
  previews: Preview[];
}

export interface RecordOptions {
  origin: string;
  transmitted: SanitizedPayload;
  /**
   * Real values, used ONLY to compute masks. Not retained past this call.
   * The token is what lets the renderer line a transmitted field up with the masked
   * shadow of what used to be there, without the ledger ever holding the value.
   */
  withheldValues: Array<{ kind: PiiKind; token: string; value: string }>;
  timings: LedgerEntry['timings'];
  peakHeapMb: number;
}

/** One entry per outbound request. */
export interface Entry {
  at: number;
  origin: string;
  transmitted: SanitizedPayload;
  withheld: WithheldGroup[];
  timings: LedgerEntry['timings'];
  resources: { peakHeapMb: number };
}

const MAX_ENTRIES = 200;
const MAX_PREVIEWS_PER_KIND = 5;

export class Ledger {
  #entries: Entry[] = [];

  /**
   * `withheldValues` carries real secrets in and masked previews out. They are
   * consumed here and never stored — that boundary is the whole point of this class.
   */
  record(opts: RecordOptions): Entry {
    const grouped = new Map<PiiKind, WithheldGroup>();

    for (const { kind, token, value } of opts.withheldValues) {
      let group = grouped.get(kind);
      if (!group) {
        group = { kind, count: 0, previews: [] };
        grouped.set(kind, group);
      }
      group.count++;
      if (group.previews.length < MAX_PREVIEWS_PER_KIND
          && !group.previews.some((p) => p.token === token)) {
        group.previews.push({ token, masked: maskPreview(value, kind) });
      }
    }

    const entry: Entry = {
      at: Date.now(),
      origin: opts.origin,
      transmitted: opts.transmitted,
      withheld: [...grouped.values()],
      timings: opts.timings,
      resources: { peakHeapMb: opts.peakHeapMb },
    };

    this.#entries.push(entry);
    if (this.#entries.length > MAX_ENTRIES) this.#entries.shift();
    return entry;
  }

  entries(): readonly Entry[] {
    return this.#entries;
  }

  get length(): number {
    return this.#entries.length;
  }

  /** Totals across the session, for the summary strip at the top of the panel. */
  totals(): { requests: number; withheld: number; byKind: Array<{ kind: PiiKind; count: number }> } {
    const byKind = new Map<PiiKind, number>();
    let withheld = 0;
    for (const e of this.#entries) {
      for (const g of e.withheld) {
        byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + g.count);
        withheld += g.count;
      }
    }
    return {
      requests: this.#entries.length,
      withheld,
      byKind: [...byKind].map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  clear(): void {
    this.#entries = [];
  }
}
