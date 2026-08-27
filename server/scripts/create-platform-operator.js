/**
 * Create the first TulongGuro platform operator.
 *
 * The platform console used to be opened with a single shared secret,
 * PLATFORM_ADMIN_KEY, typed into a form. It is opened with a named account now
 * — see the note above requireOperator in server.js for why. This script is the
 * bootstrap: there is nobody to sign in as until it has run once.
 *
 * ── Why the key is still required here ──
 * This is the one place it survives on the operator path, and it survives
 * because it has to: a script that could mint platform accounts with no
 * credential at all would be a back door for anyone who reached the server's
 * filesystem or a CI shell. Holding the key is the proof that whoever is
 * running this already had operator authority under the old scheme.
 *
 * After the first operator exists, everybody else is added from inside the
 * console, by an operator who is signed in and therefore named in the log. You
 * should not need this script again.
 *
 * ── Usage, from the server/ directory ──
 *
 *   node scripts/create-platform-operator.js "Juan Dela Cruz" juan@tulongguro.com
 *
 * The password is generated and printed once. It is not stored anywhere in
 * plaintext and cannot be recovered — if it is lost, run this again with
 * --reset to set a new one for the same address.
 *
 *   node scripts/create-platform-operator.js "Juan Dela Cruz" juan@tulongguro.com --reset
 *
 * Idempotent without --reset: an address that already has an operator account
 * is reported and left alone, so running it twice does not silently change a
 * working password.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { validateContactEmail, normalizeEmail } = require('../accountEmails');

const BCRYPT_SALT_ROUNDS = 10;

/** No look-alike characters: this gets read aloud or pasted into a chat once,
 *  and a password that cannot be dictated is a support problem of its own. */
function generatePassword(length = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const [name, email] = args.filter((a) => !a.startsWith('--'));

  if (!process.env.PLATFORM_ADMIN_KEY) {
    return fail(
      'PLATFORM_ADMIN_KEY is not set. It is the bootstrap credential for this script — '
      + 'set it in server/.env, the same value the console used before operator accounts existed.',
    );
  }
  if (!name || !email) {
    return fail(
      'Usage: node scripts/create-platform-operator.js "Full Name" email@example.com [--reset]',
    );
  }

  // The same rule the console applies when one operator adds another: a real,
  // deliverable address, never one of the synthetic school login domains. This
  // is the address they sign in with and the only way to reach them.
  const check = validateContactEmail(email);
  if (!check.ok) return fail(check.error);
  const address = normalizeEmail(check.email);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: address }, { username: address }] },
  });

  if (existing && existing.role !== 'PLATFORM') {
    return fail(
      `${address} is already a ${existing.role} account at a school. `
      + 'An operator must be a separate account — pick another address.',
    );
  }

  const password = generatePassword();
  const hashed = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  if (existing) {
    if (!reset) {
      console.log(`\n• ${address} is already an operator. Nothing changed.`);
      console.log('  Pass --reset to set a new password for this account.\n');
      return;
    }
    await prisma.user.update({
      where: { id: existing.id },
      // Ends any session opened with the old password. A reset exists because
      // the old credential is lost or in the wrong hands; leaving the current
      // token working would defeat it.
      data: { password: hashed, sessionsValidFrom: new Date(), name: name.trim() },
    });
    console.log(`\n✔ Password reset for operator ${address}`);
  } else {
    await prisma.user.create({
      data: {
        name: name.trim(),
        email: address,
        username: address,
        password: hashed,
        role: 'PLATFORM',
        // No school. An operator belongs to the platform, and a schoolId here
        // would place them inside a tenant they must never be a member of.
        schoolId: null,
        schoolName: null,
      },
    });
    console.log(`\n✔ Platform operator created: ${address}`);
  }

  console.log('\n  Password (shown once, not recoverable):\n');
  console.log(`      ${password}\n`);
  console.log('  Sign in at /platform/approvals. Add the rest of the team from');
  console.log('  the Operators tab there, so each action is logged under a name.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
