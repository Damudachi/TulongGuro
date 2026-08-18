/**
 * One-off backfill for School.ownerId — the school's super admin.
 *
 * Run this ONCE after deploying the change that makes adding, promoting,
 * demoting and password-resetting an admin the super admin's alone.
 *
 * Every school registered from now on records its owner at registration. Every
 * school that already existed has NULL there, because the column did not exist
 * when they signed up. resolveSuperAdminId() in server.js handles that by
 * falling back to the school's earliest ADMIN row — which is who registered it,
 * since registration creates the school and its first admin in the same
 * request — so nothing is broken before this runs. What this does is write that
 * answer down, so the fallback stops being load-bearing.
 *
 * Why writing it down matters, given the fallback works: the fallback is a
 * derivation, and derivations drift. If the founding admin's account is ever
 * demoted or deleted, "earliest remaining ADMIN" silently becomes somebody
 * else, and a school's super admin would change without anybody deciding it. A
 * stored ownerId keeps pointing at the person who actually registered the
 * school, and a school whose owner no longer holds an admin account is then a
 * visible situation an operator can look at rather than one that quietly
 * resolves itself to the wrong person.
 *
 * Idempotent: schools that already have an ownerId are left alone, so running
 * it twice is a no-op and running it after a partial failure resumes.
 *
 * Usage, from the server/ directory:
 *
 *   node scripts/backfill-school-owner.js            # report only, writes nothing
 *   node scripts/backfill-school-owner.js --apply    # perform the backfill
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = require('../db');

const APPLY = process.argv.includes('--apply');

async function main() {
  const schools = await prisma.school.findMany({
    where: { ownerId: null },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (schools.length === 0) {
    console.log('Every school already records an owner. Nothing to do.');
    return;
  }

  console.log(`${schools.length} school(s) with no recorded owner.\n`);

  const resolved = [];
  const unresolvable = [];

  for (const school of schools) {
    const firstAdmin = await prisma.user.findFirst({
      where: { schoolId: school.id, role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (firstAdmin) resolved.push({ school, admin: firstAdmin });
    // A school with no admin at all cannot happen through any route here — the
    // demote guard keeps at least one — but a hand-edited database can produce
    // it, and inventing an owner for one would be worse than reporting it.
    else unresolvable.push(school);
  }

  for (const { school, admin } of resolved) {
    console.log(`  ${school.name}\n    -> ${admin.name} <${admin.email}> (joined ${admin.createdAt.toISOString().slice(0, 10)})`);
  }

  if (unresolvable.length) {
    console.log(`\n⚠ ${unresolvable.length} school(s) have no ADMIN account and cannot be resolved:`);
    for (const s of unresolvable) console.log(`  ${s.name} (${s.id})`);
    console.log('  These need an admin account before they have an owner to record.');
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing was written. Re-run with --apply to record ${resolved.length} owner(s).`);
    return;
  }

  let written = 0;
  for (const { school, admin } of resolved) {
    // One update per school rather than one transaction over all of them: each
    // is independent, and a single failure part-way should leave the schools
    // already done recorded rather than rolling the whole run back.
    try {
      await prisma.school.update({ where: { id: school.id }, data: { ownerId: admin.id } });
      written++;
    } catch (e) {
      console.error(`  ✗ ${school.name}: ${e.message}`);
    }
  }
  console.log(`\n✅ Recorded an owner for ${written} of ${resolved.length} school(s).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
