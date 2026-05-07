import { User, Bell, Shield, Save } from 'lucide-react';

export default function Settings() {
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate">Account Settings</h1>
        <p className="text-slate-500 text-sm">Manage your profile and preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Sidebar */}
        <div className="md:col-span-1 space-y-2">
          <button className="w-full flex items-center p-3 text-sm font-medium rounded-lg bg-blue-50 text-brand-navy border-l-4 border-brand-navy">
            <User className="w-5 h-5 mr-3" />
            Profile Information
          </button>
          <button className="w-full flex items-center p-3 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-50 border-l-4 border-transparent">
            <Bell className="w-5 h-5 mr-3" />
            Notifications
          </button>
          <button className="w-full flex items-center p-3 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-50 border-l-4 border-transparent">
            <Shield className="w-5 h-5 mr-3" />
            Security & Password
          </button>
        </div>

        {/* Content */}
        <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-brand-slate mb-6">Profile Information</h2>
          
          <form className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" defaultValue="Juan Dela Cruz" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <input type="email" defaultValue="teacher@deped.gov.ph" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">School Name</label>
              <input type="text" defaultValue="Manila Science High School" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bio (Optional)</label>
              <textarea rows="3" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" placeholder="Tell your students a bit about yourself..."></textarea>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button type="button" className="px-6 py-2.5 bg-brand-navy text-white font-medium rounded-lg hover:bg-blue-900 transition-colors flex items-center shadow-md">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
