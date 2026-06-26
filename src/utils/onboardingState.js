/**
 * Onboarding State Utility
 * Manages per-user onboarding flags in localStorage.
 * All keys are scoped to the current user's ID to prevent
 * cross-account state leakage on shared browsers.
 */

function getCurrentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.id || 'anonymous';
  } catch {
    return 'anonymous';
  }
}

/**
 * Check if a user has already seen/completed an onboarding flag.
 * @param {string} key - The onboarding flag name (e.g., 'studentWelcome', 'teacherGuidedTour')
 * @returns {boolean}
 */
export function hasSeenFlag(key) {
  const userId = getCurrentUserId();
  return localStorage.getItem(`tulongguro_${key}_${userId}`) === 'true';
}

/**
 * Mark an onboarding flag as seen/completed for the current user.
 * @param {string} key - The onboarding flag name
 */
export function markFlagSeen(key) {
  const userId = getCurrentUserId();
  localStorage.setItem(`tulongguro_${key}_${userId}`, 'true');
}

/**
 * Reset an onboarding flag (useful for testing).
 * @param {string} key - The onboarding flag name
 */
export function resetFlag(key) {
  const userId = getCurrentUserId();
  localStorage.removeItem(`tulongguro_${key}_${userId}`);
}

// Standard flag names used across the app
export const FLAGS = {
  STUDENT_WELCOME: 'studentWelcome',
  AI_COPILOT_TOOLTIP: 'aiCopilotTooltip',
  TEACHER_GUIDED_TOUR: 'teacherGuidedTour',
  FIRST_VALIDATE_RELEASE: 'firstValidateRelease',
  EXPLORED_DEMO: 'exploredDemo',
  ONBOARDING_CHECKLIST_DISMISSED: 'onboardingChecklistDismissed',
};
