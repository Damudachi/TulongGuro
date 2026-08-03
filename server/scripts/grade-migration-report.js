/**
 * Read-only. Reports every grade that would change if the app switched from
 * its current "mean of each activity's percentage" to the points-weighted
 * DepEd model in grading.js.
 *
 * Writes nothing. Run it, read it, decide — then the cutover is a deliberate
 * announced change rather than something that quietly shifts after a deploy.
 *
 *   node scripts/grade-migration-report.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { computeGrade, legacyAverage, defaultPolicyFor, PASSING_GRADE } = require('../grading');

const prisma = new PrismaClient();
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const num = (v, n = 5) => String(v ?? '—').padStart(n);

(async () => {
  const subs = await prisma.submission.findMany({
    where: { status: 'GRADED' },
    include: { activity: { include: { class: true } }, student: true },
  });

  const graded = subs
    .map(s => ({
      studentId: s.studentId,
      studentName: s.student?.name || s.studentId,
      classId: s.activity?.classId || 'none',
      className: s.activity?.class?.name || '(no class)',
      subject: s.activity?.class?.subject || '',
      percent: s.hitlScore ?? s.aiScore ?? null,
      points: s.activity?.points || 100,
      // No activity carries a component yet, so everything lands in Written
      // Work. That makes this report a clean measurement of the fairness fix
      // alone — component weighting changes nothing until they are assigned.
      component: 'WW',
    }))
    .filter(g => typeof g.percent === 'number');

  // ── Per student, per class: this is the unit a quarter grade is issued in ──
  const byKey = new Map();
  for (const g of graded) {
    const key = `${g.studentId}|${g.classId}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }

  console.log('\nPER-CLASS GRADES  (the unit a report card actually uses)\n');
  console.log(pad('Student', 20), pad('Class', 22), num('now'), num('fair'), num('trans'), ' change');
  console.log('-'.repeat(78));

  let changed = 0, unchanged = 0, crossings = [];
  const rows = [...byKey.values()].sort((a, b) =>
    a[0].studentName.localeCompare(b[0].studentName));

  for (const work of rows) {
    const { studentName, className, subject } = work[0];
    const now = legacyAverage(work);
    const result = computeGrade(work, defaultPolicyFor(subject));
    const fair = Math.round(result.initialGrade);
    const trans = result.transmutedGrade;

    const delta = trans - now;
    if (delta === 0) unchanged++; else changed++;

    // The only difference that changes a decision: crossing the passing line.
    const wasPassing = now >= PASSING_GRADE;
    const nowPassing = trans >= PASSING_GRADE;
    if (wasPassing !== nowPassing) {
      crossings.push({ studentName, className, now, trans, nowPassing });
    }

    const mark = delta === 0 ? '' : (delta > 0 ? `  +${delta}` : `  ${delta}`);
    console.log(pad(studentName, 20), pad(className, 22), num(now), num(fair), num(trans), mark);
  }

  console.log('\n  now   = what the app displays today (mean of activity percentages)');
  console.log('  fair  = points-weighted Initial Grade (total earned / total possible)');
  console.log('  trans = Initial Grade put through the DepEd transmutation table');

  console.log(`\nSUMMARY`);
  console.log(`  grades that change : ${changed}`);
  console.log(`  grades unchanged   : ${unchanged}`);

  if (crossings.length === 0) {
    console.log(`  pass/fail flips    : 0  (nobody crosses the ${PASSING_GRADE} line)`);
  } else {
    console.log(`  pass/fail flips    : ${crossings.length}  <-- review these individually`);
    for (const c of crossings) {
      console.log(`     ${c.studentName} / ${c.className}: ${c.now} -> ${c.trans} ` +
        `(now ${c.nowPassing ? 'PASSING' : 'FAILING'})`);
    }
  }

  // The transmutation table has a floor of 60, so it only ever raises a grade.
  // Worth stating plainly: it is not a curve teachers opted into.
  console.log('\nNOTE  Transmutation never lowers a grade — its floor is 60. If these');
  console.log('      numbers look inflated, that is the table doing what it specifies,');
  console.log('      and it is the "trans" column, not the fairness fix, causing it.');

  await prisma.$disconnect();
})();
