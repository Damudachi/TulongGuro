# QA batch: grading guardrails, deadline truth, and mobile layout

**Date:** 2026-08-16
**Status:** design approved, ready to plan
**Scope:** seven reported items from a teacher-side QA pass

## The ask

Seven items, reported together after testing on a phone:

1. Lock advanced edit if there's already a graded activity
2. Overflow of submit button in review dashboard and navbar
3. In teacher, it should have no closed and late?? Or is it better if it has?
4. Remove change points in quick edit of the activity
5. Require lesson/topic in create activity
6. Created a new course shell with a different subject, but it has a different
   colour — is this intentional?
7. Overflow in phone view (`bugs screenshots/overflow.jpg`, `overflow_2.jpg`)

Two of them (3 and 6) were questions rather than instructions. Both are answered
below, and both turned out to have a real defect underneath the question.

They group into five pieces of work. Nothing here is a new feature; every item is
an existing screen telling the teacher something untrue, or refusing to fit on
the device the app was installed on.

---

## A. Guardrails once marks exist (items 1 and 4)

### The problem

An activity's rubric and its `points` total are what a recorded mark *means*.
`hitlScore` is stored as a percentage of the activity total, so changing `points`
after grading silently re-values every mark already taken — a paper marked 20/25
becomes 20/50 with nobody told. Changing the rubric orphans the per-criterion
breakdown that the gradebook, the skill charts and the student's feedback screen
all read.

Both are reachable today from `ClassHub`'s quick-edit modal:

- **Points** is a live `<input type="number">` (`ClassHub.jsx:543`) whose value
  goes straight into the PUT body.
- **Advanced Edit (Edit Rubric)** (`ClassHub.jsx:602`) is an unconditional link
  into `ActivityBuilder`, where the rubric can be rewritten.

The modal already refuses to *delete* an activity that has submissions
(`ClassHub.jsx:482`), so the shape of the guardrail exists — it just stops short
of the two fields that actually corrupt data.

### Decision

**The lock trips on the first `GRADED` submission.** Not on first upload (too
strict — a teacher fixing a rubric mid-upload is doing legitimate work), and not
on release (too late — the mark is already wrong by then). `GRADED` is the exact
moment a recorded mark starts depending on the rubric and the points total.

### Server — the single source of truth

`server/server.js`:

- **`GET /api/activities/:activityId`** (line 5574) returns `gradedCount`
  alongside the activity: a `prisma.submission.count({ where: { activityId,
  status: 'GRADED' } })`. `staffOwnsActivitySchool` already gates the route;
  this only adds a field.
- **`PUT /api/teacher/activities/:activityId`** (line 5144) rejects any request
  that would **change** `rubric` or `points` while `gradedCount > 0`, with
  `code: 'GRADES_RECORDED'` and a 409.

  The comparison is against the stored value, not against presence of the field.
  An identical rubric re-sent by a form that always posts every field is a no-op
  and must still succeed — otherwise Advanced Edit breaks on unrelated saves.
  This mirrors the existing `RUBRIC_REQUIRED` guard directly above it
  (line 5163), which is likewise scoped to requests that actually carry the field.

Everything else on the activity — title, type, topic, deadline, `lateUntil`,
instructions, `maxAttempts` — stays editable forever. None of it changes what a
recorded mark means.

### ClassHub quick-edit modal

`src/pages/teacher/ClassHub.jsx`:

- **Points becomes read-only.** Static text (`100 pts`) with "Changed in Advanced
  Edit" beneath it, replacing the number input at line 543. `points` is dropped
  from the `editForm` state and from the PUT payload entirely, so quick edit can
  no longer send it at all.
- **Advanced Edit locks** when `editActivity.submissions?.some(s => s.status ===
  'GRADED')`. It renders as a disabled block styled to match the
  `Cannot Delete (Has Submissions)` control at the top of the same modal
  (line 483), with its own reason: the rubric is what the existing marks were
  measured against.

No new fetch is needed. `GET /api/classes/:classId` (`server.js:4858`) already
returns `submissions: { select: { id, status, studentId, aiScore, releasedAt } }`
on every activity.

### ActivityBuilder

A teacher can reach `/teacher/activity/edit/:id` directly — from a bookmark, or
from the browser's history after the lock appears. `ActivityBuilder` already
fetches the activity on mount (line 377) and will now receive `gradedCount`.
When it is above zero, the rubric panel renders read-only behind a banner
explaining why, while title, instructions and the deadline fields stay editable.

The UI lock and the server rule are deliberately redundant. The server rule is
what protects the data; the UI lock is what stops a teacher wasting five minutes
rewriting a rubric that will be refused on save.

---

## B. Teacher deadline labels stop lying (item 3)

### The answer to the question

The teacher list should have both Closed *and* Late, because the student list
already does and they currently disagree.

`ClassHub.jsx:281` computes `isPastDeadline(activity.deadline)` and prints
`(Closed)` at line 305. It never looks at `lateUntil`. The four student-facing
screens — `SubmitWork.jsx:420`, `Subjects.jsx:148`, `SubjectActivities.jsx:114`,
`ActivityDetails.jsx:65` — all use `submissionWindow()` from
`src/utils/deadlines.js`, which distinguishes the two dates:

```js
isLate:   isPastDeadline(activity?.deadline),                        // no longer on time
isClosed: isPastDeadline(activity?.lateUntil || activity?.deadline), // no longer accepted
```

So an activity with a late window open reads **"Late accepted"** to the student
and **"(Closed)"** to their teacher, at the same moment, about the same activity.
A teacher told an activity is closed has no reason to expect more uploads, and
`lateUntil` is a field they themselves set in Activity Builder (line 1078).

### Change

`ClassHub.jsx` imports `submissionWindow` instead of `isPastDeadline` and renders
the same three states the student sees:

| State | Teacher label |
|---|---|
| open, on time | *(due date only, no suffix)* |
| past deadline, late window open | `(Late accepted until Oct 3)` — amber |
| past the close date | `(Closed)` — red |

`lateUntil` is a scalar on `Activity` and arrives with the existing include at
`server.js:4855`, so no API change. `formatDeadline` handles the date rendering.

---

## C. Lesson/Topic required when it can be (item 5)

### The constraint

The Lesson / Topic `<select>` in `ActivityBuilder.jsx:1006–1043` is wrapped in
`{(classLessons.length > 0 || depedTopicsApply) && ...}`. The field does not
render at all when the class has no parsed curriculum lessons *and* the DepEd
topic map does not apply — `depedTopics.js` is the MATATAG Grade 6 English map
and nothing else, so a Grade 3 Math class has neither. A blanket "required"
would make activity creation impossible for those classes.

### Decision

**Require it wherever the field is shown; leave the guard in place.** The common
path — a class whose curriculum has been established — is enforced. A class with
no curriculum still creates activities, with no field and no obstacle.

Rejected: a required free-text fallback. It would guarantee every activity
carries *a* label, but an unstructured string feeds neither the rubric
resolution nor the topic-breakdown analytics, which is the reason the field
exists. A required-looking box that buys nothing is worse than no box.

Also rejected: blocking creation until curriculum is set up. It converts a
missing curriculum — an admin's job, on a different screen — into a teacher's
dead end.

### Change

`src/pages/teacher/ActivityBuilder.jsx`:

- the `<select>` at line 1011 gains `required`
- the label at line 1009 loses `(optional)`
- the placeholder option at line 1013 changes from `— Not linked to a lesson —`
  to a non-selectable prompt (`disabled value=""`), so the empty state cannot be
  chosen deliberately
- the helper text at line 1041 drops "Leave blank if neither fits"

### The second create form is dead code

`ClassHub.jsx` carries its own Create New Activity modal (lines 390–471) with the
same lesson dropdown at line 403 (`— Select a lesson (optional) —`). It is
unreachable: `showActivityForm` is initialised `false` at line 31 and the only
other references set it to `false` (lines 90, 464). Nothing in `src/` ever sets
it `true`. The toolbar's Create Activity button routes to `ActivityBuilder`
instead (line 259).

**Recommendation: delete the modal, its `newActivity` state and its
`handleCreateActivity` handler rather than adding `required` to a form no
teacher can open.** Carrying a second, divergent creation path is how an item
like #5 gets half-fixed — the dead form has already drifted (it has no
`lateUntil`, no rubric picker, no `component`, and a four-option type list where
`ActivityBuilder` uses `ACTIVITY_TYPES`). Deleting it also removes the
`POST /api/teacher/activities` JSON branch's only frontend caller, so that route
should be left alone for now, not removed with it.

This is the one judgement call in the batch that goes beyond the seven reported
items. Say so if you would rather leave the dead modal in place — the rest of
the work does not depend on it.

---

## D. Mobile layout (items 2 and 7)

### D1. The review footer sits under the navbar (item 2)

`HITLWorkspace.jsx:1514` is the grading screen's action bar — Validate, Release
to student, Done, Skip, Back — declared `sticky bottom-0 z-10`. The mobile dock
in `TeacherLayout.jsx:164` is `fixed bottom-0 z-40`, and it is painted after the
page. On a phone the buttons that finish a grading run are behind the navbar.

`index.css:150` already carries `.tg-above-dock`, written for precisely this
failure — the comment names "Start AI checking" as the button it was built to
rescue. It lifts a bar's contents by the dock's own height plus
`env(safe-area-inset-bottom)`, and zeroes itself at `md` where there is no dock.
It was never applied here.

**Change:** add `tg-above-dock` to the inner `p-4` button row at
`HITLWorkspace.jsx:1524`. The bar's white background still runs to the bottom of
the screen; only its contents lift.

### D2. The rubric editor overflows sideways (item 7)

Both screenshots trace to one function, `renderCriterionEditor`
(`ActivityBuilder.jsx:759`), which is rendered from three places — manual mode,
template editing, and extracted-rubric editing — so the defect appears wherever
a rubric is edited.

The cause in both cases is that a flex child defaults to `min-width: auto`. A
text `<input>` has a substantial intrinsic width, so `flex-1` never shrinks it
below that; the row's minimum width exceeds the viewport and pushes content out.

**`overflow.jpg` — Scoring Levels rows (line 789).**
`flex gap-2 items-center` holding a `w-28` label, a `w-14` score, and a `flex-1`
description. Minimum row width lands past 370px before the card's `p-3`, the
`pl-2 border-l-2` rail and the page's `p-4` are counted. The description input
runs off the right edge, exactly as photographed.

*Fix:* label and score share a line; the description takes its own line beneath
on a phone, and the three sit side-by-side from `sm:` up. `min-w-0` on the
description input.

**`overflow_2.jpg` — criterion header row (line 763).**
`flex gap-2 items-start` holding a `flex-1` name input, a percent group
(`w-20` number + `%` + `= N pts`), and a trash button. Same minimum-width
failure, but this one escapes the card: the screenshot shows the **whole page**
scrolled sideways, with the "Extracted Rubric (Editable)" heading cut off on the
*left* and the fixed dock — which is viewport-anchored, so it does not move —
still centred. That is a page-level horizontal scroll, not a clipped card.

*Fix:* `flex-col sm:flex-row` on the row, `min-w-0` on the `flex-1` name input,
and the percent group wraps rather than compressing.

---

## E. Card colours stop shuffling (item 6)

### The answer to the question

**No — the colour has nothing to do with the subject.** `Dashboard.jsx:584`
calls `tintFor(idx)`, and `folderTints.js:20` is `FOLDER_TINTS[index % 6]`. The
index is the card's position in `filteredClasses`, not anything about the class.

So the colour is decorative variety, which is intentional. But keying it to
position has a consequence that is not: filtering by subject or grade level
renumbers the list, and every card repaints. The same class is royal blue on the
unfiltered dashboard and lime green once "Filipino" is selected. Creating a new
class shifts colours too. Colour that changes under the user reads as meaning
they have failed to decode.

`src/pages/student/Subjects.jsx:29` has the identical bug in its own palette
(`SUBJECT_THEMES` / `themeFor(idx)`), and additionally carries the raw index into
the detail screen as `selected.themeIndex` (line 281), so the header colour of an
opened subject depends on where it happened to sit in the list.

### Decision

Derive the tint from a stable identity instead of a position. Rejected: mapping
tints to `SUBJECTS`, because a teacher with three Filipino sections would get
three identical cards and lose the ability to tell them apart at a glance —
which is the job the colour is actually doing.

### Change

- `src/constants/folderTints.js` gains `tintForKey(id)` — a small string hash
  into `FOLDER_TINTS`, alongside the existing positional `tintFor` (still used by
  callers that genuinely have no id).
- `Dashboard.jsx:584` uses `tintForKey(cls.id)`. The `[DEMO]` override at the
  same line is untouched.
- `Subjects.jsx` grows the same key-based lookup over `SUBJECT_THEMES`, and
  `selected` carries the subject rather than a `themeIndex`, so the detail
  header (line 76) derives its theme from the same key.

A class then keeps its colour permanently — through filtering, reordering, and
new classes appearing above it.

---

## Testing

`server/tests/` runs on vitest via `server/vitest.config.mjs`, and already
contains `touch-reachability.test.js` — a source-scanning guard written for a
mobile defect that had spread by copy-paste across seven screens. Both mobile
items here are that same shape, so they get the same treatment.

**Behaviour tests**

- `GET /api/activities/:activityId` returns `gradedCount`.
- `PUT /api/teacher/activities/:activityId` returns 409 `GRADES_RECORDED` when a
  changed `rubric` or `points` is sent for an activity with a `GRADED`
  submission.
- The same PUT **succeeds** when the rubric sent is identical to the stored one
  — the regression that would otherwise break every unrelated save.
- The same PUT succeeds for title / deadline / instructions changes regardless
  of graded state.
- `deadlines.test.js` gains the teacher-side window cases: deadline passed with
  `lateUntil` open is late-not-closed; past `lateUntil` is closed; no `lateUntil`
  closes at the deadline.

**Source-scan guards**

- No `sticky bottom-0` action bar in `src/` lacks dock clearance.
- No `flex-1` text input sits in a flex row without `min-w-0`.

**Manual**

The two reported screens re-checked at 390px wide: the rubric editor with a
range rubric and with a percentage rubric, and the HITL grading screen scrolled
to the bottom.

**Commands**

```
cd server && npx vitest run
npm run lint
```

## Out of scope

- The `points`-versus-rubric-weight arithmetic itself. `rubric-arithmetic.test.js`
  covers it and nothing here changes it.
- The `POST /api/teacher/activities` JSON branch, whose only frontend caller is
  the dead modal in section C. Leaving an unused-but-correct route is cheaper
  than proving nothing else reaches it.
- Retro-fixing marks on activities whose points were already changed after
  grading. Unknowable from stored data — the guard is forward-looking.
