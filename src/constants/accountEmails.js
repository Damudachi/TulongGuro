/**
 * Which email address a staff account is allowed to have.
 *
 *   TEACHER -> @teacher.<school-code>.edu.ph
 *   ADMIN   -> @admin.<school-code>.edu.ph
 *
 * The school's code is the middle label, and it is what gives each school its
 * own namespace: `User.email` is unique across the whole platform, so before
 * this there was exactly one `irma@teacher.edu.ph` for the entire country and
 * the second school to hire an Irma was told the address already existed. See
 * server/schoolSlug.js for how a code is chosen.
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
 * mail is sent. It guarantees the address matches the authority it carries and
 * the school it belongs to.
 */

/** The suffix every school-coded login domain ends in. Both roles share it —
 *  the leftmost label is what tells them apart. */
export const ACCOUNT_EMAIL_TLD = 'edu.ph';

const ROLE_LABEL = {
  TEACHER: 'teacher',
  ADMIN: 'admin',
};

/**
 * The flat domains used before school codes existed.
 *
 * Accounts on them are live credentials and still sign in, so a school that has
 * not been given a code yet is still shown these. They are not offered to a new
 * account at a school that has one.
 */
export const LEGACY_TEACHER_EMAIL_DOMAIN = 'teacher.edu.ph';
export const LEGACY_ADMIN_EMAIL_DOMAIN = 'admin.com';

/** The old export names, kept so callers that only ever meant "the flat admin
 *  domain" keep reading the way they did. */
export const TEACHER_EMAIL_DOMAIN = LEGACY_TEACHER_EMAIL_DOMAIN;
export const ADMIN_EMAIL_DOMAIN = LEGACY_ADMIN_EMAIL_DOMAIN;

const LEGACY_DOMAIN_BY_ROLE = {
  TEACHER: LEGACY_TEACHER_EMAIL_DOMAIN,
  ADMIN: LEGACY_ADMIN_EMAIL_DOMAIN,
};

const LOCAL_PART = /^[^\s@]+$/;

/** Any domain this platform issues logins on, old flat shape or new per-school
 *  shape. Pattern-matched because the new ones vary per school. */
const SYNTHETIC_LOGIN_DOMAIN = /^(?:admin|teacher)\.[a-z0-9]+(?:-[a-z0-9]+)*\.edu\.ph$/;

/** Trimmed and lowercased — the form the server stores and compares. */
export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * The domain a role's accounts use at one school.
 *
 * `schoolSlug` absent means a school with no code yet, which falls back to the
 * legacy flat domain — the same fallback the server makes, so a screen rendered
 * before the backfill has run shows the address that will actually be created.
 */
export function accountDomain(role, schoolSlug) {
  const label = ROLE_LABEL[role];
  if (!label) return null;
  const slug = String(schoolSlug ?? '').trim().toLowerCase();
  if (!slug) return LEGACY_DOMAIN_BY_ROLE[role] || null;
  return `${label}.${slug}.${ACCOUNT_EMAIL_TLD}`;
}

/** The domain this role's accounts must use, or null if the role has no rule. */
export function requiredDomainFor(role, schoolSlug) {
  return accountDomain(role, schoolSlug);
}

/** Whether an address sits on a domain this platform issues logins on. */
export function isSyntheticLoginDomain(domain) {
  const value = String(domain ?? '').trim().toLowerCase();
  return value === LEGACY_ADMIN_EMAIL_DOMAIN
    || value === LEGACY_TEACHER_EMAIL_DOMAIN
    || SYNTHETIC_LOGIN_DOMAIN.test(value);
}

/** `{ ok, email, error }` for one address under one role's rule at one school. */
export function validateAccountEmail(raw, role, schoolSlug) {
  const required = accountDomain(role, schoolSlug);
  const typed = normalizeEmail(raw);
  if (!typed) return { ok: false, email: '', error: 'An email address is required.' };

  // Not completed from a bare local part. The screens build the whole address
  // with buildAccountEmail before anything is validated or sent, and the server
  // refuses a bare one — accepting it here would only let the two copies of
  // this rule disagree about what is valid.
  const email = typed;

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: 'That is not a valid email address.' };
  }

  const domain = email.slice(at + 1);
  if (required && domain !== required) {
    return {
      ok: false,
      email,
      error: `${role === 'TEACHER' ? 'Teacher' : 'Admin'} accounts at this school must end in @${required}.`,
    };
  }

  return { ok: true, email, error: null };
}

/**
 * `{ ok, email, error }` for the school's *contact* address at registration.
 *
 * A different question from validateAccountEmail: that one governs logins,
 * which sit on synthetic domains nothing can be delivered to. This one has to
 * be a real mailbox, so the rule is mostly "not one of ours". Mirrors
 * validateContactEmail in server/accountEmails.js, which decides.
 */
export function validateContactEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, email: '', error: 'A contact email address is required.' };

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: 'That is not a valid email address.' };
  }

  const domain = email.slice(at + 1);
  if (!/^[^\s@.]+(\.[^\s@.]+)+$/.test(domain)) {
    return { ok: false, email, error: 'That is not a valid email address.' };
  }
  if (isSyntheticLoginDomain(domain)) {
    return {
      ok: false,
      email,
      error: `@${domain} is a sign-in name, not a mailbox. Please give a real school email we can reach you on.`,
    };
  }

  return { ok: true, email, error: null };
}

/**
 * The local part of an address, for the split "name + fixed @domain" fields
 * below. Anything already carrying an @ is cut at it, so pasting a whole
 * address into the box does the obvious thing rather than producing
 * `juan@admin.mes-maba.edu.ph@admin.mes-maba.edu.ph`.
 */
export function localPartOf(value) {
  const v = String(value ?? '').trim();
  const at = v.indexOf('@');
  return (at === -1 ? v : v.slice(0, at)).toLowerCase();
}

/** Builds the full address a role's account at a school will be created with. */
export function buildAccountEmail(localPart, role, schoolSlug) {
  const local = localPartOf(localPart);
  const domain = accountDomain(role, schoolSlug);
  return local && domain ? `${local}@${domain}` : local;
}
