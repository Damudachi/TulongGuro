/**
 * One-off backfill for Submission.releasedAt.
 *
 * Run this ONCE, immediately after `npx prisma db push` adds the column.
 *
 * Students now only see submissions where releasedAt is set. Every row that
 * already existed has releasedAt = null, so without this backfill every grade
 * ever returned would disappear from every student dashboard the moment the new
 * code deploys. Work that was already GRADED was, under the old rules, already
 * visible to the student — so it is already released, and this records that.
 *
 *   node scripts/backfill-released-at.js          # report only, changes nothing
 *   node scripts/backfill-released-at.js --apply  # perform the backfill
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const pending = await prisma.submission.findMany({
    where: { status: 'GRADED', releasedAt: null },
    select: { id: true, gradedAt: true, updatedAt: true }
  });

  console.log(`GRADED submissions with no releasedAt: ${pending.length}`);
  if (!pending.length) {
    console.log('Nothing to backfill.');
    return;
  }
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to backfill.');
    console.log('Each row would get releasedAt = its gradedAt (or updatedAt when gradedAt is null).');
    return;
  }

  let done = 0;
  for (const sub of pending) {
    await prisma.submission.update({
      where: { id: sub.id },
      // gradedAt is when the teacher validated it, which is the moment it became
      // visible under the old rules. updatedAt is the fallback for older rows
      // written before gradedAt was populated.
      data: { releasedAt: sub.gradedAt ?? sub.updatedAt ?? new Date() }
    });
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${pending.length}`);
  }
  console.log(`\nBackfilled ${done} submission(s).`);

  const remaining = await prisma.submission.count({ where: { status: 'GRADED', releasedAt: null } });
  console.log(remaining === 0 ? 'Verified: no GRADED submission is left unreleased.' : `WARNING: ${remaining} still unreleased.`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
