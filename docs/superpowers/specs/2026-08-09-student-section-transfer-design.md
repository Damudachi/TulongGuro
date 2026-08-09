# Student section transfer — design

**Date:** 9 August 2026
**Status:** approved, ready for implementation planning

---

## 1. The problem

A student belongs to exactly one section (`User.sectionId`). Moving them repoints
that single field. Every screen that finds a learner's work by walking
`Section → Class → Activity → Submission` therefore loses the work they did
before the move, and every screen that lists a section's roster gains a student
who was never present for most of its activities.

None of this deletes data. The submissions survive; they simply become
unreachable from the places that need them, and reachable from places that
misread them.

### What already survives a move

Worth stating, because the temptation during implementation will be to "fix"
these and end up double-counting:

- Submissions are never deleted. They stay pointed at the old `Activity`/`Class`.
- The student's own Subjects page reconstructs prior-section classes and shows
  only activities they have work for (`server.js:7395`+, `isPreviousSection`).
- The student's General Average already merges across the boundary:
  `workingAverageAcrossSubjects` (`server.js:217`) keys on `subject|gradeLevel`,
  **not** `classId`, so old-section English and new-section English land in one
  bucket.
- The *sending* teacher keeps their per-student drill-down via `classIdsWithWork`
  (`server.js:7220`), flagged `fromPreviousSection`.
- The student's own skill-progress (`server.js:7126`) filters on `studentId`
  alone, with no section scoping, so their skill timeline is already continuous.
- Admin analytics (`server.js:1711`) routes per-student averages through
  `workingAverageAcrossSubjects`, so a coordinator already sees the merged number.

### What is broken

1. **The receiving teacher is blind to the prior work.**
   `/api/teacher/:teacherId/student/:studentId/gradebook` is scoped
   `class: { teacherId }`. The new teacher is the one who files the report-card
   grade and cannot see the WW/PT/QA points earned before the transfer.

2. **The export computes the quarter grade from one class only.**
   `/gradebook/export` runs per `classId`/`sectionId`. A student who moved after
   sitting the Quarterly Assessment in the old section gets a grade computed from
   whatever partial components exist in the new class, with `initialGrade`
   silently renormalising the missing weight away.

3. **No transfer date exists anywhere.** The comment at `server.js:7310` names
   this directly: *"Without a record of when they transferred there is no way to
   tell 'did not hand it in' from 'had already left before it was set'."* The old
   side is guarded by dropping unsubmitted prior work; the **new** side is not — a
   transferred-in student shows MISSING against every activity their new class ran
   before they arrived.

4. **Section analytics rewrite history.**
   `/section/:sectionId/skill-progress` filters `student: { sectionId }`, so a
   student leaving retroactively removes their work from the old section's pooled
   timeline. The section's past changes after the fact.

5. **Teacher analytics under-measure a transferred-in student.**
   `/api/teacher/:teacherId/analytics` scopes `graded` to
   `activity.classId IN classIds`, so their `avgPercent` comes from post-arrival
   work only. One graded item can put them on the at-risk list as noise, or hide a
   genuinely struggling child behind too little data.

### Decisions taken

| Question | Decision |
|---|---|
| What happens to old-section work? | **Carries over and merges.** The receiving teacher files one combined subject grade. This is the DepEd Form 137 model. |
| How are classes matched across the move? | **Automatic by `(subject, gradeLevel, schoolYear)`, with a confirmation screen** showing the proposed pairings before the move commits. |
| Pre-arrival activities in the new section? | **Auto-excused**, reusing the existing `excusedAt` mechanism. |
| How much can the receiving teacher see? | **Scores and feedback, read-only.** No re-grading, excusing or releasing another teacher's work. |
| The sending teacher's view? | **Kept, marked "transferred out."** Section A's roster and historical averages stop changing retroactively. |

### Context that shapes the design

- **There is no quarter/grading-period model.** QA is a grading *component*, not
  a period; the grading unit is the whole `Class.schoolYear`. A merge key needs no
  period dimension.
- **`Class.subject` is a controlled vocabulary** — `SUBJECTS` in
  `src/constants/school.js`, rendered as a `<select>` everywhere — so
  `(subject, gradeLevel, schoolYear)` is a reliable automatic match key. It is
  nullable, and older classes may carry `subject: null`.

---

## 2. Approach

**A transfer log, with `User.sectionId` unchanged.**

One append-only table records when each move happened. `User.sectionId` keeps its
exact current meaning — "where they are now" — so none of the roughly forty
existing reads change semantics.

Two approaches were rejected:

- **A full `Enrollment` table replacing `User.sectionId`.** The textbook model,
  and it generalises to a student in two sections at once. Rejected: `sectionId`
  is read across the gradebook, analytics, tenancy checks, enrolment matching and
  the student dashboard, and every one of those becomes a join — on a live system
  whose numbers reach report cards — to buy a multi-section capability nothing
  asks for.
- **Keep deriving from submissions, no new table.** What partly exists today.
  Costs nothing, but structurally cannot deliver three of the five decisions: with
  no transfer date you cannot tell "didn't hand it in" from "wasn't here yet", and
  with no source section you cannot mark Section A's roster.

---

## 3. Data model

```prisma
model SectionTransfer {
  id             String    @id @default(uuid())
  studentId      String
  fromSectionId  String?   // null = first enrolment
  toSectionId    String?   // null = detached (the existing sectionId: null path)
  transferredAt  DateTime  @default(now())
  actorId        String?   // the teacher or admin who moved them
  schoolId       String?   // denormalised, so history survives a section delete
  reason         String?

  @@index([studentId, transferredAt])
  @@index([fromSectionId])
  @@index([toSectionId])
}
```

Plus one nullable column on `Submission`:

```prisma
transferId String?   // set only on rows a transfer auto-created
```

`schoolId` is denormalised onto the transfer row for the same reason
`GradingAuditLog` denormalises `studentId`/`activityId`: the row must stay
meaningful after the section it points at is deleted.

### Write sites

Every place `sectionId` currently changes gains a transfer row. There are three:

| Site | Today | Adds |
|---|---|---|
| `enrolStudents` create (`server.js:3606`) | creates a new account | transfer `null → section` |
| `enrolStudents` link/move (`server.js:3571`) | repoints `sectionId` | transfer `from → to` |
| Admin remove student (`server.js:2575`) | sets `sectionId: null` | transfer `from → null` |

All three run inside a transaction with the auto-excuse writes. A move is atomic:
either the roster changed and the pre-arrival rows were excused, or neither
happened.

### Which pre-arrival activities are auto-excused

In the target section's classes, an activity is auto-excused for this student when
**all three** hold:

1. `activity.createdAt < transferredAt` — it was assigned before they arrived;
2. `isPastDeadline(activity.deadline)` — it is already closed, so it is not
   something they could still do. An activity set before they arrived but still
   open stays open to them;
3. the student has **no existing submission** for it. This matters for a student
   returning to a section they were in earlier: work they already did is theirs
   and is left alone.

The write has the same shape the excuse endpoint already produces
(`server.js:6178`): `excusedAt` set, plus `excusedReason` = *"Transferred in from
Grade 6 — Masipag on 9 August 2026"*. That sentence is shown to the student, so it
is written as a note to them.

Everything downstream already works unchanged: the lilac Excused row, exclusion
from the average, `Excused` in the export, exclusion from the INCOMPLETE count.

### Backfill

None. Existing students get no transfer rows, and a student with no transfer
history is treated as always having been in their current section — which is what
every screen assumes today. Nothing regresses; the new behaviour applies from the
first move after deploy.

---

## 4. The merge — `server/transfers.js`

A new module, following the `grading.js` / `access.js` pattern: pure decisions in
the module, Prisma in the route layer. This keeps the logic unit-testable and
keeps it out of the 8k-line `server.js` that `HANDOFF.md` already flags.

### Pure functions

```
matchClass(candidateClasses, targetClass)
  → the class matching on (subject, gradeLevel, schoolYear).
    Candidates are the classes the student has submissions in, belonging to
    sections they have a transfer *out of*. Their current section's classes
    are never candidates — that work is already the target's own.
    A null subject never matches a null subject — an unlabelled class is
    ambiguous, not a match, and is surfaced at the confirm screen instead.
    More than one match in the target section is also ambiguous, surfaced and
    never silently picked, so carried work cannot be counted twice.

preArrivalActivityIds(activities, transferredAt, alreadySubmittedIds, now)
  → the three-condition rule above.

carriedOverEntries(carriedSubmissions, activities)
  → { percent, points, component } entries, the shape computeGrade already
    consumes.
```

### Thin DB wrapper

```
carriedOverFor(prisma, { studentId, targetClassId })
```

Finds the student's transfer history, resolves source classes through
`matchClass`, and returns their submissions. This is the single function the
drill-down, the export, the teacher analytics and the confirm-screen preview all
call, so the four cannot drift apart — divergence between call sites is the
failure the handoff names as the source of past grade bugs.

### Authorization

No new mechanism. `staffMayAccess` (`access.js:49`) is already school-scoped
rather than owner-scoped, precisely so *"a coordinator or a covering teacher
legitimately opens a colleague's activity"*. Carried-over reads use it.

The `class: { teacherId }` scoping stays on every **write** path, so the receiving
teacher cannot re-grade, excuse or release the sending teacher's work.

### Read paths that change

| Path | Change |
|---|---|
| `student/:studentId/gradebook` (`7198`) | append carried-over rows with `carriedOver: true`, `fromSection`, score and feedback; no action controls |
| `gradebook/export` (`8036`) | `entries` becomes own ∪ carried before `computeGrade`; carried columns headed with the source section |
| `gradebook` (`7165`) | class roster becomes current students ∪ transferred-out, the latter flagged |
| `analytics` (`6427`) | `byStudent` gains carried-over submissions for transferred-in students, so the at-risk line reads their whole subject history; transferred-out students stay in the class average but drop off `needsSupport` |
| `section/:sectionId/skill-progress` (`7143`) | **drop the `student: { sectionId }` filter entirely**, keeping only `activity: { class: { teacherId, sectionId } }` |
| `POST .../students` (`3767`) | returns the confirm-screen preview alongside `pendingMoves` |

The skill-progress fix is a deletion, not an addition. The two filters were
redundant and only one of them was correct: a submission on an activity belonging
to this section's class can only have been made by someone enrolled here at the
time, so `activity.class.sectionId` already expresses "enrolled during the
window" exactly. `student: { sectionId }` added nothing except the retroactive
erasure — it re-tested enrolment against *now* rather than against when the work
was done. Auto-excused rows are already excluded by the endpoint's existing
`rubricData: { not: null }` filter.

### Explicitly unchanged

`workingAverageAcrossSubjects` (`server.js:217`), the student's own
skill-progress (`7126`), and admin analytics (`1711`). All three already merge
correctly across a transfer. Changing them would double-count.

### A pre-existing gap this design does not widen

The excuse endpoint checks `student.sectionId !== activity.class.sectionId`
(`server.js:6172`), so once a student moves, *neither* teacher can excuse their
old-section rows — the sending teacher because the student is off their roster,
the receiving teacher because it is a write on another teacher's class.

This gap exists today. The design does not widen it. Relaxing the check to allow
the owning teacher to act on a student who *was* enrolled when the work was set is
the natural fix and is **in scope** for the implementation plan, as a separate
step from the transfer work.

---

## 5. UI and the move flow

### The preview needs no new endpoint

`POST .../students` already returns `pendingMoves` and writes nothing
(`server.js:3557`), so the preview rides on that same response. One round trip,
and nothing to add to `ROUTE_MANIFEST`.

Each pending move gains:

```js
{
  name, username, fromSectionId, fromSection,      // as today
  preview: {
    carries:   [{ subject: 'English', gradeLevel: 'Grade 6', gradeCount: 4 }],
    unmatched: [{ subject: 'Science', gradeCount: 3, reason: 'NO_MATCHING_CLASS' }],
    ambiguous: [{ subject: null,      gradeCount: 2, reason: 'CLASS_HAS_NO_SUBJECT' }],
    willExcuse: 5
  }
}
```

### `SectionMoveConfirm.jsx`

Grows from a name list into a per-student summary. Its current copy already
promises *"Their account, submitted work and grades travel with them; nothing is
deleted"* — the preview is what makes that sentence checkable.

> **Maria Santos** · `AS-26-0014` · now in Grade 6 — Masipag
> ✓ English 6 → English 6 — **4 grades carry over**
> ⚠ Science 6 — no matching class in Matulungin, **3 grades will not carry**
> ⓘ 5 activities already closed before she arrives will be marked **Excused**

Unmatched and ambiguous subjects are shown but **do not block the move**. A real
transfer is often into a section that does not teach the same subjects, and
refusing it would leave the teacher unable to do what the school has already
decided. They are stated so nobody discovers it at report-card time.

All three call sites already render this one component
(`ManageSections.jsx:286`, `SectionDetail.jsx:99`, `TeacherDetail.jsx:203`), so
they all gain the preview together.

### Moving back is the undo

On transfer *out* of a section, delete rows where:

```
transferId IS NOT NULL AND attemptCount = 0 AND aiScore IS NULL AND hitlScore IS NULL
```

— rows the system created and no human ever touched. A mis-click is repaired by
moving the student back through the normal roster flow. Nothing a teacher entered
is ever in scope for that delete. No undo screen and no new route.

### Remaining screens

- **Gradebook drill-down** — a *Carried over from Grade 6 — Masipag* group under
  the student's own rows: title, component, points, score, feedback. No
  excuse/re-grade/release controls.
- **Gradebook roster** — transferred-out students greyed, labelled
  `Transferred out 9 Aug 2026`, marks intact.
- **Export** — carried columns headed `English 6 · Masipag`, plus a metadata line
  naming the source section, so the sheet says on its face where the numbers came
  from. Sits next to the existing `Incomplete:` notice.
- **Student Subjects** — no change. Prior sections already render via
  `isPreviousSection` (`server.js:7425`), and the auto-excused rows carry the
  reason written for the student.

---

## 6. Non-regression

### The rule that protects everything else

The roster widening in section 4 happens **only in the gradebook endpoint's
response shaping — never on the `Section.students` Prisma relation.**

Admin analytics builds its student set from that relation (`server.js:1757`),
deduped by id. Widening the relation would count a transferred student in both
sections and break QA test **P7**: *"the Students tile and the class spread bar
must total the same number."* Admin analytics reads the relation unchanged.

### Transferred-out students

They stay in the sending teacher's historical averages but leave their at-risk
list. The average is a record of what happened; `needsSupport` is an action list,
and a departed student is no longer that teacher's to act on.

### Migration safety

One new table plus two nullable columns — additive only, no backfill, no writes to
existing rows. This is the fourth migration. `render.yaml` runs `migrate deploy`
behind `npm run verify`, so it cannot ship if the gate fails.

---

## 7. Testing

### New unit tests — `server/tests/transfers.test.js`

Pure functions only, no database:

- `matchClass` — clean match; null subject on either side; two matching classes in
  the target section.
- `preArrivalActivityIds` — each of the three conditions failing independently,
  and all three holding.
- `carriedOverEntries` — the `{ percent, points, component }` shape, including a
  null `component` defaulting to WW.

### Route-level tests

Through the existing `route-wiring.test.js` fake-Prisma harness:

- a move writes the transfer row and excuses exactly the qualifying activities;
- moving back deletes only rows with `transferId` set and untouched
  (`attemptCount` 0, both scores null), never a teacher-entered mark;
- the export's grade for a transferred student equals the pooled `computeGrade`,
  not the post-arrival subset;
- the receiving teacher gets 200 on a carried-over read and **403 on any write**
  to the sending teacher's class;
- P7's invariant asserted directly: the admin student count is unchanged across a
  move;
- a section's skill-progress timeline is byte-identical before and after one of
  its students transfers out — the direct regression test for problem 4.

### Gates that must stay green

- `npm run verify` — grading math, dashboard, route authorization, unit tests
- `npx eslint src server` — at or below the 75-problem baseline
- `band-parity.test.js` — client and server descriptor ladders agree
- `ROUTE_MANIFEST` — as designed there are **no new routes**, which is deliberate

### Baselines to update in `HANDOFF.md`

The 217-test count and the 3-migration count both move.

---

## 8. Out of scope

- A student enrolled in more than one section at once. `User.sectionId` stays
  single-valued; nothing asks for this.
- Transfers between schools. The match key is scoped within one school's sections,
  and cross-tenant grade movement is a separate problem with its own privacy
  questions.
- A dedicated undo screen. Moving the student back is the undo.
- Retroactively creating transfer rows for moves that happened before this ships.
