import { useState } from 'react';
import { Shield, Download, Loader2, EyeOff, Eye, Palette, CheckCircle2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { API_URL, apiFetch, setSession } from '../../config';
import ThemeToggle from '../../components/ThemeToggle';

/**
 * What a learner can actually change about their account.
 *
 * This page used to carry a Notifications tab (email/push) and a Privacy tab
 * (Profile Visibility, Show Awards on Profile). Both wrote to localStorage and
 * nothing anywhere read them back, so "Save Changes" reported success and
 * changed nothing — and being per-device, they would not have followed the
 * child to the classroom computer even if they had worked.
 *
 * The privacy pair was the worse of the two: there is no public profile in
 * this application. student/Profile.jsx renders the signed-in learner's own
 * record and nobody else can reach it, so "Profile Visibility" governed
 * nothing while telling a child their work could be hidden. A privacy promise
 * that is not enforced is worse than no control at all, so both are gone
 * rather than left as decoration.
 */
const TABS = [
  { id: 'appearance', label: 'Appearance', short: 'Look', icon: Palette },
  { id: 'security', label: 'Security', short: 'Security', icon: Shield },
  { id: 'data', label: 'Your Data', short: 'Data', icon: Download },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('security');
  const [saveMsg, setSaveMsg] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

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

  /**
   * Hand the learner a copy of their own record.
   *
   * This was a button with no handler at all — it looked like a working data
   * export and did nothing when pressed. It reads the same dashboard endpoint
   * the rest of the learner's pages use, so it can only ever contain what they
   * are already allowed to see: their profile, stars, badges and released
   * grades. Nothing about a classmate is in it, and no new endpoint was needed.
   */
  const handleDownload = async () => {
    setDownloadError('');
    setIsDownloading(true);
    let url;
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (!user.id) throw new Error('no session');

      const res = await apiFetch(`${API_URL}/api/student/${user.id}/dashboard`);
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) throw new Error('request failed');

      const payload = {
        exportedAt: new Date().toISOString(),
        student: {
          name: d.student?.name ?? user.name ?? null,
          studentId: d.student?.username ?? user.username ?? null,
          section: d.student?.section?.name ?? null,
        },
        stars: d.stars ?? 0,
        generalAverage: d.avgGrade ?? null,
        badgesEarned: (d.badges || []).filter(b => b.earned).map(b => ({ title: b.title, description: b.desc })),
        // Only released work reaches this endpoint, so this is exactly the set
        // of grades the learner has already been shown.
        grades: (d.submissions || []).map(s => ({
          activity: s.activity?.title ?? null,
          class: s.activity?.class?.name ?? null,
          score: s.hitlScore ?? s.aiScore ?? null,
          outOf: s.activity?.points ?? null,
          date: s.updatedAt ?? null,
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-tulongguro-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setSaveMsg('Your data has been downloaded.');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch {
      setDownloadError("Couldn't prepare your data just now. Please check your connection and try again.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      setIsDownloading(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" />

      <div className="tg-page pt-4 md:pt-0 max-w-4xl">
        {saveMsg && (
          <div role="status" className="mb-4 bg-aqua-100 border-2 border-aqua-200 text-aqua-800 px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {saveMsg}
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
                      ? 'bg-royal-500 text-white md:shadow-pop'
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
            {activeTab === 'appearance' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1">How TulongGuro looks</h2>
                <p className="text-sm text-navy-500 mb-5">
                  Dark mode is easier on your eyes when you are working at night.
                </p>
                <ThemeToggle />
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
                               text-white bg-royal-500 shadow-pop hover:bg-royal-700
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
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1">Your Data</h2>
                <p className="text-sm text-navy-500 mb-5">
                  Save a copy of everything this app keeps about you — your details, your stars and
                  badges, and every grade your teacher has released to you. It downloads as a file
                  you can keep.
                </p>
                {downloadError && (
                  <p role="alert" className="mb-4 text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-2xl px-4 py-3">
                    {downloadError}
                  </p>
                )}
                <button type="button" onClick={handleDownload} disabled={isDownloading}
                  className="tg-btn-ghost !py-2.5 !px-5 disabled:opacity-50">
                  {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {isDownloading ? 'Preparing…' : 'Download Your Data'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
