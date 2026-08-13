# Teacher-authored rubrics

**Date:** 2026-08-13
**Status:** approved by adviser and team, ready to implement
**Branch:** `feature/teacher-authored-rubrics`

## The ask

From our adviser: writing a rubric is part of the teacher's job, so the system
must not generate one. Replace it by asking the school for its own rubric during
curriculum establishment — optional — and when a teacher picks a lesson, suggest
nothing and leave the rubric blank. The school's rubric acts as a template
teachers may reach for.

## The principle

> The AI never authors a rubric. It transcribes rubric documents that humans
> wrote, and it grades against rubrics that humans chose.

Everything below follows from that one sentence, and it is the sentence to give
the panel.

## Four places the AI writes rubrics today

Deleting the obvious one leaves three others running.

1. **The curriculum parser invents them.** `server.js:4703` instructs the model,
   in as many words, to "generate a default grading rubric" per lesson — 3-4
   criteria, 4 bands each.
2. **Those inventions become school policy.** `saveCurriculumRubrics`
   (`server.js:2904`) promotes them into real `RubricTemplate` rows tagged by
   grade and subject, offered to every teacher in the school.
3. **Picking a lesson auto-fills one.** `resolveDefaultRubric`
   (`ActivityBuilder.jsx:109`) is a six-tier cascade whose last tier is "the
   first built-in in the list" — which staples a Grade 6 English rubric onto a
   Grade 3 Math activity.
4. **Grading falls back to one, invisibly.** `server.js:5775` holds a generic
   DepEd essay rubric as a plain string. An activity with no rubric is not
   refused; it is graded against a standard nobody in the school wrote.

The fourth is the one that matters. Without it, "leave the rubric blank" only
moves the AI-written rubric from somewhere teachers can see it to somewhere they
cannot.

## What already exists

`src/pages/admin/Rubrics.jsx` is already a manual School Rubrics page: the admin
types criteria, weights must total 100%, each rubric is tagged by grade level,
subject and output type, and teachers receive them read-only through
`GET /api/teacher/rubric-templates/:teacherId`. Roughly 70% of the replacement is
built. The work is mostly *removing* the AI paths and *routing* admins to author
rubrics at curriculum time.

## Decisions

| Question | Decision |
|---|---|
| How wide is the removal? | **AI authorship only.** Keep AI grading and AI transcription of rubric documents; remove every path where AI writes criteria. |
| AI checking with no rubric? | **Hard block.** Disabled button, explanation, two ways forward. No score, no partial grading, no fallback. |
| How does the admin supply the rubric? | **Optional upload with a review gate** on the curriculum form, plus write-by-hand and pick-existing. |
| Existing AI rubrics in the database? | **Left as they are, unmarked.** Assumes demo data is reset before defense. |

## Design

### 1. Admin — curriculum establishment

`extractLessonsFromCurriculum` (`server.js:4684`) drops `defaultRubric` from its
JSON schema and loses the "generate a rubric" instruction and its two supporting
RULES lines. It extracts title, description, week number and output type.

The Add Curriculum form gains an optional **School rubric** section with three
ways in, all feeding the existing `POST /api/admin/:adminId/rubrics`:

- **Upload** a rubric file, transcribed by the existing extraction path into an
  editable table the admin must review and explicitly save. A transcription alone
  never persists.
- **Write by hand**, using the same criteria editor as the School Rubrics page.
- **Use existing**, picking a rubric already tagged for that grade and subject.

Skipping the section entirely is fine; the curriculum publishes with lessons and
no rubric.

The criteria editor is extracted from `Rubrics.jsx` into a shared
`src/components/RubricEditor.jsx` so the two admin pages do not carry two copies
of the weights-total-100 rule.

`saveCurriculumRubrics`, its call site, and
`POST /api/admin/:adminId/curriculums/:curriculumId/promote-rubrics` are removed.
Their only job was lifting AI-generated rubrics out of lessons.

### 2. Teacher — Activity Builder

`resolveDefaultRubric` and the effect that applies it are deleted. Selecting a
lesson sets the output type and the lesson mapping, nothing more. The rubric card
reads "No rubric set" until the teacher acts.

The picker keeps its existing contents and order — the school's rubrics, then the
teacher's own, then the generic DepEd samples. Everything is *offered*; nothing is
*applied*. This is what lets "the school rubric acts as a template" and "it should
not suggest any rubric" both hold: they only conflict if offered and applied are
the same act.

Saving an activity with no rubric is allowed. Today it is not — three client
checks block it and `resolveActivityRubric` (`server.js:5031`) silently fills one
in server-side for anything that gets past them. Both go. The remaining checks
(every criterion named, weights total 100, total above zero) still fire, but only
once criteria exist.

### 3. Grading — the gate

`rubricContext` starts as `null` rather than a generic essay rubric. Tier 3, the
DepEd topic's recommended template, is deleted. Two tiers survive, both
human-written:

1. The activity's own rubric.
2. The class lesson's rubric — kept only so activities created before this change
   keep working.

When neither resolves, the endpoint returns `409 { code: 'NO_RUBRIC' }` **before
any AI call is made**. Not a degraded grade, not a warning attached to a score —
no grade.

`BatchUpload` and `HITLWorkspace` disable "Start AI checking" and show a card
naming the problem with both ways out, linking back to the activity's rubric
section.

### 4. Copy

Four strings promise AI-written rubrics (`Curriculum.jsx:191`, `:300`,
`Rubrics.jsx:166`) and one badge implies them (`Curriculum.jsx:250`). All
corrected to lessons only.

## Testing

`route-wiring.test.js:1149` currently pins the auto-fill precedence order. It is
inverted: picking a lesson must apply nothing.

Three new tests:

- The curriculum parser's output carries no `defaultRubric`.
- Grading without a rubric returns `NO_RUBRIC` **and the model mock is never
  invoked**. This is the test that makes the guarantee provable rather than
  merely intended.
- An activity saves with `rubric: null`.

## What survives, and why

| Feature | Why |
|---|---|
| AI grades against the rubric | The thesis. Untouched. What changes is that the rubric is always one a human wrote and chose. |
| AI transcribes an uploaded rubric | Data entry, not authorship. A human reviews before it saves. Removing it means typing every criterion by hand. |
| Built-in DepEd sample rubrics | Hand-written by us in `server/rubricTemplates.js`, no AI at any point, labelled "Generic DepEd samples". |

## Risks

1. **Teachers must set a rubric per activity or AI checking is dead.** The school
   rubric library is the entire mitigation. If admins do not populate it,
   teachers feel this immediately.
2. **AI-written rubrics already in the database stay unmarked.** Fine if demo
   data is reset before defense; otherwise "who wrote this rubric?" has no clean
   answer.
3. **The sparkle icon reads as "AI magic"** even on hand-written DepEd templates.
   Cheap to change, easy to forget.
