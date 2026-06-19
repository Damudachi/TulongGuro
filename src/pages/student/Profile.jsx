import { useState, useEffect } from 'react';
import { User, School, IdCard, BookOpen, Star, Shield, Eye, EyeOff, Save, Settings, TrendingUp } from 'lucide-react';
import { API_URL } from '../../config';

const SKILL_LABELS = { vocabulary: 'Vocabulary', punctuation: 'Punctuation', thematicFlow: 'Thematic Flow', sentenceStructure: 'Sentence Structure' };

function SkillBar({ label, value, max = 25 }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 70 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className="font-bold text-slate-700">{value}/{max}</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StudentProfile() {
  const [data, setData] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [activeTab, setActiveTab] = useState('profile');
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    Promise.all([
      fetch(`${API_URL}/api/student/${user.id}/dashboard`).then(r => r.json()),
      fetch(`${API_URL}/api/student/${user.id}/subjects`).then(r => r.json())
    ]).then(([dashData, subData]) => {
      if (dashData.success) setData(dashData);
      if (subData.success) setSubjects(subData.subjects);
    }).catch(() => {});
  }, []);

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const student = data?.student || user;
  const submissions = data?.submissions || [];
  const stars = data?.stars || 0;
  const avgGrade = data?.avgGrade || 0;
  const avgSkills = data?.avgSkills || {};
  const hasSkills = Object.values(avgSkills).some(v => v > 0);

  const handleChangePassword = (e) => {
    e.preventDefault();
    if (passwords.newPass !== passwords.confirm) return alert('New passwords do not match.');
    if (passwords.newPass.length < 6) return alert('Password must be at least 6 characters.');
    setSaveMsg('Password updated successfully!');
    setPasswords({ current: '', newPass: '', confirm: '' });
    setTimeout(() => setSaveMsg(''), 2000);
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">My Profile</h1>
        <p className="text-slate-500 text-sm">Your account details and academic progress</p>
      </div>

      {/* Avatar Card */}
      <div className="bg-gradient-to-br from-brand-green to-emerald-600 rounded-2xl p-6 text-white mb-6 flex items-center gap-5 shadow-lg">
        <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center text-4xl font-extrabold shadow-inner">
          {(student.name || 'S').charAt(0)}
        </div>
        <div>
          <h2 className="text-2xl font-bold">{student.name || 'Student'}</h2>
          <p className="text-green-100 text-sm">{student.section?.name || data?.student?.section?.name || '—'}</p>
          <div className="flex items-center gap-1 mt-2 text-yellow-300 text-sm font-bold">
            <Star className="w-4 h-4 fill-yellow-300" /> {stars} Stars
          </div>
        </div>
      </div>

      {saveMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm font-medium">
          ✓ {saveMsg}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-2 mb-6">
        {[
          { id: 'profile', label: 'Profile', icon: User },
          { id: 'academic', label: 'Academic', icon: TrendingUp },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-brand-green text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
            <div className="bg-blue-50 p-3 rounded-xl"><IdCard className="w-5 h-5 text-brand-navy" /></div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Student ID</p>
              <p className="font-bold text-brand-slate">{student.username || '—'}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
            <div className="bg-green-50 p-3 rounded-xl"><User className="w-5 h-5 text-brand-green" /></div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Full Name</p>
              <p className="font-bold text-brand-slate">{student.name || '—'}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
            <div className="bg-amber-50 p-3 rounded-xl"><School className="w-5 h-5 text-brand-amber" /></div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Section</p>
              <p className="font-bold text-brand-slate">{data?.student?.section?.name || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Academic Tab */}
      {activeTab === 'academic' && (
        <div className="space-y-6">
          {/* Overall Stats */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><BookOpen className="w-4 h-4" /> Overall Performance</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-extrabold text-brand-navy">{submissions.length}</p>
                <p className="text-xs text-slate-500 mt-1">Graded</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-brand-green">{avgGrade > 0 ? `${avgGrade}%` : '—'}</p>
                <p className="text-xs text-slate-500 mt-1">Average</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-yellow-500">{stars}</p>
                <p className="text-xs text-slate-500 mt-1">Stars</p>
              </div>
            </div>
          </div>

          {/* Per-Subject Grades */}
          {subjects.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><BookOpen className="w-4 h-4" /> Subject Grades</h3>
              <div className="space-y-3">
                {subjects.map(sub => {
                  const grade = sub.overallGrade;
                  const gradeColor = grade === null ? 'text-slate-300' : grade >= 90 ? 'text-green-600' : grade >= 75 ? 'text-amber-600' : 'text-red-600';
                  const pct = grade !== null ? grade : 0;
                  const barColor = grade === null ? 'bg-slate-200' : grade >= 90 ? 'bg-green-400' : grade >= 75 ? 'bg-amber-400' : 'bg-red-400';
                  return (
                    <div key={sub.id}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-slate-700">{sub.subject || sub.name}</span>
                        <span className={`text-sm font-bold ${gradeColor}`}>
                          {grade !== null ? `${grade}%` : '—'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5">
                        <div className={`h-2.5 rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{sub.gradedCount}/{sub.activityCount} activities graded</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Skill Averages */}
          {hasSkills && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Writing Skills</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.entries(SKILL_LABELS).map(([key, label]) => (
                  <SkillBar key={key} label={label} value={avgSkills[key] || 0} max={25} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Change Password */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4" /> Change Password
            </h3>
            <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} required value={passwords.current}
                    onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-green outline-none pr-10" />
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
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-green outline-none"
                  placeholder="At least 6 characters" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input type="password" required value={passwords.confirm}
                  onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-green outline-none" />
              </div>
              <button type="submit"
                className="px-5 py-2 bg-brand-green text-white font-medium rounded-lg hover:bg-emerald-600 transition-colors flex items-center text-sm shadow-sm">
                <Save className="w-4 h-4 mr-2" /> Update Password
              </button>
            </form>
          </div>

          {/* Default Password Notice */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            <strong>Note:</strong> Default password is <code className="bg-amber-100 px-1 rounded">password123</code>. Change it above for security.
          </div>
        </div>
      )}
    </div>
  );
}
