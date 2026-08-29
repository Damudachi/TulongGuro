/**
 * What makes a password acceptable, and how strong it is beyond that.
 *
 * This copy is the one that decides. src/constants/password.js mirrors it so
 * the form can answer as the user types, but a browser can be made to say
 * anything, so every route that sets a password calls passwordProblem() here.
 *
 * ── The rule ──
 * Eight characters, with a lowercase letter, an uppercase letter and a digit.
 * It replaced a bare `length >= 6` that let `123456` through everywhere —
 * the gap QA logged as "no handler for weak password".
 *
 * A symbol is deliberately NOT required. These accounts are typed on shared
 * classroom keyboards, often on phones, by teachers who are not going to reach
 * for a password manager; a symbol requirement is the point at which people
 * start writing the password on a sticky note next to the machine, which
 * costs more than it buys. Symbols still COUNT toward strength below — they
 * are rewarded, just not demanded.
 *
 * ── Why every role, including students ──
 * Students are held to the same rule when they change their own password.
 * Their issued default is exempt and stays a birthday (MMDDYYYY, all digits,
 * see birthdayPassword in server.js): a default is handed out, not chosen, and
 * a Grade 1-6 learner has to be able to be told it once and type it. So a
 * pupil's starting password will not satisfy the rule they meet if they later
 * change it. That asymmetry is intended — the default is a system credential
 * meant to be replaced, the rule governs what replaces it.
 */

// bcrypt silently ignores everything past 72 bytes: two different long
// passwords that share a 72-byte prefix hash identically and each unlocks the
// other's account. Refusing them outright is the only honest option, since
// truncating for the user would be doing the same damage quietly.
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Why this password is not acceptable, or null if it is.
 *
 * One sentence, addressed to the person typing, naming the thing to fix. The
 * checks run shortest-first so the message is about the most basic thing still
 * wrong rather than the last test to fail.
 */
function passwordProblem(password) {
  const value = typeof password === 'string' ? password : String(password ?? '');
  if (!value) return 'Enter a password.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // Byte length, not character length: one emoji is four bytes, so a password
  // well under 72 characters can still cross the limit bcrypt cares about.
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    return 'That password is too long. Please keep it under 72 characters.';
  }
  const missing = [];
  if (!/[a-z]/.test(value)) missing.push('a small letter');
  if (!/[A-Z]/.test(value)) missing.push('a capital letter');
  if (!/[0-9]/.test(value)) missing.push('a number');
  if (missing.length === 1) return `Your password also needs ${missing[0]}.`;
  if (missing.length === 2) return `Your password also needs ${missing[0]} and ${missing[1]}.`;
  if (missing.length === 3) return `Your password needs ${missing[0]}, ${missing[1]} and ${missing[2]}.`;
  return null;
}

/**
 * The four requirements, each with whether this password meets it.
 *
 * The form lists these and ticks them off as they are met. Returned in a fixed
 * order so the list does not reshuffle under the cursor while someone types.
 */
function passwordChecklist(password) {
  const value = typeof password === 'string' ? password : '';
  return [
    { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: value.length >= MIN_PASSWORD_LENGTH },
    { id: 'lower', label: 'A small letter (a-z)', met: /[a-z]/.test(value) },
    { id: 'upper', label: 'A capital letter (A-Z)', met: /[A-Z]/.test(value) },
    { id: 'digit', label: 'A number (0-9)', met: /[0-9]/.test(value) },
  ];
}

/**
 * How strong a password is once it is acceptable at all — the meter.
 *
 * ── Why meeting the four requirements reads as "Strong" ──
 * It used to score 1 of 4 and read "Fair", with the points above it bought by
 * length and symbols. That was defensible as advice and wrong as feedback: the
 * four requirements ARE the rule, so someone who had just satisfied every one
 * of them, watched the checklist go green, and was free to submit was told by
 * the thing next to it that their password was middling. People read that as
 * "not finished yet" and kept typing, or assumed the form was refusing them.
 * A meter must not contradict the checklist it sits above.
 *
 * So the floor of acceptable is "Strong", and the headroom above it is one
 * step, not three:
 *
 *   0  Too weak     fails passwordProblem() — the form will not take it
 *   1  Weak         clears the rule on a technicality (see the run check)
 *   3  Strong       all four requirements met. The form takes it.
 *   4  Very strong  and long enough, or with a symbol, to be worth more
 *
 * 2 is deliberately unused: nothing sits between "we accept this" and "this
 * only technically qualifies", and leaving the gap keeps the bar's four
 * segments reading as distinct states rather than a continuum.
 */
function passwordStrength(password) {
  const value = typeof password === 'string' ? password : '';
  if (passwordProblem(value)) {
    return { score: 0, label: 'Too weak', unmet: passwordChecklist(value).filter((c) => !c.met) };
  }
  // A password whose letters are one character repeated ("aaaaaaaA1") passes
  // every class check and is still trivially guessed. It is accepted — the
  // rule is the rule — but it is the one case the meter refuses to call strong.
  if (/^(.)\1+$/.test(value.replace(/[^A-Za-z]/g, '').toLowerCase())) {
    return { score: 1, label: 'Weak', unmet: [] };
  }
  // Past the rule, length is what actually buys resistance to guessing; a
  // symbol is the cheaper way to the same place, so either earns the last step.
  const strong = value.length >= 12 || /[^A-Za-z0-9]/.test(value);
  return { score: strong ? 4 : 3, label: strong ? 'Very strong' : 'Strong', unmet: [] };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  passwordProblem,
  passwordChecklist,
  passwordStrength,
};
