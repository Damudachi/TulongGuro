/**
 * Which email address a staff account is allowed to have.
 *
 *   TEACHER -> @teacher.edu.ph
 *   ADMIN   -> @admin.com
 *
 * Mirrors server/accountEmails.js, which is the copy that actually decides —
 * this one exists so the person typing the address is told the rule before they
 * submit, and so the field can carry the domain as a suffix instead of asking
 * them to remember it. There is no build step in this app that could share one
 * module across the client/server boundary; the same constraint already forces
 * the server/depedTopics.js + src/utils/topics.js pair. The two must stay in
 * step, and the server one is authoritative if they ever don't.
 *
 * Note this is format validation only. Nothing here — or on the server — proves
 * the mailbox exists or that its owner asked for an account; no confirmation
 * mail is sent. It guarantees the address matches the authority it carries.
 */

export const TEACHER_EMAIL_DOMAIN = 'teacher.edu.ph';
export const ADMIN_EMAIL_DOMAIN = 'admin.com';

const DOMAIN_BY_ROLE = {
  TEACHER: TEACHER_EMAIL_DOMAIN,
  ADMIN: ADMIN_EMAIL_DOMAIN,
};

const LOCAL_PART = /^[^\s@]+$/;

/** Trimmed and lowercased — the form the server stores and compares. */
export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/** The domain this role's accounts must use, or null if the role has no rule. */
export function requiredDomainFor(role) {
  return DOMAIN_BY_ROLE[role] || null;
}

/** `{ ok, email, error }` for one address under one role's rule. */
export function validateAccountEmail(raw, role) {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, email: '', error: 'An email address is required.' };

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: 'That is not a valid email address.' };
  }

  const domain = email.slice(at + 1);
  const required = requiredDomainFor(role);
  if (required && domain !== required) {
    return {
      ok: false,
      email,
      error: `${role === 'TEACHER' ? 'Teacher' : 'Admin'} accounts must end in @${required}.`,
    };
  }

  return { ok: true, email, error: null };
}

/**
 * The local part of an address, for the split "name + fixed @domain" fields
 * below. Anything already carrying an @ is cut at it, so pasting a whole
 * address into the box does the obvious thing rather than producing
 * `juan@admin.com@admin.com`.
 */
export function localPartOf(value) {
  const v = String(value ?? '').trim();
  const at = v.indexOf('@');
  return (at === -1 ? v : v.slice(0, at)).toLowerCase();
}

/** Builds the full address a role's account will be created with. */
export function buildAccountEmail(localPart, role) {
  const local = localPartOf(localPart);
  const domain = requiredDomainFor(role);
  return local && domain ? `${local}@${domain}` : local;
}
