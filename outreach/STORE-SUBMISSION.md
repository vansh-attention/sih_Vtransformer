# Chrome Web Store (Unlisted) and Firefox AMO — everything except the click

Prepared 19 Sep 2026. **Both submissions need HIS accounts**, so this file carries every
field already written; the remaining work is signing in and pasting.

Why this exists: a Web Store listing is the **only** auto-update route for anyone without
repo access — Ma'am, and the judges at the finale. Chrome honours `update_url` for
off-store extensions **only on managed machines under enterprise policy**, and an ordinary
profile blocks off-store installs outright, so the tidy answer of a self-hosted CRX does
not exist for us. Firefox is the opposite: a signed unlisted XPI self-hosts and
auto-updates properly.

⚠ **A Web Store install can only ever auto-update the SCAN half.** An extension cannot
install a native daemon, so the reasoning server still arrives by zip or clone. Say this
in the listing rather than letting someone discover it — that is defect #7's shape.

---

## 1. Chrome Web Store — Unlisted

**Cost** $5, one time, per developer account. **Visibility** Unlisted: anyone with the
link can install, it does not appear in search. **Review** not same-day, and `<all_urls>`
on a privacy tool gets read carefully. ⏳ **Submit early or not at all** — 30 Sep is the
portal deadline and the finale is December.

### Store listing

| field | value |
|---|---|
| **Name** | Aavaran: Privacy-Preserving Browser Agent |
| **Category** | Productivity → Workflow & Planning |
| **Language** | English (India) |

**Short description** (132 char limit — this is 127):

> Reads the page with an on-device model and replaces every PAN, Aadhaar, card and face
> with a tag before anything is sent.

**Detailed description:**

> Aavaran lets an AI agent act on a web page without that page's personal data ever
> leaving your machine.
>
> Before any network request is made, a small model running inside your browser reads the
> page and replaces every PAN, Aadhaar number, card number, bank account, password and
> face with a typed tag — `<PII_PAN_1>`, `<PII_FACE_1>`. The reasoning model receives the
> tags. It never receives the values. It can decide "put the PAN in this field" without
> ever having seen a PAN, because the substitution happens back on your machine at the
> moment the action runs.
>
> The Privacy Ledger shows you this rather than asking you to believe it. For every turn
> it lists what was withheld, shows a masked shadow of each destroyed value, and gives you
> the exact bytes that were transmitted, to read yourself. It then searches every byte
> sent and received for every value it is holding — literally, JSON-escaped, and with
> spaces and hyphens stripped — and reports the result.
>
> What it does:
> • Detects personal data by DOM semantics, by checksum-validated patterns (Verhoeff for
>   Aadhaar, Luhn for cards, GSTIN, IFSC, UPI) and by a person-name layer
> • Blurs faces in the screenshot before the screenshot is attached to anything
> • Strikes every redacted value out of the image, because redacting the text and then
>   transmitting a photograph of it is not redacting
> • Refuses to transmit an image at all when part of the page cannot be read
> • Validates every action the model proposes before it touches the page, and will not
>   place a value into a field of the wrong kind
> • Stops on one click, mid-request
>
> REQUIRES A LOCAL REASONING SERVER. This extension scans and redacts on its own. To have
> the agent act, you also run a small open-weight model on your own computer — nothing is
> sent to any company's service, including ours. Setup instructions are linked below.
>
> Built for Smart India Hackathon 2026, problem statement SIH26171 (ISRO), by Team
> Vagabonds at IIM Mumbai.

### Single purpose

> To let a locally-run AI agent operate on the current web page while removing personal
> data from everything that leaves the browser.

### Permission justifications

Written per permission, because a reviewer reads them per permission.

| permission | justification |
|---|---|
| `activeTab` | The agent acts only on the tab the user explicitly ran it on. This is what scopes it to that tab rather than to browsing generally. |
| `scripting` | The content script performs the extraction and redaction. It must be injected into the page being acted on; that is where the redaction happens, before anything crosses the network. |
| `tabs` | To read the URL of the active tab so the panel can tell the user which page will be acted on, and to capture the visible tab for the visual-perception step required by the problem statement. |
| `sidePanel` | The whole interface — the goal input, the Privacy Ledger and the transcript — is a side panel, so it stays beside the page being acted on. |
| `storage` | Stores the address of the user's own local reasoning server. No personal data and no page content is ever stored. |
| `offscreen` | Face detection and image redaction run in an offscreen document. A service worker has no DOM and no WebGPU, so the image work cannot be done there; doing it in the page would expose the model to the page. |
| `host_permissions: http://127.0.0.1/*` | To reach the reasoning server on the user's own machine. This is the only network destination the extension has. |
| `host_permissions: <all_urls>` | The user chooses which page to act on, and it may be any page. The extension does not read pages in the background — the content script is injected on demand, for the tab the user pressed Run on. |

⚠ `<all_urls>` is the one that draws scrutiny. Lead the justification with the fact that
injection is **on demand**, not on browse.

### Data usage disclosures

All of these are true, which is the point of the product:

- **Does not collect or transmit user data.** The only outbound request goes to
  `127.0.0.1` — the user's own machine.
- Does not use or transfer data for purposes unrelated to the single purpose.
- Does not sell data to third parties.
- Does not use or transfer data to determine creditworthiness or for lending.

### Privacy policy

⛔ **REQUIRED, and we do not have one hosted yet.** The listing cannot be submitted
without a URL. It has to be a page we control, and the repo is **private**, so a GitHub
link will not serve. Cheapest honest options, in order:

1. A GitHub **Gist** (public, no repo exposure), or a one-file GitHub Pages site under a
   new public repo containing only the policy.
2. A page on his existing site if one is reachable.

Draft text is in `outreach/PRIVACY-POLICY.md` — it is short because there is genuinely
nothing to disclose.

### Assets

- **Icon 128×128** — `extension/icons/icon128.png`, already in the package.
- **Screenshots**, 1280×800 or 640×400, at least one and up to five. Use the panel states
  from `node scripts/panel-shot.mjs` (they render at 400px wide, so they need mounting on
  a 1280×800 canvas rather than being uploaded raw). Recommended five, in this order:
  1. `3-scan-result` — what was found and withheld
  2. `4-run-complete` — the ledger, with "0 values leaked" and the transcript
  3. `14-needs-user-input` — the agent asking rather than inventing
  4. `10-page-unreadable` — a protection firing and saying so
  5. `5-settings-open` — the local server address, proving where it talks
- **Package** — `Aavaran-v0.2.x-chrome.zip` from the release. ⚠ Build it from a FRESH
  clone: `extension/dist` is not cleared between builds, and three dead content-hashed
  chunks shipped in a zip once because of exactly that.

---

## 2. Firefox — signed unlisted XPI

**Cost** free. **Route** addons.mozilla.org → Developer Hub → Submit a New Add-on → "On
your own site". Mozilla signs it and hands back an XPI that self-hosts and **does**
auto-update, which is the capability Chrome will not give us off-store.

- Build with `node build.mjs`; `dist-firefox/` is emitted ready to zip.
- Firefox requires an `update_url`-style `browser_specific_settings.gecko.id`. ⚠ **Check
  `dist-firefox/manifest.json` has one before submitting** — the build aligns the two
  manifests, but an add-on id is Firefox-only and may not be set.
- Source-code submission is required when the package contains minified or bundled code.
  Ours is esbuild output, so **expect to be asked for source**. The repo is private;
  prepare to upload a source zip instead of a link. `Aavaran-v0.2.3-full.zip` already is
  one.

---

## What is NOT done and needs him

1. **Host a privacy policy** and put the URL in both listings.
2. **Pay the $5** and create the Chrome developer account.
3. **Create the AMO account.**
4. Decide whether the Web Store's 2–3 day review is worth starting before 30 Sep.

Everything else above is written and ready to paste.
