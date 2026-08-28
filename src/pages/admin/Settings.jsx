import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Lock, Eye, EyeOff, KeyRound, CheckCircle2, ShieldCheck } from 'lucide-react';
import { API_URL, apiFetch, setSession } from '../../config';
import { getStoredUser } from '../../utils/session';
import ThemeToggle from '../../components/ThemeToggle';

/**
 * The admin's own account page.
 *
 * Admin was the one role with no way to change its own password. Every reset
 * control that exists points at somebody else — /admin/admins resets a
 * *co*-admin (the server loads the target through coAdminInSchool, so it cannot
 * be aimed at yourself), the Teachers page resets a teacher, and the platform
 * console refuses an operator resetting their own. So an admin working from a
 * temporary password somebody else chose had no way to replace it, and the only
 * route back was asking a peer to reset it — which hands the new password to a
 * second person, the opposite of what changing it is for.
 *
 * The endpoint has always been role-agnostic and has always required the
 * current password as proof of identity; the teacher, student and platform
 * operator screens already call it. This is the missing screen, not a new
 * capability.
 */

/** Read-only account field — these are not editable here. */
function LockedField({ label, value }) {
  return (
    <div>
      <label className="block text-[10px] font-extrabold text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-semibold flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

export default function AdminSettings() {
  // Read once at first render: the stored user does not change while this page
  // is open, so an effect-then-setState pass only bought an extra render.
  const [user] = useState(getStoredUser);
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [showCurrent, setShowCurrent] = useState(false);
  const [pwError, setPwError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setSaveMsg('');
    // Checked here as well as on the server so the common mistakes are named
    // without a round trip. The server still decides.
    if (passwords.newPass !== passwords.confirm) return setPwError('The two new passwords do not match.');
    if (passwords.newPass.length < 6) return setPwError('Your new password must be at least 6 characters.');
    if (passwords.newPass === passwords.current) return setPwError('Your new password must be different from the current one.');

    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.newPass }),
      });
      const data = await res.json();
      if (!data?.success) {
        setPwError(data?.error || 'That did not work. Please try again.');
        return;
      }
      // The change ends every other session for this account; the token that
      // comes back is minted after that cut-off, so this browser stays signed
      // in. Without writing it back, the admin changing their own password
      // would be the one thrown out to the login screen.
      if (data.token) setSession(getStoredUser(), data.token);
      setPasswords({ current: '', newPass: '', confirm: '' });
      setSaveMsg('Password changed. Any other device you were signed in on has been signed out.');
      setTimeout(() => setSaveMsg(''), 6000);
    } catch {
      setPwError('Could not reach the server. Your password has not been changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">Your account</h1>
        <p className="text-slate-500 text-sm">Your sign-in details and how this console looks</p>
      </div>

      {saveMsg && (
        <div role="status" className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {saveMsg}
        </div>
      )}

      {/* ── Account details ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 mb-6">
        <h2 className="font-bold text-brand-slate mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-navy" /> Account details
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LockedField label="Full Name" value={user?.name || 'N/A'} />
            <LockedField label="Email Address" value={user?.email || user?.username || 'N/A'} />
          </div>
          <LockedField label="School" value={user?.school?.name || user?.schoolName || 'Not set'} />
          {/* Renaming is self-only and already lives on the Admins page, so it
              is pointed at rather than duplicated here — two forms writing the
              same field is how they drift apart. */}
          <p className="text-xs text-slate-500 font-medium">
            Your name is changed on the <Link to="/admin/admins" className="font-bold text-brand-navy hover:underline">School admins</Link> page.
            Your email and school cannot be changed from the console — contact TulongGuro support.
          </p>
        </div>
      </div>

      {/* ── Password ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 mb-6">
        <h2 className="font-bold text-brand-slate mb-1 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-brand-navy" /> Change password
        </h2>
        <p className="text-slate-500 text-sm mb-5">
          If you are still signing in with a temporary password somebody else chose, replace it here.
        </p>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div>
            <label htmlFor="admin-current-pw" className="block text-sm font-medium text-slate-700 mb-1">Current password</label>
            <div className="relative">
              <input id="admin-current-pw" type={showCurrent ? 'text' : 'password'} required
                autoComplete="current-password" value={passwords.current}
                onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
                className="w-full border border-slate-200 px-4 py-2.5 pr-12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
              <button type="button" onClick={() => setShowCurrent(v => !v)}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-navy">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="admin-new-pw" className="block text-sm font-medium text-slate-700 mb-1">New password</label>
            <input id="admin-new-pw" type="password" required autoComplete="new-password"
              value={passwords.newPass}
              onChange={e => setPasswords(p => ({ ...p, newPass: e.target.value }))}
              placeholder="At least 6 characters"
              className="w-full border border-slate-200 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
          </div>
          <div>
            <label htmlFor="admin-confirm-pw" className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
            <input id="admin-confirm-pw" type="password" required autoComplete="new-password"
              value={passwords.confirm}
              onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
              className="w-full border border-slate-200 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
          </div>
          {pwError && (
            <p role="alert" className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {pwError}
            </p>
          )}
          <button type="submit" disabled={busy}
            className="bg-brand-navy text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md disabled:opacity-40 flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Update password
          </button>
          <p className="text-xs text-slate-500">
            Changing this signs you out on every other device you are still logged in on. This one stays signed in.
          </p>
        </form>
      </div>

      {/* ── Appearance ──
          The sidebar carries a compact copy of this control, but the sidebar is
          desktop-only: on a phone this page is the only place the console's
          theme can be changed. */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6">
        <ThemeToggle />
      </div>
    </div>
  );
}
