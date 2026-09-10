# Spike F — does the extension actually run in Firefox?

Run: 10 Sep 2026 · Firefox 155.0.1 (headed) · Apple M5
Reproduce: `./run.sh`

Spike B tested ORT on a plain Firefox *page*. It never tested the *extension* — and a
manifest audit found **five hard Firefox blockers**, so "Firefox works" was an
unverified claim until this ran.

## Result: ✅ the extension loads and runs

```
offscreen API   false     <- Chrome-only, as expected
sidePanel API   false
sidebarAction   true
navigator.gpu   true

vision path via bridge : reachable, backend = webgpu
content script         : ok, 27 nodes, extract 4ms, sanitize 4ms
                         withheld 1xNAME 2xEMAIL 1xPHONE 1xPAN 1xAADHAAR
                                  1xGSTIN 1xCARD 1xPASSWORD 1xADDRESS
```

Full PII pipeline working in Firefox, identical output to Chrome.

---

## ⚠ CORRECTION to Spike B: headed Firefox DOES have WebGPU

Spike B measured **headless** Firefox, found `requestAdapter()` returned null, and
concluded Firefox falls back to WASM at ~32 ms/crop. That finding carried an explicit
caveat — *"Not yet tested: headed Firefox. Do not claim either way until measured."*

Now measured. **Headed Firefox 155 has a working WebGPU adapter**, and ORT selects the
`webgpu` backend. The null adapter was an artefact of headless mode, not a Firefox
limitation.

The WASM fallback is still needed and still correct — it is what runs when no adapter is
available — but the *expected* Firefox path is WebGPU, not WASM. Any slide claiming
"Firefox degrades to WASM" would have been wrong.

## Firefox is NOT timer-throttled — unlike Chrome's offscreen document

The same encode probe, both browsers:

| canvas | Chrome offscreen doc | **Firefox background page** |
|---|---|---|
| 16px | 1004 ms | **0 ms** |
| 256px | 1005 ms | **1 ms** |
| 1024px | 1013 ms | **3 ms** |

Chrome's offscreen document is hidden and its task scheduling is quantised to ~1 s.
Firefox's background event page is not, so it pays none of that cost.

An unexpected consequence: **the Firefox port is architecturally simpler AND faster on
this path.** Having no offscreen document turns out to be an advantage.

## What the port required

Five blockers, each of which stops the manifest loading at all:

| Chrome | Firefox |
|---|---|
| `background.service_worker` | `background.scripts` (event page — and it has a DOM) |
| `permissions: offscreen` | no such API; not permitted in the manifest |
| `permissions: sidePanel` + `side_panel` | `sidebar_action` |
| — | `browser_specific_settings.gecko.id` is mandatory for unsigned MV3 |

The architectural one is `offscreen`. Chrome's service worker has no DOM, so the models
must live in an offscreen document; Firefox's event page has a DOM, so they live there
directly. `vision/bridge.ts` hides that difference — the orchestrator never learns which
browser it is in. Without it, Firefox support would have meant a second copy of the
agent loop.

The vision handlers are `import()`ed **dynamically**, so Chrome's service worker does not
carry ONNX Runtime it never executes: that mistake grew the background bundle from 23 KB
to 195 KB before it was caught.

`build.mjs` now fails the build if the two manifests diverge on any non-host-specific
key, so they cannot drift into being two different extensions.

## Traps worth recording

- **Firefox has no `--load-extension`.** Installation goes over the Remote Debugging
  Protocol. `web-ext` wraps this; `install.mjs` speaks it directly to avoid the
  dependency.
- **`devtools.debugger.prompt-connection` must be false**, or Firefox shows a modal
  asking the user to approve the connection and an automated run hangs on it forever
  with no error.
- **Actor IDs come from `getRoot`, not the RDP greeting.** Older Firefox put
  `addonsActor` in the greeting; current builds do not, so the obvious approach fails
  with a greeting containing only protocol traits.
- The runner builds a **copy** of the extension with the Firefox manifest swapped in.
  Swapping `manifest.json` in place would leave the working tree Firefox-only if the
  script died halfway.
