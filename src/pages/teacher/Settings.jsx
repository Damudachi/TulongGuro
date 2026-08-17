import { useState } from 'react';
import { User, Shield, Lock, Eye, EyeOff, Loader2, Palette } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { API_URL, apiFetch, setSession } from '../../config';
import ThemeToggle from '../../components/ThemeToggle';

/**
 * The Bio field and the Notifications tab used to live here. Both wrote to
 * localStorage and nothing read them back: the bio was captioned "tell your
 * students a bit about yourself" and no student page has ever displayed it,
 * and there is no notification delivery for the toggle to govern. Both
 * reported "Saved!" and changed nothing, on one device only. Removed rather
 * than left as decoration — what remains here is what actually takes effect.
 */

/** Read-only account field — these are set by the school admin. */
function LockedField({ label, value }) {
  return (
    <div>
      <label className="block text-[10px] font-extrabold text-navy-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="px-4 py-3 bg-cream-100 border-2 border-cream-200 rounded-2xl text-sm text-navy-600 font-bold flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-navy-400 shrink-0" />
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  // Read once at first render rather than in an effect — the stored user does
  // not change while this page is open, so a load-then-setState pass only
  // bought an extra render.
  const [user] = useState(() => JSON.parse(localStorage.getItem('user') || '{}'));
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  /**
   * Change the signed-in teacher's password.
   *
   * This used to validate the two fields, skip the network entirely and report
   * "Password updated successfully!" — so a teacher handed a temporary password
   * by their admin believed they had replaced it while the temporary one stayed
   * live. It now goes to the server, and only says so when the server agrees.
   */
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (passwords.newPass !== passwords.confirm) return setPwError('The two new passwords do not match.');
    if (passwords.newPass.length < 6) return setPwError('Your new password must be at least 6 characters.');

    setPwBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.newPass }),
      });
      const data = await res.json();
      if (!data.success) { setPwError(data.error || 'That did not work. Please try again.'); return; }
      // The change ends every other session for this account; the token that
      // comes back is minted after that cut-off so this browser stays signed in.
      if (data.token) setSession(JSON.parse(localStorage.getItem('user') || '{}'), data.token);
      setPasswords({ current: '', newPass: '', confirm: '' });
      setSaveMsg('Password changed. Any other device you were signed in on has been signed out.');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch {
      setPwError('Network error. Please try again.');
    } finally {
      setPwBusy(false);
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile Information', short: 'Profile', icon: User },
    { id: 'appearance', label: 'Appearance', short: 'Look', icon: Palette },
    { id: 'security', label: 'Security & Password', short: 'Security', icon: Shield },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your profile and preferences" />

      <div className="tg-page pt-4 md:pt-0 max-w-4xl">
        {saveMsg && (
          <div role="status" className="mb-4 bg-aqua-100 border-2 border-aqua-200 text-aqua-800 px-4 py-3 rounded-2xl text-sm font-bold">
            ✓ {saveMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* ── Tab rail: segmented on mobile, list on desktop ── */}
          <div className="md:col-span-1">
            <div className="flex md:flex-col gap-1.5 bg-white md:bg-transparent p-1.5 md:p-0 rounded-2xl border-2 md:border-0 border-cream-200">
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 px-3 py-2.5 md:px-4 md:py-3
                              text-sm font-bold rounded-xl md:rounded-2xl transition-all ${
                    activeTab === tab.id
                      ? 'bg-royal-500 text-white md:shadow-pop'
                      : 'text-navy-500 hover:bg-cream-100'
                  }`}>
                  <tab.icon className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
                  <span className="md:hidden">{tab.short}</span>
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Content ── */}
          <div className="md:col-span-2 tg-card p-5 md:p-6">
            {activeTab === 'profile' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-5">Profile Information</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <LockedField label="Full Name" value={user?.name || 'N/A'} />
                    <LockedField label="Email Address" value={user?.email || user?.username || 'N/A'} />
                  </div>
                  <LockedField label="School Name" value={user?.schoolName || 'Not set'} />
                  <p className="text-xs text-navy-400 font-semibold">
                    Name, email, and school are set by your administrator and cannot be changed here.
                  </p>
                </div>
              </>
            )}

            {activeTab === 'appearance' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-5">Appearance</h2>
                <ThemeToggle />
              </>
            )}

            {activeTab === 'security' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-5">Change Password</h2>
                <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
                  <div>
                    <label className="tg-label">Current Password</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} required value={passwords.current}
                        onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
                        className="tg-input pr-12" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-navy-300 hover:text-navy-600">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="tg-label">New Password</label>
                    <input type="password" required value={passwords.newPass}
                      onChange={(e) => setPasswords(p => ({ ...p, newPass: e.target.value }))}
                      className="tg-input" placeholder="At least 6 characters" />
                  </div>
                  <div>
                    <label className="tg-label">Confirm New Password</label>
                    <input type="password" required value={passwords.confirm}
                      onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                      className="tg-input" />
                  </div>
                  {pwError && (
                    <p role="alert" className="text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-2xl px-4 py-3">
                      {pwError}
                    </p>
                  )}
                  <button type="submit" disabled={pwBusy} className="tg-btn-primary !py-2.5 !px-5 disabled:opacity-50">
                    {pwBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />} Update Password
                  </button>
                  <p className="text-xs text-navy-400">
                    Changing this signs you out on any other device you are still logged in on.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
