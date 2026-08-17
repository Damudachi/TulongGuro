import { useState, useEffect } from 'react';
import { User, School, IdCard, BookOpen, Star } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';

const INFO_TILES = [
  { key: 'username', label: 'Student ID', icon: IdCard, tile: 'bg-royal-500' },
  { key: 'name',     label: 'Full Name',  icon: User,   tile: 'bg-aqua-500' },
  { key: 'section',  label: 'Section',    icon: School, tile: 'bg-sun-400' },
];

export default function StudentProfile() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) {
      apiFetch(`${API_URL}/api/student/${user.id}/dashboard`)
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
  const avgGradePartial = data?.avgGradePartial || false;
  const avgGradeSubjectsIncluded = data?.avgGradeSubjectsIncluded || 0;
  const avgGradeSubjectsTotal = data?.avgGradeSubjectsTotal || 0;

  const valueFor = (key) =>
    key === 'section' ? (student.section?.name || '—') : (student[key] || '—');

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-24">
      <div className="mb-7">
        <h1 className="font-display text-3xl font-extrabold text-navy-700">My Profile</h1>
        <p className="text-navy-500 text-sm font-semibold mt-1">Your account details</p>
      </div>

      {/* ── Avatar card ── */}
      <div className="bg-royal-500 rounded-3xl px-5 py-5 text-white mb-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-white text-royal-700 flex items-center justify-center text-3xl font-extrabold shrink-0">
          {(student.name || 'S').charAt(0)}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-extrabold truncate">{student.name || 'Student'}</h2>
          <p className="text-royal-100 text-sm font-semibold truncate">{student.section?.name || '—'}</p>
          <div className="inline-flex items-center gap-1.5 mt-2.5 bg-sheen/15 px-3 py-1 rounded-full text-sm font-extrabold">
            <Star className="w-4 h-4 fill-sun-400 text-sun-400" /> {stars} Stars
          </div>
        </div>
      </div>

      {/* ── Info tiles ── */}
      <div className="space-y-3 mb-6">
        {INFO_TILES.map(({ key, label, icon: Icon, tile }) => (
          <div key={key} className="tg-card p-4 flex items-center gap-4">
            <div className={`${tile} p-3 rounded-2xl text-white shrink-0`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-navy-400 font-extrabold uppercase tracking-wider">{label}</p>
              <p className="font-bold text-navy-700 truncate">{valueFor(key)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Academic summary ── */}
      <div className="tg-card p-6">
        <h3 className="font-display font-extrabold text-navy-700 mb-5 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-navy-400" /> Academic Summary
        </h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { value: submissions.length, label: 'Outputs', tone: 'text-royal-600' },
            { value: avgGrade > 0 ? `${avgGrade}%` : '—', label: 'Average', tone: 'text-aqua-700',
              hint: avgGradePartial ? `${avgGradeSubjectsIncluded} of ${avgGradeSubjectsTotal} subjects` : null },
            { value: stars, label: 'Stars', tone: 'text-sun-700' },
          ].map(stat => (
            <div key={stat.label} className="bg-cream-100 rounded-2xl py-4">
              <p className={`font-display text-3xl font-extrabold ${stat.tone}`}>{stat.value}</p>
              <p className="text-xs font-bold text-navy-500 mt-1">{stat.label}</p>
              {stat.hint && <p className="text-[10px] font-semibold text-navy-400 mt-0.5">{stat.hint}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Password help notice ── */}
      <div className="mt-4 p-4 bg-sun-100 border-2 border-sun-200 rounded-2xl text-xs text-navy-700 font-semibold">
        <strong>Note:</strong> Don't know your password? Ask your teacher — they can look it up or reset it for you.
      </div>
    </div>
  );
}
