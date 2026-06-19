import { useState, useEffect } from 'react';
import { User, Bell, Shield, Save, Lock, Eye, EyeOff } from 'lucide-react';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [user, setUser] = useState(null);
  const [bio, setBio] = useState('');
  const [notifications, setNotifications] = useState({
    emailGrades: true,
    emailSubmissions: true,
    pushAlerts: false,
    weeklyReport: true
  });
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

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

  const handleChangePassword = (e) => {
    e.preventDefault();
    if (passwords.newPass !== passwords.confirm) {
      return alert('New passwords do not match.');
    }
    if (passwords.newPass.length < 6) {
      return alert('Password must be at least 6 characters.');
    }
    // In production, this would call an API
    setSaveMsg('Password updated successfully!');
    setPasswords({ current: '', newPass: '', confirm: '' });
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const tabs = [
    { id: 'profile', label: 'Profile Information', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security & Password', icon: Shield },
  ];

  function Toggle({ checked, onChange, label }) {
    return (
      <label className="flex items-center justify-between py-3 cursor-pointer">
        <span className="text-sm text-slate-700">{label}</span>
        <button type="button" onClick={() => onChange(!checked)}
          className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-brand-navy' : 'bg-slate-200'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
        </button>
      </label>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate">Account Settings</h1>
        <p className="text-slate-500 text-sm">Manage your profile and preferences</p>
      </div>

      {saveMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm font-medium">
          ✓ {saveMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Sidebar */}
        <div className="md:col-span-1 space-y-2">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center p-3 text-sm font-medium rounded-lg border-l-4 transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-50 text-brand-navy border-brand-navy'
                  : 'text-slate-600 hover:bg-slate-50 border-transparent'
              }`}>
              <tab.icon className="w-5 h-5 mr-3" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <>
              <h2 className="text-lg font-bold text-brand-slate mb-6">Profile Information</h2>
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Full Name</label>
                    <div className="px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-700 font-medium flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      {user?.name || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Email Address</label>
                    <div className="px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-700 font-medium flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      {user?.email || user?.username || 'N/A'}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">School Name</label>
                  <div className="px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-700 font-medium flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    {user?.schoolName || 'Not set'}
                  </div>
                </div>
                <p className="text-xs text-slate-400">Name, email, and school are set by your administrator and cannot be changed here.</p>

                <div className="border-t border-slate-100 pt-5">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bio (Optional)</label>
                  <textarea rows="3" value={bio} onChange={(e) => setBio(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                    placeholder="Tell your students a bit about yourself..." />
                  <div className="flex justify-end mt-3">
                    <button onClick={handleSaveBio} type="button"
                      className="px-5 py-2 bg-brand-navy text-white font-medium rounded-lg hover:bg-blue-900 transition-colors flex items-center text-sm shadow-sm">
                      <Save className="w-4 h-4 mr-2" /> Save Bio
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <>
              <h2 className="text-lg font-bold text-brand-slate mb-6">Notification Preferences</h2>
              <div className="divide-y divide-slate-100">
                <Toggle label="Email me when a student submits work"
                  checked={notifications.emailSubmissions}
                  onChange={(v) => setNotifications(p => ({ ...p, emailSubmissions: v }))} />
                <Toggle label="Email me when grades are finalized"
                  checked={notifications.emailGrades}
                  onChange={(v) => setNotifications(p => ({ ...p, emailGrades: v }))} />
                <Toggle label="Push notifications for urgent alerts"
                  checked={notifications.pushAlerts}
                  onChange={(v) => setNotifications(p => ({ ...p, pushAlerts: v }))} />
                <Toggle label="Weekly summary report"
                  checked={notifications.weeklyReport}
                  onChange={(v) => setNotifications(p => ({ ...p, weeklyReport: v }))} />
              </div>
              <div className="flex justify-end mt-6">
                <button onClick={handleSaveNotifs} type="button"
                  className="px-5 py-2 bg-brand-navy text-white font-medium rounded-lg hover:bg-blue-900 transition-colors flex items-center text-sm shadow-sm">
                  <Save className="w-4 h-4 mr-2" /> Save Preferences
                </button>
              </div>
            </>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <>
              <h2 className="text-lg font-bold text-brand-slate mb-6">Change Password</h2>
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} required value={passwords.current}
                      onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none pr-10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                  <input type="password" required value={passwords.newPass}
                    onChange={(e) => setPasswords(p => ({ ...p, newPass: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                    placeholder="At least 6 characters" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                  <input type="password" required value={passwords.confirm}
                    onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
                </div>
                <button type="submit"
                  className="px-5 py-2 bg-brand-navy text-white font-medium rounded-lg hover:bg-blue-900 transition-colors flex items-center text-sm shadow-sm">
                  <Shield className="w-4 h-4 mr-2" /> Update Password
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
