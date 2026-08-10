# Trophy Room expansion, and five QA defects

**Date:** 2026-08-10
**Status:** approved

Two pieces of work that ship together: five defects found in a full-surface QA
sweep of the three dashboards, and ten new badges — the reason the sweep was
commissioned.

---

## Part 1 — QA defects

Found by cross-checking all 115 frontend API calls against all 103 Express
routes, sweeping every `<button>` for a missing handler, every navigation
target against the router, and every mutation for whether it inspects its own
result. The wiring layer was clean; these five are behavioural.

### 1. Validate can silently fail to save a grade (HIGH)

`src/pages/teacher/HITLWorkspace.jsx:405`. The PUT to
`/api/teacher/submissions/:id/grade` is awaited but its result is never
inspected. `fetch` resolves on 4xx, so a 400 or 403 flows straight into
`setIsApproved(true)`, the first-validation celebration, and — in a queue run —
`goToNext()`. The teacher is told the grade was saved and is moved to the next
paper with nothing written.

The 403 path is reachable, not theoretical: `tests/route-wiring.test.js`
already asserts this endpoint 403s for a teacher who does not own the class,
and carried-over work from a colleague's class is deliberately readable but not
writable.

**Fix:** check `res.ok` and the parsed `success` flag. On failure, surface the
server's own message, leave `isApproved` false, do not celebrate, and do not
advance the queue. This is the only mutation in the app that does not already
do this.

### 2. "Download Your Data" is a dead button (MEDIUM)

`src/pages/student/Settings.jsx:228` carries no `onClick`. It is the only
button in the app with no handler.

**Fix:** implement it against data the learner can already see — their profile,
stars, badges and released grades from `/api/student/:id/dashboard` — and save
it as a JSON file. No new endpoint. Failure is reported rather than silent.

### 3. Settings preferences are inert (MEDIUM)

Student Settings (email/push notifications, Profile Visibility, Show Awards)
and Teacher Settings (bio, notification preferences) write to `localStorage`,
and nothing anywhere reads them back. "Save Changes" reports success; nothing
changes. They are also per-device, the same defect the setup checklist was
rewritten to avoid.

The privacy pair is the sharper problem: there is no public profile in this
application. `student/Profile.jsx` renders the signed-in learner's own record
and is reachable only by them. "Profile Visibility" and "Show Awards on
Profile" therefore govern nothing that exists, while telling a child their
work is hidden.

**Fix:** remove the controls that govern nothing — the Privacy tab in full, and
the notification toggles on both Settings pages. Keep Security (a real password
change) and Data & Privacy (see #2). Removing a control that has never done
anything is not a feature cut; leaving a privacy promise unenforced is a
correctness problem.

### 4. Reset-to-default reports success even when it fails (MEDIUM)

`src/pages/admin/Grading.jsx:87`. `resetPolicy` discards the response and
always flashes "back on the DepEd default", including on a 404 or 403.

**Fix:** read the response, flash only on success, surface the error otherwise —
matching `saveSettings` and `savePolicy` directly above it.

### 5. Grade levels sort lexicographically (LOW)

`admin/Teachers.jsx:126` and `admin/Grading.jsx:106` order "Grade 1, Grade 10,
Grade 2…". Both plain `.sort()` and `localeCompare` do this.

**Fix:** order by position in `GRADE_LEVELS`, the pattern already used and
commented in `teacher/ManageSections.jsx:423` and `admin/Rubrics.jsx:21`.

---

## Part 2 — Ten new badges

Five badges exist. Ten more, chosen so that most are reachable by a learner who
is struggling rather than only by high scorers.

### Data model

Badges are currently derived on every read and stored nowhere. Class rank
breaks that: it depends on classmates, so a badge shown in October could vanish
in June because someone else improved — through no fault of the child holding
it.

New model, and a migration:

```prisma
model StudentBadge {
  id        String   @id @default(uuid())
  studentId String
  badgeId   String
  earnedAt  DateTime @default(now())
  student   User     @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([studentId, badgeId])
  @@index([studentId])
}
```

Conditions are still computed live on each dashboard load. The result is
unioned with what is stored, and anything newly earned is written with
`createMany({ skipDuplicates: true })`. Once earned, a badge is never taken
away — including by a later grade correction, which is the accepted trade.

`onDelete: Cascade` because a deleted learner's badges have no meaning; every
other user relation in the schema that is purely derived does the same.

### Class rank

**Class Champion** — placed in the top 3 of their section by general average.

Ranking reuses `workingAverageAcrossSubjects`, the same function behind the
average the learner already sees, so the two can never disagree. Every
student's average is computed from their released, GRADED work, so the
comparison is like-for-like.

Only the learner's own earned flag crosses the wire. No names, no positions, no
leaderboard — nothing about a classmate reaches any browser.

Two guards keep this off the hot path of the student dashboard:

1. Skipped entirely if the badge is already stored — once earned, never
   recomputed, which is the common case after the first time.
2. Skipped unless the learner has at least 5 graded activities, the same
   volume bar Honor Student already uses.

### The ten

| id | Title | Condition |
|---|---|---|
| `first-steps` | First Steps | First graded activity |
| `class-champion` | Class Champion | Top 3 in your section by general average |
| `comeback-kid` | Comeback Kid | Below passing in a subject, then at or above passing later in that same subject |
| `turnaround` | Turnaround | Below passing, then 90+ in that same subject |
| `steady-climber` | Steady Climber | 3 graded activities in a row, each scoring higher than the last |
| `personal-best` | Personal Best | Beat your own previous best score in a subject |
| `always-on-time` | Always On Time | 5 submissions in a row, none late |
| `all-rounder` | All-Rounder | Graded work in 4 or more subjects |
| `dedicated` | Dedicated | 25 graded activities |
| `strategy-scholar` | Strategy Scholar | 10 personalised reading strategies |

Comeback Kid and Turnaround both compare against the school's own
`passingGrade`, never a hardcoded 75 — consistent with stars and bands.
Ordering for "later", "in a row" and "previous" is by `gradedAt`, falling back
to `createdAt`, and is always scoped within one subject.

### Structure

`computeBadges` currently holds every condition in one function and is already
at the size where that stops being readable. Fifteen conditions make it worse.
Split:

- `server/badges.js` — a new module. One pure function per condition, over a
  normalised array of a learner's graded work, plus the definition table. No
  Prisma, no Express.
- `server/server.js` — keeps the route, the persistence union, and the rank
  query. `computeBadges` becomes a thin call into the module.

Rank enters `badges.js` as a precomputed boolean, not a query, so the module
stays testable without a database.

### Presentation

`src/pages/student/Awards.jsx` needs a style and icon for each new id. It
already falls back gracefully for an unknown id, so the page cannot break on a
badge the client does not recognise — that stays true.

### Testing

`server/tests/badges.test.js`, against the pure module:

- every condition, earned and not earned
- boundaries: exactly at the passing grade, exactly 90 for Turnaround, exactly
  3 for Steady Climber, exactly 5 for Always On Time
- Comeback Kid must not fire across two different subjects
- Comeback Kid must not fire on a *later* score that came *before* the low one
- a learner with no section, and one with no graded work at all, return no
  badges rather than throwing
- rank absent (`null`) is not the same as rank false

Route-level, in the existing `route-wiring.test.js` harness: the dashboard
response carries no classmate data, and an already-stored badge suppresses the
section query.
