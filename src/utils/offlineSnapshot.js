/**
 * offlineSnapshot.js — the activity list a student can still see with no signal.
 *
 * The upload queue (offlineQueue.js) has been able to carry a submission across
 * a dropout for a while, but only from the submit form for an activity the
 * student had already opened. Getting to that form needs the activity list, the
 * list comes from /api/, and the service worker refuses to cache /api/ on
 * purpose — see the rule at the top of public/sw.js, which is right and which
 * this file does not change. So the page keeps its own copy instead, and keeps
 * it deliberately thin.
 *
 * ── What is kept, and what is not ──
 * Kept: what it takes to choose an activity and know whether it is still open.
 * Not kept: mySubmission in any form — status, attempt count, grade, imageUrl.
 *
 * Two reasons, and both of them are about a phone that is not one student's.
 * A shared classroom device must not carry one learner's grade into the next
 * learner's hands. And a grade or a "submitted" tick shown from last week, with
 * no way for the reader to tell it is stale, is worse than showing nothing —
 * the same argument the service worker makes about a teacher's cached roster.
 *
 * The cost is real and is paid on purpose: offline, the app cannot tell whether
 * this student already submitted, so it says so plainly rather than guessing.
 * If they submit again, the server decides on flush and the queue reports back.
 */

const KEY_PREFIX = 'tg_activities_';

/** A saved list older than this is not shown at all. A school year's deadlines
 *  move; a week is long enough to cover a stretch without signal and short
 *  enough that nothing on screen is badly out of date. */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The only fields that ever reach the disk. An allow-list, not a delete-list,
 * so a field added to /api/student/:id/activities later is excluded by default
 * instead of being written to a shared phone until someone notices.
 */
const KEEP = ['id', 'title', 'className', 'type', 'points', 'deadline', 'lateUntil', 'maxAttempts', 'instructions'];

const store = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

const keyFor = (userId) => `${KEY_PREFIX}${userId}`;

function strip(activity) {
  const out = {};
  for (const field of KEEP) {
    if (activity?.[field] !== undefined) out[field] = activity[field];
  }
  return out;
}

/**
 * Save the list this student just fetched. Called after every successful read,
 * so the copy on disk is never older than their last online moment.
 *
 * Silent on failure: this runs off the back of a successful fetch, and a full
 * disk is not a reason to make a working online page report an error.
 */
export function saveActivitySnapshot(userId, activities) {
  const disk = store();
  if (!disk || !userId) return;
  try {
    disk.setItem(keyFor(userId), JSON.stringify({
      savedAt: new Date().toISOString(),
      activities: (activities || []).map(strip),
    }));
  } catch (e) {
    console.warn('[OfflineSnapshot] Could not save the activity list:', e.message);
  }
}

/**
 * The saved list, or null — null covering every reason there is nothing usable
 * to show: never saved, corrupt, too old, or written by a version that stored a
 * different shape. The caller renders its normal empty state for all of them.
 *
 * @returns {{ activities: Array, savedAt: string } | null}
 */
export function readActivitySnapshot(userId) {
  const disk = store();
  if (!disk || !userId) return null;

  let snapshot;
  try {
    snapshot = JSON.parse(disk.getItem(keyFor(userId)) || 'null');
  } catch {
    return null;
  }
  if (!snapshot || !Array.isArray(snapshot.activities)) return null;

  const savedAt = Date.parse(snapshot.savedAt);
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > SNAPSHOT_MAX_AGE_MS) return null;

  return snapshot;
}

/**
 * Drop every student's saved list on this device. Called on sign-out, and it
 * clears all of them rather than only the one signing out: the point is that
 * the next person to pick up the phone finds nothing of the last one's.
 *
 * The upload queue is deliberately left alone. Queued work belongs to the
 * student who made it, not to the session — it carries its own studentId and
 * the server re-checks the token when it finally flushes — so signing out on a
 * borrowed phone must not throw away an essay that has not been sent yet.
 */
export function clearActivitySnapshots() {
  const disk = store();
  if (!disk) return;
  const keys = [];
  for (let i = 0; i < disk.length; i++) {
    const key = disk.key(i);
    if (key?.startsWith(KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => disk.removeItem(key));
}
