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

A team name should say something about the six of you, not about the software. It also
outlives this one project.

| Name | Meaning | Note |
|---|---|---|
| **Anveshan** | "quest, investigation, research" | Fits a team whose strongest section is the one admitting what it got wrong |
| **Paridhi** | "boundary, perimeter" | Our whole design is about one boundary and what may cross it |
| **Kshitij** | "horizon" | Common in Indian student teams, which cuts both ways |
| **Sankalp** | "resolve, determination" | Warm, slightly generic |
| **Aarambh** | "beginning" | Good for a first-year team; you are batch 01 of BS-DSBM |
| **Antardrishti** | as above | Works as both, if you would rather have one name for everything |

**My pick: Anveshan**, if you want team and project to be different. It means enquiry
rather than achievement, which matches a report whose best section is about mistakes.

**Simplest option: use Antardrishti for all three.** One name for the team, the project
and the org is easier to explain, easier to remember, and means the deck, the portal and
the repo all agree. Fewer things to keep in sync under a deadline.

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

## Three ready-made combinations

**A. One name for everything**
Team *Antardrishti*, project *Antardrishti*, org `antardrishti`.
Simplest. Everything agrees, nothing to keep in sync.

**B. Team and project distinct**
Team *Anveshan*, project *Antardrishti*, org `antardrishti`.
The team has its own identity that survives past this hackathon.

**C. Plain English throughout**
Team *One-Way Glass*, project *One-Way Glass*, org `oneway-glass`.
No translation needed for any audience, at the cost of Indian character.

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
