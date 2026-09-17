# Email to the IIM Mumbai SIH SPOC

**To:** pujasarkar@iimmumbai.ac.in
**Cc:** `vansh.260163@iimmumbai.ac.in`, `jinshri.260130@iimmumbai.ac.in`,
`aarna.260101@iimmumbai.ac.in`, `manas.260169@iimmumbai.ac.in`,
`siddhartha.260159@iimmumbai.ac.in`
**Attach:** `SIH26171-Project-Report.pdf`

Nothing is outstanding. Addresses follow `firstname.rollnumber@iimmumbai.ac.in`, verified
against Harsh's own (`harsh.260125@`). The other five are derived from that pattern rather
than read from the directory, so glance at them once before sending: if a first name is
spelt differently in the institute system (Siddhartha against Siddharth, for instance)
that one address will bounce and the rest will go through.

> **Salutation.** Dr. Puja Sarkar is Assistant Professor in Analytics & Data Science, so
> "Respected Ma'am" is the right register for a student writing to faculty at an Indian
> institute. "Dear Dr. Sarkar" is equally correct and slightly more formal.

---

**Subject:** SIH 2026 nomination: Aavaran, a privacy-preserving browser agent for ISRO (PS SIH26171)

Respected Ma'am,

I am Harsh Bajpai, BS-DSBM 2026-30, roll number 260125. I am writing on behalf of Team
Vagabonds, six students of the institute who have built a working entry for Smart India
Hackathon 2026 and who would like to be nominated for it.

**The problem.** ISRO's problem statement SIH26171 asks for a browser agent that can read
a user's screen and act on it without that screen being sent to a server. The obstacle is
that an agent which cannot see a field cannot act on it either, so blurring the screen
disables the agent, and redacting at the server concedes the point, because the data has
already crossed the network by then.

**What we built.** Aavaran, a Chrome and Firefox extension in which a small model runs inside the
browser, reads the page, and replaces every PAN, Aadhaar number, card number, password
and face with a typed tag before any network request is made. An open-weight
vision-language model then reasons over the censored page and returns one action, which
the extension validates and executes. The tag carries the only fact the reasoning needs,
that the field is filled and well formed, and withholds the value itself. The personal
values never leave the machine at all, so the guarantee comes from where the data sits
rather than from trusting whoever runs the server.

**Where it stands.** It runs today on Chrome and Firefox across Windows, macOS and Linux.
Against a held-out set of pages it was never tuned on, it redacts every personal value
with no false positives and leaks nothing. It completes a real multi-step task, filling
and submitting a three-field government-style form, in about half a minute end to end. Seventeen
checks run on every push across Windows, macOS and Linux, and every number in the
attached report can be reproduced from the repository with one command.

The report sets out the architecture, the results against ISRO's own published marking
scheme, and, just as importantly, the defects we found in our own work and the claims we
have not yet proved.

**What we are asking.** We would be grateful if the institute would consider nominating
our team for SIH26171; the portal closes on 30 September. We would gladly prepare
whatever the institute needs from us for that, and would be happy to demonstrate the
system to you in person beforehand, including on a laptop with no internet connection,
which is the quickest way to see that the privacy claim is structural rather than a
matter of trust.

Thank you for your time, Ma'am.

Regards,  
**Harsh Bajpai**  
BS-DSBM 2026-30 · 260125 · 9926749541  
harsh.260125@iimmumbai.ac.in

On behalf of: Vansh Khosla, Manas Bharadia, Jinshri Jain, Aarna Chauhan and
Siddhartha Chaudhary.

---

## Why it is written this way

It is a pitch, not a set of questions. With no internal hackathon and only a handful of
teams likely to come forward, there is nothing to ask permission about: the useful thing
is to give her everything she needs to say yes, in one reading.

Three choices worth keeping if you edit it:

- **The ask is single and concrete.** One sentence, one verb, one deadline. A message
  that asks for several things invites a reply that addresses none of them.
- **The bolded run-in headings carry the argument on their own.** Someone skimming four
  lines gets problem, solution, status, ask, in that order.
- **The offer to demonstrate offline is the strongest line in the email.** It is the one
  claim a sceptical reader can verify in two minutes, and offering it unprompted signals
  that the claim will survive being checked.
