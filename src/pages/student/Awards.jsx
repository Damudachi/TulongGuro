import { useState, useEffect } from 'react';
import { Trophy, Star, Lock, Zap, BookOpen, Award } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const AWARDS = [
  { id: 1, icon: Star,     title: 'First Star',     desc: 'Scored 90+ on your first essay',          threshold: 1,  tile: 'bg-sun-400',     shell: 'bg-sun-100 border-sun-200',         ink: 'text-sun-800' },
  { id: 2, icon: BookOpen, title: 'Bookworm',       desc: 'Read and applied 3 reading strategies',   threshold: 3,  tile: 'bg-royal-500',   shell: 'bg-royal-100 border-royal-200',     ink: 'text-royal-700' },
  { id: 3, icon: Zap,      title: 'Grammar Master', desc: 'Perfect grammar score on any assignment', threshold: 5,  tile: 'bg-lilac-400',   shell: 'bg-lilac-100 border-lilac-200',     ink: 'text-lilac-700' },
  { id: 4, icon: Trophy,   title: 'Honor Student',  desc: 'Maintain 90+ average across 5 outputs',   threshold: 10, tile: 'bg-magenta-500', shell: 'bg-magenta-100 border-magenta-200', ink: 'text-magenta-700' },
  { id: 5, icon: Award,    title: 'Essay Champion', desc: 'Complete 10 graded essay submissions',    threshold: 15, tile: 'bg-aqua-500',    shell: 'bg-aqua-100 border-aqua-200',       ink: 'text-aqua-800' },
];

export default function Awards() {
  const [stars, setStars] = useState(0);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) {
      fetch(`${API_URL}/api/student/${user.id}/dashboard`)
        .then(r => r.json())
        .then(d => { if (d.success) setStars(d.stars || 0); })
        .catch(() => {});
    }
  }, []);

  const unlocked = AWARDS.filter(a => stars >= a.threshold);
  const locked = AWARDS.filter(a => stars < a.threshold);
  const progress = Math.round((unlocked.length / AWARDS.length) * 100);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="mb-7">
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Trophy Room 🏆</h1>
        <p className="text-navy-500 text-sm font-semibold mt-1">Your earned achievements and badges</p>
      </div>

      {/* ── Stars summary ── */}
      <div className="bg-navy-700 text-white px-5 py-5 rounded-3xl mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sky-300 text-sm font-bold">Your Stars</p>
            <p className="font-display text-4xl font-extrabold mt-0.5">{stars}</p>
            <p className="text-sky-200/70 text-xs font-semibold mt-1.5">
              {unlocked.length} of {AWARDS.length} awards unlocked
            </p>
          </div>
          <Star className="w-14 h-14 fill-sun-400 text-sun-400 shrink-0" />
        </div>
        <div className="mt-4 h-2.5 bg-white/15 rounded-full overflow-hidden">
          <div className="h-full bg-sun-400 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* ── Unlocked ── */}
      {unlocked.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-extrabold text-navy-400 uppercase tracking-wider mb-4">Earned Badges</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {unlocked.map(award => {
              const Icon = award.icon;
              return (
                <div key={award.id} className={cn('p-5 rounded-3xl border-2 flex items-center gap-4', award.shell)}>
                  <div className={cn('p-3.5 rounded-2xl text-white shrink-0 shadow-pop', award.tile)}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-extrabold text-navy-700">{award.title}</p>
                    <p className="text-xs text-navy-600 mt-0.5">{award.desc}</p>
                    <p className={cn('text-xs font-extrabold mt-1.5 flex items-center gap-1', award.ink)}>
                      <Star className="w-3 h-3 fill-current" /> Requires {award.threshold} stars
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Locked ── */}
      {locked.length > 0 && (
        <section>
          <h2 className="text-xs font-extrabold text-navy-400 uppercase tracking-wider mb-4">Locked — Keep going!</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {locked.map(award => {
              const Icon = award.icon;
              return (
                <div key={award.id} className="p-5 rounded-3xl border-2 border-cream-200 bg-cream-50 flex items-center gap-4">
                  <div className="p-3.5 bg-white rounded-2xl relative shrink-0 border-2 border-cream-200">
                    <Icon className="w-7 h-7 text-navy-200" />
                    <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-navy-300 grid place-items-center">
                      <Lock className="w-3 h-3 text-white" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-extrabold text-navy-400">{award.title}</p>
                    <p className="text-xs text-navy-400 mt-0.5">{award.desc}</p>
                    <p className="text-xs font-extrabold text-navy-500 mt-1.5 flex items-center gap-1">
                      <Star className="w-3 h-3" /> Need {award.threshold - stars} more stars
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
