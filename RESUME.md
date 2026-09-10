# SIH 2026 — SIH26171 — On-device Visual Perception for Light-weight Browser Agents

**READ THIS FIRST.**

ISRO / Department of Space · Software · Smart Automation
Idea submission deadline **30 September 2026** · Grand finale December 2026
Repo: `vansh-attention/sih_Vtransformer` — Vansh's repo, Harsh has WRITE
Local: `~/sih-browser-agent` · released **v0.1.0**, **v0.1.1**

| file | what it is |
|---|---|
| `README.md` | Public front door |
| `ONBOARDING.md` | Send to a teammate. Project + `./setup.sh` |
| `RUNBOOK.md` | The demo. Print it. **Pre-warm the model** |
| `AUDIT.md` | Every part rated from a user's POV — all 17 now at 10 |
| `bench/README.md` | Scorecard, the holdout rule, known gaps |
| `spikes/*/FINDINGS.md` | Why the architecture is what it is, with measurements |
| `deck/` | The 6-slide SIH submission. `python3 deck/build.py` rebuilds |

```bash
./setup.sh             # clone -> working, one command
./test-all.sh          # 15 checks, no browser needed
./test-all.sh --full   # 20 checks: + real browsers + live model
```

---

## ⛔ THE ONLY THING BLOCKING SUBMISSION — ASK HIM

**Does IIM Mumbai have a SPOC registered on sih.gov.in?** SPOC registration closed
**31 July 2026**. No SPOC means the team cannot enter at all this year. Raised at every
checkpoint across this whole session and still unanswered.

Also needed from the portal, for deck slide 1 — rendered in amber «guillemets» so they
cannot ship blank: **Theme, Team ID, Team Name**. Then **re-export the PDF from
PowerPoint**, not from the LibreOffice copy in `deck/`.

Third: **the internal hackathon date**. That is the real deadline and it is earlier than
30 Sep. Fallback if IIM Mumbai has no SPOC — he is also enrolled at **IITM BS**, and IIT
Madras reliably participates.

**The two official forms are already downloaded** — `~/Downloads/`,
`College-Consent-Letter-for-SPOC-SIH2026.docx` and
`College-Authorization-letter-SIH2026.docx`. Both are blank templates, so nothing has
been started. Read from them:

- A SPOC is appointed by the **Principal/Dean**, one per institute, and that SPOC
  nominates the college's **top 50 teams** (45 + 5 waitlist). So a registered SPOC is
  necessary but not sufficient — the team still has to be nominated.
- The nomination letter is **one per team**, on college letterhead, signed and stamped
  by the Principal, and needs the college's **AICTE/UGC number**.
- **Do not restyle either form.** The template says in as many words that a team whose
  format has been changed is likely to be disqualified.

---

## What it is

A browser extension (Chrome + Firefox) plus a local Python server.

A small model runs **in the browser**, reads the page, and replaces every PAN, Aadhaar,
card, password and face with a typed tag **before any network request**. An open-weight
VLM reasons over the censored page and returns one action; the client validates it, then
executes it.

**The vault lives in the content script.** The background script — the only part that
touches the network — has never held a real value. "No PII leaves the machine" is a
property of the architecture, not a claim about code correctness.

## Numbers — all measured, none estimated

| | tuned (12 fixtures) | **holdout** |
|---|---|---|
| visual context accuracy | 100% | **100%** |
| PII recall / precision | 100% / 100% | **100% / 100%** |
| redaction precision | 100% | **100%** |
| leaks | **0** | **0** |

Per turn: 47 KB · vision 65 ms · model ~3.8 s · **~4.7 s on a low-end laptop**
(6× CPU throttle, Spike G). The model generates **~11 tok/s** — that is the hardware:
constrained decoding, context size and model choice were each measured and ruled out.

CI runs `setup.sh` and `test-all.sh` on **Linux, macOS and Windows** on every push.

---

## Rules that must not be broken

1. **Never tune against `bench/holdout/`.** It simulates the finale, where sites are
   revealed on the day. Special-casing its content deletes the only generalisation
   evidence we have.
2. **No hardcoded CSS selectors, ever.** Same reason.
3. **Measure the operation, not the stage.** Wrong guesses this session: 3 on the vision
   stage, 2 on the huge page, 4 on fault injection. Each time, instrumenting cost less
   than a single guess.
4. **A green test that cannot fail is worse than no test.** One passed while the
   extractor returned zero nodes, because `[].every()` is `true`. Assert coverage first.
5. **Print the evidence before theorising.** Four CI cycles chasing a fault-injection bug
   that did not exist; one round of printing the raw `/health` response found it.

---

## The leak class that keeps recurring — LOOK HERE FIRST

**Four separate leaks had the same shape: content visible on screen but invisible to the
redactor, while the screenshot transmits it anyway.** The leak test only inspects the
JSON payload, so it caught none of them.

1. Hidden text lifted into a visible element's `contextLabel`
2. Shadow DOM — never traversed at all
3. Text beyond the character cap — silently truncated
4. The same value appearing twice, redacted in one place only

If a fifth exists it will look like that. Current defence: **withhold the screenshot**
when part of the page is unreadable (`closedShadowHosts`, `piiBeyondTextCap`).

## Findings that cost real time — do not regress

- A positive PII keyword beats negative context ("PAN (for invoices…)" leaked a real PAN)
- `<label>` elements must not enter the tree (36 → 27 nodes)
- Scan direct text only, never `el.textContent`
- Field hints DEMOTE label text, never replace it
- Redaction is vault-global, not per-node
- **Evidence about a value must not come from the value** — `<td>Applicant Name</td>` was
  redacted as a NAME; holdout redaction precision was 22%
- Table cells take meaning from the **column header**, not the previous sibling
- `Array.from(el.children)` per node: 8644 ms vs 4 ms for sibling iteration
- `document.querySelector('label[for]')` per element: 54 s per 1500 calls. Build a map once
- Chrome's **offscreen document is timer-throttled to ~1 s** — a 16×16 canvas encodes in
  1004 ms there. Never put avoidable async work in it
- int8 is **10× SLOWER** than fp32 on WebGPU (no native int8 matmul path)
- Branded Chrome refuses `--load-extension`; use Chrome for Testing
- Chrome caches the extension's service worker in the user profile — a reused profile
  runs yesterday's code against today's build
- `instanceof HTMLSelectElement` is a browser global; it broke 7 suites under Node
- **A wall-clock threshold in a test is a claim about the machine, not the code.** The
  huge-page drill's `< 6000ms` failed two docs-only commits at 6021ms on a loaded macOS
  runner. It is now a **ratio** against a style call timed on the same machine: healthy
  0.5×, limit 3×, and an injected regression measured 3.40× — so it still fires
- Headless Firefox reports no WebGPU adapter; **headed Firefox has one** (Spike B was
  wrong and is marked superseded)

---

## Still open — none blocking

- Indian languages beyond Hindi (Tamil, Bengali, Telugu behave as Hindi did before
  `hindi-opaque.html` was added)
- Devanagari names in **prose** — form fields work; the name tokeniser is Latin-only
- Corpus is 12 fixtures + 4 real sites. **Growing it has found a real bug every single
  time — the best task for a teammate**
- Git Bash on Windows cannot background uvicorn, so the server drills skip there; WSL
  works. Documented, not hidden

## Environment notes

- `scripts/find-browser.sh` auto-detects browsers; `scripts/get-chrome-for-testing.sh`
  fetches the Testing build
- Firefox runs from a **mounted DMG** at `/Volumes/Firefox` — it is not installed.
  After a reboot: `hdiutil attach ~/Downloads/Firefox*.dmg`
- Chrome proper is on his **Desktop**, not `/Applications`
- Ollama + `qwen2.5vl:7b` (6 GB). The server warms it at startup and holds it 30 min
