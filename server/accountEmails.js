/**
 * accountEmails.js — which email address a staff account is allowed to have.
 *
 * A school's console is opened by two kinds of staff account, and until now the
 * only thing separating them was the `role` column. Nothing about the address
 * itself said which one a person was, so an admin creating accounts in bulk had
 * no check on the one field they type by hand: `maam.reyes@gmail.com` created
 * as an admin and `principal@gmail.com` created as a teacher both went through,
 * and the mistake only surfaced later as "why can't I see the admin console".
 *
 * So the domain now carries the role:
 *
 *   TEACHER -> @teacher.edu.ph
 *   ADMIN   -> @admin.com
 *
 * ── What this is and is not ──
 * This is *format validation*, not proof that anyone owns the mailbox. There is
 * no SMTP configured on this server and no confirmation link is sent, so a
 * well-formed address that nobody reads still creates an account. What the rule
 * actually buys is that the address a school hands out matches the authority it
 * carries, and that a typo in the domain is refused at the point of creation
 * rather than discovered at the first failed login.
 *
 * ── Why it lives in its own module ──
 * Four call sites enforce it (public school registration, admin-creates-teacher,
 * admin-creates-admin, teacher-promoted-to-admin) and they must not drift. The
 * frontend keeps a mirror in src/constants/accountEmails.js — this codebase has
 * no build step that could share a module across the client/server boundary,
 * the same constraint that already forces the depedTopics.js / utils/topics.js
 * pair. The client copy is a courtesy that puts the rule in front of the person
 * typing; this copy is the one that decides.
 */

/** Domain a TEACHER account's email must sit on. */
const TEACHER_EMAIL_DOMAIN = 'teacher.edu.ph';
/** Domain an ADMIN account's email must sit on. */
const ADMIN_EMAIL_DOMAIN = 'admin.com';

const DOMAIN_BY_ROLE = {
  TEACHER: TEACHER_EMAIL_DOMAIN,
  ADMIN: ADMIN_EMAIL_DOMAIN,
};

/**
 * Deliberately loose. This is not trying to be RFC 5322 — a regex that tries
 * ends up rejecting real addresses — it only rules out the shapes that cannot
 * be an address at all: no `@`, more than one `@`, nothing either side of it,
 * or whitespace anywhere. The domain half is then checked exactly, which is the
 * part that actually matters here.
 */
const LOCAL_PART = /^[^\s@]+$/;

/** Trimmed and lowercased. Addresses are stored and compared in this form. */
function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/** The domain a role's accounts must use, or null for roles with no rule (STUDENT). */
function requiredDomainFor(role) {
  return DOMAIN_BY_ROLE[role] || null;
}

/**
 * Checks one address against the rule for a role.
 *
 * Returns `{ ok, email, error }` rather than throwing: every caller wants to
 * answer with a 400 carrying the message, and the normalized address is what
 * they go on to write, so handing both back keeps the "validate then normalize
 * then write" sequence from being spelled out four times.
 *
 * A role with no rule (STUDENT, whose accounts are enrolled from a roster and
 * often have no email at all) passes any well-formed address.
 */
function validateAccountEmail(raw, role) {
  const email = normalizeEmail(raw);
  if (!email) {
    return { ok: false, email: '', error: 'An email address is required.' };
  }

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: `"${raw}" is not a valid email address.` };
  }

  const domain = email.slice(at + 1);
  const required = requiredDomainFor(role);
  if (required && domain !== required) {
    return {
      ok: false,
      email,
      // Names the required form rather than only the rule: an admin who has
      // just been refused needs to know what to type, not what was wrong.
      error: role === 'TEACHER'
        ? `Teacher accounts must use a @${TEACHER_EMAIL_DOMAIN} address — for example juan.delacruz@${TEACHER_EMAIL_DOMAIN}. "${email}" is on @${domain}.`
        : `Admin accounts must use a @${ADMIN_EMAIL_DOMAIN} address — for example principal@${ADMIN_EMAIL_DOMAIN}. "${email}" is on @${domain}.`,
    };
  }

  return { ok: true, email, error: null };
}

/**
 * Checks the *contact* address a school gives at registration — a different
 * question from the one above, and the reason this function exists separately.
 *
 * The addresses validateAccountEmail() governs are logins. They sit on
 * @admin.com and @teacher.edu.ph, which are synthetic: this server has no SMTP
 * and those domains are not ours, so nothing was ever deliverable to them. That
 * was fine while they were only usernames wearing an email's shape, but it left
 * a school registration with no reachable address on it at all — an operator
 * deciding whether a school was real had nothing to reach out to but a name
 * somebody typed.
 *
 * So a registering school now also gives an address that can actually receive
 * mail, and the one rule that matters here is that it is *not* one of the
 * synthetic login domains. Someone copying their new @admin.com login into this
 * field is the obvious mistake, and it would put the field straight back to
 * being decorative.
 *
 * Still only format validation — no confirmation link is sent, because there is
 * still no SMTP. What it buys is a channel for a human to use, and one more
 * thing a flood of fake registrations has to manufacture.
 */
function validateContactEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) {
    return { ok: false, email: '', error: 'A contact email address is required.' };
  }

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: `"${raw}" is not a valid email address.` };
  }

  const domain = email.slice(at + 1);
  // A domain with no dot cannot be reached from outside this machine —
  // "principal@localhost" and "office@school" are typos, not addresses.
  if (!/^[^\s@.]+(\.[^\s@.]+)+$/.test(domain)) {
    return { ok: false, email, error: `"${raw}" is not a valid email address.` };
  }
  if (domain === ADMIN_EMAIL_DOMAIN || domain === TEACHER_EMAIL_DOMAIN) {
    return {
      ok: false,
      email,
      error: `@${domain} addresses are sign-in names, not mailboxes — nothing can be sent to them. `
        + `Please give a real school email we can reach you on, like your DepEd or school address.`,
    };
  }

  return { ok: true, email, error: null };
}

module.exports = {
  TEACHER_EMAIL_DOMAIN,
  ADMIN_EMAIL_DOMAIN,
  normalizeEmail,
  requiredDomainFor,
  validateAccountEmail,
  validateContactEmail,
};
