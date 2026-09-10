# Spike E — the whole product, end to end, in a real browser

Run: 10 Sep 2026 · Chrome for Testing 153 (headed) · Apple M5 · Qwen2.5-VL 7B via Ollama
Reproduce: `./run.sh` (server must be up: `cd server && .venv/bin/uvicorn main:app --port 8975`)

Everything before this was verified in pieces. This runs the **real extension** against
a **real page** through the **real agent loop** — the only configuration a judge ever sees.

## Result: ✅ the loop closes in the browser

```
1:observing -> 1:redacting -> 1:reasoning -> 1:validating -> 1:acting
            -> 2:observing -> 2:redacting -> 2:reasoning -> 2:validating -> 2:acting

TURN 1  27 nodes, 156.5KB sent, navigated=true
  withheld: 1xNAME 2xEMAIL 1xPHONE 1xPAN 1xAADHAAR 1xGSTIN 1xCARD 1xPASSWORD 1xADDRESS
  ALLOW click el_23  executed=true
        "The 'Pay now' button is available and needs to be clicked to submit the payment"
  extract 3ms | sanitize 7ms | vision 473ms | model 3032ms | TOTAL 3541ms

TURN 2  27 nodes, 156.7KB sent
  extract 2ms | sanitize 5ms | vision 69ms | model 3952ms | TOTAL 4039ms
```

Ledger masks, straight from the run:

```
Ha•••••••••i     -> <PII_NAME_1>       AB•••••••F      -> <PII_PAN_1>
hb•••••••••••m   -> <PII_EMAIL_1>      23•••••••••4    -> <PII_AADHAAR_1>
+9••••••••••••0  -> <PII_PHONE_1>      41••••••••••••1 -> <PII_CARD_1>
••••••••         -> <PII_PASSWORD_1>
```

**Where the time goes:** the model is ~85% of each turn. Vision is 473 ms on the first
turn (model load) and **69 ms** thereafter. Extraction and sanitization together are
under 10 ms. Latency work means the model, not the client.

**Payload is 156 KB, almost all screenshot.** Worth downscaling before the finale — it
costs upload time on every turn and the model does not need full resolution.

---

## Three defects this found that nothing else could

### 1. Navigation tore down the loop
The agent clicked "Pay now", the form submitted, and the next message threw
`The page keeping the extension port is moved into back/forward cache`.

That was the action **succeeding**. The orchestrator now treats a torn-down channel
during execution as navigation, and re-injects the content script every turn. That is
also the correct security behaviour: **a new page gets a new, empty vault.**

### 2. The ledger's masks vanished after navigation
Masks were being fetched from the content script *after* the run. But the vault is
per-page and dies on navigation — correctly, secrets must not survive a page change — so
the request returned nothing, or threw once the old document was bfcached.

Masks are now captured **at observe time**, inside the turn record. The privacy story
survives the agent doing its job.

### 3. The validator allowed `type` against a BUTTON
It failed at execution with "not a text field" instead of being refused up front. A
button is neither a password field nor disabled, so nothing in the validator objected.

Refusal belongs at validation time: that is the layer that is supposed to know what is
safe, and an action that reaches the page and fails leaves the loop unsure whether the
page changed. `type` now requires a typeable role.

## Architecture note worth stating out loud

The **vault lives in the content script**. The background service worker — the only part
that touches the network — has never held a real value.

"No PII leaves the machine" is therefore a property of the architecture, not a claim
about any one function's correctness. A bug in the network layer *cannot* leak a PAN,
because that layer has never seen one.

---

# Performance pass — 10 Sep 2026

| | before | after |
|---|---|---|
| payload per turn | 156 KB | **47 KB** |
| vision stage | 1083 ms | **65 ms** |
| turn total | ~4900 ms | **~3730 ms** |

## The finding: an offscreen document is TIMER-THROTTLED to ~1 second

Vision was taking ~1080 ms per turn. I guessed at the cause three times — the message
transfer, the image decode, the canvas downscale — and was wrong every time. Only
instrumenting *inside* each stage produced the answer:

```
captureMs 27 | decodeMs 6 | detectMs 17 | blurAndEncodeMs 1021 | classifyMs 30
  -> transmit stages: resizeMs 11 | drawMs 0 | encodeMs 1010 | dataUrlMs 0
```

`canvas.convertToBlob()` was taking 1010 ms. Suspiciously constant, so I probed it
directly at three canvas sizes:

```
16px   1004ms      256px  1005ms
1024px 1013ms      16px again  1003ms
```

**A 16x16 canvas takes 1004 ms to encode.** That is not work — offscreen documents are
hidden by definition, and Chrome quantises hidden-document task scheduling to ~1 second.
No amount of image optimisation could ever have fixed it.

### Consequences for the architecture
- **Never do async work in the offscreen document that could live elsewhere.** Inference
  is fine (`session.run` resolved in 17 ms); anything resolving on a scheduled task is
  not.
- Downscaling now happens in the **content script**, which runs in a visible tab and is
  not throttled.
- Face blurring must stay in the offscreen document — it needs the model — so the rare
  frames containing a face still pay the ~1 s. Correctness beats latency when the
  alternative is transmitting an unblurred face.

## Downscaling matters for MODEL time, not just bytes

Skipping the downscale entirely also removes the 1 s, and that was tempting. But a VLM
tokenises an image by **area**: shipping 2400x1314 instead of 1024x561 pushed one turn's
model time to **25.9 s**. The downscale is worth far more than the bytes suggest.

## Lesson

Three wrong guesses in a row, each plausible, each costing a build-and-measure cycle.
The instrumentation that found it took less time than any one of the guesses. **Measure
the stage before optimising the stage.**

## Two bugs this pass introduced and caught

1. **`transferToImageBitmap()` detaches the canvas.** Caching the blurred frame that way
   left `convertToBlob` encoding an empty surface — a blank "redacted" image. Spike D
   caught it immediately as zero variance. `createImageBitmap()` copies instead.
2. **Both spike harnesses share `onInstalled`,** so adding Spike E silently stopped
   Spikes C and D from running at all. The background now dispatches on which collector
   port is actually listening.
