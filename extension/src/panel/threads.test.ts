/**
 * The thread decision — SIH26171.
 *
 * `decide()` is the whole origin-change behaviour in one pure function, which is why it
 * is one: the panel has never had a testable unit in it, and "what does the panel say
 * when you switch tabs" is exactly the kind of thing that gets verified by opening the
 * browser and squinting.
 *
 *   node --experimental-strip-types extension/src/panel/threads.test.ts
 */

import { decide, originOf, titleFor, type Thread } from './threads.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)}${ok ? '' : ` ${detail}`}`);
};

const thread = (origin: string, extra: Partial<Thread> = {}): Thread => ({
  id: `th_${origin}`, origin, goal: 'g', title: 'g',
  createdAt: 1, updatedAt: 1, status: 'open', turns: [], ...extra,
});

const MCA = thread('https://www.mca.gov.in');
const EPFO = thread('https://www.epfindia.gov.in');

console.log('--- which site is this, and what do we offer ---');
{
  // Same site as the conversation in progress: carry on, quietly.
  const v = decide('https://www.mca.gov.in/forms/reg', MCA, MCA);
  check('same site as the active thread -> continue', v.kind === 'continue', v.kind);

  // A different site we have been on before: offer to pick it up. This is the case he
  // asked for — "when we open the older website, it asks us to continue".
  const r = decide('https://www.epfindia.gov.in/home', MCA, EPFO);
  check('different site WITH history -> resume', r.kind === 'resume', r.kind);
  check('resume names the right thread',
    r.kind === 'resume' && r.thread.origin === EPFO.origin, JSON.stringify(r));

  // A site we have never used: this is the message that used to say the page could not
  // be read.
  const n = decide('https://example.gov.in/apply', MCA, undefined);
  check('different site with NO history -> new', n.kind === 'new', n.kind);
  check('new carries the origin, not the full url',
    n.kind === 'new' && n.origin === 'https://example.gov.in', JSON.stringify(n));

  // No conversation in progress at all.
  const f = decide('https://example.gov.in/apply', undefined, undefined);
  check('no active thread, unseen site -> new', f.kind === 'new', f.kind);
}

console.log('\n--- pages an extension genuinely cannot act on ---');
{
  /**
   * These stay a refusal. Offering "start a thread here" on chrome:// would be a button
   * that cannot work — the message he wanted replaced was the one shown on an ORDINARY
   * site, not this one, which is accurate.
   */
  for (const url of ['chrome://extensions', 'chrome-extension://abc/panel.html',
                     'about:blank', 'edge://settings', 'file:///tmp/x.html',
                     'moz-extension://abc/x.html', undefined]) {
    const v = decide(url, MCA, undefined);
    check(`internal: ${String(url).slice(0, 34)}`, v.kind === 'internal', v.kind);
  }
}

console.log('\n--- the origin is the key, and it is an ORIGIN ---');
{
  check('http and https are different threads',
    originOf('http://a.test/x') !== originOf('https://a.test/x'),
    'same key for two different security contexts');
  check('path and query do not change the key',
    originOf('https://a.test/one?q=1') === originOf('https://a.test/two'), '');
  check('port is part of the key',
    originOf('https://a.test:8443/x') !== originOf('https://a.test/x'), '');
  for (const bad of ['', 'not a url', 'javascript:alert(1)', 'data:text/html,x']) {
    check(`refuses to key on: ${bad.slice(0, 24) || '(empty)'}`,
      originOf(bad) === undefined, String(originOf(bad)));
  }
}

console.log('\n--- titles fit a 400px row ---');
{
  check('short goal is untouched', titleFor('  Fill the form  ') === 'Fill the form', '');
  const long = titleFor('x'.repeat(200));
  check('long goal is truncated with an ellipsis',
    long.length === 48 && long.endsWith('…'), `${long.length} chars`);
  check('whitespace is collapsed',
    titleFor('a\n\n  b') === 'a b', JSON.stringify(titleFor('a\n\n  b')));
}

console.log(fail ? `\n${fail} FAILURES` : '\nall thread-decision cases pass');
process.exit(fail ? 1 : 0);
