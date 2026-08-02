import { useState } from 'react';
import { Bell, Shield, Eye, Download, Save } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Toggle from '../../components/Toggle';

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
                      ? 'bg-aqua-600 text-white md:shadow-pop'
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
                  <Toggle accent="bg-aqua-600" label="Email Notifications"
                    checked={notifications.emailNotifications}
                    onChange={(v) => setNotifications(p => ({ ...p, emailNotifications: v }))} />
                  <Toggle accent="bg-aqua-600" label="Push Notifications"
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
                    <Toggle accent="bg-aqua-600" label="Show Awards on Profile"
                      checked={privacy.showAwards}
                      onChange={(v) => setPrivacy(p => ({ ...p, showAwards: v }))} />
                  </div>
                </div>
              </>
            )}

            {activeTab === 'security' && (
              <>
                <h2 className="font-display text-lg font-extrabold text-navy-700 mb-5">Security</h2>
                <button type="button" className="tg-btn-ghost !py-2.5 !px-5">
                  Change Password
                </button>
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
                             text-white bg-aqua-600 shadow-pop hover:bg-aqua-700
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
