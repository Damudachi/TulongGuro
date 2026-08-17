import { useState, useEffect, useRef } from 'react';
import { Star } from 'lucide-react';
import { API_URL, apiFetch } from '../config';
import { badgeLook } from '../constants/badgeLook';
import { getStoredUser } from '../utils/session';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * The moment a learner is told they won something.
 *
 * Which badges belong here is decided entirely by the server: the dashboard
 * returns `justEarnedBadges`, the badges whose StudentBadge row has no
 * `celebratedAt` yet. That is deliberately not "what was inserted on this
 * request" — a badge awarded by a load the child never looked at is still owed
 * its moment, and this way it waits for them instead of being spent on an empty
 * screen. Dismissing is what marks it spent, so closing the tab mid-celebration
 * brings the rest back next time rather than losing them.
 *
 * Mounted on both student screens that read the dashboard endpoint. The
 * acknowledgement is what stops the two from celebrating the same badge twice.
 */

/** Palette for the shower. Brand colours, so it reads as this app celebrating. */
const CONFETTI_COLORS = ['#EFC521', '#EE2F80', '#3BB8B4', '#9D5FBD', '#2B59C3', '#C5DB3F'];

const PIECE_COUNT = 70;
const LAYOUT_COUNT = 4;

/**
 * The showers are built once, at module load, and then only chosen between.
 *
 * Randomising during render is the obvious way to write this and the wrong one:
 * it is impure, React's lint rules refuse it, and under a re-render the whole
 * shower would re-roll and restart mid-fall — a stutter rather than confetti.
 * Building a handful of fixed layouts up front keeps the generator's randomness
 * (each shower really is random) while the render itself is a pure lookup.
 *
 * Four is plenty: a learner sees one of these per badge, minutes or days apart,
 * and nobody has ever recognised a confetti arrangement.
 */
const CONFETTI_LAYOUTS = Array.from({ length: LAYOUT_COUNT }, () =>
  Array.from({ length: PIECE_COUNT }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    width: `${6 + Math.random() * 6}px`,
    height: `${10 + Math.random() * 8}px`,
    background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    // Staggered, so the shower falls over about a second rather than arriving
    // as one wall of colour.
    animationDelay: `${(Math.random() * 0.9).toFixed(2)}s`,
    animationDuration: `${(2.2 + Math.random() * 1.6).toFixed(2)}s`,
    // Read by the confetti-fall keyframe. Each piece drifts its own way and
    // spins its own amount, which is what stops seventy identical rectangles
    // reading as a screen wipe.
    '--tg-drift': `${Math.round((Math.random() - 0.5) * 240)}px`,
    '--tg-spin': `${Math.round(360 + Math.random() * 720)}deg`,
    // Half the pieces are round. Two shapes is enough to read as confetti; one
    // reads as falling bricks.
    borderRadius: i % 2 === 0 ? '2px' : '50%',
  }))
);

/**
 * Which layout a given badge gets — a hash, so it is the same every time this
 * badge is drawn and different from the badge beside it in the queue. Pure, and
 * therefore safe to call while rendering.
 */
function layoutFor(badgeId) {
  let hash = 0;
  for (let i = 0; i < badgeId.length; i++) hash = (hash * 31 + badgeId.charCodeAt(i)) >>> 0;
  return CONFETTI_LAYOUTS[hash % LAYOUT_COUNT];
}

/**
 * @param badges  the badges owed a celebration, newest last. Safe to pass the
 *                same array on every render — the queue below only advances on
 *                a dismissal.
 * @param paused  hold the celebration back. The student dashboard passes its
 *                welcome modal's state: on the very first grade a learner can
 *                earn several badges on the same load that first opens the
 *                welcome modal, and two stacked modals is nobody's celebration.
 */
export default function BadgeCelebration({ badges, paused = false }) {
  // The queue is copied into state on first arrival rather than read from the
  // prop, so a background refetch of the dashboard cannot reorder or empty the
  // celebration the learner is in the middle of.
  const [queue, setQueue] = useState([]);
  const seen = useRef(new Set());

  useEffect(() => {
    const fresh = (badges || []).filter(b => b?.id && !seen.current.has(b.id));
    if (fresh.length === 0) return;
    fresh.forEach(b => seen.current.add(b.id));
    setQueue(prev => [...prev, ...fresh]);
  }, [badges]);

  const current = paused ? null : queue[0];

  // Dismissing is what spends the moment: only then is the badge marked
  // celebrated, so a learner who never saw this gets it back on their next
  // visit. Fire-and-forget — a failed acknowledgement costs one repeat
  // celebration, which is the harmless direction for this to fail in.
  const dismiss = () => {
    const badge = queue[0];
    setQueue(prev => prev.slice(1));
    if (!badge) return;
    const user = getStoredUser();
    if (!user.id) return;
    apiFetch(`${API_URL}/api/student/${user.id}/badges/celebrated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badgeIds: [badge.id] }),
    }).catch(() => {});
  };

  if (!current) return null;

  const style = badgeLook(current);
  const Icon = style.icon;
  const confetti = layoutFor(current.id);
  const remaining = queue.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-celebration-title"
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ink-900/60 backdrop-blur-sm"
    >
      {/* Behind the card and ignored by assistive tech: it carries no
          information the card does not already say in words. `overflow-hidden`
          keeps the drifting pieces from widening the page — a horizontal
          scrollbar on a full-screen overlay is its own small disaster. */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Keyed on the badge as well as the index, so moving to the next badge
            in the queue remounts every piece and the shower actually replays
            instead of React reusing seventy mid-animation elements. */}
        {confetti.map((piece, i) => (
          <span key={`${current.id}-${i}`} className="tg-confetti-piece animate-confetti-fall" style={piece} />
        ))}
      </div>

      <div className={cn(
        'relative bg-white rounded-[2rem] w-full max-w-sm overflow-hidden shadow-card-lg animate-pop-in text-center'
      )}>
        <div className={cn('px-8 pt-8 pb-6', style.shell, 'border-b-2')}>
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-navy-500">
            {current.custom ? 'A badge from your teacher' : 'New badge earned'}
          </p>

          <div className={cn(
            'w-24 h-24 rounded-[1.75rem] grid place-items-center mx-auto my-5 text-white shadow-pop animate-badge-land',
            style.tile
          )}>
            <Icon className="w-12 h-12" />
          </div>

          <h2 id="badge-celebration-title" className="font-display text-2xl font-extrabold text-navy-700">
            {current.title}
          </h2>
          <p className="text-sm text-navy-600 mt-1.5">{current.desc}</p>
        </div>

        <div className="px-8 pt-5 pb-7">
          {/* The mark that did it. This is the whole point of the moment for a
              badge attached to an activity — "you got 88%, you needed 80%" is
              the sentence a child repeats to somebody at home. */}
          {current.custom && current.passingScore != null && current.bestPercent != null && (
            <p className={cn('text-sm font-extrabold flex items-center justify-center gap-1.5 mb-4', style.ink)}>
              <Star className="w-4 h-4 fill-current" />
              You scored {current.bestPercent}% — you needed {current.passingScore}%
            </p>
          )}

          <button
            onClick={dismiss}
            autoFocus
            className="w-full rounded-full py-3.5 font-bold text-sm text-white bg-royal-500 shadow-pop
                       hover:bg-royal-700 active:translate-y-1 active:shadow-none transition-all"
          >
            {remaining > 0 ? `Next badge (${remaining} more)` : 'Awesome!'}
          </button>
        </div>
      </div>
    </div>
  );
}
