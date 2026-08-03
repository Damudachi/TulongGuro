import { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { applySchoolTheme } from './schoolTheme';
import { DEFAULT_PASSING_GRADE } from './grading';

/**
 * Resolves the logged-in user's school. Teachers and admins carry it directly;
 * students inherit it from their section, so the server does the lookup.
 *
 * Seeds from localStorage first so the badge renders instantly on load, then
 * refreshes from the API — an account migrated into a school after its last
 * login would otherwise show a stale name (or none at all).
 *
 * Read-only: this hook never touches the brand variables. Painting them is
 * `useSchoolTheme` below, and only the role layouts may call it — see the note
 * there for why that separation matters.
 */
export default function useSchool() {
  const [school, setSchool] = useState(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return user.school || (user.schoolName ? { id: null, name: user.schoolName } : null);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    let cancelled = false;
    fetch(`${API_URL}/api/users/${user.id}/school`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.success || !d.school) return;
        setSchool(d.school);
        // Keep localStorage in step so the next page load starts correct.
        localStorage.setItem('user', JSON.stringify({ ...user, school: d.school, schoolName: d.school.name }));
      })
      .catch(() => { /* keep the cached value */ });
    return () => { cancelled = true; };
  }, []);

  return school;
}

/**
 * The school's passing grade, for screens that only need the threshold.
 *
 * Falls back to DepEd's 75 only while the school is still loading or on an
 * account with no school attached. Every screen that colours or labels a score
 * should take the number from here rather than writing 75 into a comparison —
 * that is what let a school raise its threshold and still see the old line
 * drawn on the student-facing pages.
 */
export function usePassingGrade() {
  const school = useSchool();
  return school?.passingGrade ?? DEFAULT_PASSING_GRADE;
}

/**
 * Paints the school's brand colour across the app, for the lifetime of the
 * component that calls it. Call it from a role layout and nowhere else.
 *
 * The theme lives on :root, so it is global state with exactly one owner. When
 * a second component also applied it, that component unmounting ran the
 * cleanup and stripped the variables app-wide — while the layout's effect,
 * whose dependencies had not changed, never re-ran to put them back. Because
 * the only other caller was SchoolBadge, which renders on the dashboards, the
 * brand colour survived exactly one screen per role and vanished on the first
 * navigation away. Keeping the effect in the layout ties its lifetime to the
 * role session instead.
 *
 * The cleanup itself is still needed: signing out unmounts the layout, and the
 * login and landing pages sit outside it and must always show default
 * branding.
 */
export function useSchoolTheme() {
  const school = useSchool();

  // Paint on the cached value first so there's no flash of default blue, then
  // again once the API refresh lands.
  useEffect(() => {
    applySchoolTheme(school?.brandColor);
    return () => applySchoolTheme(null);
  }, [school?.brandColor]);

  return school;
}
