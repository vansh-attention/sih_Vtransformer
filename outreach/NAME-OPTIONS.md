# Names to discuss

Three separate things need names, and they do not have to match.

| What | Where it appears | Any constraint? |
|---|---|---|
| **Team name** | SIH portal, deck slide 1, the report | None. Anything you like. |
| **Project name** | The repo, the extension, the demo | None. It sits inside your org, so it only has to be unique to you. |
| **GitHub org** | The URL in the report's appendix | **Must be free on GitHub.** Usually the team name. |

Only the third has a real constraint, and it is the only reason "taken" appears below.
A project called Chhaya can happily live at `github.com/<yourteam>/chhaya` even though
`github.com/chhaya` belongs to someone else.

---

## Project names

The project is a browser add-on that covers up private details before anything is sent
to an AI. Good names point at *hiding in order to help*, not just at privacy.

| Name | Meaning | Why it fits | Watch out for |
|---|---|---|---|
| **Antardrishti** | "inner vision" (Sanskrit); also ordinary Hindi for *insight* | The perception happens inside your machine and stays there. This is the architecture, stated in one word. Reads as a real word, not a pun. | Twelve letters; people will shorten it |
| **Mukhauta** | "mask" (Hindi) | The page puts on a mask before the AI sees it. Concrete, visual, easy to explain to anyone | Sounds playful, maybe too light for ISRO |
| **Chhaya** | "shadow, reflection" (Sanskrit/Hindi) | The server only ever sees a shadow of the real page. Short, soft, memorable | Fairly common word; less distinctive |
| **Aavaran** | "covering, veil" (Sanskrit) | Also idiomatically a *screen* or *sheath*, which is a genuine double meaning here | Less widely understood than the others |
| **One-Way Glass** | plain English | The agent sees out, nobody sees in. Anyone understands it instantly, no translation | Generic; no Indian character |
| **Redact First** | plain English | States the single design rule the whole project rests on | Sounds like a feature, not a product |

**My pick: Antardrishti.** It is the only one where the name *is* the technical claim.
"Inner vision" describes precisely where the seeing happens and why nothing escapes, and
because it also means "insight" in normal speech it does not sound like a forced
acronym. It will land with an ISRO jury.

**Runner-up: Mukhauta**, if you want something friendlier and easier to say. The mask
image makes the whole idea explainable in one sentence to a non-technical person, which
is worth a lot in a five-minute pitch.

---

## Team names

The project name is settled: **Aavaran**. The team name is a separate field on the portal
and it should not repeat it.

### What winning teams are actually called

Names taken from the published SIH results rather than from guesswork. SIH 2025 software
edition: *Eklavya*, *Gap Bridgers*, *Hack Hounds*, *Team Pioneers*, *Teen Titans*. SIH
2025 hardware: *Caffeinated Coders*. SIH 2024 at the IIT Gandhinagar centre: *Saarthi*,
*One Boat Solution*, *Coding Gurus*, *Team Anurved*, *CodeZ*, *AANYA*, *Typewriters II*,
*INSIGHTS*, *Bhasha Setu*, *Leviosa*. From 2018: *Linguistic Pandas*, *Update 1.0*.

They fall into four groups:

| Register | Examples from the winners | Worth copying? |
|---|---|---|
| **A Sanskrit or Hindi word naming a role** | Eklavya, Saarthi, Anurved, Bhasha Setu | **Yes.** Carries meaning, sounds deliberate, and reads well to a government panel |
| **B Coder humour** | Caffeinated Coders, Hack Hounds, Coding Gurus, Linguistic Pandas | No. Extremely common, says nothing about you |
| **C The function as a name** | Gap Bridgers, One Boat Solution, INSIGHTS | Only if it describes the team, not the software |
| **D Pop culture** | Teen Titans, Leviosa | No. Fine for a college fest, thin for ISRO |

**Be honest about what this proves:** nothing. Winners come from all four groups, so the
name is not what decides it. What a name can do is cost you nothing and fit, and group A
is where the cheapest fit is.

### Suggestions

Since Aavaran means *veil*, the team name should not be a second word for hiding. The
better contrast is a name about **evidence**, because the strongest thing in the report is
that every number can be reproduced and that the weak ones are stated rather than buried.

| Name | Meaning | Why it fits the six of you |
|---|---|---|
| **Pramaan** | "proof, valid means of knowledge" (Sanskrit) | In Indian philosophy *pramana* is literally the study of what counts as evidence. A team whose report's best section is *What we have not proved* could not ask for a better word. Reads as **Team Pramaan presents Aavaran** |
| **Anveshan** | "quest, enquiry, research" | Enquiry rather than achievement. Modest in the right way, and it survives past this hackathon |
| **Saakshya** | "evidence, testimony" | Same idea as Pramaan, softer sound, slightly less known |
| **Nirikshak** | "the observer, the one who inspects" | Points at visual perception, which is the half of the problem statement people forget |
| **Aarambh** | "beginning" | You are the first BS-DSBM batch at IIM Mumbai. True, and nobody else can claim it |
| **Setu** | "bridge" | In the register of *Bhasha Setu*, a 2024 winner. Short, easy to say, easy to remember |

**Pick: Pramaan.** It is the only one that says something specific and true about how this
project was built, it is in the register that shows up most among winners, and it does not
collide with Aavaran. Say it once at the start of the pitch and it frames everything after.

**Runner-up: Anveshan**, if Pramaan sounds like it is claiming too much.

**Avoid:** anything with *code*, *hack*, *byte* or *tech* in it, a pun on your college
name, and any name that is a second word for privacy. The first is crowded, the second
travels badly outside Mumbai, and the third wastes the contrast you get for free.

---

## What is free on GitHub right now

Checked 17 September 2026. Only matters for the org.

**Free:** `antardrishti`, `mukhauta`, `screenmask`, `oneway-glass`, `redactfirst`,
`sih26171`, `antardrishti-labs`

**Taken:** `chhaya`, `aavaran`, `anveshan`, `paridhi`, `kshitij`, `sankalp`, `aarambh`,
`silhouette`, `blindfold`, `pratibimb`

If you want a taken name as your *team* name, that is completely fine. Use it on the
portal and pick something else for the org, or add a suffix like `anveshan-iimm`.

---

## Where each name goes, now that Aavaran is settled

| Field | Value | Status |
|---|---|---|
| **Project name** | Aavaran | Decided. On the report cover, in the extension, the panel and the demo |
| **GitHub org** | `AavaranAI` | Done |
| **Repository** | `AavaranAI/Aavaran` | Done |
| **Team name** | still open | **The one thing left.** SIH portal and deck slide 1 |

The team name has no constraint at all. It does not need to be free on GitHub, it does not
need to match the project, and it can be a word somebody else has already used.

---

## Once you decide

Tell me the org name and the repo name and it is one command:

```
./scripts/retarget-repo.sh <org> <repo-name>
```

That updates the git remote, rewrites the URL in the report, rebuilds the PDF, and
verifies the new address actually resolves before it prints anything. Two things still
need a person, and both are in `ORG-MIGRATION.md`: creating the organisation, which
GitHub only allows through the website, and transferring the repository, which only
Vansh can start because he owns it.
