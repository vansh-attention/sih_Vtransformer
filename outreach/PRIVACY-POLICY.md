# Privacy Policy — Aavaran

**Last updated: 19 September 2026**

Aavaran is a browser extension that lets an AI agent act on a web page while keeping that
page's personal data on your own machine.

## What we collect

Nothing.

There is no account, no sign-in, no analytics, no telemetry, no crash reporting and no
server operated by us. We do not receive your data because there is nowhere for it to go.

## Where your data goes

Aavaran makes network requests to exactly one destination: **a reasoning server running
on your own computer**, at an address you set yourself, which defaults to `127.0.0.1`.
That address is on your machine and traffic to it does not leave it.

Before any such request is made, the extension reads the page and replaces personal
values — PAN, Aadhaar number, card number, bank account, UPI ID, IFSC, GSTIN, email
address, phone number, postal address, date of birth, password, and faces in images —
with typed placeholders such as `<PII_PAN_1>`. The real values are held in memory, in the
part of the extension that runs inside the page, and are never included in the request.
The part of the extension that performs network requests has never held a real value.

If the extension cannot read part of a page — a closed shadow root, or text beyond its
size limit — it refuses to transmit a screenshot of that page rather than transmit one it
cannot verify.

## What is stored on your device

One setting: the address of your local reasoning server. It is kept in the browser's
extension storage and is never transmitted.

No page content, no personal data and no history is written to disk. The Privacy Ledger
shown in the side panel exists only for the current run and is cleared when a new run
starts. If you press "Save as a file", a transcript is written to the location you choose,
by you — nothing is saved automatically.

## Permissions

`<all_urls>` is requested because you may choose to run the agent on any page. The
extension does **not** read pages as you browse: it is injected into a single tab, on
demand, when you press Run or Scan on that tab.

The full list of permissions and the reason for each is in the extension's listing.

## Third parties

There are none. No data is sold, shared, or transferred to anyone, for any purpose.

The open-weight model the reasoning server runs is downloaded from its publisher when you
install it, in the same way any software is downloaded. After that it runs locally and
Aavaran does not contact it over the internet.

## Children

Aavaran is not directed at children and collects no data from anyone.

## Changes

If this policy changes, the date at the top changes with it.

## Contact

Harsh Bajpai — harsh.bajpai2615@gmail.com
Team Vagabonds, IIM Mumbai. Smart India Hackathon 2026, problem statement SIH26171.
