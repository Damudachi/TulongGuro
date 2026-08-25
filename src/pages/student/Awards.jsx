import { useState, useEffect } from 'react';
import {
  Trophy, Star, Lock, Zap, BookOpen, Award, Flag, Medal, TrendingUp, Rocket,
  BarChart3, Target, Clock, Compass, Flame, GraduationCap, Loader2,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import { badgeLook } from '../../constants/badgeLook';
import BadgeCelebration from '../../components/BadgeCelebration';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Presentation only. What each badge *means* — and whether it has been earned —
 * is decided server-side in badges.js, because it depends on the student's
 * actual submissions, the school's passing grade, and for Class Champion how
 * the rest of the section is doing.
 *
 * This page used to own the conditions as well, and unlocked every badge purely
 * on a star count: "Read and applied 3 reading strategies" opened at 3 stars,
 * which one 90+ essay grants. The descriptions promised things the check never
 * looked at, so a pupil could be congratulated for work they had not done.
 *
 * An id with no entry here still renders, via FALLBACK_STYLE — a badge the
 * server knows about and this file does not must never blank the page.
 */
const BADGE_STYLES = {
  // ── The original five ──
  'first-star':       { icon: Star,          tile: 'bg-sun-400',     shell: 'bg-sun-100 border-sun-200',         ink: 'text-sun-800' },
  bookworm:           { icon: BookOpen,      tile: 'bg-royal-500',   shell: 'bg-royal-100 border-royal-200',     ink: 'text-royal-700' },
  'grammar-master':   { icon: Zap,           tile: 'bg-lilac-400',   shell: 'bg-lilac-100 border-lilac-200',     ink: 'text-lilac-700' },
  'honor-student':    { icon: Trophy,        tile: 'bg-magenta-500', shell: 'bg-magenta-100 border-magenta-200', ink: 'text-magenta-700' },
  'essay-champion':   { icon: Award,         tile: 'bg-aqua-500',    shell: 'bg-aqua-100 border-aqua-200',       ink: 'text-aqua-800' },

  // ── Getting started ──
  'first-steps':      { icon: Flag,          tile: 'bg-aqua-400',    shell: 'bg-aqua-100 border-aqua-200',       ink: 'text-aqua-800' },

  // ── Standing ──
  'class-champion':   { icon: Medal,         tile: 'bg-sun-500',     shell: 'bg-sun-100 border-sun-200',         ink: 'text-sun-800' },

  // ── Recovery. Warm colours on purpose: these are the badges most likely to
  //    reach a child who has been behind, and they should not look like the
  //    consolation shelf. ──
  'comeback-kid':     { icon: TrendingUp,    tile: 'bg-magenta-400', shell: 'bg-magenta-100 border-magenta-200', ink: 'text-magenta-700' },
  turnaround:         { icon: Rocket,        tile: 'bg-magenta-600', shell: 'bg-magenta-100 border-magenta-200', ink: 'text-magenta-700' },
  'steady-climber':   { icon: BarChart3,     tile: 'bg-royal-400',   shell: 'bg-royal-100 border-royal-200',     ink: 'text-royal-700' },
  'personal-best':    { icon: Target,        tile: 'bg-lilac-500',   shell: 'bg-lilac-100 border-lilac-200',     ink: 'text-lilac-700' },

  // ── Effort ──
  'always-on-time':   { icon: Clock,         tile: 'bg-aqua-600',    shell: 'bg-aqua-100 border-aqua-200',       ink: 'text-aqua-800' },
  'all-rounder':      { icon: Compass,       tile: 'bg-royal-500',   shell: 'bg-royal-100 border-royal-200',     ink: 'text-royal-700' },
  dedicated:          { icon: Flame,         tile: 'bg-sun-600',     shell: 'bg-sun-100 border-sun-200',         ink: 'text-sun-800' },
  'strategy-scholar': { icon: GraduationCap, tile: 'bg-lilac-600',   shell: 'bg-lilac-100 border-lilac-200',     ink: 'text-lilac-700' },
};

const FALLBACK_STYLE = { icon: Award, tile: 'bg-royal-500', shell: 'bg-royal-100 border-royal-200', ink: 'text-royal-700' };

/**
 * How to draw one badge.
 *
 * The fifteen built-in badges are looked up above — their appearance is a
 * property of *which* badge it is, and always has been. A badge written by a
 * teacher has no entry here and never will: its icon and colour were chosen by
 * the teacher and travel on the badge itself, so they are read off the row and
 * turned into an icon and classes by badgeLook — the same table the teacher
 * previewed the badge through. That shared step is what stops the badge a
 * teacher designed and the badge a child is shown from drifting apart.
 */
const styleFor = (badge) => {
  if (badge?.custom) {
    return badgeLook(badge);
  }
  return BADGE_STYLES[badge?.id] || FALLBACK_STYLE;
};

export default function Awards() {
  const [stars, setStars] = useState(0);
  const [badges, setBadges] = useState([]);
  // A learner who opens the trophy room before their dashboard is the one most
  // likely to be looking for a badge they have just been told about, so the
  // celebration is mounted here too. Both screens read the same endpoint, and
  // the acknowledgement it sends on dismissal is what stops them showing the
  // same badge twice.
  const [justEarned, setJustEarned] = useState(null);
  /**
   * Until this clears, the page says nothing about what the learner has won.
   *
   * Every number here starts at its empty value — 0 stars, no badges, a 0%
   * bar — and the copy at the bottom of the page states outright that the
   * teacher has not graded anything yet. Rendered while the request is still
   * in flight, that is not an empty state, it is a wrong answer given
   * confidently to a child who may well have a badge they came here to look
   * at. Slower the connection, longer they are told they have nothing.
   *
   * Starts false when nobody is signed in, matching the student dashboard:
   * with no id there is nothing to fetch, so the spinner would only ever be
   * taken away again on the first commit. See getStoredUser.
   */
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    apiFetch(`${API_URL}/api/student/${user.id}/dashboard`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setStars(d.stars || 0);
        setBadges(d.badges || []);
        setJustEarned(d.justEarnedBadges || null);
      })
      .catch(() => {})
      // Cleared on failure too. A learner who is offline should see the empty
      // trophy room the rest of the page already handles, not a spinner that
      // never resolves.
      .finally(() => setIsLoading(false));
  }, []);

  const unlocked = badges.filter(b => b.earned);
  const locked = badges.filter(b => !b.earned);
  const progress = badges.length ? Math.round((unlocked.length / badges.length) * 100) : 0;

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <BadgeCelebration badges={justEarned} />

      <div className="mb-7">
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Trophy Room 🏆</h1>
        <p className="text-navy-500 text-sm font-semibold mt-1">Your earned achievements and badges</p>
      </div>

      {/* ── Stars summary ── */}
      <div className="bg-brand-chrome text-white px-5 py-5 rounded-3xl mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white/75 text-sm font-bold">Your Stars</p>
            <p className="font-display text-4xl font-extrabold mt-0.5">{stars}</p>
            <p className="text-white/60 text-xs font-semibold mt-1.5">
              {unlocked.length} of {badges.length} badges earned
            </p>
          </div>
          <Star className="w-14 h-14 fill-sun-400 text-sun-400 shrink-0" />
        </div>
        <div className="mt-4 h-2.5 bg-sheen/15 rounded-full overflow-hidden">
          <div className="h-full bg-sun-400 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        {/* Stars and badges are different things, so say so rather than letting
            the page imply badges are bought with stars. */}
        <p className="text-white/60 text-[11px] font-semibold mt-3">
          Stars come from every graded activity — 3 for 90 and above, 2 for 85–89, 1 for a passing mark.
          Badges are separate one-off achievements.
        </p>
      </div>

      {/* ── Earned ── */}
      {unlocked.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-extrabold text-navy-400 uppercase tracking-wider mb-4">Earned Badges</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {unlocked.map(badge => {
              const style = styleFor(badge);
              const Icon = style.icon;
              return (
                <div key={badge.id} className={cn('p-5 rounded-3xl border-2 flex items-center gap-4', style.shell)}>
                  <div className={cn('p-3.5 rounded-2xl text-white shrink-0 shadow-pop', style.tile)}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-extrabold text-navy-700">{badge.title}</p>
                    <p className="text-xs text-navy-600 mt-0.5">{badge.desc}</p>
                    <p className={cn('text-xs font-extrabold mt-1.5 flex items-center gap-1', style.ink)}>
                      <Star className="w-3 h-3 fill-current" /> Earned
                      {/* Said out loud, because a badge somebody chose to give
                          you means something a rule you cleared does not. */}
                      {badge.custom && <span className="font-bold text-navy-500">· from your teacher</span>}
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
            {locked.map(badge => {
              const style = styleFor(badge);
              const Icon = style.icon;
              const remaining = Math.max(0, (badge.target ?? 1) - (badge.progress ?? 0));
              // A teacher's badge is one activity at one mark, so "0 of 1" says
              // nothing a learner can act on. Their best attempt against the bar
              // does — and a bar with no attempt behind it yet is honestly
              // reported as not started rather than as a zero score.
              const barLine = badge.custom && badge.passingScore
                ? (badge.bestPercent === null
                    ? `Score ${badge.passingScore}% or higher to earn this`
                    : `Your best so far is ${badge.bestPercent}% — you need ${badge.passingScore}%`)
                : null;
              return (
                <div key={badge.id} className="p-5 rounded-3xl border-2 border-cream-200 bg-cream-50 flex items-center gap-4">
                  <div className="p-3.5 bg-white rounded-2xl relative shrink-0 border-2 border-cream-200">
                    <Icon className="w-7 h-7 text-navy-200" />
                    <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-navy-300 grid place-items-center">
                      <Lock className="w-3 h-3 text-white" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-extrabold text-navy-400">{badge.title}</p>
                    <p className="text-xs text-navy-400 mt-0.5">{badge.desc}</p>
                    {/* Progress in the badge's own unit — activities, strategies,
                        essays — not a star count it has nothing to do with. For
                        a teacher's badge the unit is the mark itself, so the bar
                        below fills toward the score rather than toward a count
                        of one. */}
                    <div className="mt-2 h-1.5 bg-cream-200 rounded-full overflow-hidden">
                      <div className="h-full bg-navy-300 rounded-full transition-all"
                        style={{
                          width: barLine
                            ? `${Math.min(100, Math.round(((badge.bestPercent ?? 0) / badge.passingScore) * 100))}%`
                            : `${Math.round(((badge.progress ?? 0) / (badge.target || 1)) * 100)}%`,
                        }} />
                    </div>
                    <p className="text-xs font-extrabold text-navy-500 mt-1.5">
                      {barLine || (
                        <>
                          {badge.progress ?? 0} of {badge.target ?? 1}
                          {remaining > 0 && <span className="font-semibold text-navy-400"> — {remaining} to go</span>}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {badges.length === 0 && (
        <p className="text-center text-sm text-navy-400 font-semibold py-12">
          Your badges will appear here once your teacher has graded some of your work.
        </p>
      )}
    </div>
  );
}
