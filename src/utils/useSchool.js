import { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { applySchoolTheme } from './schoolTheme';

/**
 * Resolves the logged-in user's school. Teachers and admins carry it directly;
 * students inherit it from their section, so the server does the lookup.
 *
 * Seeds from localStorage first so the badge renders instantly on load, then
 * refreshes from the API — an account migrated into a school after its last
 * login would otherwise show a stale name (or none at all).
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

  // Paint the school's brand colour as soon as we know it — on the cached
  // value first so there's no flash of default blue, then again after refresh.
  useEffect(() => { applySchoolTheme(school?.brandColor); }, [school?.brandColor]);

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
