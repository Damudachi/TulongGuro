/**
 * One-off backfill for School.slug — the school code that separates one
 * school's accounts from every other school's.
 *
 * Run this after deploying the school-code change. Until it runs, every
 * existing school has a NULL code and falls back to the legacy flat login
 * domains (@teacher.edu.ph, @admin.com), which is exactly how the platform
 * behaved before — so nothing is broken while this is pending.
 *
 * ── Two steps, deliberately separate ──
 * Assigning codes is safe: it changes no credential and nobody is signed out.
 * Rewriting staff addresses is not: it changes the string every teacher and
 * admin types to sign in. Those are different risks and they get different
 * flags, so the safe half can ship and settle first.
 *
 *   node scripts/backfill-school-slugs.js                    report only, writes nothing
 *   node scripts/backfill-school-slugs.js --apply            assign codes
 *   node scripts/backfill-school-slugs.js --apply --emails   also move staff addresses
 *
 * The intended order is: --apply, leave it a while, tell the schools, and only
 * then --emails. Login accepts the old address either way (see the legacy
 * fallback in the login route), so --emails is reversible in effect if not in
 * fact: people who type the old address still get in.
 *
 * ── Why oldest-first ──
 * Schools are processed by registration date, so when two collide on a code the
 * older one keeps the clean form. That is not fairness, it is damage control:
 * the older school's pupils already hold student IDs built on those initials
 * (MES-26-0001), and giving it the matching code means its existing IDs and its
 * new ones agree. The younger school was sharing that number line anyway — the
 * bug this change closes — and its old IDs are grandfathered either way.
 *
 * ── What it never does ──
 * It does not rewrite student IDs. A pupil's ID is printed on slips, written in
 * record books and filed with DepEd; the schema comment on studentIdIssuer says
 * it should "be written once in a record book and stay correct". So a school
 * that had pupils before this keeps issuing MES-26-NNNN to them and starts
 * issuing MES-MABA-27-NNNN to new enrolments. The two coexist for a few years
 * and the older form ages out on its own.
 *
 * It does not touch a school that already has a code. Idempotent: running it
 * twice is a no-op, and running it after a partial failure resumes.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = require('../db');
const { resolveSlug, studentPrefixFor } = require('../schoolSlug');
const {
  accountDomain, LEGACY_TEACHER_EMAIL_DOMAIN, LEGACY_ADMIN_EMAIL_DOMAIN,
} = require('../accountEmails');

const APPLY = process.argv.includes('--apply');
const MIGRATE_EMAILS = process.argv.includes('--emails');

/**
 * Codes claimed so far — the database plus everything this run has decided.
 *
 * The in-memory half matters because a dry run writes nothing: without it every
 * San Jose in the table would be reported as getting `sjes-san`, which is the
 * one thing the report exists to warn about.
 */
async function makeTakenPredicate() {
  const rows = await prisma.school.findMany({
    where: { slug: { not: null } },
    select: { slug: true },
  });
  const claimed = new Set(rows.map((row) => row.slug));
  return {
    isTaken: async (slug) => claimed.has(slug),
    claim: (slug) => claimed.add(slug),
  };
}

/** The address an existing staff account moves to, or null if it should not
 *  move. Only accounts still on a legacy flat domain are candidates — anything
 *  already on a coded domain was created after the change and is correct. */
function migratedAddress(user, slug) {
  const current = String(user.username || '').toLowerCase();
  const [localPart, domain] = current.split('@');
  if (!localPart || !domain) return null;
  const legacy = user.role === 'TEACHER' ? LEGACY_TEACHER_EMAIL_DOMAIN : LEGACY_ADMIN_EMAIL_DOMAIN;
  if (domain !== legacy) return null;
  return `${localPart}@${accountDomain(user.role, slug)}`;
}

async function main() {
  const { isTaken, claim } = await makeTakenPredicate();

  const schools = await prisma.school.findMany({
    where: { slug: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, status: true, createdAt: true },
  });

  console.log(`${schools.length} school(s) without a code.`);
  if (!APPLY) console.log('(dry run — nothing will be written)\n');
  else console.log('');

  const assignments = [];
  for (const school of schools) {
    const slug = await resolveSlug(school.name, null, isTaken);
    claim(slug);
    assignments.push({ school, slug });

    console.log(`${school.name}`);
    console.log(`   code            ${slug}`);
    console.log(`   teacher logins  name@${accountDomain('TEACHER', slug)}`);
    console.log(`   admin logins    name@${accountDomain('ADMIN', slug)}`);
    console.log(`   new student IDs ${studentPrefixFor(slug)}-YY-NNNN`);

    if (APPLY) {
      // Written one row at a time rather than in a transaction over all of
      // them: a unique-constraint failure on one school (something else claimed
      // the code between the read and the write) should cost that school, not
      // the whole run, and the script is safe to re-run for whatever is left.
      try {
        await prisma.school.update({ where: { id: school.id }, data: { slug } });
      } catch (e) {
        console.log(`   ⚠  not assigned: ${e.message.split('\n')[0]}`);
        assignments.pop();
        continue;
      }
    }
    console.log('');
  }

  if (!MIGRATE_EMAILS) {
    console.log(
      assignments.length
        ? `\n${APPLY ? 'Assigned' : 'Would assign'} ${assignments.length} code(s).`
        : '\nNothing to assign.'
    );
    console.log('Staff addresses were not touched. Re-run with --emails when the schools have been told.');
    return;
  }

  // ── Second step: move staff onto their school's domain ──
  //
  // Every school with a code is considered, not only the ones this run just
  // assigned, because a school may have been given its code on a previous run
  // and left with its staff still on the flat domain.
  console.log('\n── Staff addresses ──\n');
  const coded = await prisma.school.findMany({
    where: { slug: { not: null } },
    select: { id: true, name: true, slug: true },
  });

  let moved = 0;
  let skipped = 0;
  for (const school of coded) {
    const staff = await prisma.user.findMany({
      where: { schoolId: school.id, role: { in: ['TEACHER', 'ADMIN'] } },
      select: { id: true, name: true, username: true, email: true, role: true },
    });

    for (const user of staff) {
      const next = migratedAddress(user, school.slug);
      if (!next) continue;

      // Refuse rather than overwrite if something already holds the target
      // address. It would have to be an account created after the change with
      // the same local part at the same school — rare, but silently merging two
      // people's logins is not a failure mode worth risking to save a report
      // line.
      const clash = await prisma.user.findFirst({
        where: { OR: [{ username: next }, { email: next }], NOT: { id: user.id } },
        select: { id: true },
      });
      if (clash) {
        console.log(`⚠  ${school.name}: ${user.username} -> ${next} SKIPPED (address already in use)`);
        skipped += 1;
        continue;
      }

      console.log(`   ${user.username}  ->  ${next}`);
      if (APPLY) {
        // Sessions are deliberately NOT revoked. The credential changed, but
        // the token is signed over the user id and stays valid, so anyone
        // signed in right now keeps working until they next sign in — by which
        // time they will have been told the new address, and the legacy
        // fallback in the login route accepts the old one regardless. Ending
        // every staff session mid-day to no benefit is exactly the disruption
        // this migration is being staged to avoid.
        await prisma.user.update({
          where: { id: user.id },
          data: { username: next, email: next },
        });
      }
      moved += 1;
    }
  }

  console.log(`\n${APPLY ? 'Moved' : 'Would move'} ${moved} staff address(es).`);
  if (skipped) console.log(`${skipped} skipped — see the warnings above.`);
  console.log('Old addresses keep working: the login route resolves a legacy address to the one');
  console.log('account that answers to it. Remove that fallback only once nobody is using them.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
