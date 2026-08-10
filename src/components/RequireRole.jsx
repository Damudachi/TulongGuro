import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { guardVerdict } from '../utils/session';

/**
 * Gate around a role's screens.
 *
 * The decision lives in session.js as a pure function and is tested there;
 * this is only the wiring, deliberately kept to the two things a component has
 * to do that a function cannot.
 *
 * ── Why a re-check on pageshow ──
 * Signing out navigates to /login with a full page load, so returning here
 * with the forward button can come out of the browser's back/forward cache.
 * A bfcache restore does not re-mount React — the whole page resumes exactly
 * as it was left, guard included — so a mount-time check alone would let a
 * signed-out dashboard sit on screen. `pageshow` with `persisted` set is the
 * only signal that this happened.
 *
 * The re-check is a state bump rather than a redirect of its own, so the
 * verdict is still made in one place.
 */
export default function RequireRole({ role, children }) {
  const location = useLocation();
  const [, recheck] = useState(0);

  useEffect(() => {
    const onShow = (event) => { if (event.persisted) recheck(n => n + 1); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const verdict = guardVerdict(role);
  if (verdict.allow) return children;

  // `replace` so the screen they were refused does not stay in history for the
  // back button to offer again. `state` lets /login send them onward after a
  // successful sign-in rather than dumping them on a dashboard.
  return <Navigate to={verdict.to} replace state={{ from: location.pathname }} />;
}
