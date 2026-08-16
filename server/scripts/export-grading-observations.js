/**
 * Read-only export for the Alpha-stage automated technical observation (AM34.1).
 *
 * Writes nothing to the database and touches no submission. It reads what the
 * system already persisted and emits two CSVs for the Python/Scikit-learn side
 * to compute the confusion matrix, Accuracy, per-band Precision/Recall and
 * macro-F1 from:
 *
 *   grading-observations.csv — one row per graded paper: the AI's draft score,
 *     the teacher's validated score, both classified into DepEd descriptor
 *     bands, the signed and absolute difference, and whether the teacher edited
 *     the score or the feedback at Human-in-the-Loop review.
 *
 *   ai-requests.csv — one row per request sent to the model provider: latency
 *     and outcome, so per-request latency and the day's real consumption
 *     against the daily allowance can be computed rather than estimated.
 *
 * ── Why it reads GradingAuditLog rather than Submission ──
 *
 * Submission.aiScore and hitlScore are current state, not history. A paper
 * re-checked after validation has its aiScore cleared (UNGRADED_RESET), and a
 * teacher who revises a mark overwrites hitlScore in place — so a script
 * reading the submission row would silently lose exactly the pairs the study is
 * about. GradingAuditLog is append-only and records AI_GRADED and
 * TEACHER_VALIDATED as separate events with their own scores and timestamps,
 * which is the pairing this export needs. Where a submission has several of
 * either (a re-check, a revision), the FIRST AI draft and the LAST teacher
 * decision are taken: the draft the teacher was actually shown, and the mark
 * that ended up standing.
 *
 * ── Bands ──
 *
 * Classified with grading.bandKeyFor(), the same function the app itself uses,
 * against the passing grade of the school the paper belongs to. Passing grade
 * is per-school and configurable, so a hardcoded DO 8 s.2015 ladder would
 * produce a matrix that disagrees with what the teacher was shown on screen.
 *
 * ── Identifiers ──
 *
 * No names, no usernames, no feedback text, no image URLs. Student and school
 * ids are emitted as short salted hashes so repeated papers by one learner can
 * still be grouped without carrying an identifier out of the database. The salt
 * is per-run unless OBSERVATION_SALT is set — set it if you need two exports to
 * group consistently.
 *
 *   node scripts/export-grading-observations.js [--out ./observations] [--since 2026-08-01]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const grading = require('../grading');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT_DIR = path.resolve(argOf('--out', path.join(__dirname, '..', 'observations')));
const SINCE = argOf('--since', null);

/** Stable within a run; stable across runs only if OBSERVATION_SALT is set. */
const SALT = process.env.OBSERVATION_SALT || crypto.randomBytes(16).toString('hex');
const pseudonym = (id) => (id
  ? crypto.createHash('sha256').update(SALT + id).digest('hex').slice(0, 12)
  : '');

/** RFC 4180 enough: quote everything that could contain a comma or a quote. */
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

/**
 * The one draft and the one decision a paper is observed on.
 *
 * A submission can carry several of either — a re-check writes a second
 * AI_GRADED, a teacher revising a mark writes a second TEACHER_VALIDATED. The
 * pair that describes the human-in-the-loop moment is the FIRST draft (what the
 * teacher was actually shown) and the LAST decision (the mark that stands).
 * Returns null when there is no pair to observe: a paper with no AI draft was
 * never a machine judgement, and one with no validation has not been through
 * review yet. Either would otherwise enter the matrix as a comparison against
 * nothing.
 */
function selectPair(events) {
  const ai = events.find(e => e.event === 'AI_GRADED');
  const validations = events.filter(e => e.event === 'TEACHER_VALIDATED');
  const teacher = validations[validations.length - 1];
  if (!ai || !teacher) return null;
  if (ai.score === null || ai.score === undefined) return null;
  if (teacher.score === null || teacher.score === undefined) return null;
  return { ai, teacher, released: events.some(e => e.event === 'RELEASED') };
}

function writeCsv(file, header, rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const full = path.join(OUT_DIR, file);
  fs.writeFileSync(full, [csvRow(header), ...rows.map(csvRow)].join('\n') + '\n', 'utf8');
  return full;
}

/** p50/p95 without pulling in a stats dependency. Sorted copy, nearest rank. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

async function main() {
  const createdFilter = SINCE ? { createdAt: { gte: new Date(SINCE) } } : {};

  // ── Passing grade per school, so bands are the ones the teacher saw ──
  const schools = await prisma.school.findMany({ select: { id: true, passingGrade: true } });
  const passingBySchool = new Map(schools.map(s => [s.id, s.passingGrade ?? grading.PASSING_GRADE]));

  // ── The audit trail, oldest first ──
  const events = await prisma.gradingAuditLog.findMany({
    where: { ...createdFilter, event: { in: ['AI_GRADED', 'TEACHER_VALIDATED', 'RELEASED'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      submissionId: true, event: true, score: true, actorId: true,
      studentId: true, activityId: true, activityTitle: true, schoolId: true, createdAt: true,
    },
  });

  const bySubmission = new Map();
  for (const e of events) {
    if (!e.submissionId) continue;   // purged submission: no pair to build
    if (!bySubmission.has(e.submissionId)) bySubmission.set(e.submissionId, []);
    bySubmission.get(e.submissionId).push(e);
  }

  // Feedback is read from the submission itself — the audit log deliberately
  // stores scores only. Absent rows (purged) simply leave the flag blank.
  const submissions = await prisma.submission.findMany({
    where: { id: { in: [...bySubmission.keys()] } },
    select: { id: true, aiFeedback: true, hitlFeedback: true, activity: { select: { points: true, type: true, submissionMode: true } } },
  });
  const subById = new Map(submissions.map(s => [s.id, s]));

  const rows = [];
  let editedScore = 0, editedFeedback = 0, touchedEither = 0;
  const absDeltas = [];

  for (const [submissionId, evs] of bySubmission) {
    const pair = selectPair(evs);
    if (!pair) continue;
    const { ai: aiEvent, teacher: teacherEvent, released } = pair;

    const passingGrade = passingBySchool.get(teacherEvent.schoolId || aiEvent.schoolId) ?? grading.PASSING_GRADE;
    const aiBand = grading.bandKeyFor(aiEvent.score, passingGrade);
    const teacherBand = grading.bandKeyFor(teacherEvent.score, passingGrade);
    const signedDelta = Number((teacherEvent.score - aiEvent.score).toFixed(4));
    const absDelta = Math.abs(signedDelta);
    const sub = subById.get(submissionId);
    // "Edited" is a change to the text of record, not merely its presence: a
    // teacher who accepted the AI's wording unchanged has not overridden it.
    const feedbackEdited = sub
      ? !!(sub.hitlFeedback && sub.hitlFeedback.trim() && sub.hitlFeedback.trim() !== (sub.aiFeedback || '').trim())
      : null;
    const scoreEdited = absDelta > 0;

    if (scoreEdited) editedScore++;
    if (feedbackEdited) editedFeedback++;
    if (scoreEdited || feedbackEdited) touchedEither++;
    absDeltas.push(absDelta);

    rows.push([
      pseudonym(submissionId),
      pseudonym(teacherEvent.studentId || aiEvent.studentId),
      pseudonym(teacherEvent.schoolId || aiEvent.schoolId),
      pseudonym(teacherEvent.actorId),
      aiEvent.activityId || teacherEvent.activityId || '',
      sub?.activity?.type || '',
      sub?.activity?.submissionMode || '',
      sub?.activity?.points ?? '',
      passingGrade,
      aiEvent.score,
      teacherEvent.score,
      aiBand,
      teacherBand,
      signedDelta,
      absDelta,
      scoreEdited ? 1 : 0,
      feedbackEdited === null ? '' : (feedbackEdited ? 1 : 0),
      (scoreEdited || feedbackEdited) ? 1 : 0,
      released ? 1 : 0,
      aiEvent.createdAt.toISOString(),
      teacherEvent.createdAt.toISOString(),
      // How long the paper waited for a human decision. Reported because the
      // pairing is only meaningful if a teacher actually looked at the draft.
      Math.round((teacherEvent.createdAt - aiEvent.createdAt) / 1000),
    ]);
  }

  const observationsFile = writeCsv('grading-observations.csv', [
    'submission', 'student', 'school', 'teacher',
    'activityId', 'activityType', 'submissionMode', 'activityPoints', 'passingGrade',
    'aiScore', 'teacherScore', 'aiBand', 'teacherBand',
    'signedDelta', 'absDelta',
    'scoreEdited', 'feedbackEdited', 'editedEither', 'released',
    'aiGradedAt', 'validatedAt', 'secondsToValidation',
  ], rows);

  // ── Requests to the provider ──
  const requests = await prisma.aiRequestLog.findMany({
    where: createdFilter,
    orderBy: { createdAt: 'asc' },
    select: { purpose: true, model: true, attempt: true, latencyMs: true, ok: true, outcome: true, createdAt: true },
  });
  const requestsFile = writeCsv('ai-requests.csv',
    ['purpose', 'model', 'attempt', 'latencyMs', 'ok', 'outcome', 'createdAt'],
    requests.map(r => [r.purpose, r.model || '', r.attempt, r.latencyMs, r.ok ? 1 : 0, r.outcome, r.createdAt.toISOString()]));

  // ── Summary, so the run is readable without opening the CSVs ──
  const gradingReqs = requests.filter(r => r.purpose === 'GRADING');
  const latencies = gradingReqs.filter(r => r.ok).map(r => r.latencyMs).sort((a, b) => a - b);
  const byDay = new Map();
  for (const r of requests) {
    const day = r.createdAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const meanAbs = absDeltas.length
    ? (absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length).toFixed(2)
    : '—';
  const pctOf = (n) => (rows.length ? `${((n / rows.length) * 100).toFixed(1)}%` : '—');

  console.log(`\nAM34.1 — automated technical observation export`);
  console.log(`  ${observationsFile}`);
  console.log(`  ${requestsFile}\n`);
  console.log(`Graded papers with an AI draft AND a teacher decision : ${rows.length}`);
  console.log(`  score changed at review                             : ${editedScore} (${pctOf(editedScore)})`);
  console.log(`  feedback edited at review                           : ${editedFeedback} (${pctOf(editedFeedback)})`);
  console.log(`  either                                              : ${touchedEither} (${pctOf(touchedEither)})`);
  console.log(`  mean |teacher − AI|                                 : ${meanAbs} percentage points`);
  console.log(`\nProvider requests logged                             : ${requests.length}`);
  console.log(`  grading requests                                    : ${gradingReqs.length} (${gradingReqs.filter(r => !r.ok).length} failed)`);
  if (latencies.length) {
    console.log(`  grading latency p50 / p95 / max (ms)                : ${percentile(latencies, 50)} / ${percentile(latencies, 95)} / ${latencies[latencies.length - 1]}`);
  }
  for (const [day, count] of [...byDay.entries()].sort()) {
    console.log(`  requests on ${day}                              : ${count}`);
  }
  if (requests.length === 0) {
    console.log(`\n  No request rows yet. AiRequestLog fills as grading runs — if this`);
    console.log(`  is unexpected, check the migration has been applied to this database.`);
  }
  // Said plainly: per-band precision and recall are unstable on small supports,
  // and the Alpha set is small by construction.
  const bandSupport = rows.reduce((acc, r) => {
    acc[r[12]] = (acc[r[12]] || 0) + 1;   // teacherBand column
    return acc;
  }, {});
  console.log(`\nPapers per teacher-assigned band (the matrix's support):`);
  for (const [band, n] of Object.entries(bandSupport).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${band.padEnd(20)} ${n}`);
  }
  console.log(`\nReport per-band support alongside precision/recall — a band with a`);
  console.log(`handful of papers will swing on a single one.\n`);
}

// Only runs when invoked directly, so the pure helpers above can be imported by
// tests without opening a database connection or writing any files.
if (require.main === module) {
  main()
    .catch(e => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}

module.exports = { csvCell, csvRow, selectPair, percentile };
