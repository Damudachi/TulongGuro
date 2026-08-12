# Student offline uploads

**Date:** 2026-08-12
**Status:** approved, ready to implement

## The report

Two screenshots from a phone with the network off:

1. **Student.** The installed app does not open at all — Chrome's own "You're
   offline" page, with our icon on it. Not a screen we wrote.
2. **Teacher.** The app opens and shows our banner, "You are offline. Uploads
   will be queued automatically." But there is nothing to upload *to*: no class
   shell, no activity. The promise in the banner cannot be kept.

The ask: let a student submit work while offline.

## What already exists

Most of the machinery is built and unused.

- `src/utils/offlineQueue.js` — queues an upload to localStorage as downscaled
  JPEG data URLs, budgeted at 3.5MB, retried five times, dropped on a 4xx with
  the server's reason. All pages of one submission are one job.
- `src/pages/student/SubmitWork.jsx:206` — already calls `enqueue()` when
  `navigator.onLine` is false, and again when a live upload throws while offline.
- `src/layouts/StudentLayout.jsx:34` — already drains the queue on reconnect and
  alerts on dropped jobs.

A student who is offline *and already looking at the submit form for a chosen
activity* can submit today. The gap is everything before that moment.

## Why the gap exists

`public/sw.js` refuses, on purpose, to cache anything under `/api/` or
`/uploads/`. The header explains why: a grade, a deadline, a roster and a
release state are the whole point of the app, a teacher shown yesterday's answer
has no way to tell, and scanned papers should not sit on a shared classroom
phone's disk.

That rule is right, and this design keeps it. But it means the activity list
comes back empty offline, so `SubmitWork` renders "No activities assigned yet"
and there is nothing to select — the queue is unreachable.

Separately, the student device never booted at all, which is its own defect:
`sw.js:92` falls back to `caches.match('/')`, and when that resolves to
`undefined`, `respondWith(undefined)` is a network error and the browser shows
its own offline page. `install` uses `allSettled` (`sw.js:41`) so one failed
`cache.add('/')` on first install leaves a device permanently without a shell,
and nothing repairs it.

## Decisions

| Question | Decision |
|---|---|
| Scope | Student upload, then teacher upload (added after the first round of testing) |
| Where cached activities live | App-managed snapshot in localStorage, not a service-worker rule |
| Snapshot lifetime | Per signed-in user, cleared on logout, expires after 7 days |
| Grades offline | Never cached. No status, no score, no image URL. |
| Learner names offline | Only in the teacher's class snapshot, and only because batch upload cannot attribute a paper without them. Id and name; never LRN or email. |

**Why an app-managed snapshot rather than whitelisting the endpoint in `sw.js`:**
a service-worker rule caches whatever the endpoint returns, grades included,
which is exactly what the file's rule exists to prevent. A snapshot written by
the page lets us choose the fields.

**Not doing:** moving the snapshot or the queue into IndexedDB. It would buy
headroom past localStorage's ~5MB cap, but `offlineQueue.js` already guards its
own budget and refuses jobs rather than throwing. Revisit if quota turns out to
bite in real use.

## Design

### 1. Boot reliably offline — `public/sw.js`

Chain the navigation fallback so it can never resolve to `undefined`: cached `/`
→ cached `/index.html` → a small inline HTML response in our own voice. The
inline response is the floor; a device with an empty cache gets our words, not
the browser's.

Repair a broken shell rather than living with it. Every successful navigation
already writes `cache.put('/')` (`sw.js:89`), so any online navigation heals a
device whose install missed. `activate` re-attempts the shell URLs for the same
reason.

Bump `VERSION` so existing devices install the fixed worker.

### 2. Tell the student — `src/layouts/StudentLayout.jsx`

Port the banner from `TeacherLayout.jsx:141`: `online`/`offline` listeners, a
count from `getQueue()`. Student wording, not teacher wording — "You're offline.
Your work will be saved and sent when you're back" — and, when the queue is not
empty, how many pieces are waiting.

### 3. The snapshot — `src/utils/offlineSnapshot.js` (new)

Keyed `tg_activities_<userId>`, so two students sharing a phone never see each
other's list.

Stored per activity: `id`, `title`, `className`, `type`, `points`, `deadline`,
`lateUntil`, `maxAttempts`, `instructions`. Plus a `savedAt` timestamp on the
envelope.

Deliberately absent: `mySubmission` in any form — status, attempt count, grade,
`imageUrl`. Stripping happens on write, so a field added to the endpoint later
is excluded by default rather than included by accident.

- Written on every successful activities fetch.
- Read only when the fetch fails.
- Ignored when `savedAt` is older than 7 days.
- Deleted by `clearStoredSession()` (`src/utils/session.js:75`) on logout.

### 4. Use it — `src/pages/student/SubmitWork.jsx`

When the fetch at line 45 fails and a fresh snapshot exists, populate the list
from it and mark the page as showing saved data: "Saved list from <date>. You're
offline — you can still submit, and it will send when you're back."

Because `mySubmission` is absent, the page genuinely does not know whether this
student already submitted. It must say so rather than guess, and show the upload
form. `submissionWindow()` reads only `deadline` and `lateUntil`, so it still
works offline and a closed activity stays closed.

Submission then falls into the existing `queueOffline()` path at line 196,
unchanged.

### 5. Errors

The snapshot can be wrong: a deadline moved, attempts were used up on another
device, the activity was deleted. Nothing new is needed —`flushQueue` drops a
job on a 4xx with the server's reason and `StudentLayout.jsx:40` alerts the
student.

What this constrains is wording. Offline the app says "saved on this device" and
"will send when you're back". It never says "submitted", because the server has
not seen it and may yet refuse it.

### 5a. The teacher path (added after testing)

Three snapshots, all under the same lifetime and sign-out rules:

- **Classes** (`tg_teacher_<userId>`) — the dashboard's class list. Counts only,
  never people. Without it `Dashboard.jsx:638` renders the first-run setup
  wizard, so a teacher with twelve classes and no signal was invited to create
  their first one.
- **One class** (`tg_class_<userId>_<classId>`) — its activities and its roster.
  **This is the only place learner names are written to disk.** Batch upload
  cannot attribute a scanned paper without them, so the trade is made
  deliberately and scoped as narrowly as it can be: the teacher's own class, on
  the teacher's own device, id and name only. LRN, email, and everything on a
  submission stay out.
- ClassHub and BatchUpload read these when their fetch fails, and both label
  what they show as a saved copy with the date.

`ClassHub.jsx` also stopped saying "Class not found." on a failed read. That is
a claim about the class; offline the app knows only that it could not ask, and a
teacher who had just seen the class on their dashboard read it as deletion.

### 6. Tests

Following the repo's existing pattern — frontend utilities are tested from
`server/tests` under vitest with stubbed storage globals, as
`session-persistence.test.js` does.

`server/tests/offline-snapshot.test.js`:

- writes and reads back a list
- strips `mySubmission` and any unknown field on write
- keyed per user; student A's snapshot is invisible to student B
- a snapshot older than 7 days reads as absent
- `clearStoredSession()` removes it
- corrupt JSON reads as absent rather than throwing
