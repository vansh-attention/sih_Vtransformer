# Spike C — capture / DOM alignment

Run: 10 Sep 2026 · Chrome for Testing 153, **headed** · macOS Apple Silicon
Reproduce: `./run.sh`

`getBoundingClientRect()` returns **CSS pixels** in viewport space.
`captureVisibleTab()` returns a PNG in **device pixels**. On a Retina display those
differ by 2x, and neither API announces it.

Get this wrong and every redaction box is drawn in the wrong place — a face is
"blurred" while the actual face stays visible. **That failure is completely silent
unless something asserts on pixels.**

## Result: ✅ PASS — 5/5 blocks verified at the pixel level

```
viewport 1200x657  ->  image 2400x1314    DPR 2   derived scale 2.0   matches DPR: true
capture 38ms | extract 2ms | 6 nodes | viewport stable during extraction: true

block       sampled  expected  delta  nearest        img px    result
topleft     #ff0000   #ff0000      0  topleft      (120, 80)   OK
topright    #01ff00   #00ff00      1  topright    (2280, 80)   OK
centre      #0000ff   #0000ff      0  centre     (1200, 480)   OK
offset      #ffff04   #ffff00      4  offset      (194, 702)   OK
tall        #ff00ff   #ff00ff      0  tall        (460, 480)   OK

coverage 5/5 complete=true | ALL MATCHED: true
hiddenPruned: true | belowFoldExcluded: true
```

**The mapping is `imageX = cssX * (imageWidth / viewportWidth)`.** The scale is DERIVED
from the captured image rather than read from `devicePixelRatio` — they agree here, but
deriving it means a machine where they disagree still works.

`captureVisibleTab` costs ~38 ms and returns only the visible viewport, which is exactly
the coordinate space `getBoundingClientRect` reports in. No scroll-offset arithmetic is
needed.

---

## Three bugs this spike caught. The first two are the important ones.

### 1. The verification passed while proving nothing

First run: `allMatched: true`, and it was meaningless. The extractor had returned **zero
nodes**, so the check array was empty — and `[].every()` returns `true`.

**A green test that cannot fail is worse than no test**, because it actively buys
confidence. The spike now asserts coverage *first*: `checkedCount === expectedCount`,
and `allMatched` is false unless coverage is complete. It failed loudly on the very next
run, which is what it should have done from the start.

### 2. A zero-height container threw away the entire page

`walk(document.body)` returned `null` on the fixture and the whole tree vanished, with a
cheerful `nodeCount: 0`.

Cause: every block is `position:absolute`, so `<body>` has **no in-flow content and
collapses to zero height**. The old `isVisible()` conflated two different things:

- **hidden** — `display:none` / `visibility:hidden` / `opacity:0`. Safe to prune the
  subtree; nothing inside can be seen.
- **zero-size** — has no painted area *itself*, but its children may be perfectly
  visible.

These are now separate (`isHidden` vs `hasSize`). Zero-size elements pass their children
upward instead of deleting them. This would have hit real sites — all-absolute layouts
and many SPA shells collapse their containers exactly like this.

### 3. Exact pixel equality is the wrong assertion

Two blocks failed with `#01ff00` vs `#00ff00` and `#ffff04` vs `#ffff00` — single-channel
drift from macOS colour management, through a *lossless* PNG.

Now checked two ways at once: a tight per-channel tolerance (≤8), **and** the sampled
colour must be nearer its own expected colour than any other block's. Tolerance alone is
too weak; nearest-match alone too loose. Fixture colours are maximally far apart, so a
genuinely mis-mapped box lands on white or another hue and fails both.

## Environment traps

- **Headed Chrome required.** `captureVisibleTab` needs a real window and compositor.
- **Fresh profile every run.** Chrome caches the extension's service worker in the user
  profile, so a reused profile silently runs *yesterday's* code against today's build.
  Cost one confusing round of "the fix didn't work" when the fix had never loaded.
  `run.sh` now `rm -rf`s the profile.
