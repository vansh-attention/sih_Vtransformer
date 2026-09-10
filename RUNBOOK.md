# Demo runbook

Print this. Follow it in order. The failure modes at the bottom have all actually
happened during development.

---

## T-30 minutes

```bash
cd sih_Vtransformer
git pull && node build.mjs          # never demo a stale build
./test-all.sh                       # 19/19 expected; do not demo on red
```

**1. Start the local AI.**
```bash
ollama serve
```

**2. Start our server.**
```bash
cd server && .venv/bin/uvicorn main:app --port 8975
```

**3. ⚠ PRE-WARM THE MODEL. This is the step people skip.**
```bash
curl -s http://127.0.0.1:8975/health
node --experimental-strip-types bench/agent-loop.ts "Submit the payment form"
```

**Cold: 17 seconds. Warm: 2.5 seconds.** A judge timing a cold first request sees
seventeen seconds of nothing and stops watching. Run it twice; the second run is what
they'll see.

**4. Serve the demo pages.**
```bash
python3 -m http.server 8080 --directory bench/pages
```

**5. Load the extension.**
- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/`
- Firefox: `about:debugging` → Load Temporary Add-on → `dist-firefox/manifest.json`

**6. Open the tabs you'll use, in order**, so nothing loads live:
- `http://localhost:8080/checkout.html`
- `http://localhost:8080/hostile.html`

**7. Screen resolution.** The panel is narrow. Zoom the browser to 110% so the ledger is
readable from a few feet away.

---

## The demo — 4 minutes

### 1. The problem (30s) — say this before touching anything

> An AI agent is only useful if it can see your screen. But your screen has your PAN,
> your Aadhaar, your bank details, an open password field. So today you either accept an
> assistant that sees everything, or you get no assistant. We built the third option.

### 2. Run it (60s)

Open `checkout.html` — a payment form with a PAN, an Aadhaar, a card, a password.
Open the side panel. Goal: **"Submit the payment form."** Run.

While it runs, say what's happening:

> A small vision model on this laptop is reading the screen. Every PAN, Aadhaar, card and
> password is being replaced *before* anything is sent. The big AI never sees a real value.

### 3. The Privacy Ledger — this is the moment (90s)

Point at the ledger:

```
Ha•••••••••i    →  <PII_NAME_1>      withheld
AB•••••••F      →  <PII_PAN_1>       withheld
••••••••        →  <PII_PASSWORD_1>  withheld
Order Total     999999999999          sent as-is
```

> Nine values withheld. **And look at the last row** — that order total is twelve digits
> and passes the Aadhaar checksum. We deliberately did *not* redact it, because it's an
> order total. Over-redaction destroys the context the AI needs. That's scored as heavily
> as leaking.

Then open **"Raw bytes transmitted"**:

> This is the exact payload. You can read it. There's no PAN in it.

### 4. The hostile page (60s)

Open `hostile.html`.

> This page is trying to attack the agent. It contains instructions telling the AI to
> disclose the user's data — some visible, some hidden in `display:none`.

Run it, then:

> The model **complied**. Its own reasoning said "the user has authorised full
> disclosure". And it still leaked nothing — because it never had a real value to leak.
> Our security doesn't depend on the AI behaving. It's structural.

### 5. Close (30s)

> Chrome and Firefox. Runs entirely on this laptop — I can unplug the network. On unseen
> test pages: 100% precision, zero leaks. On a low-end laptop it's about a second slower
> per turn.

---

## If they ask

**"How do we know it's private?"** — Open the raw bytes. It's the whole point of the
ledger: nobody has to trust us.

**"What if the AI is malicious?"** — It has never held a real value. And every action it
returns is validated on the client before it touches the page — 15 attack cases refused,
including one real exfiltration path we found and closed.

**"Does it work on sites you haven't seen?"** — That's what our holdout tests are: pages
written before any tuning, never optimised against. 100% precision, zero leaks.

**"What doesn't it do?"** — Names with no labelling cue and not in any public name list.
One holdout test fails on that, deliberately. Closing it needs a 103 MB NER model against
a 20%-weighted resource budget; we priced it and chose not to.

**"Why not use GPT-4/Claude?"** — The PS requires an open-weight, offline-deployable
model. Ours runs on this laptop with the network off.

---

## When it breaks

| Symptom | Cause | Do this |
|---|---|---|
| "the reasoning server is not running" | uvicorn not started | The panel prints the command. Run it. |
| First request takes ~17s | Cold model | **Pre-warm.** If it happens live: "that's the model loading — watch the second one." |
| "this page cannot be read" | On `chrome://` or the extension gallery | Extensions can't touch browser-internal pages. Switch tabs. |
| Panel empty, nothing happens | Extension not rebuilt | `node build.mjs`, then reload the extension. |
| Agent clicks the wrong thing | Small model, real behaviour | Say so. The validator stopped anything unsafe — that's the point. |
| Screenshot missing | `captureVisibleTab` throttled | Wait a beat and re-run. The panel reports it rather than hiding it. |
| Firefox won't load the extension | Loaded `extension/` | Firefox needs `dist-firefox/`. |

**Do not** switch to a random live website mid-demo. Anything with a login wall, a cookie
banner or heavy JS will produce a worse first impression than the fixtures, and you can't
rehearse it.

---

## Numbers, and how to quote them

| | this machine | **low-end laptop** |
|---|---|---|
| turn total | 3.7 s | **4.7 s** |
| vision | 65 ms | ~1030 ms |
| payload | 47 KB | 47 KB |

| | tuned | **holdout (unseen)** |
|---|---|---|
| visual context | 100% | **100%** |
| PII recall | 100% | **91.7%** |
| PII precision | 100% | **100%** |
| redaction precision | 100% | **100%** |
| leaks | 0 | **0** |

**Quote the holdout column and the low-end column.** They're the honest ones, and being
the team that volunteers its own worst number is worth more than a better number nobody
believes.
