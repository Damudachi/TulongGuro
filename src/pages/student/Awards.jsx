import { useState, useEffect } from 'react';
import { Trophy, Star, Lock, Zap, BookOpen, Award } from 'lucide-react';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const AWARDS = [
  { id: 1, icon: Star,     title: 'First Star',       desc: 'Scored 90+ on your first essay',          threshold: 1,  color: 'bg-yellow-50 border-yellow-200 text-yellow-600' },
  { id: 2, icon: BookOpen, title: 'Bookworm',          desc: 'Read and applied 3 reading strategies',   threshold: 3,  color: 'bg-blue-50 border-blue-200 text-blue-600' },
  { id: 3, icon: Zap,      title: 'Grammar Master',   desc: 'Perfect grammar score on any assignment',  threshold: 5,  color: 'bg-purple-50 border-purple-200 text-purple-600' },
  { id: 4, icon: Trophy,   title: 'Honor Student',    desc: 'Maintain 90+ average across 5 outputs',   threshold: 10, color: 'bg-amber-50 border-amber-200 text-amber-600' },
  { id: 5, icon: Award,    title: 'Essay Champion',   desc: 'Complete 10 graded essay submissions',     threshold: 15, color: 'bg-green-50 border-green-200 text-green-600' },
];

export default function Awards() {
  const [stars, setStars] = useState(0);
  const [totalSubmissions, setTotalSubmissions] = useState(0);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) {
      fetch(`http://localhost:3000/api/student/${user.id}/dashboard`)
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            setStars(d.stars || 0);
            setTotalSubmissions(d.submissions?.length || 0);
          }
        }).catch(() => {});
    }
  }, []);

  const unlocked = AWARDS.filter(a => stars >= a.threshold);
  const locked = AWARDS.filter(a => stars < a.threshold);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate">Trophy Room 🏆</h1>
        <p className="text-slate-500 text-sm">Your earned achievements and badges</p>
      </div>

      {/* Stars Summary */}
      <div className="bg-gradient-to-r from-brand-navy to-blue-800 text-white p-6 rounded-2xl mb-8 flex items-center justify-between">
        <div>
          <p className="text-blue-200 text-sm font-medium">Your Stars</p>
          <p className="text-4xl font-extrabold mt-1">{stars}</p>
          <p className="text-blue-300 text-xs mt-1">{unlocked.length} of {AWARDS.length} awards unlocked</p>
        </div>
        <Star className="w-16 h-16 fill-yellow-300 text-yellow-300 opacity-90" />
      </div>

      {/* Unlocked */}
      {unlocked.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Earned Badges</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {unlocked.map(award => {
              const Icon = award.icon;
              return (
                <div key={award.id} className={cn('p-5 rounded-2xl border-2 flex items-center gap-4 shadow-sm', award.color)}>
                  <div className="p-3 bg-white rounded-xl shadow-sm"><Icon className="w-7 h-7" /></div>
                  <div>
                    <p className="font-bold text-slate-800">{award.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{award.desc}</p>
                    <p className="text-xs font-bold mt-1 flex items-center gap-1">
                      <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> Requires {award.threshold} stars
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Locked */}
      {locked.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Locked — Keep going!</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {locked.map(award => {
              const Icon = award.icon;
              return (
                <div key={award.id} className="p-5 rounded-2xl border-2 border-slate-100 bg-slate-50 flex items-center gap-4 opacity-60">
                  <div className="p-3 bg-white rounded-xl shadow-sm relative">
                    <Icon className="w-7 h-7 text-slate-300" />
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute -bottom-1 -right-1" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-500">{award.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{award.desc}</p>
                    <p className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-1">
                      <Star className="w-3 h-3" /> Need {award.threshold - stars} more stars
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
