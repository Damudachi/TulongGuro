/**
 * onboarding.js — per-user "have they seen this yet?" flags.
 *
 * These were previously a mix of global and per-user localStorage keys, so on a
 * shared classroom device the second person to log in would silently skip
 * onboarding the first person had already dismissed. Everything routes through
 * here now so every flag is scoped to the logged-in user.
 */

function currentUserId() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').id || null;
  } catch {
    return null;
  }
}

function flagKey(name) {
  const userId = currentUserId();
  return userId ? `onboarding:${name}:${userId}` : null;
}

/** True when this user has already dismissed the named onboarding step. */
export function hasSeenOnboarding(name) {
  const key = flagKey(name);
  // With no user we can't scope the flag, so don't interrupt with onboarding.
  if (!key) return true;
  return localStorage.getItem(key) === 'true';
}

export function markOnboardingSeen(name) {
  const key = flagKey(name);
  if (key) localStorage.setItem(key, 'true');
}

/** Marks several steps at once — e.g. skipping onboarding for an existing account. */
export function markAllOnboardingSeen(names) {
  names.forEach(markOnboardingSeen);
}

/**
 * Undoes markOnboardingSeen, so a dismissed step can be brought back.
 *
 * Every flag here used to be one-way: dismissing the teacher walkthrough — a
 * "Dismiss" link sitting next to "Next", easy to hit by accident — hid it for
 * good, with no affordance anywhere to reopen it.
 */
export function clearOnboardingSeen(name) {
  const key = flagKey(name);
  if (key) localStorage.removeItem(key);
}

export const ONBOARDING = {
  // Whether the teacher has *hidden* the setup checklist — not whether they
  // have finished it. How far through setup they are is derived from their own
  // rows by GET /api/teacher/:id/setup-status, because a browser flag is a
  // property of the device: the old walkthrough restarted itself on the other
  // staff-room computer and, once dismissed, could never be got back.
  TEACHER_SETUP_HIDDEN: 'teacher-setup-hidden',
  TEACHER_COPILOT_TIP: 'teacher-copilot-tip',
  STUDENT_WELCOME: 'student-welcome',
};
