/**
 * One-off backfill for User.schoolId on STUDENT accounts.
 *
 * Run this ONCE after deploying the change that has enrolStudents write
 * schoolId onto new learners.
 *
 * Students used to carry no schoolId of their own and were only attributable
 * to a school by following User -> Section -> School. Two things broke because
 * of that, and both are fixed by the column actually being populated:
 *
 *  1. DUPLICATE ACCOUNTS. Removing a student who has submitted work keeps the
 *     account and only clears sectionId (a deliberate choice — the grades must
 *     survive). That learner then belonged to no section, so the name-matching
 *     in enrolStudents could not see them, and re-enrolling them next term
 *     created a second account under a fresh student id. One child, two
 *     accounts, with every grade they had ever been given stranded on the one
 *     that no roster points at.
 *
 *  2. SESSIONS SURVIVING A SCHOOL REJECTION. The reject-school path ends
 *     sessions with `updateMany({ where: { schoolId: school.id } })`. With
 *     schoolId null on every student, that matched staff only — a school
 *     refused by a platform operator had its admins and teachers signed out
 *     while every pupil stayed logged in until their token expired.
 *
 * The school is read from the student's current section, which is the same
 * resolution the app already does at read time, so this records what was
 * already true rather than deciding anything new.
 *
 * Students who are BOTH section-less and schoolId-less cannot be resolved by
 * this script — there is nothing left to resolve them through. They are listed
 * so they can be reattached by hand; if any exist, do this backfill before
 * anybody re-enrols those names, or the duplicate is created first and the
 * repair becomes a merge.
 *
 *   node scripts/backfill-student-school.js          # report only, changes nothing
 *   node scripts/backfill-student-school.js --apply  # perform the backfill
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', schoolId: null },
    select: {
      id: true, name: true, username: true,
      section: { select: { id: true, name: true, schoolId: true, school: { select: { name: true } } } },
      _count: { select: { submissions: true } },
    },
  });

  const resolvable = students.filter(s => s.section?.schoolId);
  const stranded = students.filter(s => !s.section?.schoolId);

  console.log(`STUDENT accounts with no schoolId: ${students.length}`);
  console.log(`  resolvable through their section: ${resolvable.length}`);
  console.log(`  not resolvable (no section, or a section with no school): ${stranded.length}`);

  if (stranded.length) {
    console.log('\nThese need attention by hand — re-enrol them into a section, which will');
    console.log('set schoolId as a side effect, or set it directly:');
    for (const s of stranded) {
      console.log(`  - ${s.username}  ${s.name}  (${s._count.submissions} submission(s), section: ${s.section?.name || 'none'})`);
    }
  }

  if (!resolvable.length) {
    console.log('\nNothing to backfill.');
    return;
  }

  // Grouped so the whole run is a handful of updateMany calls rather than one
  // per student — the same school covers a whole section at a time.
  const bySchool = new Map();
  for (const s of resolvable) {
    const key = s.section.schoolId;
    if (!bySchool.has(key)) bySchool.set(key, { name: s.section.school?.name || key, ids: [] });
    bySchool.get(key).ids.push(s.id);
  }

  console.log('');
  for (const [schoolId, group] of bySchool) {
    console.log(`  ${group.name}: ${group.ids.length} student(s)`);
    if (apply) {
      await prisma.user.updateMany({ where: { id: { in: group.ids } }, data: { schoolId } });
    }
  }

  console.log(apply
    ? `\nBackfilled ${resolvable.length} student(s).`
    : '\nDry run — nothing was written. Re-run with --apply to perform the backfill.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
