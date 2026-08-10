/**
 * badges.js — what each badge means, and whether it has been earned.
 *
 * Pure. No Prisma, no Express, no clock. Everything here is a function of one
 * learner's graded work plus the school's passing grade, so every condition is
 * testable without a database — which matters, because a badge that says a
 * child did something they did not do is the failure this module exists to
 * prevent. The page used to unlock every badge on a star count: "Read and
 * applied 3 reading strategies" opened at 3 stars, which one 90+ essay grants.
 *
 * Class rank is the one condition that cannot be answered from the learner's
 * own work, so it arrives as a precomputed boolean (`rankTop3`) rather than a
 * query. `null` means "not determined" — not "no".
 *
 * `progress`/`target` are counts in the badge's own unit, so the UI renders
 * "2 of 3" without knowing what any badge measures.
 */

/**
 * One learner's graded work, oldest first, in the shape every condition below
 * reads. Ordering is by when the mark was given (`gradedAt`), falling back to
 * when the work arrived — "improved on a later activity" is meaningless
 * without a stable order, and the dashboard hands these over newest-first.
 */
function normalise(submissions) {
  return (submissions || [])
    .map(s => {
      const percent = s.hitlScore ?? s.aiScore ?? null;
      return {
        percent,
        // Subject is the unit a comeback is judged in — recovering in Maths
        // says nothing about English. Grade level joins the key for the same
        // reason it does in the gradebook: Grade 5 English is not Grade 6's.
        subject: `${s.activity?.class?.subject || ''}|${s.activity?.class?.gradeLevel || ''}`,
        type: (s.activity?.type || '').toLowerCase(),
        isLate: !!s.isLate,
        readingStrategy: s.readingStrategy,
        skillScores: s.skillScores,
        at: new Date(s.gradedAt || s.createdAt || 0).getTime(),
      };
    })
    .filter(s => s.percent !== null)
    .sort((a, b) => a.at - b.at);
}

/** Work grouped by subject, each group still oldest-first. */
function bySubject(graded) {
  const groups = new Map();
  for (const s of graded) {
    if (!groups.has(s.subject)) groups.set(s.subject, []);
    groups.get(s.subject).push(s);
  }
  return groups;
}

/**
 * Did the learner score below `passingGrade` and then, *later in that same
 * subject*, reach it?
 *
 * The order matters and is the whole condition: a strong start followed by a
 * dip is not a comeback. `threshold` lets the rarer Turnaround badge reuse the
 * identical walk with a higher bar.
 */
function recoveredInSomeSubject(graded, passingGrade, threshold = passingGrade) {
  for (const group of bySubject(graded).values()) {
    let seenFailure = false;
    for (const s of group) {
      if (seenFailure && s.percent >= threshold) return true;
      if (s.percent < passingGrade) seenFailure = true;
    }
  }
  return false;
}

/** Longest run of consecutive marks each strictly higher than the one before. */
function longestClimb(graded) {
  let best = graded.length ? 1 : 0;
  let run = best;
  for (let i = 1; i < graded.length; i++) {
    run = graded[i].percent > graded[i - 1].percent ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Did any mark beat every earlier mark in the same subject? */
function beatOwnBest(graded) {
  for (const group of bySubject(graded).values()) {
    for (let i = 1; i < group.length; i++) {
      const bestBefore = Math.max(...group.slice(0, i).map(s => s.percent));
      if (group[i].percent > bestBefore) return true;
    }
  }
  return false;
}

/** Longest run of consecutive submissions that were not late. */
function longestOnTimeRun(graded) {
  let best = 0, run = 0;
  for (const s of graded) {
    run = s.isLate ? 0 : run + 1;
    if (run > best) best = run;
  }
  return best;
}

/** Full marks on either language-mechanics skill. Both are scored out of 25. */
function perfectMechanicsCount(graded) {
  return graded.filter(s => {
    if (!s.skillScores) return false;
    try {
      const sk = JSON.parse(s.skillScores);
      return sk.punctuation >= 25 || sk.sentenceStructure >= 25;
    } catch { return false; }
  }).length;
}

function strategyCount(graded) {
  return graded.filter(s =>
    s.readingStrategy &&
    s.readingStrategy.trim() &&
    !/^n\/?a$/i.test(s.readingStrategy.trim())
  ).length;
}

/**
 * Every badge, with progress toward it.
 *
 * @param submissions  the learner's submissions, any order
 * @param passingGrade the school's own threshold — never a hardcoded 75
 * @param rankTop3     true/false if section standing was computed, null if not
 */
function computeBadges(submissions, passingGrade, { rankTop3 = null } = {}) {
  const graded = normalise(submissions);

  const outstanding = graded.filter(s => s.percent >= 90).length;
  const strategies = strategyCount(graded);
  const perfectGrammar = perfectMechanicsCount(graded);
  const essays = graded.filter(s => s.type.includes('essay')).length;
  const subjects = new Set(graded.map(s => s.subject)).size;

  // Honour roll is a *sustained* average, so it needs both the volume and the
  // mean — five 90s, not one lucky 98.
  const overallAvg = graded.length
    ? graded.reduce((sum, s) => sum + s.percent, 0) / graded.length
    : 0;
  const honourEarned = graded.length >= 5 && overallAvg >= 90;

  const climb = longestClimb(graded);
  const onTimeRun = longestOnTimeRun(graded);

  const defs = [
    // ── The original five ──
    { id: 'first-star', title: 'First Star', icon: 'star',
      desc: 'Scored 90 or above on a graded activity',
      progress: Math.min(outstanding, 1), target: 1 },
    { id: 'bookworm', title: 'Bookworm', icon: 'book',
      desc: 'Received 3 personalised reading strategies',
      progress: Math.min(strategies, 3), target: 3 },
    { id: 'grammar-master', title: 'Grammar Master', icon: 'zap',
      desc: 'Perfect punctuation or sentence-structure score on any activity',
      progress: Math.min(perfectGrammar, 1), target: 1 },
    { id: 'honor-student', title: 'Honor Student', icon: 'trophy',
      desc: 'Averaged 90 or above across at least 5 graded activities',
      progress: honourEarned ? 5 : Math.min(graded.length, 4), target: 5 },
    { id: 'essay-champion', title: 'Essay Champion', icon: 'award',
      desc: 'Completed 10 graded essay submissions',
      progress: Math.min(essays, 10), target: 10 },

    // ── Getting started ──
    { id: 'first-steps', title: 'First Steps', icon: 'flag',
      desc: 'Had your first activity graded',
      progress: Math.min(graded.length, 1), target: 1 },

    // ── Standing among classmates ──
    // Rank is not derivable from this learner's own work. When it has not been
    // computed, progress stays 0 rather than guessing — the badge shows as
    // locked, which is honest, instead of flickering earned and back again.
    { id: 'class-champion', title: 'Class Champion', icon: 'medal',
      desc: 'Placed in the top 3 of your section',
      progress: rankTop3 === true ? 1 : 0, target: 1 },

    // ── Recovery. The reason this whole set was widened: a learner who has
    // been behind and climbed out has done something worth naming, and none of
    // the original five could ever say so. ──
    { id: 'comeback-kid', title: 'Comeback Kid', icon: 'trending-up',
      desc: 'Scored below passing in a subject, then passed it on a later activity',
      progress: recoveredInSomeSubject(graded, passingGrade) ? 1 : 0, target: 1 },
    { id: 'turnaround', title: 'Turnaround', icon: 'rocket',
      desc: 'Climbed from below passing all the way to 90 or above in the same subject',
      progress: recoveredInSomeSubject(graded, passingGrade, 90) ? 1 : 0, target: 1 },
    { id: 'steady-climber', title: 'Steady Climber', icon: 'bar-chart',
      desc: 'Three graded activities in a row, each one better than the last',
      progress: Math.min(climb, 3), target: 3 },
    { id: 'personal-best', title: 'Personal Best', icon: 'target',
      desc: 'Beat your own best score in a subject',
      progress: beatOwnBest(graded) ? 1 : 0, target: 1 },

    // ── Effort, reachable whatever the marks look like ──
    { id: 'always-on-time', title: 'Always On Time', icon: 'clock',
      desc: 'Handed in 5 activities in a row without a single one being late',
      progress: Math.min(onTimeRun, 5), target: 5 },
    { id: 'all-rounder', title: 'All-Rounder', icon: 'compass',
      desc: 'Have graded work in 4 different subjects',
      progress: Math.min(subjects, 4), target: 4 },
    { id: 'dedicated', title: 'Dedicated', icon: 'flame',
      desc: 'Completed 25 graded activities',
      progress: Math.min(graded.length, 25), target: 25 },
    { id: 'strategy-scholar', title: 'Strategy Scholar', icon: 'graduation-cap',
      desc: 'Received 10 personalised reading strategies',
      progress: Math.min(strategies, 10), target: 10 },
  ];

  return defs.map(b => ({ ...b, earned: b.progress >= b.target, passingGrade }));
}

/**
 * Is this learner in the top 3 of their section by general average?
 *
 * Takes averages that are already computed — one entry per student in the
 * section, `{ studentId, average }` — so the ranking rule can be tested
 * without a database or a grading run. Students with no average yet are not
 * ranked at all: an ungraded learner is not "last".
 *
 * Ties share a place, the way a race does. Three learners tied on 95 are all
 * first, and all three are in the top 3.
 */
function isTop3(averages, studentId) {
  const ranked = (averages || []).filter(a => typeof a.average === 'number');
  const mine = ranked.find(a => a.studentId === studentId);
  if (!mine) return false;
  const better = new Set(ranked.filter(a => a.average > mine.average).map(a => a.average));
  return better.size < 3;
}

/** Every badge id this module can award — used to prune stored rows. */
const BADGE_IDS = computeBadges([], 100).map(b => b.id);

module.exports = { computeBadges, isTop3, BADGE_IDS };
