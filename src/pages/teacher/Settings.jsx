import { useState, useEffect } from 'react';
import { User, Bell, Shield, Save, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Toggle from '../../components/Toggle';
import { API_URL, apiFetch, setSession } from '../../config';

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
  const [user, setUser] = useState(null);
  const [bio, setBio] = useState('');
  const [notifications, setNotifications] = useState({
    pushAlerts: false,
  });
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    setUser(stored);
    // Load saved preferences
    const savedNotifs = JSON.parse(localStorage.getItem('notifPrefs') || 'null');
    if (savedNotifs) setNotifications(savedNotifs);
    const savedBio = localStorage.getItem('teacherBio') || '';
    setBio(savedBio);
  }, []);

  const handleSaveBio = () => {
    localStorage.setItem('teacherBio', bio);
    setSaveMsg('Bio saved!');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const handleSaveNotifs = () => {
    localStorage.setItem('notifPrefs', JSON.stringify(notifications));
    setSaveMsg('Notification preferences saved!');
    setTimeout(() => setSaveMsg(''), 2000);
  };

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
    { id: 'notifications', label: 'Notifications', short: 'Alerts', icon: Bell },
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

                  <div className="border-t-2 border-cream-200 pt-5">
                    <label className="tg-label">Bio (Optional)</label>
                    <textarea rows="3" value={bio} onChange={(e) => setBio(e.target.value)}
                      className="tg-input resize-y"
                      placeholder="Tell your students a bit about yourself..." />
                    <div className="flex justify-end mt-3">
                      <button onClick={handleSaveBio} type="button" className="tg-btn-primary !py-2.5 !px-5">
                        <Save className="w-4 h-4" /> Save Bio
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'notifications' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-3">Notification Preferences</h2>
                <div className="divide-y-2 divide-cream-200">
                  <Toggle label="Push notifications for urgent alerts"
                    checked={notifications.pushAlerts}
                    onChange={(v) => setNotifications(p => ({ ...p, pushAlerts: v }))} />
                </div>
                <div className="flex justify-end mt-6">
                  <button onClick={handleSaveNotifs} type="button" className="tg-btn-primary !py-2.5 !px-5">
                    <Save className="w-4 h-4" /> Save Preferences
                  </button>
                </div>
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
