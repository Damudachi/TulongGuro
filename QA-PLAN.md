# TulongGuro — Manual QA Plan

**For:** testing the system by hand, yourself.
**Covers:** the grade-integrity work from the earlier audit, plus everything changed in the onboarding session (demo sandbox removal, setup checklist, student login/roster work, and the four recent fixes).

---

## 0. Before you start

### Accounts and data you need

| What | Why |
|---|---|
| **1 admin account** | Parts 1, 4, 6 |
| **2 teacher accounts** (T1, T2 — same school) | Part 4 needs a *newly created* teacher who has never signed in |
| **1 block section with ≥3 learners** | Nearly everything |
| **1 activity worth 100 points**, papers uploaded for all three learners | Part 1 |
| **A second section under a different teacher** | Part 6 |

### ⚠ Watch your AI quota

**~20 requests/day per model per credential, 2 credentials configured.** Every "AI check" spends one. `AI_BATCH_SIZE` is 1 on purpose, so a 3-paper batch is 3 requests.

Budget roughly: **P1 needs 3, P9 needs 2, smoke needs 1–2.** Do the AI-dependent tests *first* in a session, and don't repeat them casually — if you run dry, the rest of the day's testing is blocked.

### There is no staging database

Everything you do here writes to live Supabase. That's expected for QA, but it means **the test data you create is real** — name your test sections obviously (e.g. "ZZ-QA-Test") so they're easy to find and clean up later.

---

## 1. What NOT to test

### Already automated — don't spend manual time here

These run on every deploy via `npm run verify` (178 tests). Re-testing by hand tells you nothing new:

- **Score validation** (rejecting `500`, `-5`, `"abc"`, `null`, `""`, `true` on the grade endpoint)
- **Cross-tenant reads** (403 for another school, 200 for the owner and same-school colleagues)
- **Student ID normalisation logic** and the ambiguity rule
- **Setup checklist step logic** (which steps tick, the counting, the plural forms)
- **Band parity** between client and server

### Known and deliberate — don't file these as bugs

- **Analytics include GRADED-but-unreleased work.** Deliberate.
- **Curriculum is copy-on-apply** — editing a curriculum lesson doesn't reach classes already created from it.
- **`computeSkillProgress` is cumulative** — a late collapse shows as a drift, not a cliff.
- **Existing student IDs stay in the old `SEC-001` format.** Only new enrolments get `AS-26-0001`.
- **Single instance is load-bearing** (AI jobs, rate limits, quota counters are in-process).

### Outstanding data, already known

- A leftover `[STUDENT-DEMO] Sample Graded Work` class under teacher Shawn Uriel, holding a fabricated 90% for Aldrich Gavriel Sabando. **Not yet deleted** — needs the SQL in `HANDOFF.md` §5.
- **2 leftover `[DEMO]` sandbox classes** with fake "Demo Student" accounts. You can clear these yourself — see test 4.1.

---

## Part 1 — Grades and numbers

**Highest consequence: these reach report cards. Do them first, while you have AI quota.**

### 1.1 — Export never contains unvalidated AI grades

1. Run **AI-check all** on your activity so all three learners get an `aiScore` but stay PENDING. *(3 AI requests)*
2. Validate **only learner 1** — give them 90.
3. Teacher → Gradebook → section card → **Export All**.

**Expect:**
- [ ] A confirm appears: *"2 submission(s) in this section have not been validated yet"*
- [ ] **Cancel** → no file downloads
- [ ] **Confirm** → `.xlsx` downloads
- [ ] In the file: learners 2 and 3 have **blank** cells and no average
- [ ] Learner 1 shows 90, average 90
- [ ] An amber row near the top reads `Incomplete: 2 submission(s) not yet validated…`
- [ ] `CLASS AVERAGE` is **90**, not ~60
- [ ] On the gradebook screen, learners 2 and 3 show an **amber ring + `*`**, with a legend under the table

> **This is the one most likely to be reported as "my grades disappeared."** They didn't — they were never validated. If the class average comes out ~60, unvalidated AI drafts are leaking into official grades, which is the most serious failure in this document.

### 1.2 — Transmutation

1. Get a learner to an Initial Grade around **69**.
2. Admin → Grading → transmutation **off** → export.
   - [ ] Header reads `Average (%)`, value **69**
   - [ ] Metadata says *"Initial Grade — not transmuted"*
3. Turn transmutation **on**, save, export again.
   - [ ] Header reads `Final Grade (transmuted)`, value **80**
   - [ ] Metadata names DO 8 s.2015
4. **Critical:** with transmutation still on, go to Teacher → Analytics.
   - [ ] The learner still reads **69**
   - [ ] They are still in **"needs support"**

> If step 4 moves to 80, the early-warning system is broken — transmutation is a reporting transform, not a measurement, and analytics must stay on the raw figure.

### 1.3 — Excused work

1. Gradebook → click a learner → find an activity showing **MISSING** → **Excuse**, enter a reason.
   - [ ] Row turns lilac **Excused** with the reason beneath
   - [ ] The learner's average goes **up** (the zero stopped counting)
2. Export.
   - [ ] That cell reads `Excused`
   - [ ] It does **not** add to the INCOMPLETE count
3. **Un-excuse.**
   - [ ] Everything reverts, including any score already on the row

### 1.4 — Deadlines at the Manila boundary

Create a `STUDENT_SUBMIT` activity with **today** as the deadline. Sign in as a learner in that section, **after 8am Manila time**:

- [ ] Student dashboard → the activity appears under **Upcoming Deadlines**
- [ ] Teacher → Gradebook → that learner shows **UPCOMING**, not MISSING
- [ ] Submit on the due date → status is **DONE**, not LATE

> A date-only deadline closes at 23:59:59 **Manila**, not midnight UTC. The old bug made work vanish at 08:00 while still being submittable.

### 1.5 — Band boundaries agree everywhere

Set a released, graded submission to exactly **74.6** (via the admin console or SQL), with the school passing grade at 75.

The same learner must read **passing / amber** in all four places:

- [ ] Student → Subjects
- [ ] Student → Gradebook
- [ ] Teacher → Gradebook
- [ ] Admin → Analytics

> Previously the server said passing and the browser coloured it red.

### 1.6 — Admin counts agree

Admin → Analytics:

- [ ] The **Students** tile and the **class spread bar** total the same number
- [ ] Enrol a learner into a second class, reload — **both numbers stay the same**

> Students used to be double-counted once they were in more than one class.

### 1.7 — AI skill scores only where they mean something

1. Create a **Maths** activity with non-language criteria ("Accuracy", "Solution Steps"). AI-check one paper. *(1 AI request)*
   - [ ] Teacher → Analytics on a Maths-only class → the writing-skills panel says **"not measured"**, not `0/25`
2. Do the same on an **English essay**. *(1 AI request)*
   - [ ] Skill scores are populated as normal

> A Maths worksheet used to come back with an invented punctuation score that was then charted as if it were a measurement.

---

## Part 2 — Teacher onboarding (rewritten this session)

**The `[DEMO]` sandbox is gone.** Nothing is seeded any more. A brand-new teacher now sees a setup checklist built from their own real data.

### 2.1 — A brand-new teacher gets no fake data

As admin, create a **new teacher account**. Sign in as them for the first time.

- [ ] **No `[DEMO] Sandbox Demo Class`** anywhere
- [ ] **No "Demo Student"** in any section
- [ ] No welcome pop-up modal
- [ ] A **"Setting up your classes"** checklist card appears on the dashboard
- [ ] It reads **Step 1 of 4**, with only step 1 expanded

> The old seed created a real student account whose password was the literal word `password`, with no school attached. If you see a Demo Student here, the seed is still running.

### 2.2 — The checklist follows your real work

Working through as the new teacher:

- [ ] **Step 1** button reads *"Create a block section"* → goes to Manage Block Sections
- [ ] After creating a section with **no learners**: step 1 is still **unticked**, and reads *"1 section created — no learners on the list yet"*, button now says *"Add learners"*
- [ ] After adding learners: step 1 **ticks green**, reads *"N students enrolled in 1 section"*, and **step 2 expands**
- [ ] **Step 3** shows an amber *"Create a class first"* chip while you have no class — and no button
- [ ] After creating a class, step 3's chip is gone and its button works
- [ ] **Step 2**'s button opens the class modal **in place** (it does not navigate away)

### 2.3 — Progress survives the device

This is the main reason the old walkthrough was replaced.

- [ ] Sign in as the same teacher in a **different browser** (or a private window). The checklist shows the **same progress** — it does not restart from step 1
- [ ] Clear that browser's site data, sign in again — progress is **still correct**

### 2.4 — Hiding it is not a one-way door

- [ ] Click the **✕** on the checklist → it disappears
- [ ] A **"Setup guide"** button appears in the dashboard header
- [ ] Click it → the checklist comes back
- [ ] Reload the page → it is still visible

### 2.5 — The example is a picture, not a record

Get to the point where steps 1–3 are done and **step 4 is current**.

- [ ] Step 4 shows a **"See an example first"** button
- [ ] It opens a sample marked **"Sample — not your class"** at the top and **"sample"** again on the score
- [ ] It shows a suggested score, strengths, what-to-work-on quotes, a rubric breakdown and next steps
- [ ] **Nothing in it is clickable through to a real submission** — no Validate, no Release
- [ ] Close it. **Check Gradebook and Analytics: no new submission, no new score, no change to any average**

> This replaced a fabricated 85% that lived in the database and *could* be validated into a real grade of record.

### 2.6 — Step 4 completes only on release

- [ ] Upload and **AI-check** a paper, then **validate** it, but **do not release**
- [ ] Step 4 is **still unticked** and reads *"1 paper checked — not released to learners yet"*, with the button now *"Release checked work"*
- [ ] **Release** it → step 4 ticks, and the **whole checklist disappears** from the dashboard
- [ ] The **"Setup guide"** button is still in the header, and still reopens it

> Marked-but-unreleased is invisible to learners, and it's the state a teacher is most likely to stop in without realising.

---

## Part 3 — Student access

**The hard part for a young learner is signing in, not the dashboard.**

### 3.1 — Printable login slips

Enrol a batch of learners (say 5, with a mix of birthdays and no-birthdays).

- [ ] The green "N accounts created" panel appears with a table of Name / Student ID / Password
- [ ] A **"Print slips (one per learner)"** button is the primary (dark green) action
- [ ] Click it → a **new window** opens with a print preview
- [ ] One card per learner, **two per row**, with dashed cut lines
- [ ] ID and password are in **large monospace** — readable at arm's length
- [ ] Each card says *"Capital letters and dashes do not matter"*
- [ ] The app's own layout/navigation is **not** in the printout
- [ ] "Copy all" still works and pastes into Excel as three columns

> If pop-ups are blocked you should get a clear message telling you to allow them — not silence.

### 3.2 — The birthday nudge

In the section creation form, paste a roster where **some** learners have birthdays and some don't:

- [ ] Each row previews either the password, a *"can't read"* error, or *"no birthday — random password"*
- [ ] An **amber summary** appears: *"N of M learners have no birthday, so their passwords will be random digits shown only once"*
- [ ] Give every learner a birthday → the amber summary **disappears**

### 3.3 — Forgiving student IDs ⭐

Take a real learner whose ID is e.g. `AS-26-0001`. Try signing in as them with the correct password, using each of these:

- [ ] `AS-26-0001` (exact) → **works**
- [ ] `as-26-0001` (lowercase) → **works**
- [ ] `AS 26 0001` (spaces) → **works**
- [ ] `as260001` (no punctuation at all) → **works**
- [ ] `  AS-26-0001  ` (leading/trailing spaces) → **works**

Then the negative cases:

- [ ] `as260001` with the **wrong password** → **rejected**. This must still fail.
- [ ] A **teacher** signing in with a mistyped email → still rejected (nothing is relaxed for teachers)

- [ ] The login page shows the hint *"Capital letters and dashes do not matter — as-26-0001 works too"* under the Student ID field
- [ ] The placeholder reads `e.g. AS-26-0001` (not the old `RIZAL-001`)

> This widens how an account is **named**, never what proves it's yours.

### 3.4 — Teacher resets a learner's password

Teacher → Manage Block Sections → expand a section:

- [ ] Each learner row has **Rename** and **Reset password** buttons
- [ ] Click **Reset password** → a confirm warns they'll be signed out everywhere
- [ ] Confirm → the new password appears **inline, in green, next to that learner**
- [ ] It says *"(their birthday)"* if they have one on file, or *"— write this down, it is random"* if not
- [ ] **The password stays on screen** — it does not fade away after a few seconds
- [ ] The learner can sign in with the new password
- [ ] **If that learner was signed in elsewhere, they are signed out** (their old session stops working)
- [ ] A teacher **cannot** reset a learner in another teacher's section

### 3.5 — Student welcome waits for something to see

- [ ] Sign in as a learner with **no released work**. **No welcome modal appears** — you land straight on the dashboard
- [ ] Release a grade for that learner. Sign in again → the welcome appears **once**
- [ ] It is **one screen**, not a 3-step carousel — no "Step 1 of 3", no Next/Back, no Skip
- [ ] One button: **"See my grade"**
- [ ] Dismiss it, reload → it **does not** come back

---

## Part 4 — The four recent fixes

### 4.1 — Clear the leftover `[DEMO]` sandboxes

There are 2 of these in production. This both fixes the data and tests the path.

- [ ] Open each `[DEMO]` class from the teacher dashboard
- [ ] An amber banner reads **"Left-over sample class"** and says the Demo Student and its marks are made up, safe to delete
- [ ] Click **Delete Demo Data** → confirm
- [ ] The class, its activity, its submission, the Demo Student **and** the demo section are all gone
- [ ] No orphan "Demo Student" remains in any section list

### 4.2 — Score only has no rubric

In Activity Builder:

- [ ] Choose **Score only** (`MANUAL_SCORE`) → the Grading Rubric panel is **replaced** by a short note explaining it isn't needed
- [ ] The note is readable and not greyed-out/disabled-looking
- [ ] Switch to **Teacher upload** or **Student submit** → the **full rubric panel comes back**, with your previous selection intact
- [ ] Publish a Score-only activity → it saves fine with no rubric
- [ ] Enter scores for it manually → they land in the gradebook

### 4.3 — Section creation is two columns

- [ ] The New Section form shows **"Step 1 · About the section"** (name, grade level) and **"Step 2 · Who is in it"** (roster) side by side
- [ ] A vertical divider separates them on a wide screen
- [ ] Narrow the window / open on a phone → they **stack** cleanly, no overlap or clipping
- [ ] Creating a section still works exactly as before

### 4.4 — Rubric names are unique

As a **teacher**:
- [ ] Save a rubric template named e.g. `Essay Rubric` → succeeds
- [ ] Save another with the **same name** → refused, with *"You already have a rubric called Essay Rubric…"*
- [ ] The save dialog **stays open** so you can rename rather than losing your work
- [ ] Try `essay rubric` (different case) and `Essay Rubric ` (trailing space) → **also refused**
- [ ] Rename it to something new → saves

As an **admin**:
- [ ] The same applies for school-wide rubrics, scoped to the school

Then the original complaint:
- [ ] Import/apply a curriculum with rubrics → note how many rubrics you get
- [ ] **Apply the same curriculum again** → **no duplicates appear**

### 4.5 — Renaming a misspelt learner ⭐

As a **teacher** (Manage Block Sections → expand section → **Rename**):

- [ ] The prompt shows the current name pre-filled
- [ ] It states: *"Their Student ID (AS-26-0001) will not change, so they sign in exactly as before"*
- [ ] Rename → the class list updates
- [ ] **The Student ID is unchanged**
- [ ] **The learner can still sign in with the same ID and password** ← the critical one
- [ ] Their existing **grades and submissions are still attached** to them
- [ ] The new spelling appears in the Gradebook and in an **export**
- [ ] Cancelling the prompt changes nothing; an empty name is rejected
- [ ] A teacher **cannot** rename a learner in another teacher's section

As an **admin** (Admin → Sections → a section):
- [ ] A **pencil icon** appears on each learner row (on hover)
- [ ] Same behaviour, same ID-unchanged guarantee

---

## Part 5 — Teacher deletion guard

This one is easy to miss and the failure is silent and destructive.

1. Create a **new teacher**, and as them create a **section with learners** — but **no class**.
2. As admin, try to **delete that teacher**.

- [ ] Deletion is **refused**, with a message naming how many student accounts are in their sections
- [ ] **The learners still exist** afterwards
- [ ] Move the learners to another section, then delete the teacher → now it succeeds

> Before this guard, deleting such a teacher silently deleted every learner account in their sections — and their grades — while reporting success. A teacher's first action is now building a roster, so this state is common.

---

## Part 6 — Smoke tests

Nothing here should have changed. You're checking nothing broke in passing.

**Student:**
- [ ] Log in, submit work, view a released grade, change password

**Teacher:**
- [ ] Create section with roster (last-name-first, birthdays)
- [ ] Create class, create activity
- [ ] Batch upload, AI check *(1–2 AI requests)*, review, validate, release
- [ ] Gradebook loads; export works

**Admin:**
- [ ] Create a teacher, move a course shell between teachers, edit grading policy
- [ ] Analytics loads

---

## Reporting what you find

For each issue, the useful minimum:

```
WHERE:     Teacher → Gradebook → Export All
ROLE:      Teacher (T1)
DID:       Clicked Export All with 2 unvalidated submissions
EXPECTED:  Confirm dialog warning about 2 unvalidated
GOT:       File downloaded immediately, class average 61
```

Add a screenshot for anything visual, and the learner/activity name for anything involving a number — most of these are only reproducible against specific data.

**Priority:** anything in **Part 1** or **Part 5** is serious — those touch grades of record and account deletion. Parts 2–4 are correctness and usability.
