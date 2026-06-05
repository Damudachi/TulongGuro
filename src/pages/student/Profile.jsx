import { useState, useEffect } from 'react';
import { User, School, IdCard, BookOpen, Star } from 'lucide-react';
import { API_URL } from '../../config';

export default function StudentProfile() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) {
      fetch(`${API_URL}/api/student/${user.id}/dashboard`)
        .then(r => r.json())
        .then(d => { if (d.success) setData(d); })
        .catch(() => {});
    }
  }, []);

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const student = data?.student || user;
  const submissions = data?.submissions || [];
  const stars = data?.stars || 0;
  const avgGrade = data?.avgGrade || 0;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">My Profile</h1>
        <p className="text-slate-500 text-sm">Your account details</p>
      </div>

      {/* Avatar Card */}
      <div className="bg-gradient-to-br from-brand-green to-emerald-600 rounded-2xl p-6 text-white mb-6 flex items-center gap-5 shadow-lg">
        <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center text-4xl font-extrabold shadow-inner">
          {(student.name || 'S').charAt(0)}
        </div>
        <div>
          <h2 className="text-2xl font-bold">{student.name || 'Student'}</h2>
          <p className="text-green-100 text-sm">{student.section?.name || '—'}</p>
          <div className="flex items-center gap-1 mt-2 text-yellow-300 text-sm font-bold">
            <Star className="w-4 h-4 fill-yellow-300" /> {stars} Stars
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="space-y-4 mb-6">
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
            <p className="font-bold text-brand-slate">{student.section?.name || '—'}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><BookOpen className="w-4 h-4" /> Academic Summary</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-extrabold text-brand-navy">{submissions.length}</p>
            <p className="text-xs text-slate-500 mt-1">Outputs</p>
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

      {/* Default Password Notice */}
      <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
        <strong>Note:</strong> Default password is <code className="bg-amber-100 px-1 rounded">password123</code>. Ask your teacher for help if you need to change it.
      </div>
    </div>
  );
}
