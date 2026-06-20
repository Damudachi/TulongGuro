import { useState } from 'react';
import { Bell, Shield, Eye, Download } from 'lucide-react';

export default function Settings() {
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    pushNotifications: false,
    weeklyDigest: true,
  });

  const [privacy, setPrivacy] = useState({
    profileVisibility: 'public',
    showAwards: true,
  });

  const handleNotificationChange = (key) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePrivacyChange = (key, value) => {
    if (typeof value === 'boolean') {
      setPrivacy(prev => ({ ...prev, [key]: !prev[key] }));
    } else {
      setPrivacy(prev => ({ ...prev, [key]: value }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-800 mb-8">Settings</h1>

        {/* Notification Settings */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex items-center mb-6">
            <Bell className="w-6 h-6 text-brand-green mr-3" />
            <h2 className="text-xl font-semibold text-slate-800">Notifications</h2>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-slate-700">Email Notifications</label>
              <input
                type="checkbox"
                checked={notifications.emailNotifications}
                onChange={() => handleNotificationChange('emailNotifications')}
                className="w-5 h-5 text-brand-green rounded cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-slate-700">Push Notifications</label>
              <input
                type="checkbox"
                checked={notifications.pushNotifications}
                onChange={() => handleNotificationChange('pushNotifications')}
                className="w-5 h-5 text-brand-green rounded cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-slate-700">Weekly Digest</label>
              <input
                type="checkbox"
                checked={notifications.weeklyDigest}
                onChange={() => handleNotificationChange('weeklyDigest')}
                className="w-5 h-5 text-brand-green rounded cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Privacy Settings */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex items-center mb-6">
            <Eye className="w-6 h-6 text-brand-green mr-3" />
            <h2 className="text-xl font-semibold text-slate-800">Privacy</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-slate-700 mb-2">Profile Visibility</label>
              <select
                value={privacy.profileVisibility}
                onChange={(e) => handlePrivacyChange('profileVisibility', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-green focus:border-transparent"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="school-only">School Only</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-slate-700">Show Awards on Profile</label>
              <input
                type="checkbox"
                checked={privacy.showAwards}
                onChange={() => handlePrivacyChange('showAwards')}
                className="w-5 h-5 text-brand-green rounded cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex items-center mb-6">
            <Shield className="w-6 h-6 text-brand-green mr-3" />
            <h2 className="text-xl font-semibold text-slate-800">Security</h2>
          </div>
          <button className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg font-medium hover:bg-slate-300 transition-colors">
            Change Password
          </button>
        </div>

        {/* Data & Download */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-6">
            <Download className="w-6 h-6 text-brand-green mr-3" />
            <h2 className="text-xl font-semibold text-slate-800">Data & Privacy</h2>
          </div>
          <button className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg font-medium hover:bg-slate-300 transition-colors">
            Download Your Data
          </button>
        </div>

        {/* Save Button */}
        <div className="mt-8 flex gap-4">
          <button className="flex-1 px-6 py-3 bg-brand-green text-white rounded-lg font-semibold hover:bg-green-700 transition-colors">
            Save Changes
          </button>
          <button className="flex-1 px-6 py-3 bg-slate-200 text-slate-800 rounded-lg font-semibold hover:bg-slate-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
