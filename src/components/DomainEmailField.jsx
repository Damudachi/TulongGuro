import { accountDomain, localPartOf } from '../constants/accountEmails';

/**
 * The email field for a staff account, with the domain fixed by the role and
 * the school.
 *
 * Teacher accounts live on @teacher.<school-code>.edu.ph and admin accounts on
 * @admin.<school-code>.edu.ph (see src/constants/accountEmails.js for why). A
 * plain text box that accepts anything and is refused by the server teaches
 * that rule one rejection at a time, and the person being refused is an admin
 * adding staff in a batch — the worst moment to be handed a rule they have to
 * remember.
 *
 * So the domain is not typed. It sits beside the box as a label the admin can
 * read but not change, and only the part before the @ is editable. That makes
 * the wrong address unreachable rather than merely refused — which matters more
 * now than it did: the domain carries the school code, so a typed one could be
 * a *different school's* domain rather than merely a malformed one.
 *
 * `schoolSlug` absent falls back to the legacy flat domain, which is the right
 * answer for a school that has not been given a code yet — the server makes the
 * same fallback, so the suffix shown is the address that will be created.
 *
 * localPartOf() cuts at any @ the admin types or pastes, so pasting a whole
 * address — the thing anyone will do first — fills the field with its name half
 * instead of producing "ana@deped.gov.ph@teacher.mes-maba.edu.ph".
 */
export default function DomainEmailField({
  role,
  schoolSlug,
  value,
  onChange,
  id,
  label,
  hint,
  required = true,
  disabled = false,
  autoFocus = false,
}) {
  const domain = accountDomain(role, schoolSlug);
  const hintId = id ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label || 'Email'} {required && '*'}
      </label>
      <div className="flex items-stretch border border-slate-200 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-brand-navy">
        <input
          id={id}
          // type="text", not type="email": the value here is a local part, and
          // a browser's built-in email validation would refuse every one of
          // them for having no @.
          type="text"
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          value={value}
          inputMode="email"
          autoComplete="off"
          aria-describedby={hintId}
          onChange={e => onChange(localPartOf(e.target.value))}
          placeholder={role === 'ADMIN' ? 'principal' : 'juan.delacruz'}
          className="flex-1 min-w-0 p-2.5 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400"
        />
        {/* Allowed to shrink and truncate, unlike the flat domains this
            replaced. `@teacher.mes-maba.edu.ph` is more than twice the length
            of `@teacher.edu.ph`, and a suffix pinned at full width squeezed the
            name box to nothing on a phone — the field the admin is actually
            trying to type in. The full value stays reachable as a tooltip and
            is repeated in the hint below, which is where it can wrap. */}
        <span
          title={`@${domain}`}
          className="shrink min-w-0 truncate px-3 grid place-items-center bg-slate-50 border-l border-slate-200 text-sm font-bold text-slate-500 select-none"
        >
          @{domain}
        </span>
      </div>
      <p id={hintId} className="text-xs text-slate-400 mt-1 break-words">
        {hint || `${role === 'ADMIN' ? 'Admin' : 'Teacher'} accounts at this school sign in on @${domain}.`}
      </p>
    </div>
  );
}
