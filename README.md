# Privacy Agent

**SIH 2026 · Problem Statement SIH26171 — On-device Visual Perception for Light-weight Browser Agents**
ISRO / Department of Space · Software · Smart Automation

A browser agent that reads your screen and acts on it — **without your personal data
ever leaving your machine.**

A small model runs inside your browser, reads the page, and replaces every PAN, Aadhaar
number, card, password and face with a typed tag *before any network request is made*.
A larger open-weight model reasons over the censored page and returns one instruction —
"click Submit" — which your browser carries out.

The server does the thinking. It never learns your PAN, your account number, or what you
look like.

---

## Quick start

```bash
git clone https://github.com/vansh-attention/sih_Vtransformer.git
cd sih_Vtransformer
./setup.sh
```

About 10 minutes, mostly downloads. It checks your tools, fetches the models, builds the
extension for both browsers, sets up the Python server, and runs the tests.

**Load the extension**

| | |
|---|---|
| **Chrome** | `chrome://extensions` → Developer mode → Load unpacked → `extension/` |
| **Firefox** | `about:debugging` → Load Temporary Add-on → `dist-firefox/manifest.json` |

**Run it**

```bash
ollama serve                                          # the local model
cd server && .venv/bin/uvicorn main:app --port 8975   # the reasoning server
python3 -m http.server 8080 --directory bench/pages   # something to try it on
```

Open `http://localhost:8080/checkout.html`, click the toolbar icon, type a goal, press
Run.

> The server warms the model at startup and holds it resident. The **first** request
> after a cold start takes ~17 s while 7 GB loads; after that it is ~4 s.

---

## Requirements

| | |
|---|---|
| **Node** | 22 or newer — we run TypeScript directly, no compile step |
| **Python** | 3.10+ |
| **Ollama** | to run the agent. Not needed to build or test |
| **Disk** | ~7 GB for the vision model, ~230 MB for everything else |
| **RAM** | 16 GB works; 8 GB will struggle with the 7B model |

**Platforms.** Developed and fully verified on macOS (Apple Silicon). The build, the
test suite and CI run on Linux. Windows works through **Git Bash or WSL** — the shell
scripts need a POSIX shell. Browser paths are auto-detected on all three; override with
`CHROME=` / `FIREFOX=` if yours is somewhere unusual.

---

## Testing

```bash
./test-all.sh          # everything that needs no browser  (~2 min)
./test-all.sh --full   # the above, plus real browsers and the live model
```

`--full` needs Chrome for Testing — branded Chrome refuses `--load-extension`, so:

```bash
./scripts/get-chrome-for-testing.sh
```

Individual pieces:

```bash
node --experimental-strip-types bench/score.ts            # the scorecard
node --experimental-strip-types bench/score.ts --holdout  # pages never tuned against
node --experimental-strip-types bench/leak-test.ts        # the hard invariant
node --experimental-strip-types bench/injection-test.ts   # hostile-page defences
./bench/failure-drills.sh                                 # things going wrong
```

---

## Where it stands

| | tuned corpus | **holdout (never tuned against)** |
|---|---|---|
| visual context accuracy | 100% | **100%** |
| PII detection recall | 100% | **100%** |
| PII detection precision | 100% | **100%** |
| redaction precision | 100% | **100%** |
| data leaks | **0** | **0** |

Per turn: **47 KB** transmitted · face detection **65 ms** · model **~3.8 s** ·
**~4.7 s** total on a low-end laptop (measured under 6× CPU throttling, not estimated).

Working today: the full loop in **Chrome and Firefox**, on-device face blurring, the
Privacy Ledger, prompt-injection resistance, graceful failure, Hindi and English.

---

## How it works

**The screen is not just pixels — it is a DOM.** Page structure already gives exact
labels, field types and coordinates for free, so the vision model runs only on the
regions the DOM cannot describe: images, canvas, cross-origin frames.

**PII detection is a three-layer cascade.** DOM semantics (`autocomplete`, ARIA,
password inputs) → patterns *with checksums* (Verhoeff for Aadhaar, Luhn for cards,
mod-36 for GSTIN) → person names via gazetteer and dictionary-absence.

**Redaction replaces the value and keeps the shape.** `<PII_PAN_1>` tells the server
"this field is filled and valid" without telling it what the value is.

**The vault lives in the content script.** The background script — the only part that
touches the network — has never held a real value. So "no personal data leaves the
machine" is a property of the *architecture*, not a promise that our code is bug-free:
a mistake in the networking layer *cannot* leak a PAN, because that layer has never seen
one.

---

## Repository map

| | |
|---|---|
| `ONBOARDING.md` | **Read this first.** What to know and what to pick up |
| `RUNBOOK.md` | The demo, step by step. Print it |
| `AUDIT.md` | Every part rated from a user's perspective |
| `bench/README.md` | The scorecard, the holdout rule, known gaps |
| `spikes/*/FINDINGS.md` | Why the architecture is what it is, with measurements |
| `deck/` | The six-slide SIH submission |

---

## Known limits

We publish these rather than wait to be asked.

- **Only Hindi among Indian languages.** Tamil, Bengali, Telugu and the rest follow the
  same pattern and are not yet covered.
- **Devanagari names in running prose** are not detected — the name tokeniser is
  Latin-only. Devanagari *form fields* are handled.
- **The test corpus is 12 pages plus 4 real websites.** Small. Every new page shape has
  found a real defect, which is the argument for growing it.
- **The model generates ~11 tokens/second on our hardware.** That is the machine, not
  the code: constrained decoding, context size and model choice were each measured and
  ruled out.
- Performance figures come from an Apple M5. **Re-measure on the machine you will
  demo on.**

## Licence

MIT — see `LICENSE`. Third-party models retain their own licences.
