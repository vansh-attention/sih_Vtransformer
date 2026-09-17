# What each of us owns, and the first thing to do

This explains every person's part of the project, written so it makes sense with no
technical background at all. For each person: what the thing actually is, what you own,
the first concrete task, and what you can say when somebody asks.

Read your own section properly. Skim the others so you know who to point at when a
question is not yours.

---

## Why this matters more than it looks

We are asking the institute to nominate us. If that happens, at some point somebody
senior asks one of us a question about our own area. The answer "I am not sure, that was
someone else" is fine once. It is not fine from everybody.

So the point of this document is not to memorise a script. A script survives exactly one
follow-up question. The point is that each of us owns something real, does the next piece
of it this week, and can then talk about it because we actually did it.

Every task below is genuinely open work. None of it is invented to keep anyone busy.
Several are listed in the report as things that still need doing, which means finishing
them improves the submission, not just our story about it.

---

## How the marks work

ISRO published exactly how entries are scored. Every task below connects to one of these.

| What is being marked | Worth |
|---|---|
| Does the AI understand what is on the screen? | 25% |
| Do we catch every private detail? | 20% |
| Do we avoid covering up harmless things? | 20% |
| Is the software light on your computer? | 20% |
| How long does a real task take? | 15% |

---

## Harsh Bajpai
### Architecture and the redaction engine

**What this is.** The *architecture* is the decision about where each piece of the
software lives, and in particular which piece is allowed to talk to the internet. The
*redaction engine* is the part that finds every private detail on a page and covers it
up before anything is sent.

**What you own.** The trust boundary, the engine that spots a PAN or an Aadhaar number
and swaps it for a harmless label, and the loop that checks the AI's instruction is safe
before carrying it out.

**First task.** Push the current code to the public repository. It is still at the 12
September version, so anyone cloning it today gets something that does not match the
report. This blocks everything else.

**If someone asks:** "I worked on where the data is allowed to go. The part that talks
to the internet never has the real values, so it cannot leak them even if we made a
mistake in it."

---

## Vansh Khosla
### The repository and making it run everywhere

**What this is.** A *browser extension* is a small add-on for Chrome or Firefox, like an
ad blocker. It has to be packaged in a way each browser accepts, and it has to work on
computers that are not ours.

**What you own.** The repository itself, the builds for both browsers, and the automatic
testing that runs on Windows, Mac and Linux every time the code changes.

**First task.** You own the repository on GitHub, so only you can move it to a team
organisation. Once we agree a name, it is Settings, then Danger Zone, then Transfer
ownership. Steps are in ORG-MIGRATION.pdf. Right now the project URL in our report has
one person's username in it, which undercuts a document about six people.

**Second task.** Run `./test-all.sh` on your own machine and tell us what happens. It has
only ever been run on one laptop. Testing from a fresh clone has already caught two bugs
that only appeared on a different computer, so this is not a formality.

**If someone asks:** "I look after the repository and the cross-browser builds, and the
testing that proves it runs on Windows, Mac and Linux rather than just our own machines."

---

## Manas Bharadia
### Evaluation, the part that makes anyone believe us

**What this is.** *Evaluation* means testing the software and measuring how well it does,
honestly. A *test page* is a realistic web page we test against. *Ground truth* is a
hand-written answer key saying which details on that page are private and which are not,
so the software can be marked against something that cannot argue back.

**What you own.** The test pages, their answer keys, and the honesty of every number in
the report.

**First task.** Add real Indian government or bank pages to the test set. Save the page,
then write an answer key listing which values are private and which only look private.
This needs no coding: it is reading a page and filling in a list. Every single page added
so far has exposed a real defect, which is why it is item 3 in the report's own plan.

**Why it matters.** This is what a professor attacks first. Anyone scores 100% on a test
they wrote themselves. Our report says one score is 75% and explains why, and that
honesty is what makes the other numbers believable. You own that.

**If someone asks:** "I work on testing and measurement. Some pages are written first
and never tuned against, so the scores are honest rather than flattering."

---

## Jinshri Jain
### The Privacy Ledger, and how the project reads

**What this is.** The *Privacy Ledger* is a screen showing exactly what was covered up
and exactly what was sent out. Two columns: what was on your screen, and what actually
left your computer.

**What you own.** How that screen presents itself, and the visual language that carries
into the deck and the report.

**First task.** Open Figure 2 on page 7 of the report and review it as a stranger would.
It currently repeats three rows unnecessarily, the type is small, and it is not obvious
at a glance which column is "before" and which is "after". Tell us what to change. You
do not need to code it; describing the problem precisely is the work.

**Why it matters.** A privacy claim nobody can check is a slogan. That screen is what
turns our claim into something a person verifies with their own eyes, and it only works
if it is legible to someone who is not an engineer. It is the most persuasive picture in
the document.

**If someone asks:** "I work on the screen that shows what was hidden and what was
actually sent, so a user can check our privacy claim instead of taking our word for it."

---

## Aarna Chauhan
### The deck and the diagrams

**What this is.** The deck is the six slides that go to the SIH portal. The diagrams are
the pictures that explain the system, including the one showing the dashed line with real
data on one side and the internet on the other.

**What you own.** The submission deck, its figures, and how the report looks on the page.

**First task.** Slide 1 of the deck still has blanks: Theme, Team ID and Team Name. Theme
is "Smart Automation", which is confirmed. The other two arrive when we register. Build
the deck so those are the only things missing, and it can go out the moment we have them.

**Second task.** Read the report and tell us where it looks wrong. Not the words, the
look. You have better judgement about that than the rest of us.

**Why it matters.** Our report admits a score of 75% that most teams would hide. That
only works if the document looks like it came from people who knew what they were doing.
A serious argument presented carelessly reads as a careless argument, and the person
reading it is a researcher who judges documents for a living.

**If someone asks:** "I do the deck, the diagrams and how the report presents itself.
The architecture diagram is the one picture that shows what the project actually is."

---

## Siddhartha Chaudhary
### The demonstration and the language review

**What this is.** The *demonstration* is the live run we show a judge. The *runbook* is
the sheet saying exactly what to click, in what order, and what to do when something goes
wrong. The *vocabulary lists* are the words the software uses to tell a private value
from a harmless one, in each Indian language.

**What you own.** The demo, the runbook, and the language coverage.

**First task.** The software knows commercial words in eleven Indian languages, and eight
of them have never been checked by somebody who reads the script. This matters concretely:
a twelve-digit total on a bill passes the Aadhaar checksum, so if the word for "total" is
missing in a language, the software covers up a harmless number and loses marks. The list
is about five words per language. Find people who read Gujarati, Kannada, Malayalam,
Punjabi, Odia, Marathi and Telugu, and get the words checked. The report lists this as
work that "needs a reader rather than an engineer".

**Second task.** Run the demo end to end and time it. Write down what went wrong. That is
the runbook.

**If someone asks:** "I work on the demonstration and on the Indian language coverage,
because a word we are missing in Gujarati costs us marks on precision."

---

## The honest bit

The split is not even, and this document is not pretending otherwise. Three of us are
working mostly on code and three mostly on evaluation, presentation and demonstration.

Two things are true at once. The second half is what decides whether the first half
convinces anybody: a correct system nobody can understand scores nothing. And the tasks
above are genuinely open, so whoever does them has actually done them, and can say so
without rehearsing anything.

"I worked on a different part of this, let me get you the right person" is a completely
good answer to a question outside your area. It is a much better answer than guessing,
and far better than an answer that falls apart on the second question.
