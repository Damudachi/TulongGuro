import { useState } from 'react';
import { Bell, Shield, Eye, Download, Save, Loader2, EyeOff } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Toggle from '../../components/Toggle';
import { API_URL, apiFetch, setSession } from '../../config';

const NOTIF_KEY = 'studentNotifPrefs';
const PRIVACY_KEY = 'studentPrivacyPrefs';

const DEFAULT_NOTIFS = {
  emailNotifications: true,
  pushNotifications: false,
};

const DEFAULT_PRIVACY = {
  profileVisibility: 'public',
  showAwards: true,
};

const TABS = [
  { id: 'notifications', label: 'Notifications', short: 'Alerts', icon: Bell },
  { id: 'privacy', label: 'Privacy', short: 'Privacy', icon: Eye },
  { id: 'security', label: 'Security', short: 'Security', icon: Shield },
  { id: 'data', label: 'Data & Privacy', short: 'Data', icon: Download },
];

/** Read once when state is first created — avoids a load-then-setState effect. */
function readPrefs(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
  } catch {
    return fallback;
  }
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('notifications');
  const [notifications, setNotifications] = useState(() => readPrefs(NOTIF_KEY, DEFAULT_NOTIFS));
  const [privacy, setPrivacy] = useState(() => readPrefs(PRIVACY_KEY, DEFAULT_PRIVACY));
  const [saveMsg, setSaveMsg] = useState('');

  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  /**
   * Change the learner's own password.
   *
   * This tab used to be a "Change Password" button with no handler at all — so
   * the credential a pupil is handed on day one, which is their birthday and
   * therefore known to everyone in the class, could not be changed by them at
   * any point in the year. The only way out was to ask an admin to reset it,
   * which sets it back to the same birthday.
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
      // Changing a password signs out every other session. The server hands
      // back a token minted after that cut-off so this browser stays signed in.
      if (data.token) setSession(JSON.parse(localStorage.getItem('user') || '{}'), data.token);
      setPasswords({ current: '', newPass: '', confirm: '' });
      setSaveMsg('Password changed. Use the new one next time you sign in.');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch {
      setPwError('Network error. Please try again.');
    } finally {
      setPwBusy(false);
    }
  };

  const handleSave = () => {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications));
    localStorage.setItem(PRIVACY_KEY, JSON.stringify(privacy));
    setSaveMsg('Settings saved!');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  /** Discard unsaved edits by re-reading whatever was last persisted. */
  const handleReset = () => {
    setNotifications(readPrefs(NOTIF_KEY, DEFAULT_NOTIFS));
    setPrivacy(readPrefs(PRIVACY_KEY, DEFAULT_PRIVACY));
  };

  return (
    <>
      <PageHeader title="Settings" />

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
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 px-2 py-2.5 md:px-4 md:py-3
                              text-sm font-bold rounded-xl md:rounded-2xl transition-all ${
                    activeTab === tab.id
                      ? 'bg-royal-600 text-white md:shadow-pop'
                      : 'text-navy-500 hover:bg-cream-100'
                  }`}>
                  <tab.icon className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
                  <span className="md:hidden text-xs">{tab.short}</span>
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Content ── */}
          <div className="md:col-span-2 tg-card p-5 md:p-6">
            {activeTab === 'notifications' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-3">Notifications</h2>
                <div className="divide-y-2 divide-cream-200">
                  <Toggle accent="bg-royal-600" label="Email Notifications"
                    checked={notifications.emailNotifications}
                    onChange={(v) => setNotifications(p => ({ ...p, emailNotifications: v }))} />
                  <Toggle accent="bg-royal-600" label="Push Notifications"
                    checked={notifications.pushNotifications}
                    onChange={(v) => setNotifications(p => ({ ...p, pushNotifications: v }))} />
                </div>
              </>
            )}

            {activeTab === 'privacy' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-5">Privacy</h2>
                <div className="space-y-4">
                  <div>
                    <label className="tg-label">Profile Visibility</label>
                    <select
                      value={privacy.profileVisibility}
                      onChange={(e) => setPrivacy(p => ({ ...p, profileVisibility: e.target.value }))}
                      className="tg-input"
                    >
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                      <option value="school-only">School Only</option>
                    </select>
                  </div>
                  <div className="border-t-2 border-cream-200">
                    <Toggle accent="bg-royal-600" label="Show Awards on Profile"
                      checked={privacy.showAwards}
                      onChange={(v) => setPrivacy(p => ({ ...p, showAwards: v }))} />
                  </div>
                </div>
              </>
            )}

            {activeTab === 'security' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1">Change your password</h2>
                <p className="text-sm text-navy-500 mb-5">
                  Your first password was your birthday, which your classmates can guess. Pick one only you know.
                </p>
                <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
                  <div>
                    <label className="tg-label" htmlFor="current-password">Current password</label>
                    <div className="relative">
                      <input id="current-password" type={showPassword ? 'text' : 'password'} required
                        autoComplete="current-password"
                        value={passwords.current}
                        onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
                        className="tg-input pr-11" />
                      <button type="button" onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-600">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="tg-label" htmlFor="new-password">New password</label>
                    <input id="new-password" type="password" required minLength={6} autoComplete="new-password"
                      value={passwords.newPass}
                      onChange={(e) => setPasswords(p => ({ ...p, newPass: e.target.value }))}
                      className="tg-input" />
                    <p className="text-xs text-navy-400 mt-1">At least 6 characters.</p>
                  </div>
                  <div>
                    <label className="tg-label" htmlFor="confirm-password">Confirm new password</label>
                    <input id="confirm-password" type="password" required autoComplete="new-password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                      className="tg-input" />
                  </div>
                  {pwError && (
                    <p role="alert" className="text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-2xl px-4 py-3">
                      {pwError}
                    </p>
                  )}
                  <button type="submit" disabled={pwBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-full py-2.5 px-5 font-bold text-sm
                               text-white bg-royal-600 shadow-pop hover:bg-royal-700
                               active:translate-y-1 active:shadow-none transition-all disabled:opacity-50">
                    {pwBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    Update password
                  </button>
                  <p className="text-xs text-navy-400">
                    Changing this signs you out on any other device you are still logged in on.
                  </p>
                </form>
              </>
            )}

            {activeTab === 'data' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-5">Data &amp; Privacy</h2>
                <button type="button" className="tg-btn-ghost !py-2.5 !px-5">
                  <Download className="w-4 h-4" /> Download Your Data
                </button>
              </>
            )}

            {/* Save row — only for the tabs that hold editable preferences. */}
            {(activeTab === 'notifications' || activeTab === 'privacy') && (
              <div className="flex gap-3 mt-6 pt-5 border-t-2 border-cream-200">
                <button onClick={handleReset} type="button" className="tg-btn-ghost flex-1 !py-2.5">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  type="button"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-full py-2.5 px-5 font-bold text-sm
                             text-white bg-royal-600 shadow-pop hover:bg-royal-700
                             active:translate-y-1 active:shadow-none transition-all"
                >
                  <Save className="w-4 h-4" /> Save Changes
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
