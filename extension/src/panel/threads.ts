/**
 * Conversation threads, one per site — SIH26171.
 *
 * Until now every run was an island. You ran the agent, read the ledger, and the next
 * run started from nothing; switching tabs mid-task just said the new page could not be
 * read. A thread makes a site something you can come back to.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TWO THINGS A THREAD DELIBERATELY DOES NOT CONTAIN
 *
 * 1. NO VALUES, AND NO RESOLVABLE TOKENS. The vault lives in the content script, is
 *    minted per session, and dies with the page. `<PII_PAN_1>` means nothing tomorrow —
 *    it would either resolve to nothing or, far worse, to a DIFFERENT value minted in a
 *    later session. So a thread stores what was done and which KINDS were withheld, as
 *    counts. A thread file is safe to hand to a stranger, which is the same standard the
 *    transcript audit already holds itself to.
 *
 * 2. NO ELEMENT IDS. `el_49` is minted per extraction. Storing "the agent was waiting on
 *    el_49" and restoring it tomorrow points at nothing, or at a different element on a
 *    page that has since changed. A pending question therefore remembers the field's
 *    LABEL, and the id is re-derived from the live page on resume.
 *
 * Both push the same way: resuming a thread restores the GOAL and the story so far, and
 * then re-observes the live page from scratch. Which is the correct semantics regardless,
 * because the page has probably changed since.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Storage is `chrome.storage.local` — the user's own machine, no account, no network.
 * That keeps "the only outbound request goes to 127.0.0.1" true, which is the headline of
 * the deck, the store listing and the privacy policy.
 *
 * ⚠ A thread records WHICH SITES the agent was used on, which is browsing history. It is
 * on by default and `deleteAll()` exists and is wired to a visible control, and
 * `outreach/PRIVACY-POLICY.md` says so. A policy that stops being true is worse than no
 * feature.
 */

export interface ThreadTurn {
  at: number;
  /** Prose, already safe: the model's own reasoning line, which never held a value. */
  summary: string;
  withheld: Array<{ kind: string; count: number }>;
  refusedReason?: string;
}

export interface Thread {
  id: string;
  /** The key. One active thread per site. */
  origin: string;
  /** First goal, truncated — what the user sees in the list. */
  title: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  status: 'open' | 'done';
  turns: ThreadTurn[];
  /**
   * What the agent was waiting for when the run stopped.
   *
   * `fieldLabel`, never an element id — see the header. On resume the panel finds the
   * field by label against a freshly observed page.
   */
  pending?: { question: string; fieldLabel: string };
}

const KEY = 'threads';

/**
 * Cap on stored threads.
 *
 * Unbounded local storage is a slow leak with a privacy cost attached: the longer the
 * list, the more browsing history sits on disk for no one's benefit. Oldest-first
 * eviction, so the sites you actually return to survive.
 */
const MAX_THREADS = 50;

/** Trim a goal into something that fits a 400px list row. */
export function titleFor(goal: string): string {
  const t = goal.trim().replace(/\s+/g, ' ');
  return t.length <= 48 ? t : `${t.slice(0, 47)}…`;
}

/**
 * The origin, as the thread key.
 *
 * `origin` and not `host`: http and https on the same host are different security
 * contexts, and a thread that silently spans them would resume a conversation from one
 * onto the other. An unparseable URL yields undefined, and undefined means no thread —
 * the feature simply does not engage, which is the safe direction.
 */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

type Store = { [id: string]: Thread };

async function readAll(): Promise<Store> {
  try {
    const got = await chrome.storage.local.get(KEY);
    const v = got?.[KEY];
    return v && typeof v === 'object' ? v as Store : {};
  } catch {
    return {};
  }
}

async function writeAll(store: Store): Promise<void> {
  // Evict oldest by updatedAt, never by insertion order: the thread you keep returning
  // to is the one worth keeping, and it is not necessarily the newest.
  const ids = Object.keys(store);
  if (ids.length > MAX_THREADS) {
    const byAge = ids.sort((a, b) => store[a]!.updatedAt - store[b]!.updatedAt);
    for (const id of byAge.slice(0, ids.length - MAX_THREADS)) delete store[id];
  }
  try { await chrome.storage.local.set({ [KEY]: store }); } catch { /* quota, private mode */ }
}

export async function listThreads(): Promise<Thread[]> {
  const all = await readAll();
  return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The thread for a site, if there is one. */
export async function threadFor(origin: string | undefined): Promise<Thread | undefined> {
  if (!origin) return undefined;
  const all = await readAll();
  return Object.values(all)
    .filter((t) => t.origin === origin)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function getThread(id: string): Promise<Thread | undefined> {
  return (await readAll())[id];
}

export async function createThread(origin: string, goal: string): Promise<Thread> {
  const all = await readAll();
  const now = Date.now();
  const t: Thread = {
    id: `th_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    origin, goal, title: titleFor(goal),
    createdAt: now, updatedAt: now, status: 'open', turns: [],
  };
  all[t.id] = t;
  await writeAll(all);
  return t;
}

/**
 * Fold a finished run into a thread.
 *
 * Takes the loop's own record shape and keeps only what is safe and useful: the model's
 * reasoning line, the withheld COUNTS, and any refusal. No payloads, no transcripts, no
 * tokens — a transcript is 90 KB per run and holds every id and token in it, and none of
 * that survives the session anyway.
 */
export async function appendRun(
  id: string,
  run: {
    stopReason: string;
    question?: string;
    /** Label of the field the question is about. Resolved by the caller, which has the page. */
    questionFieldLabel?: string;
    records: Array<{
      withheld?: Array<{ kind: string; count: number }>;
      actions?: Array<{ action?: { reasoning?: string; kind?: string }; allowed?: boolean; reason?: string }>;
    }>;
  },
): Promise<Thread | undefined> {
  const all = await readAll();
  const t = all[id];
  if (!t) return undefined;

  for (const r of run.records ?? []) {
    const first = (r.actions ?? [])[0];
    t.turns.push({
      at: Date.now(),
      summary: first?.action?.reasoning?.trim()
        || (first?.action?.kind ? `${first.action.kind}` : 'observed the page'),
      withheld: r.withheld ?? [],
      ...(first && first.allowed === false && first.reason ? { refusedReason: first.reason } : {}),
    });
  }

  t.updatedAt = Date.now();
  t.status = run.stopReason === 'goal-complete' || run.stopReason === 'answered' ? 'done' : 'open';
  if (run.stopReason === 'needs-user-input' && run.question) {
    t.pending = { question: run.question, fieldLabel: run.questionFieldLabel ?? '' };
  } else {
    delete t.pending;
  }

  all[id] = t;
  await writeAll(all);
  return t;
}

export async function deleteThread(id: string): Promise<void> {
  const all = await readAll();
  delete all[id];
  await writeAll(all);
}

/** Wipe everything. Wired to a visible control — see the header. */
export async function deleteAll(): Promise<void> {
  try { await chrome.storage.local.remove(KEY); } catch { /* nothing to do */ }
}

/**
 * WHAT THE PANEL SHOULD OFFER FOR THE TAB THAT IS CURRENTLY IN FRONT.
 *
 * The whole origin-change decision, in one pure function so it can be tested without a
 * browser, a tab or a storage backend. The panel renders the verdict and does not think.
 *
 * The `internal` case stays a refusal rather than becoming "start a new thread": an
 * extension genuinely cannot act on `chrome://`, and offering a thread there would be a
 * button that cannot work. The case worth replacing was the refusal shown on an ORDINARY
 * site, which is now an invitation.
 */
export type ThreadVerdict =
  | { kind: 'internal' }
  | { kind: 'continue'; thread: Thread }
  | { kind: 'resume'; thread: Thread }
  | { kind: 'new'; origin: string };

export function decide(
  url: string | undefined,
  activeThread: Thread | undefined,
  siteThread: Thread | undefined,
): ThreadVerdict {
  const origin = originOf(url);
  if (!origin) return { kind: 'internal' };
  // Already in a conversation on this very site: just keep going, say nothing loud.
  if (activeThread && activeThread.origin === origin) return { kind: 'continue', thread: activeThread };
  // A different site we have been on before: offer to pick it up.
  if (siteThread) return { kind: 'resume', thread: siteThread };
  // A site with no history: this is the message that used to say the page could not be read.
  return { kind: 'new', origin };
}
