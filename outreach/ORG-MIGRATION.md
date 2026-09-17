# Moving the repository to a team organisation

Everything that can be automated is. This is the short list of things a person has to
do, in the order they have to happen.

Read `NAME-OPTIONS.md` first if the name is not settled.

---

## Why bother

The repository currently sits at `github.com/vansh-attention/sih_Vtransformer`. The
report's appendix prints that address and invites the reader to clone it. A URL carrying
one member's personal handle undercuts a document that presents six people, and it is
the first thing a reader sees.

Transferring, rather than re-uploading, keeps the commit history, the tags, the CI runs
and the stars, and GitHub leaves a permanent redirect so anything already shared keeps
working.

---

## Step 1, Harsh: push today's work first

**Do this before anything else, whatever you decide about names.**

The public repository is currently at the 12 September commit. Everything since then
lives only on this Mac. Anyone cloning it today gets a version where the false positives
the report says are fixed are *not* fixed, where the `--wild` corpus does not exist, and
where the end-to-end task fails. **Every headline number in the report is unreproducible
from the public repo right now,** and the appendix tells the reader to go and check.

Doing this first also means the transfer carries the real work rather than a stale
snapshot.

---

## Step 2, Any of you: create the organisation

GitHub does not allow this from the command line on free accounts, so it is a browser
job. It takes about a minute and costs nothing.

1. github.com, top-right `+` menu, **New organization**
2. Choose the **Free** plan
3. Organization name: whatever you settled on in `NAME-OPTIONS.md`
4. Contact email: use the one you will actually read
5. Belongs to: **My personal account**

Then invite the other five: **People**, **Invite member**, their GitHub usernames. Give
everyone **Write**, and make at least two people **Owner**, so the org is not locked to
one person if someone loses access before December.

---

## Step 3, Vansh: transfer the repository

Only Vansh can do this. He owns the repo, and Harsh has write access, not admin. There
is no way around it from this end.

1. Open `github.com/vansh-attention/sih_Vtransformer`
2. **Settings**, scroll to the bottom, **Danger Zone**
3. **Transfer ownership**
4. New owner: the organisation name
5. Type the repository name to confirm

It is not as alarming as the section title suggests. Nothing is deleted, the old URL
redirects, and the transfer can be reversed the same way.

If Vansh is unavailable, say so and the fallback is a fresh repository under the org
with the full history pushed to it. It loses the redirect and the stars, nothing else.

---

## Step 4, Harsh: point everything at the new home

One command, from the repository root:

```
./scripts/retarget-repo.sh <org> <repo-name>
```

It refuses to touch anything until the new URL actually resolves, so running it too
early is harmless. It then updates the git remote, rewrites the address in the report
builder, rebuilds the PDF, and verifies the new path is in the document and the old one
is gone.

---

## Step 5, By hand, and quick

- `README.md` and `ONBOARDING.md` if either names the old path. The script lists any
  file that still mentions it when it finishes.
- The SIH portal **Team Name** field.
- Deck slide 1, which still carries a placeholder. Rebuild with
  `python3 deck/build.py`, then re-export the PDF from PowerPoint.
- Re-send the report only if it has already gone out with the old URL in it.

---

## Sanity check when you are done

```
git remote -v                    # should show the org
./test-all.sh                    # 17 checks, still green
```

Then open the last page of the report and confirm the address printed there is the one
you just created. That page is the only one a reader acts on, so a wrong URL there is
worse than no URL at all.
