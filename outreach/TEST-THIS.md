# Please break Aavaran

Five of you, five different laptops, five sets of websites we have never seen. That is
worth more to this project than anything we can do on one machine, and it is the only
way to find out what Ma'am will hit before she hits it.

**Finding something wrong is the point.** A report saying "it worked" tells us nothing we
did not already believe. A report saying "it missed the phone number on my college portal"
is a real finding and goes straight into the fix list.

Ten minutes each. No coding, no terminal, nothing to install beyond one folder.

---

## What this thing is, in three lines

An AI assistant that helps you fill in a web page has to read that page, which means your
PAN, your Aadhaar and your bank account go to somebody's server. This extension finds
every personal value **inside your browser** and replaces it with a label before anything
is sent. The assistant still sees a working page. It never sees your data.

The longer version is in `TEAM-EXPLAINER.pdf`. You do not need it to test.

---

## Part 1: everybody, ten minutes

### Install

1. Download `privacy-agent-extension.zip` and unzip it. It is 1.4 MB.
2. Open **Chrome**. Go to `chrome://extensions`
3. Turn on **Developer mode**, top right.
4. Press **Load unpacked** and choose the unzipped folder, the one holding `manifest.json`.

Chrome only for now. If you have no Chrome, say so and do Part 3 instead.

### Test it on a site we have never seen

This is the part that matters. **Do not use a page we gave you.** Open something of your
own: your bank's login, the college portal, IRCTC, a job application, an insurance form,
anything with a box you can type into.

5. Type into a field **you can see**. Use made-up values, never your real ones:
   - a name, for instance `Vikram Sharma`
   - a PAN: `ABCPE1234F`
   - a mobile: `9876543210`
6. Click the extension icon in the toolbar. A panel opens on the right.
7. Press **Scan this page**.

### Tell us what happened

Copy this into the group and fill it in. Takes a minute.

```
Site:            (the URL)
What I typed:    (the values)
What it caught:  (what the panel listed)
What it MISSED:  (anything you typed that did not appear)
What it caught
that was not
personal:        (an order number, a date, a reference number)
Anything
confusing:       (any moment you did not know what to do)
Chrome + OS:     (Chrome 1xx, Windows 11 / macOS)
```

**The two lines that matter most are MISSED and the false catch.** Those are scored
equally in the marking scheme, so an over-eager catch costs us exactly as much as a leak.

### Things that are not bugs

- **Nothing found on a page where you typed nothing.** Pages hold no personal data until
  somebody puts some in.
- **Nothing found after typing into a hidden box.** Collapsed search bars and the like are
  ignored deliberately. Type into something you can actually see.
- **"Cannot scan this page"** on `chrome://` pages or the extension store. Chrome forbids
  it and so does every extension.

---

## Part 2: Vansh and Manas, twenty minutes

Same as above, then the repository.

```
git clone https://github.com/AavaranAI/Aavaran.git
cd Aavaran
./setup.sh
./test-all.sh
```

Expect **17 passed, 0 skipped**, in about a minute. No browser and no network needed.

**If anything fails on your machine, that is a genuine finding, so send the output rather
than working around it.** Two bugs have already been caught exactly this way, both of them
present only because one laptop happened to have something installed that another did not.

Then try to break the scan from the command line on a site of your choice:

```
SIH_LIVE_URL="https://your-chosen-site.example" bash spikes/i-live-site/run.sh
```

It opens a real browser, types realistic values into whatever it finds, runs the
production scan, and prints what happened to every single value: redacted, pruned because
the box was invisible, never extracted, or leaked. Only a leak fails the run. Send us the
output either way.

---

## Part 3: no Chrome, or no time

Open `why.html`. It is a plain web page, it needs nothing installed, and it shows one
screen sent two ways: the way an ordinary assistant sends it, and the way this sends it.
Every value on it was produced by running the real code, so it is a result and not a
drawing.

Then read `TEAM-EXPLAINER.pdf` and tell us which sentence lost you. That is a real
finding too, because the same sentence will lose somebody on a jury.

---

## What we need back, and by when

| Who | What | Why it matters |
|---|---|---|
| **Everyone** | One filled-in report from a site of your own | Five unseen sites is a test set we cannot build alone |
| **Everyone** | Your yes on the email draft | It goes to Ma'am with all six names on it |
| **Vansh, Manas** | `./test-all.sh` output from your machine | Proves it is not just working on one laptop |
| **Vansh** | The repository moved to a team organisation | Only the owner can do it, and it is currently under a personal account |
| **Everyone** | Team name and project name | The portal needs both and nothing else is blocked on us |

The portal closes **30 September**. Everything above is small; it is the waiting that is
expensive.

---

## One request

Please use **made-up values**. `ABCPE1234F` is a correctly formed PAN that belongs to
nobody. The whole argument of this project is that your real ones should never be
anywhere they do not have to be, and that starts with us.
