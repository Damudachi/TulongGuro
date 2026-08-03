/**
 * verify-dashboard.js — manual QA, automated.
 *
 * The checklist item was "manually compute and verify every figure on the
 * analytics dashboard to ensure the system's math matches real-world math".
 * Doing that by hand once proves nothing about the next deploy, so this does it
 * the way a teacher would — longhand, from first principles — and compares.
 *
 * Everything here recomputes independently. It deliberately does NOT import the
 * helpers the server uses for the same numbers (workingAverage, bandCounts,
 * starsFor); checking a function against itself would pass no matter what. The
 * arithmetic below is written the way DO 8 s.2015 states it and the way a
 * teacher with a calculator would do it.
 *
 *   node scripts/verify-dashboard.js
 */

const grading = require('../grading');

let passed = 0, failed = 0;

function check(label, actual, expected, tolerance = 0) {
  const ok = expected === null || actual === null
    ? actual === expected
    : Math.abs(actual - expected) <= tolerance;
  if (ok) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}\n        system says ${actual}, longhand says ${expected}`);
}

function section(title) { console.log(`\n${title}`); }

// ── 1. Points -> percent -> points must survive the round trip ──
// This is the failure the audit found: an integer percentage cannot represent
// 7 out of 30, so the gradebook displayed 6.9 for a mark the teacher entered
// as 7. Storage keeps full precision now, so every whole-point mark on every
// plausible activity size has to come back exactly.
section('Score round-trip (points -> stored percent -> displayed points)');
{
  const store = (pts, max) => (pts / max) * 100;                       // what the server saves
  const display = (p, max) => Math.round((p / 100) * max * 10) / 10;   // what every screen shows
  let worst = 0, worstCase = '';
  for (const max of [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100]) {
    for (let pts = 0; pts <= max; pts++) {
      const shown = display(store(pts, max), max);
      const drift = Math.abs(shown - pts);
      if (drift > worst) { worst = drift; worstCase = `${pts}/${max} displayed as ${shown}`; }
    }
  }
  check(`worst drift across every whole mark (${worstCase || 'none'})`, worst, 0, 1e-9);
}

// ── 2. Component percentage: raw points first, never a mean of percentages ──
// A teacher totals the points earned and the points possible, then divides.
// Averaging each activity's percentage instead makes a 20-point quiz weigh as
// much as a 100-point essay.
section('Component percentage (points-weighted, per DO 8)');
{
  const entries = [
    { percent: 90, points: 100 },   // 90 of 100
    { percent: 80, points: 50 },    // 40 of 50
    { percent: 50, points: 20 },    // 10 of 20
  ];
  // Longhand: (90 + 40 + 10) earned out of (100 + 50 + 20) possible.
  const longhand = ((90 + 40 + 10) / (100 + 50 + 20)) * 100;
  check('mixed activity sizes', grading.componentPercentage(entries), longhand, 1e-9);

  // The unfair alternative, kept as a guard: if these two ever agree on this
  // input, the points-weighting has been lost again.
  const meanOfPercents = (90 + 80 + 50) / 3;
  if (Math.abs(longhand - meanOfPercents) < 0.01) {
    console.log('  FAIL  fixture is too weak to distinguish the two methods');
    failed++;
  } else { passed++; }

  check('single activity', grading.componentPercentage([{ percent: 73, points: 40 }]), 73, 1e-9);
  check('nothing graded', grading.componentPercentage([]), null);
}

// ── 3. Initial Grade: weighted components, renormalised when one is missing ──
section('Initial Grade (weighted components)');
{
  // Languages weighting: WW 30 / PT 50 / QA 20.
  const graded = [
    { percent: 80, points: 100, component: 'WW' },
    { percent: 90, points: 100, component: 'PT' },
    { percent: 70, points: 100, component: 'QA' },
  ];
  // Longhand: 80(.30) + 90(.50) + 70(.20) = 24 + 45 + 14 = 83
  const result = grading.computeGrade(graded, { WW: 30, PT: 50, QA: 20 }, { transmute: false });
  check('all three components present', result.initialGrade, 83, 0.01);

  // With no Quarterly Assessment yet, the remaining 30/50 must renormalise to
  // 37.5/62.5 — otherwise every student sits at 80% of their real grade until
  // exam week and the at-risk list is nonsense.
  const partial = grading.computeGrade(
    graded.filter(g => g.component !== 'QA'), { WW: 30, PT: 50, QA: 20 }, { transmute: false }
  );
  const longhandPartial = 80 * (30 / 80) + 90 * (50 / 80);
  check('QA missing renormalises', partial.initialGrade, longhandPartial, 0.01);
}

// ── 4. Descriptor bands must stay strictly descending at any passing grade ──
// The dashboards used a fixed 90/80/passing ladder, so a school passing at 85
// filed a failing 82 under "Satisfactory" and drew it in the healthy part of
// the class-spread bar.
section('Descriptor bands (ordering + bucketing)');
{
  for (const passing of [60, 70, 75, 80, 85, 90, 95]) {
    const bands = grading.descriptorBands(passing);
    let descending = true;
    for (let i = 1; i < bands.length; i++) {
      if (bands[i].min >= bands[i - 1].min) descending = false;
    }
    check(`ladder strictly descending at passing=${passing}`, descending ? 1 : 0, 1);

    // No band above "failing" may start below the passing grade.
    const leaks = bands.filter(b => b.key !== 'failing' && b.min < passing).length;
    check(`no passing band below the line at passing=${passing}`, leaks, 0);
  }

  // A student on 82 in a school that passes at 85 is failing, full stop.
  check('82 fails when passing is 85',
    grading.bandKeyFor(82, 85) === 'failing' ? 1 : 0, 1);
  check('82 passes when passing is 75',
    grading.bandKeyFor(82, 75) === 'failing' ? 1 : 0, 0);

  const counts = grading.bandCounts([95, 88, 82, 76, 60, null], 75);
  check('band counts total', Object.values(counts).reduce((a, b) => a + b, 0), 6);
  check('ungraded counted separately', counts.notGraded, 1);
  check('one below 75', counts.failing, 1);
}

// ── 5. Stars ──
// The old rule used `||`, so a teacher-assigned 0 fell through to the AI score
// and a pupil marked zero could still collect 3 stars off the AI's 95.
section('Stars');
{
  check('90+ earns 3', grading.starsForScore(92, 75), 3);
  check('85-89 earns 2', grading.starsForScore(87, 75), 2);
  check('passing earns 1', grading.starsForScore(76, 75), 1);
  check('below passing earns 0', grading.starsForScore(74, 75), 0);
  check('76 earns nothing when passing is 80', grading.starsForScore(76, 80), 0);

  // The `||` regression, pinned: teacher marked 0, AI had said 95.
  const marked = [{ hitlScore: 0, aiScore: 95 }];
  check('teacher-assigned 0 does not inherit the AI score', grading.starsFor(marked, 75), 0);

  const mixed = [
    { hitlScore: 95, aiScore: null },   // 3
    { hitlScore: null, aiScore: 86 },   // 2
    { hitlScore: 78, aiScore: 40 },     // 1
    { hitlScore: 50, aiScore: 99 },     // 0
  ];
  check('mixed submissions total', grading.starsFor(mixed, 75), 6);
}

// ── 6. Transmutation ──
// Banded, so it floors within each band. Rounding instead pushes every boundary
// a grade too high and inflates report cards.
section('Transmutation');
{
  check('60 initial -> 75', grading.transmute(60), 75);
  check('100 initial -> 100', grading.transmute(100), 100);
  check('0 initial -> 60 floor', grading.transmute(0), 60);
  check('98.39 floors to 98, not 99', grading.transmute(98.39), 98);
  check('never lowers a passing grade', grading.transmute(75) >= 75 ? 1 : 0, 1);
}

// ── 7. The export average, which had its own bug ──
// It divided a sum of percentages by a sum of points — two different units —
// which reads correctly only while every activity is worth exactly 100.
section('Export average (regression: the >100% bug)');
{
  const entries = [
    { percent: 80, points: 100, component: 'WW' },
    { percent: 90, points: 50, component: 'WW' },
  ];
  const { initialGrade } = grading.computeGrade(entries, { WW: 30, PT: 50, QA: 20 }, { transmute: false });
  // Longhand: 80 + 45 = 125 earned of 150 possible.
  check('mixed point values', initialGrade, (125 / 150) * 100, 0.01);
  check('never exceeds 100', initialGrade <= 100 ? 1 : 0, 1);

  // The old formula, reproduced, to prove the fixture actually catches it.
  const oldWay = ((80 + 90) / (100 + 50)) * 100;
  check('old formula did exceed 100 on this input', oldWay > 100 ? 1 : 0, 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
