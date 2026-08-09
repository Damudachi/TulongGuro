# TulongGuro — Session Handoff

**Written:** 7 August 2026
**Purpose:** Hand a fresh session enough context to run QA on recent work without re-deriving the architecture.
**State at handoff:** working tree clean, all work committed, all migrations applied, all checks green.

---

## 1. Orientation

### Stack
- **Frontend** — React 19 + Vite + Tailwind v4, `src/`. Deployed to Vercel.
- **Backend** — Express + Prisma + PostgreSQL (Supabase), `server/`. Single file: `server/server.js` (~8k lines). Deployed to Render.
- **AI** — Gemini, multiple API keys pooled (quota is metered per *project*, so two keys from two projects = two budgets).
- **Storage** — Supabase Storage for submission images.
- No TypeScript.

### Commands
```bash
# from repo root
npm run dev          # frontend
npm run build        # frontend production build
npx eslint src server

# from server/
npm run dev          # API (nodemon)
npm run verify       # THE GATE: grading math + dashboard + route auth + unit tests
npm test             # unit tests only (Vitest, 217 tests, 15 files in server/tests/)
npx prisma migrate status
```

`npm run verify` is what `render.yaml` runs **before** the deploy touches the database. If it fails, nothing ships. Keep it that way.

### Baselines to compare against
| Check | Expected |
|---|---|
| `npx eslint src server` | **75 problems** (73 errors, 2 warnings) — all pre-existing, mostly `react-hooks/set-state-in-effect`. A number above 75 means something new was introduced. |
| `server/` `npm run verify` | **Passes.** 297 tests across 17 files, plus `verify:grading` 92, `verify:dashboard` 41, `verify:routes` 45. The four `roster.test.js` failures described below are resolved — see the note. *(Historic:* **Did not pass.** The three `verify:*` stages all pass individually — `verify:grading` 92 passed, `verify:dashboard` 41 passed, `verify:routes` 45 passed (45 routes scanned) — but the final stage, `npm test` (Vitest), is **265 tests across 16 files: 261 passed, 4 failed**. All 4 failures are confined to `server/tests/roster.test.js`, and come from commit `4a2d642` ("Name fix"), which added `stripNameCommas` to `src/utils/roster.js` — it strips the comma from names like "Dela Cruz, Juan", while those four tests assert the comma survives. That commit is the user's own in-flight work, made immediately before this branch started, and is unrelated to section transfers.)* **Resolution:** `stripNameCommas` was the wrong fix. The surname comma is the only thing in a stored name that marks where the family name ends, so removing it made the student greeting unfixable — `firstNameFromRoster` fell back to the trailing word and greeted children by their *second given name*. It is now `normalizeRosterName`, which collapses whitespace and keeps the first comma (optional to type, preserved when typed), and `firstNameFromRoster` returns the whole given-name portion. The four tests pass unchanged, because what they asserted was right. |
| `npx prisma migrate status` | **7 migrations.** `20260810020000_lesson_rubric_template` and `20260810030000_submission_rubric_score_note` are written but **not yet applied** — they apply themselves on the next deploy (`render.yaml` runs `migrate deploy` after `verify`). Three additive nullable columns; existing rows untouched. |
| `npm run build` | succeeds; the >500 kB chunk warning is expected |

---

## 2. What changed, and where

Three commits, oldest first.

### `1d7bb1b` — ten user-reported bugs
1. **Student IDs** — was always `SEC-001` (the code split the section name on a dash that the form never produces). Now `<SCHOOL>-<YY>-<NNNN>`, e.g. `AS-26-0001`. School-scoped, survives section changes. **Existing IDs were deliberately left alone** — they are login usernames.
2. **Activity Builder** — "Curriculum Lesson" and "DepEd Topic" merged into one optional `Lesson / Topic` dropdown. DepEd competencies only appear for Grade 6 English (the list is Grade 6 English only).
3. **Roster notes** — "last name first" guidance added to all three roster inputs.
4. **`[STUDENT-DEMO]` auto-seed removed** — it wrote a fake class and a fabricated 90% graded submission into the student's *real* section on login.
5. **Change password** — both teacher and student forms were fake (the teacher one printed "Password updated successfully!" without a network call). New `POST /api/auth/change-password`, rate-limited.
6. **Credentials display** — `window.alert` replaced with a copyable table (`src/components/StudentCredentials.jsx`). Random passwords are generated server-side and stored hashed, so that alert was the only moment they were ever readable.
7. **Cross-section moves** — enrolling a name that already has an account silently emptied a colleague's roster. Server now returns `pendingMoves` and refuses until confirmed.
8. **Delete-section** — says what is blocking before calling the API.
9. **Course-shell reassignment** — errors now render next to the control instead of in a banner offscreen.
10. **Detached students** — a student unassigned from a section was invisible to name matching, so re-enrolling created a duplicate account and orphaned their grades. Students now carry `schoolId`; this also fixed a real security gap where rejecting a school revoked staff sessions but **not** student sessions.

### `17b4201` — grade integrity, tenancy, analytics
Groundwork:
- **Prisma migrations adopted.** Baselined `0_init`; `render.yaml` runs `migrate deploy`, not `db push`.
- **Vitest added** to `server/`, wired into `npm run verify`.
- **`numInstances: 1`** pinned in `render.yaml` with the reasons.
- **Grading temperature measured** before changing it (`server/scripts/measure-grading-variance.js`), then set to `0.2`.

Fixes:
- **Export shipped unvalidated AI drafts as official grades** — no `status` check. Now gated, with an `INCOMPLETE:` notice, a pre-export confirm, and draft markers in the gradebook.
- **`hitlScore` unvalidated** — 400 on out-of-range.
- **AI score unvalidated** — clamped 0–100, flagged via `Submission.scoreOutOfRange`, surfaced in the HITL workspace.
- **`useTransmutation` was dead** — no call site ever transmuted. The export now does; analytics deliberately don't.
- **Client/server band disagreement** — client now rounds before banding.
- **Two (then three) contradictory "late" definitions** — reads stored `isLate`; fixed the student dashboard dropping tasks due today at 08:00 Manila.
- **Cross-tenant read leak** — classes with no `schoolId` were readable by any staff account. Rule extracted to `server/access.js`.
- **Admin band distribution double-counted** students.
- **N+1 in teacher analytics** — ~120 queries → 3.

### `6b423f8` — best-practice gaps
- AI job registry finalises in a `finally`; hourly sweeper added.
- Boot log names the process-local state that breaks under horizontal scaling.
- School average is now the mean of per-student averages, not of class averages.
- **AI skill scores only requested when the rubric assesses writing or language.** A Maths worksheet previously came back with an invented punctuation score that was charted as measurement.
- **Excused state added** (`Submission.excusedAt` / `excusedReason`). Excused work leaves the average entirely rather than counting as zero.

### Files worth knowing
| File | Why |
|---|---|
| `server/grading.js` | Pure grading engine. `countsAsGrade`, `parseScore`, `clampScore`, `isExcused`, `memoPolicyLoader`, transmutation, descriptor bands, stars. No DB, no Express — everything here is unit-tested. |
| `server/access.js` | Staff read-tenancy rule, pure. `classSchoolId`, `staffMayAccess`. |
| `src/utils/grading.js` | Client twin of the descriptor ladder. **Must stay in step with `server/grading.js`** — `server/tests/band-parity.test.js` enforces this by running both against each other. |
| `src/utils/deadlines.js` | Client twin of `isPastDeadline`. Same rule: a date-only deadline closes at 23:59:59 **Manila**, not midnight UTC. |
| `server/scripts/verify-route-authorization.js` | Has a `ROUTE_MANIFEST`. **Any new `/api/teacher/` route must be added or `npm run verify` fails.** This is intentional. |
| `server/db.js` | The Prisma client, behind a Proxy over a swappable instance. Exists so the route table can be exercised without a database — see the note in the file. `__setClientForTests` throws in production. |
| `server/tests/route-wiring.test.js` | Drives the real Express app over HTTP with a fake Prisma client. Covers P3 and P8, which used to be manual REST-client steps. |

---

## 3. QA test plan

Ordered by consequence. Items 1–4 involve numbers that reach report cards.

**P3 and P8 are now automated** and run inside `npm run verify` — nothing to do by hand. The rest are still manual UI walkthroughs.

> **Setup once:** a class with ≥3 students, one activity worth 100 points, and papers uploaded for all three.

### P1 — Export never contains unvalidated AI grades
1. Run **AI-check all** on the activity so all three get an `aiScore` but stay PENDING.
2. Validate **only student 1** (give them 90).
3. Teacher → Gradebook → section card → **Export All**.
   - Expect a confirm: *"2 submission(s) in this section have not been validated yet"*. Cancel → no download.
   - Confirm → `.xlsx` downloads.
4. Open the file.
   - Students 2 and 3: blank cells, no average.
   - Student 1: 90, average 90.
   - Amber row near the top: `Incomplete: 2 submission(s) not yet validated…`
   - `CLASS AVERAGE` = 90, not ~60.
5. On the gradebook screen, students 2 and 3 show an **amber ring + `*`** with a legend under the table.

**Regression risk:** this is the change most likely to be reported as "my grades disappeared". They didn't — they were never validated.

### P2 — Transmutation
1. Get a student to an Initial Grade around **69**.
2. Admin → Grading, transmutation **off** → export. Header `Average (%)`, value **69**, metadata says *"Initial Grade — not transmuted"*.
3. Turn it **on**, save, export. Header `Final Grade (transmuted)`, value **80**, metadata names DO 8 s.2015.
4. **Critical:** Teacher → Analytics with transmutation still on. The student must still read **69** and still be in "needs support".

If step 4 moves, the early-warning system is broken.

### P3 — Score validation — **automated**
Covered by `server/tests/route-wiring.test.js`, so `npm run verify` now runs it on every deploy. It drives the real route over HTTP and asserts **400** for `500`, `-5`, `"abc"`, `null`, `""`, `true`, `[]`, `100.1` and an omitted field — and, in each case, that `submission.update` was **never called**. The happy path asserts 76.7 is stored unrounded and that a validated `0` is accepted as a real mark.

Still worth one manual pass: validating through the review UI, to confirm the browser sends what the endpoint expects.

### P4 — Excused
1. Gradebook → click a student → find an activity showing **MISSING** → **Excuse**, enter a reason.
2. Row turns lilac **Excused** with the reason beneath. The student's average goes **up** (the zero stopped counting).
3. Export → that cell reads `Excused`, and it does **not** add to the INCOMPLETE count.
4. **Un-excuse** → everything reverts, including any score that was already on the row.

### P5 — Deadlines (Manila boundary)
Create a `STUDENT_SUBMIT` activity with **today** as the deadline. As a student in that section, after 8am Manila:
- Dashboard → the activity is in **Upcoming Deadlines** (previously it vanished at 08:00 while still being submittable).
- Teacher → Gradebook → that student: **UPCOMING**, not MISSING.
- Submit on the due date → **DONE**, not LATE.

### P6 — Band boundaries agree
```sql
UPDATE "Submission" SET "hitlScore" = 74.6 WHERE id = '<a released, graded submission>';
```
With passing grade 75, the same student must read **passing/amber** in: student Subjects + Gradebook, teacher Gradebook, admin Analytics. Previously the server said passing and the browser coloured it red.

### P7 — Admin counts
Admin → Analytics: the **Students** tile and the **class spread bar** must total the same number. Enrol a student in a second class and reload — both stay the same.

### P8 — Tenancy — **automated**
Covered by `server/tests/route-wiring.test.js`. All three routes are asserted in both directions, which is what makes the result meaningful — identical fixture data, only the token differs:

| Class | Caller | Expect |
|---|---|---|
| no school anywhere | unrelated teacher | 403 |
| no school anywhere | the owning teacher | 200 |
| belongs to school A | staff at school B | 403 |
| belongs to school A | colleague at school A | 200 |

Plus 404 (not 403) for a missing activity, 401 for no token and for a tampered signature, and 403 for a student on a staff-only route.

### P9 — AI skill scores
1. Create a **Maths** activity with a rubric of non-language criteria ("Accuracy", "Solution Steps"). AI-check a paper.
   - `SELECT "skillScores" FROM "Submission" WHERE id='<id>'` → `NULL`.
   - Teacher → Analytics on a Maths-only class → the writing-skills panel says **"not measured"**, not `0/25`.
2. Same on an **English essay** → `skillScores` populated as before.

### P10 — Smoke tests (nothing should have changed)
- Student: log in, submit work, see a released grade, change password.
- Teacher: create section with roster (last-name-first, birthdays), create class, create activity, batch upload, AI check, review, validate, release.
- Admin: create teacher, move a course shell between teachers, edit grading policy.

### P11 — Section transfer

*Requires a running app with seeded data — these steps were not executed by automation, walk them by hand.*

Two sections, both teaching English 6 in the same school year, each with graded
activities. Move a student from one to the other.

1. The confirm dialog names what carries, what does not, and how many
   activities will be excused. Cancel → nothing is written.
2. Confirm. In the receiving teacher's gradebook, click the student:
   - their old marks appear under **Carried over from …**, with no
     excuse/re-grade controls;
   - activities the new section ran before they arrived read **Excused**, with
     the reason naming the old section and the date — not MISSING.
3. Export the receiving section. The student's average must reflect **both**
   sections' work. Carried columns are headed with the old section's name.
4. In the *sending* teacher's gradebook, the student is still listed, greyed,
   **Transferred out ⟨date⟩**, marks intact. They are **not** on that teacher's
   at-risk list.
5. Admin → Analytics: the Students tile and the class spread bar still agree
   (this is P7, re-asserted across a move).
6. Move them back. The auto-excused rows disappear; nothing a teacher entered
   is lost.

---

## 4. Known gaps — deliberately not fixed

Don't file these as new bugs; they were considered and left.

| Gap | Why it was left |
|---|---|
| **Single instance is load-bearing.** AI job registry, rate-limit buckets and AI quota counters are all in-process. | `render.yaml` runs one instance and pins `numInstances: 1` with an explanation; the server logs it at boot. A durable job queue solves a problem that doesn't exist yet. **If you ever scale past one instance, fix this first.** |
| **Curriculum is copy-on-apply.** Editing a `CurriculumLesson` does not reach `ClassLesson` rows already copied into live classes. | Correct for stability. What's missing is a "N classes are using an older copy — push update?" affordance in the admin UI. |
| **Analytics include GRADED-but-unreleased work.** | Deliberate — `status: 'GRADED'` is the gate everywhere. Worth adding UI copy saying so on the admin dashboard. |
| **`computeSkillProgress` is cumulative.** A student who collapses in week 8 shows a gentle drift, not a cliff. | Chart is least sensitive exactly when intervention matters most. A rolling-average overlay would fix it. |
| **`server/server.js` is ~8k lines.** | Several bugs found in the audit were divergences between call sites that would be obvious if the grade-writing paths lived in one module. Extracting `grades.js` and `analytics.js` is the highest-value refactor available. |
| **Existing student IDs stay `SEC-001`.** | They are login usernames. Changing them locks students out. Only new enrolments get the new format. |
| **Transfers do not cross schools.** A learner moving to another school gets a new account. | The match key is scoped inside one school's sections, and moving a child's grade history across a tenant boundary is a privacy decision, not a data one. |
| **Transfers before this shipped have no record.** Those learners are treated as always having been in their current section. | Which is exactly what every screen assumed before, so nothing regressed — but a move that happened last term will not show carried-over work. |
| **`POST /api/teacher/activities/:activityId/scores` and `POST /api/teacher/upload` skip roster validation.** They write `Submission` rows for an arbitrary `studentId` with only `teacherOwnsActivity` checked, unlike `POST /api/teacher/submissions/excuse`, which does check the roster. | Pre-existing, not introduced by this branch. A misassigned upload can attach a graded submission to a student outside the activity's section. Recommended follow-up: mirror the excuse route's roster check on both routes. |
| **`src/pages/teacher/Gradebook.jsx` has a second, independent roster-rendering branch**, fed by the same endpoint as `GradebookClass.jsx` but without the transferred-out treatment. | Currently unreachable via in-app navigation, so it was left alone — but it will drift. |

---

## 5. Outstanding

**Last measured against production: 7 Aug 2026, ~20:05 local.**

### 5.1 Data — all clear ✅

Every fabricated-data item is gone. Verified against production 7 Aug 2026, ~20:30 local:

| Check | Count |
|---|---|
| `[STUDENT-DEMO]` classes | **0** — the fabricated 90% is off Aldrich Gavriel Sabando's record |
| `[DEMO]` sandbox classes | **0** |
| `DEMO-` student accounts | **0** — including the one whose password was the literal string `password` |
| Demo sections | **0** |
| Students without `schoolId` | **0** — the invariant tenancy and session revocation key on |
| Sections without `schoolId` | **0** |
| Duplicate rubric names | **0** groups / 40 templates |
| `GradingExample` rows | **0** — no fabricated few-shot rows |

Totals after cleanup: **3 sections, 4 students**. Nothing beyond the demo rows was touched.

**Do not re-run any demo cleanup.** The `[DEMO]` sandbox was removed by hand in the Supabase SQL editor (child rows first: submissions → notifications → class lessons → activities → class → user → section — the table editor cannot do it, the foreign keys block a direct delete). `DELETE /api/teacher/demo-data/:classId` and the amber banner in `ClassHub.jsx` now have nothing left to act on; both can be removed, along with the `[DEMO]` exclusion in the teacher-delete route (`server.js`, the `realClasses` count).

### 5.2 Known bugs — all fixed ✅

Three from the original audit (A, B, C below); six more from the admin-dashboard
QA sweep, written up in §8.10.

**A. The section gradebook grid dropped a transferred learner.** — **Fixed.**
`GET /api/teacher/:teacherId/gradebook` now looks up `SectionTransfer` rows out of each class's section and appends the departed learners to the returned roster, flagged `transferredOut` with `transferredOutAt`. Added to the *response*, never to the Prisma relation — widening that relation would double-count a child in admin analytics and break QA P7.

**B. The export dropped them too.** — **Fixed.**
`GET /api/teacher/:teacherId/gradebook/export` built `students` from `cls.section.students` alone, so a transferred learner was not a blank row or a flagged row but **no row at all**, while every mark their teacher gave them sat untouched in the database. The roster is now the current section **plus** anyone holding a non-archived submission against one of the class's activities — derived from the submissions already loaded, not a fresh query. Departed learners are named `"<name> (transferred out <date>)"`, the sheet carries a `Transferred out:` notice, and they are **excluded from CLASS AVERAGE**: their row rests on whatever part of the quarter they were present for, so averaging it with full-quarter averages compares two different things. Regression test: *"the export still contains a learner who transferred out"*.

**C. The new section showed a transferee as MISSING** for activities set before they arrived. — **Fixed.**
`excusePreArrival()` writes an excused row for every activity assigned before the learner's `transferredAt` that is already past its deadline and that they have no submission for. No migration was needed after all: `SectionTransfer.transferredAt` is the record of *when* they joined. `cleanUpTransferRows()` deletes exactly those invented rows if the move is undone — four conditions, all load-bearing.

### 5.3 Never manually tested

`QA-PLAN.md` exists and is ordered by consequence, but **none of it has been run by hand.** P1 (*export never contains unvalidated AI grades*) is the highest-consequence test in the whole document and is untested. P3 and P8 are automated and can be skipped.

### 5.4 Documentation drift

- `QA-PLAN.md` §3.2 still describes the roster as a comma-separated textarea; it is now a two-column editor (§8).
- `QA-PLAN.md` has no coverage for: student rename, rubric-name uniqueness, score-only rubric removal, the two-column section form, transfer visibility, or school-year archiving.

### 5.5 A caveat on this list

This is what surfaced *in the course of doing other work* — not a systematic audit. The transfer bug only came to light because it was asked about directly, and the section-name-reuse bug (§8) was found while building something else. A deliberate sweep would likely find more.

---

## 6. Gotchas for the next session

1. **`DATABASE_URL` in `server/.env` points at production Supabase.** There is no staging. Any script you run hits live school data. Use read-only queries unless the change is explicitly authorised, and prefer `prisma migrate deploy` (never resets) over `migrate dev` (can reset).

2. **Schema changes go through migrations now, not `db push`.**
   ```bash
   # edit schema.prisma, then:
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
   # review, save as prisma/migrations/<timestamp>_<name>/migration.sql, then:
   npx prisma migrate deploy && npx prisma generate
   ```

3. **The JS coercion trap bit three times.** `Number(null)`, `Number('')` and `Number([])` are all **`0`** — a valid score. Coerce-then-validate silently turns "no value sent" into a zero for a student. Always check the *type* before coercing. `grading.parseScore` and `grading.clampScore` both do; copy that shape.

4. **Two client/server twins must stay in step:** `src/utils/grading.js` ↔ `server/grading.js`, and `src/utils/deadlines.js` ↔ `isPastDeadline()` in `server.js`. The first pair is enforced by `band-parity.test.js`. The second is not — if you touch deadline logic, check both.

5. **Adding an `/api/teacher/` route requires a `ROUTE_MANIFEST` entry** in `scripts/verify-route-authorization.js` or the build fails. Intentional.

6. **AI quota is ~20 requests/day per model per credential**, 2 credentials configured. `AI_BATCH_SIZE` defaults to **1** on purpose — batching was measured to shift an identical paper's score by up to 14 points depending on which classmates shared the request. Don't raise it to solve a capacity problem; add a key from a second Google Cloud project instead.

7. **Grading temperature is 0.2**, set after measurement, not assumption. `node scripts/measure-grading-variance.js --dry-run` shows the plan; without the flag it spends ~30 requests. Measured result: mean SD 1.77 → 1.26, with the gain concentrated on weak papers (3.71 → 2.19).

8. **`vi.mock` does not work on `server.js`.** It is CommonJS, and Vitest cannot rewrite a `require()` inside a CJS file — the mock is ignored *silently*. The first draft of `route-wiring.test.js` mocked `@prisma/client`, appeared to pass 13 assertions, and was in fact querying the production database the whole time; the tell was `findUnique.mock.calls.length === 0` alongside a 404. Swap the client through `db.js` instead, and load both `db.js` and `server.js` with `createRequire` so the test shares Node's CJS cache with the app. Loading them through Vitest's module runner yields a second copy and the swap does nothing.

9. **Onboarding progress is derived, not stored.** Don't add a "current step" column or a localStorage step number. `GET /api/teacher/:id/setup-status` counts rows; `src/utils/setupSteps.js` turns those counts into the checklist. The only flag left in localStorage is whether the teacher *hid* the card. See section 7.

10. **Audit reports live in the git history**, not in files. `git show 17b4201` and `git show 6b423f8` carry the reasoning in their messages, and the code comments explain *why* rather than *what* — read them before changing anything in `grading.js` or the grading prompt.

---

## 7. Onboarding — the demo sandbox is gone

### What was removed

`seedDemoSandbox` ran on **every** admin-created teacher and wrote five real rows: a Section, a STUDENT account, a Class, an Activity, and a Submission with a fabricated `aiScore` of 85. It is deleted. Three reasons, ascending:

- Cleanup was the teacher's job — the walkthrough's last step asked them to delete it. The `[STUDENT-DEMO]` rows in section 5 are what that instruction was worth.
- The demo student's password was the literal string `password`, under username `DEMO-<epoch ms>`. A working login, once per teacher.
- It created that student with **no `schoolId`**, undoing the backfill on every teacher added, and putting those accounts outside the tenancy rules that key on `schoolId`.

The four-step walkthrough went with it — every step named the demo class.

### What replaced it

A **setup checklist** on the teacher dashboard, over the teacher's own real work:

1. Add your block section and its class list
2. Create your first class
3. Create your first activity
4. Grade a paper **and release it**

| File | Role |
|---|---|
| `GET /api/teacher/:teacherId/setup-status` | Six counts: sections, students, classes, activities, graded, released. |
| `src/utils/setupSteps.js` | `buildSteps(counts)` → the four steps, with `done`, `progress`, `cta`, `blockedBy`. Pure; unit-tested by `server/tests/setup-steps.test.js` (15 tests). |
| `src/components/SetupChecklist.jsx` | Draws it. Only the current step expands. |
| `src/components/ExampleFeedback.jsx` | Static sample of AI output — the one thing the sandbox was actually good for. Constants in the file; **cannot** be graded, released or counted. |

Three decisions worth keeping:

- **Derived, never stored.** Onboarding state used to be localStorage-only, so it was a property of the *device*: signing in on the other staff-room computer restarted the tour, and a mis-clicked "Dismiss" hid it permanently. Counts fix both.
- **Step 4 is `released > 0`, not `graded > 0`.** Marked-but-unreleased is invisible to learners and is the state a teacher is most likely to stop in without realising.
- **Hiding is reversible** — a "Setup guide" button in the dashboard header, and `clearOnboardingSeen()` in `src/utils/onboarding.js`.

### One bug fixed on the way

`DELETE /api/admin/:adminId/teachers/:teacherId` deletes every student in every section the teacher owns. That was survivable when the only such students were seeded `Demo Student` rows — but a teacher's first real action is now building a roster, which can exist for weeks before the first class does, and the route only blocked on *classes*. Removing such a teacher would have silently deleted real children's accounts and their grades while reporting success. It now refuses when any non-`DEMO-` student sits in those sections.

### Student side

The hard part for an elementary learner is the **login**, not the dashboard. All six items are done.

| Change | Where |
|---|---|
| **Printable login slips** — one cut-out card per learner, name + ID + password in 15pt monospace. Opens a detached print window so the app's layout stays out of the handout. | `src/components/StudentCredentials.jsx` (`printSlips`) |
| **Birthday-password nudge** — a count before submitting: "12 of 40 learners have no birthday, so their passwords will be random digits shown only once." The per-row preview already existed; a 40-name roster scrolls, and the *count* is the decision. | `src/pages/teacher/ManageSections.jsx` |
| **Forgiving student IDs** — `as-26-0001`, `AS 26 0001` and `as260001` all reach `AS-26-0001`. | `POST /api/auth/login` |
| **Show-password toggle** | already existed on `src/pages/Login.jsx`; the placeholder now shows the real ID format and says punctuation does not matter |
| **One-click password reset from the teacher's roster** | `PUT /api/teacher/sections/:sectionId/students/:studentId/password` |
| **Student welcome cut to one screen**, held until the learner has released work | `src/pages/student/Dashboard.jsx` |

Two of these are worth understanding before changing them.

**The relaxed ID lookup widens how an account is *named*, never what proves it is yours.** It runs only for `role === 'STUDENT'`, only after an exact match has already failed, and only when the normalised form matches **exactly one** account — two candidates is treated as no match rather than a guess. The password is then checked normally. Ten tests in `route-wiring.test.js` pin this, including "still refuses the wrong password on a relaxed match" and "refuses rather than guessing when two IDs normalise the same way".

**The teacher reset revokes sessions**, like the admin one it mirrors — a forgotten password is indistinguishable from a shared one. It hands back a birthday-derived password when the roster has a birthdate, random otherwise, and the new password renders inline next to the learner and stays there until the next reset. It is not a toast: the teacher has to read it aloud to a child at a keyboard, which is exactly what the old `window.alert` got wrong.

Why the student welcome moved: it used to fire on first sign-in, in front of an empty dashboard. "Look out for the yellow cards" means nothing when there are no cards, and a nine-year-old facing a three-step carousel taps through it to make it go away. It now waits until `submissions` is non-empty — that list only ever contains *released* work — so every line describes something visible behind the modal.

### Not done

For Grades 1–3 specifically, the standard elsewhere (Seesaw, ClassDojo) is no typed password at all: a class code on the board, then pick your name from a grid and tap a picture as a PIN. That is a bigger change than anything above and was not attempted.

---

## 8. Later changes — rosters, transfers, school years

Everything below landed after §7, in the same session. Ordered by how much damage the original behaviour could do.

### 8.1 Section names were reused across school years ⚠️ *the worst one*

`POST /api/teacher/sections` looked up an existing section by **name alone**. Schools reuse block names every year, so next June, creating "Grade 6 - Sampaguita" would have silently reopened **last year's** section and enrolled the new intake onto the leaving class's roster — alongside their grades.

Now scoped by school year as well. A `NULL` year still matches, so a roster created before the column existed is reused and stamped rather than duplicated.

### 8.2 School year on sections

- **Migration** `20260807020000_section_school_year` — adds nullable `Section.schoolYear`, backfills existing rows to `'2026-2027'`, indexes it. The backfill is a **hardcoded constant, not a computed date**: a migration must replay identically whenever it runs, so it cannot ask what "now" is.
- **`server/schoolYear.js`** — the June–March rule as pure functions. Twin of the derivation in `src/constants/school.js`, held in step by parity tests in `server/tests/school-year.test.js` (same twin problem as `grading.js` — see gotcha 4).

Three leniencies, all deliberate and all tested:

| Case | Treated as | Why |
|---|---|---|
| `null` / unparseable year | **current** | Hiding a roster nobody can then find again is worse than one stale entry |
| A *future* year | **current** | A teacher setting up next June's blocks in April must see what they just made |
| April–May gap | **the year that just ended** | Classes are over but results are not final; archiving there hides a gradebook mid-entry |

The list endpoint returns **everything** and flags `isArchived`; the client folds past years behind a "Show past years (N)" toggle. Filtering server-side would leave a teacher no route to last year's marks, and those are records.

### 8.3 Moving a learner between sections

A move is only `User.sectionId = <new>`. Submissions are never touched — they stay bound to activities in the old class. Nothing is lost from the database; the problem was **visibility**, and it was asymmetric in the worst direction: the numbers kept counting while the evidence became unreachable to the person who produced it.

**Fixed:**
- `GET /api/teacher/:teacherId/student/:studentId/gradebook` resolved on `sectionId: student.sectionId`, so the moment a learner transferred, every mark their previous teacher gave them dropped out of that teacher's view. It now also includes classes *that teacher owns* where the learner has work. Still scoped by `teacherId` throughout — a test asserts this.
- Rows from a class the learner has left carry `fromPreviousSection: true`.
- **A previous-section activity with no submission is dropped, not shown as MISSING.** Without an enrolment date, "didn't hand it in" and "had already left" are indistinguishable, and inventing a missing mark against a child is the worse error. Work they actually did is always kept.
- `GET /api/student/:studentId/subjects` now unions in classes the learner has graded work in but is no longer rostered into (flagged `isPreviousSection`, only activities they have submissions for). Previously the General Average counted subjects the page would not list.
- The dashboard's subject total unions current-section subjects with subjects they have been graded in, so `subjectsIncluded` can no longer exceed `subjectsTotal` — that produced *"covering 3 of 2 subjects"* for a transferee.

**Also fixed since:** §5.2 A, B and C — the grid, the export and the pre-arrival MISSING case.

### 8.4 Roster entry is two columns

Name and birthday were one comma-separated line, split on the last comma — the same character separating a surname from a first name *and* a name from a date.

Now `src/components/RosterEditor.jsx` + `src/utils/roster.js`, used by both the create-section and add-students forms. Name required, birthday explicitly optional (blank ⇒ random password). **Pasting a block of lines still works** — it is how a 40-name roster actually gets entered — and still splits a trailing date while keeping a surname comma.

`rosterPayload` **refuses the whole submit** on an unreadable date rather than dropping it: dropping it hands the learner a random password nobody wrote down while the teacher believes they set a memorable one.

### 8.5 Four smaller fixes

| Fix | Note |
|---|---|
| **Rubric names unique** | Per-teacher for private templates, per-school for admin ones; case-insensitive and trimmed. 409 with the existing name; the save dialog stays open so work is not lost. The curriculum importer already deduped — the doubling came through the *save* path, which had no check at all. |
| **Score-only hides the rubric** | `MANUAL_SCORE` replaces the panel with a line saying why. Not greyed out — a disabled section reads as something you failed to fill in. |
| **Section form in two columns** | "Step 1 · About the section" / "Step 2 · Who is in it". |
| **Student rename, teacher and admin** | `PUT /api/{teacher,admin}/.../students/:studentId`. **The username is deliberately untouched** — it is the student ID and their login, so regenerating it from a corrected spelling would lock the child out. Both prompts say so. Previously the only way to fix a misspelling was deleting the account, which is refused for anyone who had submitted work. |

### 8.6 Deploying the migration — no permission needed

`render.yaml:32` already runs `npx prisma migrate deploy` in the build command, with `npm run verify` **before** it, so a broken build stops the deploy without touching the database. **Commit and push and the migration applies itself.**

The permission blocks hit repeatedly in this session (the Claude Code auto-mode classifier auto-denying production writes) only ever mattered for *ad-hoc* SQL — the `[STUDENT-DEMO]` delete. They do not block schema changes. If a future session needs ad-hoc SQL, either use `/permissions` to switch to a mode that prompts, or run it in the Supabase SQL editor.

⚠️ **Push before anyone creates sections expecting year separation.** The code sets `schoolYear` on create, but the column has to exist first. One push handles both, since Render migrates during the build.

### 8.7 Curriculum lesson rubrics are school rubrics

A lesson's rubric was saved into "Your school rubrics" already, but named after
its **output type** (`Essay — English Grade 6`), and picking that lesson in the
Activity Builder loaded the separate copy on `ClassLesson.defaultRubric` under a
synthetic `lesson-rubric` option. So the rubric a teacher saw when they chose a
week was a rubric they could not then find anywhere in their rubric list, and
the two copies were free to drift.

- Templates are now named after the **lesson/week** they belong to
  (`Week 3: Elements of a Short Story — English Grade 6`). A rubric genuinely
  shared by several lessons keeps the output-type name, because that is what it
  is. Same-title collisions are numbered rather than silently dropped.
- `CurriculumLesson.rubricTemplateId` / `ClassLesson.rubricTemplateId`
  (migration `20260810020000_lesson_rubric_template`) point the lesson at the
  template. **No foreign key on purpose:** `defaultRubric` stays the fallback,
  so a deleted template must degrade to "use the embedded copy" rather than
  cascade the lesson away or block the delete.
- `resolveDefaultRubric` tier 1 now resolves the linked template and returns
  `saved:<id>`, so the picker selects the real row and shows the real name.
  Lessons imported before the link have no id and fall through to the embedded
  copy exactly as before.
- Rubrics are saved *before* the lessons on import, so a lesson is never
  written pointing at a template that does not exist yet.
- **A name is only "taken" by a rubric that is genuinely the same rubric.**
  Revising a curriculum means deleting and re-uploading it (the upload route
  refuses a second one for the same school/grade/subject), and
  `RubricTemplate.curriculumId` is `onDelete: SetNull` — so the old templates
  survive that delete under their old names holding their old criteria.
  Matching on name alone skipped the revision as "already there" and stamped
  the new lesson with the **superseded** template's id; because the linked
  template outranks the embedded copy, teachers would then build activities
  against criteria the admin thought they had replaced, silently. Templates are
  now matched on name **and** criteria signature, and a same-name-different-
  criteria revision is written under a numbered name. This failure mode did not
  exist before the link — the embedded copy always won, so drift meant nothing.
- **Both copy paths carry the id.** `POST /api/teacher/classes` (accepting a
  curriculum at class creation — the dominant flow) and
  `POST /api/teacher/classes/:id/parse-curriculum` both copy `rubricTemplateId`
  onto `ClassLesson`. Missing it on either leaves a null link and silently
  reinstates the pre-§8.7 behaviour for every class made that way.
- `POST .../curriculums/:id/promote-rubrics` back-fills the link for
  curriculums that predate this.

### 8.8 Releasing one paper

`POST /api/teacher/submissions/:id/release` existed and had **no caller**.
Release was reachable only from the end-of-run summary, which only renders in
queue mode (`?queue=`), so a teacher opening one paper from the gradebook could
validate it and then had nowhere to go — the mark was recorded, `status` GRADED,
so the learner's dashboard reported the activity as graded, while `releasedAt`
stayed null so they could not see it. Compounding it, the header badge keyed on
`isApproved` (which is only `status === 'GRADED'`) and announced **"Released to
Student"** for a paper nobody had published.

Single-paper mode now shows **Release to student** as the primary action until
it has been done, and the badge distinguishes *Validated — not yet released*
from *Released to Student*.

### 8.9 The AI checker's arithmetic is now checked

Investigating a report that an incomplete paper scored too well surfaced two
things nothing was checking. Both were found in **live data**, on the same
activity, and both papers were already `GRADED` — i.e. a teacher had validated
them and they were counting toward real marks:

| Symptom | Real instance |
|---|---|
| Headline score ≠ the criteria it is the sum of | criteria totalled **65**, `aiScore` stored **67** — 67 became the grade |
| A criterion scored outside the band the model itself labelled it with | **28** awarded under `"Proficient (21-26 pts)"` |

Neither is caught by `scoreFeedbackMismatch`, which asks whether a shortfall was
*explained*, not whether the numbers add up. The prompt does say *"Your 'score'
field must equal the sum, scaled to percentage"* — saying so is not checking.

- `rubricScoreNoteFor()` (exported, unit-tested in `tests/rubric-arithmetic.test.js`,
  11 tests built from the real shapes) returns a sentence naming the
  disagreement, or null. Persisted to `Submission.rubricScoreNote`
  (migration `20260810030000_submission_rubric_score_note`), red banner in the
  HITL workspace.
- **It never corrects the score.** A disagreement means the model's output is
  untrustworthy on that paper; picking one of its two answers would be guessing
  which. The teacher decides.
- One point of rounding slack, so the banner does not cry wolf and get ignored.
- Computed from the raw result *before* `clampScore`, or a clamped 120 would
  read as agreeing with criteria it never matched.
- Existing rows get `NULL` — honestly "not checked", since nothing checked them
  when they were graded. A read-only audit at the time of writing found
  **2 of 5** papers carrying a rubric breakdown were inconsistent, both already
  GRADED. Small sample, but that is the whole production corpus.

**Not fixed, and the bigger problem:** on that activity the rubric itself does
not match the assignment. A *Narrative Essay* is graded 40% on "Content &
Evidence on **Global/National Issues**" and 30% on "Audience Awareness &
Inclusivity", with nothing measuring mechanics. Every pupil is marked down on
the 40-point criterion — the AI's own feedback says the same sentence about all
four — so it cannot discriminate, and the incomplete paper scores the *same 22*
there as a complete one. Only Organization separates them, which is why the
class compresses into 67–83 and an incomplete paper still lands at 65. That is a
rubric-selection problem (see §8.7), not a grading-engine one.

---

### 8.10 Two owners, one section

`Class.teacherId` and `Section.teacherId` are separate columns, and the admin
dashboard lets you move each on its own — reassign a course shell on the teacher
page, reassign an adviser on the section page. Both routes are correct in
isolation, and the section form even says so ("changing the adviser does not
move the classes taught in this section"). What nothing accounted for is the
shape the two produce together: **a shell taught by one teacher, sitting in a
section advised by another.** Four of the six bugs below are that shape meeting
code written before it existed.

Found by QA sweep, not by a report. The reassignment routes themselves were
never the bug — everything they promise, they do.

| # | Bug | Fix |
|---|---|---|
| 1 | **Removing a teacher part-destroyed them.** Reassign their shell, then delete them: both guards pass (no classes of their own, roster left with the shell), so the route reached `section.deleteMany({teacherId})` — still the parent of the colleague's class, and `Class_sectionId_fkey` is `ON DELETE RESTRICT`. The teardown was a bare sequence of `deleteMany` with **no transaction**, so the constraint fired *after* their rubric templates and grading examples were gone. Admin got a 500 and a teacher who still existed, minus their rubric library. | Refuse up front, naming the blocking class, its teacher and the section. Whole teardown moved into one `$transaction` so any *other* late constraint can't half-delete either. |
| 2 | **Section rename could recreate §8.1.** The create path reuses a section by (name, school, year) via `findFirst` with no `orderBy` — that is the whole §8.1 fix, and it holds only while the name is unique inside a year. Rename enforced nothing. | Clash check mirroring the create path's key. Note the null-year arm: a legacy row with no `schoolYear` skips the year filter entirely rather than comparing `null` to `null` twice, which would hide every same-name section that *has* a year. |
| 3 | **The old adviser's checklist reset to zero.** `setup-status` counted sections and students by `Section.teacherId` alone, while every other teacher-facing route scopes by school or `Class.teacherId`. An established teacher whose section got a new adviser was told they had 0 sections and 0 students, while still teaching those children. | Counts are now `OR: [{ teacherId }, { classes: { some: { teacherId } } }]`. |
| 4 | **Four tenancy rules for one question.** `staffMayAccess` used section ?? teacher; `sectionInSchool` used section **or** teacher; class reassign used teacher **only** (never loaded `section`); analytics and overview used section **only**. A section with a null `schoolId` was editable from the Teachers page and invisible in Analytics. | All on `classSchoolId`'s ladder — section first, teacher as fallback. The `DELETE` class route was missed on the first pass and caught in review: an admin could see a class, rename it and hand it on, then be told "not found" when deleting it. |

Two more in the AI checker, same root cause in a different place — **a set of
columns that has to be changed in more than one spot**:

| # | Bug | Fix |
|---|---|---|
| 5 | **Stale flags survived a photo replacement.** Three write sites each kept their own hand-written list of what to forget, so `rubricScoreNote` landed in all three *success* paths and none of the *reset* paths. Replace the photo on a flagged paper and its red "the AI's own numbers disagree" banner stayed, quoting criteria being set to `null` in the same statement. `rubricParseFailed`, `readingStrategy`, `scoreOutOfRange` and `privacyViolation` had drifted the same way — a cropped re-upload kept the uncropped copy's Privacy Act warning. | One exported `UNGRADED_RESET` naming **every** AI-written column, spread at all five sites (three resets, the success path, and both flag-and-stop writes, which set `privacyViolation: true` back on top). Pinned by an exact-shape test, so the next flag added has one place to go. |
| 6 | **Batch privacy flag could revert a validated grade.** `applyBatchResult`'s privacy branch wrote by id with no status filter, while its sibling `persistGradingResult` guards the identical race with `status: 'PENDING'`. A batch snapshots its queue and runs for minutes; a teacher validating a paper meanwhile had their grade taken back to `PENDING` — and once the reset also nulled `rubricData` and `gradedAt`, their rubric with it, dropping the paper out of "release all" with no error. | `updateMany` scoped to `PENDING`, reporting `superseded` on `count === 0` — the same shape the sibling already used. |

**Not defects.** Admin analytics was read end to end: per-student banding, the
school average, the class summaries and the per-student-per-class double-count
guard are all sound. `ActivityBuilder`'s `resolveDefaultRubric` precedence
(linked template → embedded copy → outputType → any school rubric → built-ins)
and `bandScoreNumber`'s `"36-40" → 40` fallback both hold.

**Tests.** `server/tests/admin-reassign.test.js` — the delete-teacher refusal,
the proof it destroys nothing on the way to refusing, the rename clash, and the
`UNGRADED_RESET` shape. Suite is 302, up from 297.
