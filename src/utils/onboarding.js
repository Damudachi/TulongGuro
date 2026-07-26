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

export const ONBOARDING = {
  TEACHER_WELCOME: 'teacher-welcome',
  TEACHER_WALKTHROUGH: 'teacher-walkthrough',
  TEACHER_COPILOT_TIP: 'teacher-copilot-tip',
  STUDENT_WELCOME: 'student-welcome',
};
