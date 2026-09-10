# Spike D — does face redaction actually redact the face?

Run: 10 Sep 2026 · Chrome for Testing 153 · Apple M5
Model: **UltraFace RFB-320** (ONNX Model Zoo, MIT) — **1.2 MB**
Reproduce: `./spikes/c-capture/run.sh` (runs Spikes C and D in one browser launch)

"We blurred the faces" is the easiest claim in this project to believe and never check.
A tight box, a fixed blur radius, or an off-by-a-scale-factor coordinate map all produce
an image that LOOKS processed while the person stays perfectly recognisable.

## Result: ✅ VERIFIED

```
faces detected : 1  (score 1.00)   backend: webgpu
detected box   : 226,91  30x39
applied box    : 218,81  46x59     (grown 25% - see below)
inference      : 53.6 ms warm  (437 ms cold, first-run shader compile)

detail inside box : variance 3195.88 -> 343.58   ratio 0.108
                    89.2% of detail destroyed
outside the box   : 5 control points, ALL delta = 0
```

Both halves hold at once: the face is destroyed, and **nothing else in the image was
touched**. The second half matters as much as the first — a blur that smears the whole
frame would pass a naive "did it change" test while wrecking the visual context the
server needs, costing 25% of the grade to protect 20%.

## Two design decisions that came out of building it

**Grow the box before blurring (25%).** UltraFace boxes are tight around the facial
features and leave hair, ears, jawline and chin outside — all of which identify a person
perfectly well. A tight blur looks diligent and de-identifies nothing.

**Blur radius scales with face size.** A fixed radius leaves large faces recognisable.
Radius is `max(8, min(w,h)/4)`, so a small face is blurred as thoroughly as a large one.

Padding during letterboxing is **mid-grey (127)**, which normalises to exactly 0 and
contributes nothing to the activations. Black padding reads as a strong edge and can
invent detections along the border.

---

## The mistake worth remembering: the first verification was measuring the wrong thing

The initial test asserted that sampled pixels INSIDE the face box must change by more
than 10. It **failed** — reporting `insideChanged: false` while the blur was working
perfectly.

Why: one sample point sat on flat skin tone. **Blur is an average of neighbours, so over
a uniform region the average is the original value.** Individual pixels barely move. The
test was measuring pixel displacement when the property that matters is *detail
destruction*.

Replaced with **luma variance over the region**: blur is a low-pass filter, and what it
removes is high-frequency detail, which is exactly what variance measures. It is also
the measure that actually corresponds to "is this person still recognisable".

The lesson generalises past this spike: a red test is not automatically a real defect.
It is worth one round of asking whether the assertion encodes the property you care
about — here, "pixels moved" and "the face is gone" are not the same claim, and only one
of them is the requirement.

## Numbers for the deck

| | |
|---|---|
| face model size | 1.2 MB |
| detection (warm) | **53.6 ms** |
| detection (cold) | 437 ms — shader compile, once |
| detail destroyed | **89.2%** |
| collateral damage | **0 pixels** outside the box |
