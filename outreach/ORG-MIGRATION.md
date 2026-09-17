# The repository has moved to the team organisation

**Done on 17 September.** The organisation was renamed from `SIH-vis` to
`AavaranAI` part-way through; it is the same organisation and the same repository,
so nothing had to be moved a second time. This document used to be a plan. It is now a record of what
happened and a short list of what is still outstanding, which is mostly not code.

---

## Where everything lives now

| | |
|---|---|
| **Organisation** | `github.com/AavaranAI` |
| **Repository** | `github.com/AavaranAI/Aavaran` |
| **Visibility** | **Private** |
| **History** | All 70 commits, both tags, root commit intact |
| **Old address** | `vansh-attention/sih_Vtransformer`, still exists, no longer the one we use |

The report's appendix, this document set, `README.md`, `ONBOARDING.md` and the git remote
all point at the organisation. Nothing still prints the personal address.

---

## What was actually done

The organisation already held a repository of the same name, created on 10 September,
containing one commit by Vansh with a nineteen-byte README. Our full history was pushed
over it, and **that placeholder commit was preserved first** on a branch called
`initial-placeholder`, so nothing of anyone's was destroyed. Delete that branch whenever
you like; it exists only so that the move took nothing away.

The local `origin` now points at the organisation. The old repository is still reachable
as a remote called `personal`, so nothing is stranded.

---

## Outstanding, and one of them matters

### 1. The repository is private, and the report invites Ma'am to clone it

This is the one to decide first. The last page of the report gives her the address and
tells her the numbers can be reproduced from it. **If she opens that link today she gets a
404,** which reads as a dead link rather than a permission setting.

Three ways out, in order of preference:

1. **Make it public.** Simplest, and the evidence is the point of the exercise. Everything
   in it is our own work and there is nothing sensitive: no keys, no credentials, no
   personal data, and the test fixtures use invented values. Settings, General, Danger
   Zone, Change visibility.
2. **Invite her as a collaborator.** Keeps it closed, but she needs a GitHub account and
   has to accept an invitation before she can read a word of it, which is friction at
   exactly the wrong moment.
3. **Leave it private and drop the invitation from the report.** Honest, but it gives up
   the strongest thing the report has, which is that every number in it can be checked.

Whoever decides, decide before the email goes out.

### 2. Invite the other five

**People**, **Invite member**, their GitHub usernames. Everyone gets **Write**. Make at
least one more person an **Owner**, so the organisation is not locked to one account if
somebody loses access before December.

### 3. Decide what happens to the old repository

Both copies currently hold the same history, which is fine today and will not stay fine.
The moment somebody pushes to one of them they diverge, and then there are two answers to
the question of what the project is.

Ask Vansh to **archive** `vansh-attention/sih_Vtransformer`. Archiving makes it read-only
and reversible, it keeps the history and the link alive for anyone who already has it, and
it removes any doubt about which repository is the real one.

### 4. Two small things

- The organisation repository's description still reads "vision transfer problem statement
  of the SIH". The problem statement is about on-device visual perception with privacy
  preservation; the description is worth a rewrite before anybody outside reads it.
- The SIH portal **Team Name** field and deck slide 1 still carry placeholders. Rebuild
  the deck with `python3 deck/build.py`, then re-export the PDF from PowerPoint.

---

## If any of it needs doing again

```
./scripts/retarget-repo.sh <org> <repo-name>
```

It checks the repository exists as **you** before touching anything, so it works for a
private repository, then updates the git remote, rewrites the address in the report
builder, rebuilds the PDF, and verifies the new path is in the document and the old one is
gone.

Afterwards:

```
git remote -v                    # origin should be the org
./test-all.sh                    # 17 checks, still green
```

Then open the last page of the report and confirm the address printed there is the right
one. That page is the only one a reader acts on, so a wrong URL there is worse than none.
