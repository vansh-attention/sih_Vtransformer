# Aavaran: what we built, explained simply

For everyone on the team. No technical background needed. Nothing here assumes you
have seen the code, and every technical word is explained the first time it appears.

Read time: about ten minutes. If you only read one part, read **"The idea in one
picture"** and **"If someone asks you about it"**.

---

## 1. The problem we are solving

There is a new kind of software called an **AI agent**. An ordinary AI chatbot only
talks to you. An agent goes further: it can look at your screen and *do* things, like
filling in a form or clicking a button for you.

To do that, it has to see your screen.

And here is the trouble. Think about what is actually on your screen when you fill in a
form on an Indian website. Your name. Your PAN. Your Aadhaar number. Your card number.
Your address. Maybe a password box you have already typed into.

Every AI agent available today solves this the same way: it takes a photograph of your
screen and sends the whole thing to a company's computer somewhere else. Your PAN goes
with it. The company promises to be careful.

So you get a choice nobody should have to make:

- Use the agent, and hand over everything on your screen, or
- Keep your data private, and get no help at all.

**We built the third option.**

---

## 2. The idea in one picture

Imagine you need help filling a long government form, so you ask a friend who is very
good at forms. But the form has your Aadhaar number on it, and you would rather your
friend did not see that.

So before you show them the form, you cover every private box with a sticky note. On
each sticky note you write what *kind* of thing is underneath:

> `[AADHAAR NUMBER, filled in, and it is valid]`
>
> `[PAN, filled in, and it is valid]`

Now show your friend the form.

Your friend can still help you completely. They can see the form is nearly finished,
they can see which box is still empty, and they can say "the Aadhaar box is done, now
click Submit". They give you genuinely useful instructions.

**And they never saw a single digit of your Aadhaar number.**

That is exactly what our software does. The sticky notes are the whole invention.

---

## 3. How it actually works

Four steps. Nothing more complicated than the sticky-note story.

**Step 1. Read the page, inside your own computer.**
Our software is a **browser extension**, a small add-on you install into Chrome or
Firefox, like an ad blocker. It reads the web page you are looking at. This happens
entirely on your machine. Nothing has left yet.

**Step 2. Cover up everything private.**
It finds every PAN, Aadhaar number, card number, password, address and face on the
page, and replaces each one with a label. Your real PAN `ABCPE1234F` becomes the text
`<PII_PAN_1>`. The real values are locked away in your browser's memory, in a part of
the program we call the **vault**.

The important bit: **this happens before anything is sent anywhere.** Not after. The
private data never travels.

**Step 3. Ask the AI what to do next.**
Only the covered-up version gets sent to the AI. The AI reads it, understands the page,
and sends back one instruction, like "click the button called Submit".

**Step 4. Do it.**
Our extension receives that instruction, checks that it is sensible and safe, and then
performs it on the real page.

Then it repeats, until the task is done.

---

## 4. Why this is genuinely clever, and not just careful

This is the part worth understanding, because it is what makes judges sit up.

Most privacy claims are promises: "we are careful", "we delete your data", "we have a
policy". You have to trust the company. If one of their programmers makes a mistake,
your data leaks anyway.

Ours is not a promise. It is a matter of **where the data physically is.**

The part of our program that is allowed to talk to the internet has never, at any
moment, held your real PAN. It cannot leak it, in the same way you cannot give away
money you have never had. Even if we wrote a bug in that part, even if the AI company
turned hostile, the private data is simply not there to take.

There is a nice demonstration of this in our results. We built a trap page containing a
hidden instruction aimed at the AI, telling it to reveal everything it knew. **The AI
fell for it completely** and announced it was disclosing everything.

It disclosed nothing. There was nothing to disclose.

---

## 5. What we measured, and what the numbers mean

ISRO published exactly how entries will be marked. We report against their list rather
than numbers we chose ourselves.

| What ISRO measures | Worth | How we did |
|---|---|---|
| Does the AI understand the screen? | 25% | 100% on our tests |
| Do we catch every private value? | 20% | 100% on our tests, **75% on the hardest test** |
| Do we avoid covering up harmless things? | 20% | 100% |
| Is it light on your computer? | 20% | measured in a real browser |
| How long does a real task take? | 15% | about 31 seconds, 7 runs in 8 |

**About that 75%.** We deliberately built a harder test using real websites that we did
not write ourselves, and on that test we score 75%, not 100%. We put that number in the
report ourselves, in bold.

That is not modesty, it is strategy. Anyone can score 100% on a test they wrote. A
professor who reads a report where everything is perfect assumes the test was too easy
and stops believing all of it. Showing one honest weak number makes every other number
credible. We also explain exactly why it happens and how we will fix it.

---

## 6. What still needs doing

We are not pretending it is finished. The report has a whole section listing what we
have *not* proved. The main open items:

- On very large web pages, our software stops reading after a point and can miss
  private data further down. We made it fail *safely*, it refuses to send the picture
  rather than risk sending something private, but it should read the whole page.
- It sometimes covers up names that are not private, like a politician's name in a
  Wikipedia article. Harmless, but it makes the AI less useful.
- It takes about half a minute to fill a form you could fill yourself in less, and it
  succeeds in seven runs out of eight. Today it is worth using when privacy matters
  more than speed.

---

## 7. Where things stand

- The software works today, on Chrome and Firefox, on Windows, Mac and Linux.
- It is tested automatically: 23 separate checks run every time we change the code.
- Everything is public, so anyone can download it and check our claims themselves.
- We have written a project report and are asking IIM Mumbai to nominate us for Smart
  India Hackathon 2026. The deadline is **30 September 2026**.

---

## 8. If someone asks you about it

You do not need to be technical to explain this well. If a professor, a judge or a
friend asks, this is enough:

> "AI agents need to see your screen to help you, which means sending your PAN and
> Aadhaar to some company's server. We built a browser extension that covers up every
> private detail *before* anything is sent. The AI still understands the page well
> enough to help, but it never sees the actual numbers. The guarantee isn't that we
> promise to be careful, the part of our software that talks to the internet never has
> your data in the first place."

If they push further, three facts are worth knowing:

1. **It runs on your own machine.** No account, no API key, no internet connection
   needed for the private part.
2. **We test on pages we didn't write.** That is why one of our scores is 75% and not
   100%, and we say so in the report.
3. **You can check it yourself.** The code is public and one command reproduces every
   number we claim.

And if you are asked something you genuinely do not know, "I worked on a different part
of this, let me get you the right answer" is a completely good response. Nobody expects
six people to each know everything.

---

## 9. Words you might hear

| Word | What it means |
|---|---|
| **Browser extension** | A small add-on for Chrome or Firefox, like an ad blocker |
| **PII** | "Personally Identifiable Information", private details like PAN, Aadhaar, a card number |
| **Redaction** | Covering something up, like a blacked-out line in a document |
| **The vault** | The locked place in your browser where the real values are kept |
| **Token / tag** | The sticky-note label, for example `<PII_PAN_1>` |
| **The model** | The AI that reads the covered-up page and decides what to do |
| **Held-out test** | A test we wrote first and then never adjusted our code to pass, so the score is honest |
| **The ledger** | A screen showing exactly what was covered up and exactly what was sent, so you can check us |
| **Prompt injection** | A hidden instruction on a web page designed to trick an AI |
