# Student Section Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a student moves between sections, their grades, activities and feedback follow them — merged into one subject grade the receiving teacher can file — instead of becoming unreachable.

**Architecture:** An append-only `SectionTransfer` table records when each move happened; `User.sectionId` keeps its exact current meaning ("where they are now"), so no existing read changes semantics. A new pure module `server/transfers.js` decides which prior classes match a target class and which pre-arrival activities to auto-excuse. Every read path that needs merged grades calls one shared function, so they cannot drift apart.

**Tech Stack:** Node/Express (CommonJS), Prisma 5 + PostgreSQL, Vitest 4, React 19 + Vite + Tailwind v4. No TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-09-student-section-transfer-design.md`

## Global Constraints

- **No TypeScript.** Plain JavaScript throughout. `server/` is CommonJS (`require`/`module.exports`); `src/` is ESM.
- **`server/transfers.js` must not import Prisma or Express.** Same rule as `grading.js` and `access.js` — plain objects in, plain values out. The DB lookup stays in the route layer.
- **`isPastDeadline` is injected, never imported.** It is a private function in `server.js` (`server.js:7573`), and `server.js` cannot be pulled into a unit test. Pure functions that need it take it as a parameter.
- **`Section.students` (the Prisma relation) is never widened.** Admin analytics builds its student set from it (`server.js:1757`) and QA test P7 asserts the resulting count. Roster widening happens only in the gradebook endpoint's response shaping.
- **No new `/api/` routes.** Every change rides on an existing endpoint. If a new `/api/teacher/` route is ever added it MUST be added to `ROUTE_MANIFEST` in `server/scripts/verify-route-authorization.js` or `npm run verify` fails.
- **Write paths stay `class: { teacherId }`-scoped.** The receiving teacher gets read access to carried-over work via `staffMayAccess`, and must get **403** on any write to another teacher's class.
- **Baselines that must not regress:** `npx eslint src server` ≤ 75 problems (73 errors, 2 warnings); `npm run verify` green.
- **Migrations are hand-written** into `server/prisma/migrations/<timestamp>_<name>/migration.sql`, matching the existing convention. New columns are nullable with no default so no backfill touches existing rows.
- **All shell commands below run from `server/`** unless the path says otherwise.

---

### Task 1: `server/transfers.js` — the pure decision core

**Files:**
- Create: `server/transfers.js`
- Test: `server/tests/transfers.test.js`

**Interfaces:**
- Consumes: `server/grading.js` (`gradePercentOf`) — already exists.
- Produces:
  - `matchingSourceClasses(candidates, target) → { matched: Class[], reason: string|null }`
  - `duplicateTargetKeys(targetClasses) → string[]`
  - `preArrivalActivityIds(activities, transferredAt, alreadySubmittedActivityIds, isPastDeadline) → string[]`
  - `carriedOverEntries(submissions) → {percent, points, component}[]`
  - Constants `NO_MATCHING_CLASS`, `CLASS_HAS_NO_SUBJECT`

- [ ] **Step 1: Write the failing test**

Create `server/tests/transfers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import transfers from '../transfers.js';

const {
  matchingSourceClasses, duplicateTargetKeys, preArrivalActivityIds,
  carriedOverEntries, NO_MATCHING_CLASS, CLASS_HAS_NO_SUBJECT,
} = transfers;

const cls = (id, subject, gradeLevel = 'Grade 6', schoolYear = '2026-2027') =>
  ({ id, subject, gradeLevel, schoolYear });

describe('matchingSourceClasses', () => {
  it('matches on subject, gradeLevel and schoolYear together', () => {
    const candidates = [cls('a', 'English'), cls('b', 'Science')];
    const { matched, reason } = matchingSourceClasses(candidates, cls('t', 'English'));
    expect(matched.map(c => c.id)).toEqual(['a']);
    expect(reason).toBeNull();
  });

  it('does not match a different school year', () => {
    const candidates = [cls('a', 'English', 'Grade 6', '2025-2026')];
    const { matched, reason } = matchingSourceClasses(candidates, cls('t', 'English'));
    expect(matched).toEqual([]);
    expect(reason).toBe(NO_MATCHING_CLASS);
  });

  it('does not match a different grade level', () => {
    const candidates = [cls('a', 'English', 'Grade 5')];
    expect(matchingSourceClasses(candidates, cls('t', 'English')).reason).toBe(NO_MATCHING_CLASS);
  });

  // An unlabelled class is ambiguous, not a match. Two nulls matching would
  // merge a Maths class into a Science one.
  it('refuses to match when the target has no subject', () => {
    const { matched, reason } = matchingSourceClasses([cls('a', null)], cls('t', null));
    expect(matched).toEqual([]);
    expect(reason).toBe(CLASS_HAS_NO_SUBJECT);
  });

  it('ignores candidates with no subject even when the target has one', () => {
    expect(matchingSourceClasses([cls('a', null)], cls('t', 'English')).reason)
      .toBe(NO_MATCHING_CLASS);
  });

  // A student who moved twice (A -> B -> C) has two prior English classes and
  // both are legitimately theirs. Multiple sources is not an error.
  it('returns every matching source class, not just the first', () => {
    const candidates = [cls('a', 'English'), cls('b', 'English')];
    expect(matchingSourceClasses(candidates, cls('t', 'English')).matched.map(c => c.id))
      .toEqual(['a', 'b']);
  });

  it('survives empty and missing input', () => {
    expect(matchingSourceClasses([], cls('t', 'English')).reason).toBe(NO_MATCHING_CLASS);
    expect(matchingSourceClasses(null, cls('t', 'English')).reason).toBe(NO_MATCHING_CLASS);
  });
});

describe('duplicateTargetKeys', () => {
  // Two English 6 classes in the target section would each claim the same
  // carried-over work, counting it twice.
  it('names a key held by more than one class in the target section', () => {
    expect(duplicateTargetKeys([cls('a', 'English'), cls('b', 'English'), cls('c', 'Science')]))
      .toEqual(['English|Grade 6|2026-2027']);
  });

  it('is empty when every class is distinct', () => {
    expect(duplicateTargetKeys([cls('a', 'English'), cls('b', 'Science')])).toEqual([]);
  });

  it('ignores unlabelled classes, which never match anything anyway', () => {
    expect(duplicateTargetKeys([cls('a', null), cls('b', null)])).toEqual([]);
  });
});

describe('preArrivalActivityIds', () => {
  const ARRIVAL = new Date('2026-08-09T00:00:00Z');
  const before = { id: 'old', createdAt: new Date('2026-08-01T00:00:00Z'), deadline: '2026-08-05' };
  const after = { id: 'new', createdAt: new Date('2026-08-20T00:00:00Z'), deadline: '2026-08-25' };
  const closed = () => true;
  const open = () => false;

  it('excuses an activity assigned before arrival whose deadline has passed', () => {
    expect(preArrivalActivityIds([before], ARRIVAL, [], closed)).toEqual(['old']);
  });

  it('leaves an activity assigned after arrival alone', () => {
    expect(preArrivalActivityIds([after], ARRIVAL, [], closed)).toEqual([]);
  });

  // Assigned before she arrived but still open: she can still do it.
  it('leaves an activity that is still open alone', () => {
    expect(preArrivalActivityIds([before], ARRIVAL, [], open)).toEqual([]);
  });

  // A student returning to a section they were in earlier already has work
  // here, and that work is theirs.
  it('leaves an activity the student has already submitted alone', () => {
    expect(preArrivalActivityIds([before], ARRIVAL, ['old'], closed)).toEqual([]);
  });

  it('survives empty and missing input', () => {
    expect(preArrivalActivityIds([], ARRIVAL, [], closed)).toEqual([]);
    expect(preArrivalActivityIds(null, ARRIVAL, null, closed)).toEqual([]);
  });
});

describe('carriedOverEntries', () => {
  const sub = (percent, points, component) => ({
    status: 'GRADED', hitlScore: percent, archivedAt: null, excusedAt: null,
    activity: { points, component },
  });

  it('produces the shape computeGrade consumes', () => {
    expect(carriedOverEntries([sub(80, 50, 'PT')]))
      .toEqual([{ percent: 80, points: 50, component: 'PT' }]);
  });

  // Matches the export's own default (server.js:8125) and computeGrade's
  // treatment of an unrecognised component.
  it('defaults a null component to Written Work and null points to 100', () => {
    expect(carriedOverEntries([sub(80, null, null)]))
      .toEqual([{ percent: 80, points: 100, component: 'WW' }]);
  });

  it('drops work that is not a grade of record', () => {
    const pending = { status: 'PENDING', aiScore: 90, archivedAt: null, excusedAt: null, activity: { points: 100 } };
    const excused = { status: 'GRADED', hitlScore: 90, archivedAt: null, excusedAt: new Date(), activity: { points: 100 } };
    expect(carriedOverEntries([pending, excused])).toEqual([]);
  });

  it('keeps a validated zero, which is a real mark', () => {
    expect(carriedOverEntries([sub(0, 100, 'WW')]))
      .toEqual([{ percent: 0, points: 100, component: 'WW' }]);
  });

  it('survives empty and missing input', () => {
    expect(carriedOverEntries([])).toEqual([]);
    expect(carriedOverEntries(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/transfers.test.js
```

Expected: FAIL — `Cannot find module '../transfers.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/transfers.js`:

```js
/**
 * transfers.js — what follows a student when they move between sections.
 *
 * Pure, like grading.js and access.js: plain objects in, plain values out. No
 * Prisma and no Express, so every decision here is unit-testable without a
 * database. The lookups live in the route layer, which then asks these
 * functions for the verdict.
 *
 * `isPastDeadline` is injected rather than imported. The server's copy is a
 * private function inside server.js, which cannot be pulled into a test — see
 * the note at the top of tests/deadlines.test.js.
 */

const grading = require('./grading');

/** The target class has no subject, so nothing can be matched to it safely. */
const CLASS_HAS_NO_SUBJECT = 'CLASS_HAS_NO_SUBJECT';
/** Nothing in the student's history teaches this subject at this level/year. */
const NO_MATCHING_CLASS = 'NO_MATCHING_CLASS';

/**
 * The identity a class is merged on.
 *
 * (subject, gradeLevel, schoolYear) — the same key
 * workingAverageAcrossSubjects already groups a student's General Average by,
 * plus the year, because two school years are two different grades.
 *
 * Null subject returns null rather than a key: Class.subject is a controlled
 * vocabulary (SUBJECTS in src/constants/school.js) but is nullable, and
 * treating "unlabelled" as a value would merge a Maths class into a Science
 * one. Unlabelled is ambiguous, and ambiguity is surfaced, never guessed.
 */
function classKey(cls) {
  if (!cls || !cls.subject) return null;
  return `${cls.subject}|${cls.gradeLevel || ''}|${cls.schoolYear || ''}`;
}

/**
 * Every class in `candidates` whose work should count toward `target`.
 *
 * More than one match is not an error: a student who moved twice has two prior
 * classes in the same subject and both are legitimately theirs.
 *
 * @returns {{matched: object[], reason: string|null}} reason is set only when
 *   matched is empty, and names why for the confirm screen.
 */
function matchingSourceClasses(candidates, target) {
  const key = classKey(target);
  if (key === null) return { matched: [], reason: CLASS_HAS_NO_SUBJECT };
  const matched = (candidates || []).filter(c => classKey(c) === key);
  if (matched.length === 0) return { matched: [], reason: NO_MATCHING_CLASS };
  return { matched, reason: null };
}

/**
 * Keys held by more than one class in the target section.
 *
 * Each such key would claim the same carried-over work twice, so the caller
 * surfaces these instead of merging. Unlabelled classes are skipped — they
 * never match anything, so they cannot double-count.
 */
function duplicateTargetKeys(targetClasses) {
  const seen = new Map();
  for (const cls of targetClasses || []) {
    const key = classKey(cls);
    if (key === null) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
}

/**
 * Activities in the section the student is arriving into that they were never
 * present for, and can no longer do.
 *
 * All three conditions must hold:
 *   1. assigned before they arrived;
 *   2. already closed — one still open stays open to them;
 *   3. they have no submission for it, which matters for a student returning
 *      to a section they were in earlier. Work they already did is theirs.
 *
 * @param {(deadline: string|null) => boolean} isPastDeadline injected; see the
 *   module note above.
 */
function preArrivalActivityIds(activities, transferredAt, alreadySubmittedActivityIds, isPastDeadline) {
  const submitted = new Set(alreadySubmittedActivityIds || []);
  const arrival = new Date(transferredAt).getTime();
  return (activities || [])
    .filter(a => a && !submitted.has(a.id))
    .filter(a => new Date(a.createdAt).getTime() < arrival)
    .filter(a => isPastDeadline(a.deadline))
    .map(a => a.id);
}

/**
 * Carried-over submissions as the {percent, points, component} entries
 * computeGrade already consumes, so a merged grade is computed by exactly the
 * same code as an unmerged one.
 *
 * gradePercentOf applies countsAsGrade, so unvalidated AI drafts, archived and
 * excused rows drop out here — and a validated 0 survives, because `??` is not
 * `||`.
 */
function carriedOverEntries(submissions) {
  const entries = [];
  for (const sub of submissions || []) {
    const percent = grading.gradePercentOf(sub);
    if (percent === null) continue;
    entries.push({
      percent,
      points: sub.activity?.points || 100,
      component: sub.activity?.component || 'WW',
    });
  }
  return entries;
}

module.exports = {
  classKey,
  matchingSourceClasses,
  duplicateTargetKeys,
  preArrivalActivityIds,
  carriedOverEntries,
  CLASS_HAS_NO_SUBJECT,
  NO_MATCHING_CLASS,
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/transfers.test.js
```

Expected: PASS, 20 tests.

- [ ] **Step 5: Run the full gate**

```bash
npm run verify
cd .. && npx eslint src server
```

Expected: verify green; eslint at 75 problems or fewer.

- [ ] **Step 6: Commit**

```bash
git add server/transfers.js server/tests/transfers.test.js
git commit -m "feat: add transfers.js, the pure decision core for section moves"
```

---

### Task 2: Migration — `SectionTransfer` and `Submission.transferId`

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260809000000_section_transfer/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.sectionTransfer` model; `Submission.transferId String?`.

- [ ] **Step 1: Add the models to the schema**

In `server/prisma/schema.prisma`, add after the `Section` model:

```prisma
/// When a student moved between sections, and who moved them.
///
/// A User has exactly one Section, so a move repoints that single field and
/// leaves no trace of what came before. Every screen that finds a learner's
/// work by walking Section -> Class -> Activity -> Submission therefore loses
/// what they did before the move, and the section they arrive into shows them
/// MISSING against activities they were never present for. Nothing is deleted
/// by a move; it just becomes unreachable from the places that need it, and
/// misread by the places that find it.
///
/// This is the missing fact. `User.sectionId` still answers "where are they
/// now" and is unchanged; this answers "since when", which is what tells
/// "did not hand it in" from "had already left before it was set".
///
/// Append-only. schoolId is denormalized onto the row for the same reason
/// GradingAuditLog denormalizes studentId/activityId: the record has to stay
/// meaningful after the section it points at is deleted.
model SectionTransfer {
  id            String   @id @default(uuid())
  studentId     String
  /// Null on a learner's first enrolment — they came from nowhere.
  fromSectionId String?
  /// Null when a learner is unassigned rather than moved, which is what the
  /// admin remove-student route already does when they have submitted work.
  toSectionId   String?
  transferredAt DateTime @default(now())
  /// The teacher or admin who did it. Null for a system-generated row.
  actorId       String?
  schoolId      String?
  reason        String?
  createdAt     DateTime @default(now())

  @@index([studentId, transferredAt])
  @@index([fromSectionId])
  @@index([toSectionId])
}
```

And add one field to the `Submission` model, immediately after `excusedReason`:

```prisma
  /// Set only on rows a section transfer created — the pre-arrival activities
  /// auto-excused when a learner joined a section partway through.
  ///
  /// It is what makes a mis-click reversible without an undo screen: moving
  /// the learner back out deletes rows carrying this id that no human has
  /// touched (attemptCount 0, both scores null), and can never reach a mark a
  /// teacher entered. Nullable, so every existing row is "not created by a
  /// transfer" without a backfill.
  transferId            String?
```

- [ ] **Step 2: Write the migration SQL**

Create `server/prisma/migrations/20260809000000_section_transfer/migration.sql`:

```sql
-- Records when a student moved between sections.
--
-- User.sectionId is unchanged and still answers "where are they now". This
-- answers "since when", which is what tells "did not hand it in" apart from
-- "had already left before it was set".
--
-- Additive only: a new table, plus one nullable column with no default, so
-- every existing Submission row is "not created by a transfer" without a
-- backfill and without claiming anything about work already marked.

-- CreateTable
CREATE TABLE "SectionTransfer" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromSectionId" TEXT,
    "toSectionId" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "schoolId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionTransfer_studentId_transferredAt_idx" ON "SectionTransfer"("studentId", "transferredAt");

-- CreateIndex
CREATE INDEX "SectionTransfer_fromSectionId_idx" ON "SectionTransfer"("fromSectionId");

-- CreateIndex
CREATE INDEX "SectionTransfer_toSectionId_idx" ON "SectionTransfer"("toSectionId");

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "transferId" TEXT;
```

- [ ] **Step 3: Verify the schema and migration agree**

```bash
npx prisma validate
npx prisma migrate status
```

Expected: `validate` reports the schema is valid; `migrate status` lists 4 migrations with the new one pending.

- [ ] **Step 4: Apply and regenerate the client**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status
```

Expected: `migrate status` reports "Database schema is up to date" with 4 migrations.

- [ ] **Step 5: Run the full gate**

```bash
npm run verify
```

Expected: green, 217 tests (unchanged — no behaviour has been wired yet).

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260809000000_section_transfer
git commit -m "feat: add SectionTransfer table and Submission.transferId"
```

---

### Task 3: Record the transfer and auto-excuse pre-arrival work

**Files:**
- Modify: `server/server.js` — `enrolStudents` (`~3485-3630`), admin remove-student route (`~2561-2580`)
- Test: `server/tests/transfers.test.js` (append)

**Interfaces:**
- Consumes: `transfers.preArrivalActivityIds`, `prisma.sectionTransfer`, `Submission.transferId`.
- Produces:
  - `recordTransfer(tx, { studentId, fromSectionId, toSectionId, actorId, schoolId, reason })` → the created `SectionTransfer` row
  - `excusePreArrival(tx, { studentId, sectionId, transferId, transferredAt, fromSectionLabel })` → count of rows created
  - `enrolStudents` gains an `actorId` option.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/transfers.test.js`:

```js
describe('the excusal reason is written to the student, not to the system', () => {
  it('names the section they came from and the date', () => {
    expect(transfers.transferExcuseReason('Grade 6 — Masipag', new Date('2026-08-09T02:00:00Z')))
      .toBe('Transferred in from Grade 6 — Masipag on 9 August 2026');
  });

  // A learner enrolled for the first time came from nowhere; the sentence has
  // to still read as a sentence.
  it('handles an arrival with no previous section', () => {
    expect(transfers.transferExcuseReason(null, new Date('2026-08-09T02:00:00Z')))
      .toBe('Enrolled on 9 August 2026');
  });

  // The date a Filipino teacher and pupil see is the Manila one. 9 Aug 2026
  // at 20:00 UTC is already the 10th in Manila.
  it('uses the Manila calendar date, not UTC', () => {
    expect(transfers.transferExcuseReason(null, new Date('2026-08-09T20:00:00Z')))
      .toBe('Enrolled on 10 August 2026');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/transfers.test.js
```

Expected: FAIL — `transfers.transferExcuseReason is not a function`.

- [ ] **Step 3: Add the reason builder to `transfers.js`**

In `server/transfers.js`, before `module.exports`:

```js
/**
 * The sentence a student reads on an auto-excused row.
 *
 * Written to them, not about them — excusedReason is shown on their own
 * gradebook, and "TRANSFER_IN" would be a code where a child needs a reason.
 * Manila calendar date, because that is the day they and their teacher were
 * actually living in; the same reason deadlines resolve in Manila.
 */
function transferExcuseReason(fromSectionLabel, transferredAt) {
  const day = new Date(transferredAt).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric',
  });
  return fromSectionLabel
    ? `Transferred in from ${fromSectionLabel} on ${day}`
    : `Enrolled on ${day}`;
}
```

Add `transferExcuseReason,` to the `module.exports` object.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/transfers.test.js
```

Expected: PASS, 23 tests.

- [ ] **Step 5: Add the two write helpers to `server.js`**

In `server/server.js`, immediately above `async function enrolStudents(` (around line 3485), add:

```js
/**
 * Record that a learner changed section.
 *
 * Called from every place User.sectionId changes — there are three: a new
 * enrolment, a move onto another roster, and the admin unassign. Each writes
 * a row so the history has no gaps; a learner with no rows at all is one who
 * has not moved since this shipped, and is treated as always having been where
 * they are.
 *
 * Takes a transaction client, because a roster change and the excusals it
 * implies have to land together or not at all.
 */
async function recordTransfer(tx, { studentId, fromSectionId, toSectionId, actorId, schoolId, reason }) {
  return tx.sectionTransfer.create({
    data: {
      studentId,
      fromSectionId: fromSectionId || null,
      toSectionId: toSectionId || null,
      actorId: actorId || null,
      schoolId: schoolId || null,
      reason: reason || null,
    },
  });
}

/**
 * Excuse the activities a learner arriving into a section was never present
 * for and can no longer do.
 *
 * Without this they read as MISSING against work set before they existed on
 * the roster — a mark against a child for not doing something they were not
 * there for. Excused is the state that already means exactly this: it leaves
 * the average entirely (computeGrade renormalises), prints as "Excused" in the
 * export, and is not counted as unreviewed. So this reuses it rather than
 * adding a state every screen would have to learn.
 *
 * transfers.preArrivalActivityIds owns the decision; this is the write.
 */
async function excusePreArrival(tx, { studentId, sectionId, transferId, transferredAt, fromSectionLabel }) {
  const activities = await tx.activity.findMany({
    where: { class: { sectionId } },
    select: { id: true, createdAt: true, deadline: true },
  });
  if (activities.length === 0) return 0;

  const existing = await tx.submission.findMany({
    where: { studentId, activityId: { in: activities.map(a => a.id) } },
    select: { activityId: true },
  });

  const toExcuse = transfers.preArrivalActivityIds(
    activities, transferredAt, existing.map(s => s.activityId), isPastDeadline
  );
  if (toExcuse.length === 0) return 0;

  const reason = transfers.transferExcuseReason(fromSectionLabel, transferredAt);
  // createMany rather than a loop: this can be a whole quarter of activities,
  // and retainUntil is not set because an excused row holds no learner work to
  // retain — nothing was submitted.
  const { count } = await tx.submission.createMany({
    data: toExcuse.map(activityId => ({
      studentId, activityId, status: 'PENDING', attemptCount: 0,
      excusedAt: transferredAt, excusedReason: reason, transferId,
    })),
  });
  return count;
}
```

Add the module require near the top of `server.js`, next to the existing `grading`/`access` requires:

```js
const transfers = require('./transfers');
```

- [ ] **Step 6: Wire the move path in `enrolStudents`**

In `server/server.js`, change the signature to accept an actor:

```js
async function enrolStudents(section, studentsList, { schoolId, teacherId, actorId = null, allowMove = false }) {
```

Replace the `prisma.user.update` in the existing-account branch (currently `server.js:3569-3573`) with:

```js
      // The roster change and the excusals it implies land together or not at
      // all. Not the whole function: it hashes passwords for new accounts,
      // which is deliberately slow and has no business holding a transaction
      // open.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: existingAccount.id },
          // schoolId is set here too so an account that predates students
          // carrying one picks it up the first time it is re-enrolled.
          data: { sectionId: section.id, ...(schoolId ? { schoolId } : {}) },
        });
        const transfer = await recordTransfer(tx, {
          studentId: existingAccount.id,
          fromSectionId: currentSection?.id || null,
          toSectionId: section.id,
          actorId, schoolId,
        });
        await excusePreArrival(tx, {
          studentId: existingAccount.id,
          sectionId: section.id,
          transferId: transfer.id,
          transferredAt: transfer.transferredAt,
          fromSectionLabel: currentSection
            ? (currentSection.gradeLevel ? `${currentSection.gradeLevel} — ${currentSection.name}` : currentSection.name)
            : null,
        });
      });
```

And in the new-account branch, after `prisma.user.create` (currently `server.js:3596-3616`), record the first enrolment. A brand-new account has no prior work, so `excusePreArrival` still runs — a learner enrolled into a section partway through the year is in exactly the situation this exists for:

```js
    await prisma.$transaction(async (tx) => {
      const transfer = await recordTransfer(tx, {
        studentId: user.id, fromSectionId: null, toSectionId: section.id, actorId, schoolId,
      });
      await excusePreArrival(tx, {
        studentId: user.id, sectionId: section.id, transferId: transfer.id,
        transferredAt: transfer.transferredAt, fromSectionLabel: null,
      });
    });
```

- [ ] **Step 7: Pass `actorId` at both call sites**

`enrolStudents` is called from the teacher roster route (`~server.js:3767`) and the admin add-students route (`~server.js:2536`). Add `actorId: req.auth.sub` to the options object at both.

- [ ] **Step 8: Wire the admin unassign path**

In the admin remove-student route (`server.js:2575`), replace the bare update with:

```js
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: student.id }, data: { sectionId: null } });
        await recordTransfer(tx, {
          studentId: student.id,
          fromSectionId: section.id,
          toSectionId: null,
          actorId: req.auth.sub,
          schoolId: section.schoolId,
          reason: 'Removed from section',
        });
      });
```

- [ ] **Step 9: Run the full gate**

```bash
npm run verify
cd .. && npx eslint src server
```

Expected: verify green, 223 tests; eslint ≤ 75.

- [ ] **Step 10: Commit**

```bash
git add server/server.js server/transfers.js server/tests/transfers.test.js
git commit -m "feat: record section transfers and auto-excuse pre-arrival work"
```

---

### Task 4: Moving back is the undo

**Files:**
- Modify: `server/server.js` — `excusePreArrival` neighbourhood, add `cleanUpTransferRows`
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: `Submission.transferId`.
- Produces: `cleanUpTransferRows(tx, { studentId, sectionId })` → count deleted.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`, at the end of the file:

```js
// ───────────────────────────────────────────────────────────────────
// Moving a student back out deletes only the rows the move invented
// ───────────────────────────────────────────────────────────────────

describe('a transfer out cleans up only what a transfer in created', () => {
  it('deletes untouched auto-excused rows and nothing else', async () => {
    const { cleanUpTransferRows } = require('../server.js');

    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = { submission: { deleteMany } };

    await cleanUpTransferRows(tx, { studentId: 'stu-1', sectionId: 'sec-a' });

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const { where } = deleteMany.mock.calls[0][0];

    // The four conditions together are what makes this safe. Losing any one of
    // them puts a teacher-entered mark in range of a delete.
    expect(where.studentId).toBe('stu-1');
    expect(where.transferId).toEqual({ not: null });
    expect(where.attemptCount).toBe(0);
    expect(where.aiScore).toBeNull();
    expect(where.hitlScore).toBeNull();
    expect(where.activity).toEqual({ class: { sectionId: 'sec-a' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/route-wiring.test.js -t "transfer out cleans up"
```

Expected: FAIL — `cleanUpTransferRows is not a function`.

- [ ] **Step 3: Write the implementation**

In `server/server.js`, directly after `excusePreArrival`:

```js
/**
 * Undo, without an undo screen.
 *
 * A move that was a mis-click is repaired by moving the learner back through
 * the normal roster flow. What has to be cleaned up is the rows the first move
 * invented — the auto-excused pre-arrival ones — because leaving them behind
 * would show a learner as having "work" in a section they were never really in.
 *
 * All four conditions are load-bearing, and the reason this can be a delete
 * rather than a soft flag:
 *
 *   transferId   not null  -> the system created this row, not a person
 *   attemptCount 0         -> nobody ever submitted against it
 *   aiScore      null      -> the AI never graded it
 *   hitlScore    null      -> no teacher ever entered a mark
 *
 * A row failing any one of them is somebody's work or somebody's judgement and
 * is never in range. If a teacher un-excused a transfer row and marked it, it
 * has a score and survives.
 */
async function cleanUpTransferRows(tx, { studentId, sectionId }) {
  const { count } = await tx.submission.deleteMany({
    where: {
      studentId,
      transferId: { not: null },
      attemptCount: 0,
      aiScore: null,
      hitlScore: null,
      activity: { class: { sectionId } },
    },
  });
  return count;
}
```

Export it for the test by extending the existing export at `server.js:8589`:

```js
module.exports = { app, startServer, cleanUpTransferRows };
```

- [ ] **Step 4: Call it on the way out of a section**

Inside the `enrolStudents` move transaction from Task 3, add a call **before** `tx.user.update`, so the learner is cleaned out of the section they are leaving:

```js
        if (currentSection?.id) {
          await cleanUpTransferRows(tx, { studentId: existingAccount.id, sectionId: currentSection.id });
        }
```

And in the admin unassign transaction from Task 3, before the `tx.user.update`:

```js
        await cleanUpTransferRows(tx, { studentId: student.id, sectionId: section.id });
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "transfer out cleans up"
```

Expected: PASS.

- [ ] **Step 6: Run the full gate and commit**

```bash
npm run verify
git add server/server.js server/tests/route-wiring.test.js
git commit -m "feat: moving a student back deletes only the rows the move invented"
```

---

### Task 5: `carriedOverForClass` — the one shared lookup

**Files:**
- Modify: `server/server.js` — add below `excusePreArrival`
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: `transfers.matchingSourceClasses`, `prisma.sectionTransfer`.
- Produces: `carriedOverForClass(prisma, { classId, studentIds })` → `Map<studentId, Submission[]>`, each submission carrying `activity: { id, title, points, component, deadline, class: { name, section: { name, gradeLevel } } }`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`:

```js
describe('carriedOverForClass', () => {
  it('returns an empty map without querying when no student has moved', async () => {
    const { carriedOverForClass } = require('../server.js');

    const prisma = {
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-b' }) },
      sectionTransfer: { findMany: vi.fn().mockResolvedValue([]) },
      submission: { findMany: vi.fn() },
    };

    const result = await carriedOverForClass(prisma, { classId: 'c1', studentIds: ['s1'] });

    expect(result.size).toBe(0);
    // The N+1 this replaces is the whole point: no student means no query.
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
  });

  it('fetches every student\'s carried work in one query, not one per student', async () => {
    const { carriedOverForClass } = require('../server.js');

    const prisma = {
      class: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-b' }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'old-eng', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' },
          { id: 'old-sci', subject: 'Science', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' },
        ]),
      },
      sectionTransfer: {
        findMany: vi.fn().mockResolvedValue([
          { studentId: 's1', fromSectionId: 'sec-a', toSectionId: 'sec-b' },
          { studentId: 's2', fromSectionId: 'sec-a', toSectionId: 'sec-b' },
        ]),
      },
      submission: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sub1', studentId: 's1', activityId: 'a1', activity: { id: 'a1', classId: 'old-eng' } },
          { id: 'sub2', studentId: 's2', activityId: 'a2', activity: { id: 'a2', classId: 'old-eng' } },
        ]),
      },
    };

    const result = await carriedOverForClass(prisma, { classId: 'c1', studentIds: ['s1', 's2'] });

    expect(prisma.submission.findMany).toHaveBeenCalledTimes(1);
    expect(result.get('s1').map(s => s.id)).toEqual(['sub1']);
    expect(result.get('s2').map(s => s.id)).toEqual(['sub2']);

    // Science is not English: the Science class must never be a source.
    const { where } = prisma.submission.findMany.mock.calls[0][0];
    expect(where.activity.classId.in).toEqual(['old-eng']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/route-wiring.test.js -t "carriedOverForClass"
```

Expected: FAIL — `carriedOverForClass is not a function`.

- [ ] **Step 3: Write the implementation**

In `server/server.js`, after `cleanUpTransferRows`:

```js
/** What a carried-over row has to carry to be displayed and to be graded. */
const CARRIED_OVER_SELECT = {
  id: true, studentId: true, activityId: true, status: true,
  hitlScore: true, aiScore: true, hitlFeedback: true, aiFeedback: true,
  archivedAt: true, excusedAt: true, excusedReason: true, isLate: true,
  gradedAt: true, releasedAt: true,
  activity: {
    select: {
      id: true, title: true, points: true, component: true, deadline: true, classId: true,
      class: { select: { id: true, name: true, section: { select: { id: true, name: true, gradeLevel: true } } } },
    },
  },
};

/**
 * Work these students did in another section that counts toward this class.
 *
 * The single lookup behind the drill-down, the export, the teacher analytics
 * and the confirm-screen preview. They share it so they cannot disagree about
 * a learner's grade — divergence between call sites doing the same sum by hand
 * is what produced several of the grade bugs in HANDOFF.md.
 *
 * Batched over studentIds on purpose. Called per student it would be the same
 * N+1 the teacher analytics rewrite removed (~120 queries -> 3).
 *
 * @returns {Promise<Map<string, object[]>>} studentId -> submissions. Students
 *   with nothing carried over are absent from the map rather than present with
 *   an empty array, so callers can skip them cheaply.
 */
async function carriedOverForClass(prisma, { classId, studentIds }) {
  const empty = new Map();
  if (!classId || !studentIds?.length) return empty;

  const target = await prisma.class.findUnique({
    where: { id: classId },
    select: { id: true, subject: true, gradeLevel: true, schoolYear: true, sectionId: true },
  });
  if (!target) return empty;

  // Sections these learners have actually left. No transfers means nobody has
  // moved, and there is nothing to look for.
  const moves = await prisma.sectionTransfer.findMany({
    where: { studentId: { in: studentIds }, fromSectionId: { not: null } },
    select: { studentId: true, fromSectionId: true },
  });
  const priorSectionIds = [...new Set(
    moves.map(m => m.fromSectionId).filter(id => id && id !== target.sectionId)
  )];
  if (priorSectionIds.length === 0) return empty;

  const candidates = await prisma.class.findMany({
    where: { sectionId: { in: priorSectionIds } },
    select: { id: true, subject: true, gradeLevel: true, schoolYear: true },
  });

  const { matched } = transfers.matchingSourceClasses(candidates, target);
  if (matched.length === 0) return empty;

  const subs = await prisma.submission.findMany({
    where: {
      studentId: { in: studentIds },
      activity: { classId: { in: matched.map(c => c.id) } },
      archivedAt: null,
    },
    select: CARRIED_OVER_SELECT,
  });

  const byStudent = new Map();
  for (const sub of subs) {
    if (!byStudent.has(sub.studentId)) byStudent.set(sub.studentId, []);
    byStudent.get(sub.studentId).push(sub);
  }
  return byStudent;
}
```

Extend the export:

```js
module.exports = { app, startServer, cleanUpTransferRows, carriedOverForClass };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "carriedOverForClass"
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full gate and commit**

```bash
npm run verify
git add server/server.js server/tests/route-wiring.test.js
git commit -m "feat: add carriedOverForClass, the one lookup every merged read shares"
```

---

### Task 6: The receiving teacher can see the carried-over work

**Files:**
- Modify: `server/server.js:7198-7320` — `GET /api/teacher/:teacherId/student/:studentId/gradebook`
- Modify: `src/pages/teacher/GradebookStudent.jsx` — the student drill-down panel (it is the sole consumer of that endpoint, at line 76; `Gradebook.jsx` is the section-level shell and never calls it)
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: `carriedOverForClass`.
- Produces: rows in the existing `rows` array gain `carriedOver: boolean` and `fromSection: string|null`; carried rows also carry `feedback: string|null`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`:

```js
describe('the receiving teacher sees carried-over work read-only', () => {
  const T_RECEIVING = 'teacher-receiving';
  const STUDENT = 'student-maria';

  it('403s when that teacher tries to write to the sending teacher\'s class', async () => {
    // The read is school-scoped via staffMayAccess; the write is not. A
    // receiving teacher who can re-grade a colleague's mark would be able to
    // rewrite a grade of record they never awarded.
    prismaFake.activity.findUnique.mockResolvedValue({
      id: ACTIVITY, class: { teacherId: T1, sectionId: 'sec-a' },
    });

    const res = await call('POST', '/api/teacher/submissions/excuse', {
      token: tokenFor({ id: T_RECEIVING, schoolId: SCHOOL_A }),
      body: { activityId: ACTIVITY, studentId: STUDENT, excused: true, reason: 'x' },
    });

    expect(res.status).toBe(403);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
    expect(prismaFake.submission.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or passes**

```bash
npx vitest run tests/route-wiring.test.js -t "receiving teacher sees carried-over"
```

Expected: PASS immediately — `teacherOwnsActivity` already refuses. This is a **characterisation test**: it pins the behaviour the rest of this task must not break. If it fails, stop and investigate before continuing.

- [ ] **Step 3: Add carried-over rows to the endpoint**

In `server/server.js`, inside `GET /api/teacher/:teacherId/student/:studentId/gradebook`, replace the `res.json` at the end (currently `server.js:7316`) with:

```js
    // ── Work from a section they transferred out of ──
    //
    // The rows above are this teacher's own classes. A learner who moved
    // mid-year did part of the same subject somewhere else, and this teacher is
    // the one who files the combined subject grade — so the marks that grade
    // rests on have to be visible to them, or the number is undefendable to a
    // parent.
    //
    // Read-only throughout. staffMayAccess (access.js) is school-scoped rather
    // than owner-scoped precisely so a colleague can open this; every write
    // path stays teacherId-scoped, so nothing here can be re-graded, excused or
    // released by anyone but the teacher who awarded it.
    const ownClassIds = [...new Set(activities.map(a => a.classId))];
    const carriedRows = [];
    for (const classId of ownClassIds) {
      const carried = await carriedOverForClass(prisma, { classId, studentIds: [studentId] });
      for (const sub of carried.get(studentId) || []) {
        const section = sub.activity?.class?.section;
        carriedRows.push({
          activityId: sub.activity.id,
          activityTitle: sub.activity.title,
          className: sub.activity.class?.name || '',
          deadline: sub.activity.deadline,
          status: grading.isExcused(sub) ? 'EXCUSED' : (sub.isLate ? 'LATE' : 'DONE'),
          grade: grading.gradePercentOf(sub) === null
            ? null
            : Math.round((grading.gradePercentOf(sub) / 100) * (sub.activity.points || 100)),
          totalScore: sub.activity.points || 100,
          submissionId: sub.id,
          excusedReason: sub.excusedReason || null,
          fromPreviousSection: true,
          // Distinct from fromPreviousSection, which the sending teacher's own
          // view already uses. This says "another teacher awarded this, you may
          // read it and nothing more".
          carriedOver: true,
          fromSection: section
            ? (section.gradeLevel ? `${section.gradeLevel} — ${section.name}` : section.name)
            : null,
          feedback: sub.hitlFeedback || sub.aiFeedback || null,
        });
      }
    }

    res.json({ success: true, student, rows: [...visibleRows, ...carriedRows] });
```

Also add `carriedOver: false` and `fromSection: null` to the object literal built in the existing `rows.map` (around `server.js:7291`), so every row has the same shape:

```js
        carriedOver: false,
        fromSection: null,
```

- [ ] **Step 4: Render them in the drill-down**

In `src/pages/teacher/Gradebook.jsx`, find the student drill-down table that maps over `rows`. Split it into the student's own rows and the carried ones, and render the carried group beneath with no action controls:

```jsx
{rows.filter(r => r.carriedOver).length > 0 && (
  <div className="mt-6">
    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
      Carried over from {rows.find(r => r.carriedOver)?.fromSection}
    </h4>
    <p className="text-xs text-slate-500 mb-3">
      Marked by their previous teacher. These count toward the subject grade and
      cannot be changed here.
    </p>
    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
      {rows.filter(r => r.carriedOver).map(r => (
        <div key={r.submissionId} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-brand-slate truncate">{r.activityTitle}</div>
            {r.feedback && <div className="text-xs text-slate-500 truncate">{r.feedback}</div>}
          </div>
          <span className="text-sm font-bold text-brand-slate shrink-0">
            {r.grade === null ? '—' : `${r.grade}/${r.totalScore}`}
          </span>
        </div>
      ))}
    </div>
  </div>
)}
```

Change the existing rows map to `rows.filter(r => !r.carriedOver).map(...)` so carried rows are not also rendered inline.

- [ ] **Step 5: Run the gate**

```bash
npm run verify
cd .. && npx eslint src server && npm run build
```

Expected: verify green; eslint ≤ 75; build succeeds (the >500 kB chunk warning is expected).

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/tests/route-wiring.test.js src/pages/teacher/Gradebook.jsx
git commit -m "feat: show carried-over work in the teacher drill-down, read-only"
```

---

### Task 7: The export computes one merged subject grade

**Files:**
- Modify: `server/server.js:8036-8140` — `GET /api/teacher/:teacherId/gradebook/export`
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: `carriedOverForClass`, `transfers.carriedOverEntries`.
- Produces: no signature change — the sheet gains columns and a metadata line.

- [ ] **Step 1: Write the failing test**

First add the import to the **top** of `server/tests/route-wiring.test.js`, beside the existing `import` lines — ESM imports are hoisted, so one buried mid-file works but trips `import/first` and reads as a mistake:

```js
import transfersModule from '../transfers.js';
```

Then append at the end of the file:

```js
describe('a transferred student\'s exported grade uses their whole subject history', () => {
  it('pools carried entries with own entries before computeGrade', () => {
    const grading = require('../grading.js');
    const POLICY = { WW: 30, PT: 50, QA: 20 };

    // Maria did the Quarterly Assessment in her old section and only one
    // Written Work task since arriving. Grading the new class alone drops QA
    // entirely and renormalises its 20% away.
    const own = [{ percent: 80, points: 100, component: 'WW' }];
    const carried = transfersModule.carriedOverEntries([
      { status: 'GRADED', hitlScore: 60, archivedAt: null, excusedAt: null,
        activity: { points: 100, component: 'QA' } },
    ]);

    const partial = grading.computeGrade(own, POLICY, { transmute: false });
    const merged = grading.computeGrade([...own, ...carried], POLICY, { transmute: false });

    expect(partial.finalGrade).toBe(80);          // QA renormalised away
    expect(merged.componentPercents.QA).toBe(60); // the QA she actually sat
    expect(merged.finalGrade).toBe(72);           // (80*30 + 60*20) / 50
    expect(merged.finalGrade).not.toBe(partial.finalGrade);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "whole subject history"
```

Expected: PASS. This proves the merge arithmetic before any endpoint changes, and is the number Step 3 must produce.

- [ ] **Step 3: Pool the entries in the export**

In `server/server.js`, inside the export's per-class loop, immediately before `const rows = students.map(student => {` (around `server.js:8098`), fetch the carried work once for the whole class:

```js
      // One query for the class, not one per student — the row loop below runs
      // per learner and must not issue a query inside it.
      const carriedByStudent = await carriedOverForClass(prisma, {
        classId: cId,
        studentIds: students.map(s => s.id),
      });
```

`students.map` is currently synchronous. Change it to a sequential loop so the carried columns can be built, replacing `const rows = students.map(student => {` with:

```js
      // Every distinct carried activity in this class, so the sheet has a
      // stable column per one rather than a ragged row per student.
      const carriedActivities = new Map();
      for (const subs of carriedByStudent.values()) {
        for (const sub of subs) {
          if (!carriedActivities.has(sub.activity.id)) carriedActivities.set(sub.activity.id, sub.activity);
        }
      }

      const rows = students.map(student => {
```

Inside the row builder, after the existing `for (const act of activities)` loop and **before** `computeGrade` is called, add:

```js
        // ── Work from a section this learner transferred out of ──
        //
        // The export is the report card, so it is the one place that must not
        // grade a transferred learner on a fragment of the quarter. Without
        // this, a pupil who sat the Quarterly Assessment before moving has QA
        // renormalised away by initialGrade and is graded on whatever the new
        // class happens to have set since — a smaller sample, weighted wrong.
        //
        // Same entry shape and the same computeGrade, so a merged grade is not
        // computed by different code than an unmerged one.
        const carried = carriedByStudent.get(student.id) || [];
        for (const sub of carried) {
          if (grading.isExcused(sub)) {
            row[`carried:${sub.activity.id}`] = 'Excused';
            continue;
          }
          const score = grading.gradePercentOf(sub);
          row[`carried:${sub.activity.id}`] = score === null ? null : Math.round(score * 10) / 10;
        }
        entries.push(...transfers.carriedOverEntries(carried));
```

- [ ] **Step 4: Carry the new data through to the sheet builders**

The sheet builders are a separate scope fed by `classData` (`server.js:8142`). Add `carriedActivities` to that push:

```js
      classData.push({ cls, activities, students, rows, passingGrade: exportPassing, unreviewedCount, useTransmutation, carriedActivities });
```

Add a shared label helper just above `if (format === 'xlsx') {`:

```js
    /** "Sci 6 · Grade 6 — Masipag" — a carried column says where it came from. */
    const carriedHeader = (activity) => {
      const section = activity.class?.section;
      const label = section
        ? (section.gradeLevel ? `${section.gradeLevel} — ${section.name}` : section.name)
        : 'previous section';
      return `${activity.title} · ${label}`;
    };
```

- [ ] **Step 5: Add the columns to the xlsx sheet**

Destructure `carriedActivities` in the xlsx loop (`server.js:8180`):

```js
      for (const { cls, activities, rows, passingGrade: exportPassing, unreviewedCount, useTransmutation, carriedActivities } of classData) {
```

After the `Incomplete:` warning block and before `sheet.addRow([]);`, add the notice:

```js
        // Said in the sheet, because a column whose title names another
        // section is otherwise the only clue that this learner's grade rests
        // on work their current teacher did not set.
        if (carriedActivities.size > 0) {
          const carriedRow = sheet.addRow([
            'Carried over:',
            `${carriedActivities.size} activit${carriedActivities.size === 1 ? 'y' : 'ies'} from a section a student transferred out of. Those columns are headed with the section they came from, and count toward the averages below.`
          ]);
          carriedRow.getCell(1).font = { bold: true, color: { argb: 'FF2563EB' } };
          carriedRow.getCell(2).font = { color: { argb: 'FF2563EB' } };
        }
```

Then extend the three places that walk `activities` in column order. Header row:

```js
        const headers = [
          'Student Name',
          ...activities.map(a => a.title),
          ...[...carriedActivities.values()].map(carriedHeader),
          useTransmutation ? 'Final Grade (transmuted)' : 'Average (%)'
        ];
```

Data rows:

```js
          const dataRow = sheet.addRow([
            row.name,
            ...activities.map(a => row[a.id] !== null ? row[a.id] : '—'),
            ...[...carriedActivities.keys()].map(id => {
              const v = row[`carried:${id}`];
              return v === undefined || v === null ? '—' : v;
            }),
            row.average !== null ? `${row.average}%` : '—'
          ]);
```

Class average row, after the existing `for (const act of activities)` loop:

```js
        for (const activityId of carriedActivities.keys()) {
          // Numbers only, same as above: an excused cell holds the string
          // 'Excused' and would concatenate rather than add.
          const scores = rows.map(r => r[`carried:${activityId}`]).filter(s => typeof s === 'number');
          avgRow.push(scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—');
        }
```

- [ ] **Step 6: Add the columns to the CSV export**

The CSV branch (`server.js:8288`) mirrors the same three points. Destructure `carriedActivities` into its loop, add a `# Carried over: …` comment line alongside the other `#` metadata lines, and append the same carried headers and cells to its header and data rows. Use `carriedHeader` for the titles so the two formats cannot disagree.

- [ ] **Step 7: Run the gate**

```bash
npm run verify
```

Expected: green.

- [ ] **Step 8: Verify by hand**

Follow HANDOFF.md's P1 setup, then move one student between two sections that both teach the same subject, and export the receiving section in **both** formats. Confirm the transferred student's `average` differs from the same student's average computed over the new class alone, that the carried columns are headed with the old section's name, and that the xlsx and CSV agree.

- [ ] **Step 9: Commit**

```bash
git add server/server.js server/tests/route-wiring.test.js
git commit -m "feat: export a transferred student's whole subject history, not a fragment"
```

---

### Task 8: Teacher analytics stop under-measuring a transferred student

**Files:**
- Modify: `server/server.js:6427-6600` — `GET /api/teacher/:teacherId/analytics`
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: `carriedOverForClass`.
- Produces: no new response fields.

> **CORRECTED IN REVIEW — this task's Step 4 as originally written was wrong twice.**
>
> 1. **Pooling must skip the teacher's own classes.** `graded` is scoped
>    `activity.classId IN classIds` across ALL the teacher's classes, so where one
>    teacher takes the subject in both the old and new section, those submissions are
>    already in `byStudent` and pooling them again double-counts — corrupting
>    `avgPercent`, the class average, the bands and the at-risk flag. Skip carried
>    submissions whose `activity.classId` is in `classIds`, as Task 6 does.
>
> 2. **The `transferredOut` flag must NOT be added.** It cannot be correct here:
>    `uniqueStudents` comes from `section.students` (the live roster), so a departed
>    student is never in it to flag, and the only learners the flag can match are
>    those who left *and came back* — dropping a currently-enrolled, possibly
>    struggling child off their own teacher's action list. The requirement is already
>    satisfied structurally; see the spec's "Transferred-out students" section.
>
> Also required: `CARRIED_OVER_SELECT` must gain `subject: true` and `gradeLevel: true`
> on its `class` select, because `workingAverageAcrossSubjects` keys per-subject
> grouping on exactly those. Without them carried work becomes a phantom extra subject.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`:

```js
describe('at-risk detection for a transferred student', () => {
  // One graded item since arriving is not evidence of anything. Flagging on it
  // is noise; hiding a struggling child behind it is worse.
  it('reads their whole subject history, not just post-arrival work', () => {
    const grading = require('../grading.js');
    const POLICY = { WW: 30, PT: 50, QA: 20 };

    const postArrivalOnly = [{ percent: 55, points: 100, component: 'WW' }];
    const withCarried = [
      ...postArrivalOnly,
      { percent: 88, points: 100, component: 'WW' },
      { percent: 90, points: 100, component: 'PT' },
    ];

    expect(grading.computeGrade(postArrivalOnly, POLICY, { transmute: false }).isPassing).toBe(false);
    expect(grading.computeGrade(withCarried, POLICY, { transmute: false }).isPassing).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "at-risk detection for a transferred"
```

Expected: PASS. It pins the arithmetic the endpoint change must produce.

- [ ] **Step 3: Pool carried work into `byStudent`**

In `server/server.js`, after `byStudent` is built and before the `for (const student of uniqueStudents)` loop (around `server.js:6521`), add:

```js
    // ── A learner who transferred in ──
    //
    // `graded` above is scoped to this teacher's classIds, so a pupil who
    // arrived in week 6 is measured on weeks 6 onward alone. That is both a
    // false alarm generator — one mark below the line reads as at-risk — and a
    // way to miss a genuinely struggling child behind too small a sample. The
    // at-risk list is the whole point of this endpoint, so it has to see the
    // subject history the grade actually rests on.
    for (const cls of classes) {
      const carried = await carriedOverForClass(prisma, {
        classId: cls.id,
        studentIds: uniqueStudents.map(s => s.id),
      });
      for (const [studentId, subs] of carried) {
        if (!byStudent.has(studentId)) byStudent.set(studentId, []);
        byStudent.get(studentId).push(...subs);
      }
    }
```

- [ ] **Step 4: Keep transferred-out students out of the action list**

Still in `server.js`, before the `uniqueStudents` loop, resolve who has left:

```js
    // ── A learner who transferred out ──
    //
    // Their marks stay in this teacher's class average, because the average is
    // a record of what happened and they were here when it did. They come off
    // needsSupport, because that is an action list and this child is now
    // somebody else's to act on.
    const sectionIds = [...new Set(classes.map(c => c.sectionId).filter(Boolean))];
    const departures = sectionIds.length
      ? await prisma.sectionTransfer.findMany({
          where: { fromSectionId: { in: sectionIds }, studentId: { in: uniqueStudents.map(s => s.id) } },
          select: { studentId: true },
        })
      : [];
    const transferredOut = new Set(departures.map(d => d.studentId));
```

Then in the loop, add `transferredOut: transferredOut.has(student.id)` to each `studentTrends` entry, and guard the `needsSupport.push` (currently `server.js:6589`):

```js
      if (reasons.length && !transferredOut.has(student.id)) {
        needsSupport.push({ student, avgPercent, reasons });
      }
```

- [ ] **Step 5: Run the gate**

```bash
npm run verify
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/tests/route-wiring.test.js
git commit -m "feat: teacher analytics read a transferred student's whole history"
```

---

### Task 9: Section skill-progress stops rewriting its own history

**Files:**
- Modify: `server/server.js:7143-7157` — `GET /api/teacher/:teacherId/section/:sectionId/skill-progress`
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`:

```js
describe('a section\'s skill-progress timeline is stable when a student leaves', () => {
  const SECTION = 'sec-a';
  const url = `/api/teacher/${T1}/section/${SECTION}/skill-progress`;

  const query = async () => {
    await call('GET', url, { token: tokenFor({ id: T1, schoolId: SCHOOL_A }) });
    return prismaFake.submission.findMany.mock.calls[0][0].where;
  };

  it('scopes by the activity\'s section, never by where the student is now', async () => {
    const where = await query();

    // A submission on this section's activity can only have come from someone
    // enrolled here at the time. `student: { sectionId }` re-tested enrolment
    // against *now*, which is what erased a departed learner's work from the
    // section's past.
    expect(where.activity).toEqual({ class: { teacherId: T1, sectionId: SECTION } });
    expect(where.student).toBeUndefined();
  });

  it('still excludes auto-excused transfer rows, which carry no rubric', async () => {
    const where = await query();
    expect(where.rubricData).toEqual({ not: null });
    expect(where.status).toBe('GRADED');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/route-wiring.test.js -t "skill-progress timeline is stable"
```

Expected: FAIL on the first test — `where.student` is `{ sectionId: SECTION }`, not undefined.

- [ ] **Step 3: Delete the redundant filter**

In `server/server.js:7148-7152`, remove the `student` line and add the note:

```js
      where: {
        status: 'GRADED',
        rubricData: { not: null },
        // Scoped by the activity's section alone, deliberately.
        //
        // There used to be a `student: { sectionId }` filter alongside this.
        // The two were redundant — a submission on this section's activity can
        // only have been made by someone enrolled here at the time — and only
        // one of them was correct. The student filter re-tested enrolment
        // against *now*, so the moment a learner transferred out, every point
        // they had contributed vanished from this section's timeline and the
        // section's past silently changed shape.
        //
        // Auto-excused transfer rows carry no rubricData, so they are already
        // excluded by the filter above.
        activity: { class: { teacherId, sectionId } },
      },
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "skill-progress timeline is stable"
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run verify
git add server/server.js server/tests/route-wiring.test.js
git commit -m "fix: stop erasing a departed student from a section's skill timeline"
```

---

### Task 10: The sending teacher keeps the student, marked transferred out

**Files:**
- Modify: `server/server.js:7165-7192` — `GET /api/teacher/:teacherId/gradebook`
- Modify: `src/pages/teacher/GradebookClass.jsx` — roster rendering (it fetches `/gradebook?classId=` at line 61 and renders the student rows)
- Test: `server/tests/route-wiring.test.js` (append)

**Interfaces:**
- Consumes: `prisma.sectionTransfer`.
- Produces: each `classes[].section.students[]` entry gains `transferredOut: boolean` and `transferredOutAt: string|null`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`:

```js
describe('P7 invariant: a move does not change the admin student count', () => {
  it('never widens the Section.students relation itself', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');

    // Admin analytics builds its student set from this relation and dedupes by
    // id (server.js ~1757); QA test P7 asserts the Students tile and the class
    // spread bar agree. Widening the relation would put a transferred learner
    // in two sections at once and break that. The widening belongs in the
    // gradebook endpoint's response shaping, and only there.
    const adminAnalytics = src.slice(src.indexOf("app.get('/api/admin/:adminId/analytics'"));
    const body = adminAnalytics.slice(0, adminAnalytics.indexOf('\napp.'));
    expect(body).not.toMatch(/sectionTransfer/);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "P7 invariant"
```

Expected: PASS. It is a guard rail for Step 3, which must not violate it.

- [ ] **Step 3: Widen the roster in the gradebook response only**

In `server/server.js`, in `GET /api/teacher/:teacherId/gradebook`, after the `classes` query and before `res.json`:

```js
    // ── Learners who have transferred out ──
    //
    // Section.students is where they are now, so a learner who moved vanishes
    // from their old teacher's roster the instant it happens — along with every
    // mark that teacher personally awarded, and with the class average silently
    // changing shape behind them.
    //
    // Added here, in the response, and NOT to the Prisma relation. Admin
    // analytics builds its school-wide student set from that relation
    // (deduped by id) and QA test P7 asserts the resulting count; widening it
    // would count one child in two sections.
    const sectionIds = [...new Set(classes.map(c => c.sectionId).filter(Boolean))];
    const departures = sectionIds.length
      ? await prisma.sectionTransfer.findMany({
          where: { fromSectionId: { in: sectionIds } },
          select: { studentId: true, fromSectionId: true, transferredAt: true },
          orderBy: { transferredAt: 'desc' },
        })
      : [];

    const departedIds = [...new Set(departures.map(d => d.studentId))];
    const departed = departedIds.length
      ? await prisma.user.findMany({
          where: { id: { in: departedIds }, role: 'STUDENT' },
          select: { id: true, name: true, username: true, sectionId: true },
        })
      : [];
    const departedById = new Map(departed.map(s => [s.id, s]));

    const classesWithDepartures = classes.map(cls => {
      const current = cls.section?.students || [];
      const currentIds = new Set(current.map(s => s.id));
      const left = departures
        .filter(d => d.fromSectionId === cls.sectionId)
        .map(d => ({ ...departedById.get(d.studentId), at: d.transferredAt }))
        // Gone only if they have not come back. A learner moved out and back in
        // is on the roster normally.
        .filter(s => s.id && !currentIds.has(s.id) && s.sectionId !== cls.sectionId);

      const seen = new Set();
      const transferredOut = left.filter(s => !seen.has(s.id) && seen.add(s.id)).map(s => ({
        id: s.id, name: s.name, username: s.username,
        transferredOut: true, transferredOutAt: s.at,
      }));

      return {
        ...cls,
        section: cls.section && {
          ...cls.section,
          students: [
            ...current.map(s => ({ ...s, transferredOut: false, transferredOutAt: null })),
            ...transferredOut,
          ],
        },
      };
    });

    res.json({ success: true, activities, classes: classesWithDepartures });
```

- [ ] **Step 4: Render them greyed in the roster**

In `src/pages/teacher/Gradebook.jsx`, where each student row is rendered in the class roster table, add the muted treatment and the label:

```jsx
<tr className={student.transferredOut ? 'opacity-60' : ''}>
  <td className="px-3 py-2">
    <span className="font-medium text-brand-slate">{student.name}</span>
    {student.transferredOut && (
      <span className="ml-2 text-xs font-medium text-slate-500">
        Transferred out {new Date(student.transferredOutAt).toLocaleDateString('en-GB', {
          timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric',
        })}
      </span>
    )}
  </td>
  {/* existing score cells unchanged — their marks stay intact */}
</tr>
```

- [ ] **Step 5: Run the gate**

```bash
npm run verify
cd .. && npx eslint src server && npm run build
```

Expected: verify green; eslint ≤ 75; build succeeds.

- [ ] **Step 6: Verify P7 by hand**

Admin → Analytics: note the Students tile and the class spread bar total. Move a student between two sections. Reload. Both numbers must be unchanged.

- [ ] **Step 7: Commit**

```bash
git add server/server.js server/tests/route-wiring.test.js src/pages/teacher/Gradebook.jsx
git commit -m "feat: keep transferred-out students on the sending teacher's roster"
```

---

### Task 11: The confirm screen says what will happen

**Files:**
- Modify: `server/server.js` — `enrolStudents` `pendingMoves` push (`~3557`)
- Modify: `src/components/SectionMoveConfirm.jsx`
- Test: `server/tests/transfers.test.js` (append)

**Interfaces:**
- Consumes: `transfers.matchingSourceClasses`, `transfers.duplicateTargetKeys`, `transfers.preArrivalActivityIds`.
- Produces: `buildMovePreview({ sourceClasses, targetClasses, gradeCountByClassId, preArrivalCount })` → `{ carries[], unmatched[], ambiguous[], willExcuse }`; each `pendingMoves[]` entry gains `preview`.

**Why this does not call `carriedOverForClass`.** Every other merged read does, and should. This one cannot: `carriedOverForClass` finds source sections by reading `SectionTransfer` rows, and at preview time the move has not happened, so no such row exists. The preview walks the student's *current* section directly instead. Both still route the actual matching decision through `transfers.matchingSourceClasses`/`classKey`, which is the part that must not diverge — do not "unify" these by making the preview write a speculative transfer row.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/transfers.test.js`:

```js
describe('buildMovePreview', () => {
  const { buildMovePreview } = transfers;
  const src = (id, subject) => ({ id, subject, gradeLevel: 'Grade 6', schoolYear: '2026-2027' });

  it('reports what carries, with the number of grades behind it', () => {
    const preview = buildMovePreview({
      sourceClasses: [src('old-eng', 'English')],
      targetClasses: [src('new-eng', 'English')],
      gradeCountByClassId: { 'old-eng': 4 },
      preArrivalCount: 5,
    });

    expect(preview.carries).toEqual([{ subject: 'English', gradeLevel: 'Grade 6', gradeCount: 4 }]);
    expect(preview.unmatched).toEqual([]);
    expect(preview.ambiguous).toEqual([]);
    expect(preview.willExcuse).toBe(5);
  });

  // A real transfer is often into a section that does not teach the same
  // subjects. It is stated, not refused.
  it('reports work that will not carry, and does not treat it as an error', () => {
    const preview = buildMovePreview({
      sourceClasses: [src('old-sci', 'Science')],
      targetClasses: [src('new-eng', 'English')],
      gradeCountByClassId: { 'old-sci': 3 },
      preArrivalCount: 0,
    });

    expect(preview.carries).toEqual([]);
    expect(preview.unmatched).toEqual([
      { subject: 'Science', gradeCount: 3, reason: NO_MATCHING_CLASS },
    ]);
  });

  it('reports an unlabelled source class as ambiguous rather than guessing', () => {
    const preview = buildMovePreview({
      sourceClasses: [src('old-x', null)],
      targetClasses: [src('new-eng', 'English')],
      gradeCountByClassId: { 'old-x': 2 },
      preArrivalCount: 0,
    });

    expect(preview.ambiguous).toEqual([
      { subject: null, gradeCount: 2, reason: CLASS_HAS_NO_SUBJECT },
    ]);
  });

  // Two English classes in the target would each claim the same work.
  it('reports a duplicated target subject as ambiguous, never merging into both', () => {
    const preview = buildMovePreview({
      sourceClasses: [src('old-eng', 'English')],
      targetClasses: [src('new-eng-a', 'English'), src('new-eng-b', 'English')],
      gradeCountByClassId: { 'old-eng': 4 },
      preArrivalCount: 0,
    });

    expect(preview.carries).toEqual([]);
    expect(preview.ambiguous).toEqual([
      { subject: 'English', gradeCount: 4, reason: 'MULTIPLE_TARGET_CLASSES' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/transfers.test.js -t "buildMovePreview"
```

Expected: FAIL — `buildMovePreview is not a function`.

- [ ] **Step 3: Implement it in `transfers.js`**

Add to `server/transfers.js` before `module.exports`:

```js
/** A target section holding two classes with the same key; see duplicateTargetKeys. */
const MULTIPLE_TARGET_CLASSES = 'MULTIPLE_TARGET_CLASSES';

/**
 * What a move will do, for the confirm screen.
 *
 * SectionMoveConfirm already promises "their account, submitted work and
 * grades travel with them; nothing is deleted". This is what makes that
 * sentence checkable rather than a claim — and what stops "Science did not
 * carry" being discovered at report-card time.
 *
 * Nothing here blocks a move. A transfer into a section that does not teach
 * the same subjects is a normal thing a school decides; refusing it would
 * leave the teacher unable to do what has already been decided.
 */
function buildMovePreview({ sourceClasses, targetClasses, gradeCountByClassId, preArrivalCount }) {
  const counts = gradeCountByClassId || {};
  const dupes = new Set(duplicateTargetKeys(targetClasses));
  const carries = [];
  const unmatched = [];
  const ambiguous = [];

  for (const source of sourceClasses || []) {
    const gradeCount = counts[source.id] || 0;
    const key = classKey(source);

    if (key === null) {
      ambiguous.push({ subject: source.subject ?? null, gradeCount, reason: CLASS_HAS_NO_SUBJECT });
      continue;
    }
    if (dupes.has(key)) {
      ambiguous.push({ subject: source.subject, gradeCount, reason: MULTIPLE_TARGET_CLASSES });
      continue;
    }
    const hit = (targetClasses || []).some(t => classKey(t) === key);
    if (!hit) {
      unmatched.push({ subject: source.subject, gradeCount, reason: NO_MATCHING_CLASS });
      continue;
    }
    carries.push({ subject: source.subject, gradeLevel: source.gradeLevel, gradeCount });
  }

  return { carries, unmatched, ambiguous, willExcuse: preArrivalCount || 0 };
}
```

Add `buildMovePreview,` and `MULTIPLE_TARGET_CLASSES,` to `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/transfers.test.js -t "buildMovePreview"
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Attach the preview to `pendingMoves`**

In `server/server.js`, in `enrolStudents`, replace the `pendingMoves.push({...})` block (`~3557`) with a version that gathers the preview. Because this runs per name, fetch the target section's classes once, above the entry loop:

```js
  // Fetched once for the whole import, not per name: this is the section every
  // pending move would be arriving into.
  const targetClasses = await prisma.class.findMany({
    where: { sectionId: section.id },
    select: { id: true, subject: true, gradeLevel: true, schoolYear: true },
  });
  const targetActivities = await prisma.activity.findMany({
    where: { class: { sectionId: section.id } },
    select: { id: true, createdAt: true, deadline: true },
  });
```

Then the push becomes:

```js
      if (currentSection && currentSection.id !== section.id && !allowMove) {
        const sourceClasses = await prisma.class.findMany({
          where: { sectionId: currentSection.id },
          select: { id: true, subject: true, gradeLevel: true, schoolYear: true },
        });
        const gradedCounts = await prisma.submission.groupBy({
          by: ['activityId'],
          where: {
            studentId: existingAccount.id, status: 'GRADED', archivedAt: null, excusedAt: null,
            activity: { classId: { in: sourceClasses.map(c => c.id) } },
          },
          _count: { _all: true },
        });
        const activityClass = new Map(
          (await prisma.activity.findMany({
            where: { id: { in: gradedCounts.map(g => g.activityId) } },
            select: { id: true, classId: true },
          })).map(a => [a.id, a.classId])
        );
        const gradeCountByClassId = {};
        for (const g of gradedCounts) {
          const classId = activityClass.get(g.activityId);
          if (classId) gradeCountByClassId[classId] = (gradeCountByClassId[classId] || 0) + 1;
        }

        const existingHere = await prisma.submission.findMany({
          where: { studentId: existingAccount.id, activityId: { in: targetActivities.map(a => a.id) } },
          select: { activityId: true },
        });
        const preArrivalCount = transfers.preArrivalActivityIds(
          targetActivities, new Date(), existingHere.map(s => s.activityId), isPastDeadline
        ).length;

        pendingMoves.push({
          name: studentName.trim(),
          username: existingAccount.username,
          fromSectionId: currentSection.id,
          fromSection: currentSection.gradeLevel
            ? `${currentSection.gradeLevel} — ${currentSection.name}`
            : currentSection.name,
          preview: transfers.buildMovePreview({
            sourceClasses, targetClasses, gradeCountByClassId, preArrivalCount,
          }),
        });
        continue;
      }
```

- [ ] **Step 6: Render the preview**

Replace the move list in `src/components/SectionMoveConfirm.jsx` (lines 30-39) with:

```jsx
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-80 overflow-y-auto mb-5">
          {moves.map(m => (
            <div key={m.username} className="px-3 py-3 text-sm">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="font-medium text-brand-slate truncate">{m.name}</span>
                <span className="text-xs text-slate-500 shrink-0">
                  <span className="font-mono">{m.username}</span> · now in {m.fromSection}
                </span>
              </div>
              {m.preview && (
                <ul className="text-xs space-y-0.5 mt-1.5">
                  {m.preview.carries.map(c => (
                    <li key={`c-${c.subject}`} className="text-emerald-700">
                      ✓ {c.subject} — <span className="font-bold">{c.gradeCount} grade{c.gradeCount === 1 ? '' : 's'} carry over</span>
                    </li>
                  ))}
                  {m.preview.unmatched.map(u => (
                    <li key={`u-${u.subject}`} className="text-amber-700">
                      ⚠ {u.subject} — no matching class here, <span className="font-bold">{u.gradeCount} grade{u.gradeCount === 1 ? '' : 's'} will not carry</span>
                    </li>
                  ))}
                  {m.preview.ambiguous.map((a, i) => (
                    <li key={`a-${i}`} className="text-amber-700">
                      ⚠ {a.subject || 'An unlabelled class'} — {a.reason === 'MULTIPLE_TARGET_CLASSES'
                        ? 'more than one class here teaches it'
                        : 'the class has no subject set'}, {a.gradeCount} grade{a.gradeCount === 1 ? '' : 's'} will not carry
                    </li>
                  ))}
                  {m.preview.willExcuse > 0 && (
                    <li className="text-slate-500">
                      ⓘ {m.preview.willExcuse} activit{m.preview.willExcuse === 1 ? 'y' : 'ies'} already closed before they arrive will be marked <span className="font-medium">Excused</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
```

All three call sites (`ManageSections.jsx:286`, `SectionDetail.jsx:99`, `TeacherDetail.jsx:203`) already render this component and need no change.

- [ ] **Step 7: Run the gate**

```bash
npm run verify
cd .. && npx eslint src server && npm run build
```

Expected: verify green, eslint ≤ 75, build succeeds.

- [ ] **Step 8: Verify by hand**

Teacher → Manage Sections → add a roster containing a name already enrolled in another section that teaches at least one different subject. The dialog must name what carries, what does not, and how many activities will be excused — before anything is written.

- [ ] **Step 9: Commit**

```bash
git add server/server.js server/transfers.js server/tests/transfers.test.js src/components/SectionMoveConfirm.jsx
git commit -m "feat: show what a section move will do before it commits"
```

---

### Task 12: Let the owning teacher excuse a student who has since moved

**Files:**
- Modify: `server/server.js:6167-6175` — `POST /api/teacher/submissions/excuse`
- Test: `server/tests/route-wiring.test.js` (append)

**This task is independent and may be dropped.** It fixes a pre-existing gap the transfer work makes more visible, and touches no code the other tasks depend on.

**Interfaces:**
- Consumes: `prisma.sectionTransfer`.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/route-wiring.test.js`:

```js
describe('excusing a student who has since transferred out', () => {
  const url = '/api/teacher/submissions/excuse';

  it('lets the owning teacher excuse work set while the student was enrolled', async () => {
    prismaFake.submission.findUnique.mockResolvedValue({
      id: SUBMISSION, activity: { type: 'Essay', class: { teacherId: T1 } },
    });
    prismaFake.activity.findUnique.mockResolvedValue({
      id: ACTIVITY, class: { teacherId: T1, sectionId: 'sec-a' },
    });
    // She is in sec-b now, but she was in sec-a when this was set.
    prismaFake.user.findUnique.mockResolvedValue({
      id: 'maria', role: 'STUDENT', sectionId: 'sec-b', sessionsValidFrom: null,
    });
    prismaFake.sectionTransfer.findFirst.mockResolvedValue({
      studentId: 'maria', fromSectionId: 'sec-a',
    });
    prismaFake.submission.findFirst.mockResolvedValue({ id: SUBMISSION });

    const res = await call('POST', url, {
      token: tokenFor({ id: T1, schoolId: SCHOOL_A }),
      body: { activityId: ACTIVITY, studentId: 'maria', excused: true, reason: 'Was on school representation' },
    });

    expect(res.status).toBe(200);
    expect(prismaFake.submission.update).toHaveBeenCalled();
  });

  it('still 404s for a student who was never in the section at all', async () => {
    prismaFake.activity.findUnique.mockResolvedValue({
      id: ACTIVITY, class: { teacherId: T1, sectionId: 'sec-a' },
    });
    prismaFake.user.findUnique.mockResolvedValue({
      id: 'stranger', role: 'STUDENT', sectionId: 'sec-z', sessionsValidFrom: null,
    });
    prismaFake.sectionTransfer.findFirst.mockResolvedValue(null);

    const res = await call('POST', url, {
      token: tokenFor({ id: T1, schoolId: SCHOOL_A }),
      body: { activityId: ACTIVITY, studentId: 'stranger', excused: true },
    });

    expect(res.status).toBe(404);
    expect(prismaFake.submission.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/route-wiring.test.js -t "excusing a student who has since transferred"
```

Expected: FAIL on the first test with 404 — the current check compares only against where the student is now.

- [ ] **Step 3: Relax the roster check**

In `server/server.js`, replace the check at `server.js:6172` with:

```js
    // ── "Is this learner on this activity's roster?" ──
    //
    // Their current section is the common answer, but not the only correct
    // one. A learner who transferred out is no longer in this section, and the
    // teacher who set the work is still the only person who can excuse it —
    // the receiving teacher cannot, because every write path is scoped to the
    // owning teacher. Comparing against `sectionId` alone therefore left work
    // nobody at all could correct.
    //
    // Having *been* enrolled here is the honest test, and a learner who was
    // never in this section still fails it.
    const activitySectionId = activity?.class?.sectionId;
    let onRoster = !!student && student.role === 'STUDENT' && student.sectionId === activitySectionId;
    if (!onRoster && student?.role === 'STUDENT' && activitySectionId) {
      const wasEnrolled = await prisma.sectionTransfer.findFirst({
        where: { studentId: student.id, fromSectionId: activitySectionId },
        select: { id: true },
      });
      onRoster = !!wasEnrolled;
    }
    if (!onRoster) {
      return res.status(404).json({ success: false, error: 'That student is not in this activity\'s section.' });
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/route-wiring.test.js -t "excusing a student who has since transferred"
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run verify
git add server/server.js server/tests/route-wiring.test.js
git commit -m "fix: let the owning teacher excuse work for a student who has since moved"
```

---

### Task 13: Update the handoff baselines

**Files:**
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: the final test count and migration count.
- Produces: nothing.

- [ ] **Step 1: Get the real numbers**

```bash
npm run verify
npx prisma migrate status
cd .. && npx eslint src server
```

Record the exact test count from the Vitest summary, the migration count, and the eslint problem count. Do not estimate them.

- [ ] **Step 2: Update the baselines table**

In `HANDOFF.md`, section 1 "Baselines to compare against", update the `npm run verify` row with the new test count and the `npx prisma migrate status` row with the new migration count. Update the eslint row only if the number actually changed.

- [ ] **Step 3: Add a QA item**

Add to section 3, after P10:

```markdown
### P11 — Section transfer

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
```

- [ ] **Step 4: Add to the known-gaps table**

In section 4, add:

```markdown
| **Transfers do not cross schools.** A learner moving to another school gets a new account. | The match key is scoped inside one school's sections, and moving a child's grade history across a tenant boundary is a privacy decision, not a data one. |
| **Transfers before this shipped have no record.** Those learners are treated as always having been in their current section. | Which is exactly what every screen assumed before, so nothing regressed — but a move that happened last term will not show carried-over work. |
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add HANDOFF.md
git commit -m "docs: update baselines and add P11 section-transfer QA"
```

---

## Appendix: full-system verification

After Task 13, run the whole gate once from a clean tree:

```bash
cd server && npm run verify && npx prisma migrate status
cd .. && npx eslint src server && npm run build
```

Then walk HANDOFF.md **P1** (export never contains unvalidated AI grades), **P4** (excused), **P7** (admin counts) and the new **P11** by hand. P1 and P4 matter most here: this plan writes new `Submission` rows with `excusedAt` set and pools new entries into the export's `computeGrade`, which are the two mechanisms those tests exist to protect.
