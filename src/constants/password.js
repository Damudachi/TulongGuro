/**
 * What makes a password acceptable, and how strong it is beyond that.
 *
 * Eight characters, with a small letter, a capital letter and a number.
 *
 * See server/passwordRule.js for why the rule is shaped this way and why a
 * symbol is not required — that copy is the one that decides. This one exists
 * so the form can tick the requirements off under the cursor as someone types
 * instead of waiting for a submit to tell them what they already could have
 * been told, and so the strength meter has something to draw. It is advisory:
 * every route that sets a password re-runs the server's copy, because a
 * browser can be made to say anything.
 *
 * Keep the two in step. A rule that is stricter here than on the server tells
 * people their password is bad when it would have been taken; a rule that is
 * looser here promises one that is then refused on submit, which is worse.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

// The server measures against bcrypt's 72-BYTE ceiling, so this copy has to
// count bytes too. TextEncoder rather than .length: one emoji is four bytes,
// and a mirror that counted characters would pass a password the server then
// refused.
function byteLength(value) {
  if (typeof TextEncoder === 'undefined') return value.length;
  return new TextEncoder().encode(value).length;
}

/** Why this password is not acceptable, or null if it is. */
export function passwordProblem(password) {
  const value = typeof password === 'string' ? password : String(password ?? '');
  if (!value) return 'Enter a password.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (byteLength(value) > MAX_PASSWORD_BYTES) {
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

/** The four requirements, in a fixed order, each with whether it is met. */
export function passwordChecklist(password) {
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
export function passwordStrength(password) {
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

/**
 * A temporary password that is guaranteed to satisfy the rule above.
 *
 * No look-alike characters (0/O, 1/l/I): this is read off one screen and typed
 * into another, often over a phone call, and a password that cannot be
 * dictated is a support ticket of its own.
 *
 * ── Why it builds one of each class instead of drawing at random ──
 * This used to be ten characters drawn from the whole alphabet, which does not
 * guarantee a digit: with 8 digits in a 57-character alphabet, about one
 * generated password in five contained no number at all. That was harmless
 * while the only rule was a length floor. The moment a digit became required
 * it meant the app would hand an admin a password its own server then refused
 * — a bug that would have looked random and been miserable to chase. So one
 * character of each required class is placed first, the rest are filled in,
 * and the result is shuffled so the classes do not sit in a fixed order.
 */
export function generatePassword(length = 10) {
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I, no O
  const LOWER = 'abcdefghijkmnopqrstuvwxyz';  // no l
  const DIGIT = '23456789';                   // no 0, no 1
  const ALL = UPPER + LOWER + DIGIT;
  const size = Math.max(length, MIN_PASSWORD_LENGTH);

  // crypto.getRandomValues where it exists — a temporary password is a live
  // credential for as long as it takes the holder to replace it, which is
  // often never, and Math.random is not seeded for that job.
  const randomInt = (max) => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      // Reject the tail that would otherwise make low values likelier.
      const limit = Math.floor(0xFFFFFFFF / max) * max;
      let n;
      do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
      return n % max;
    }
    return Math.floor(Math.random() * max);
  };

  const chars = [
    UPPER[randomInt(UPPER.length)],
    LOWER[randomInt(LOWER.length)],
    DIGIT[randomInt(DIGIT.length)],
  ];
  while (chars.length < size) chars.push(ALL[randomInt(ALL.length)]);
  // Fisher-Yates, so the guaranteed three do not always lead.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
