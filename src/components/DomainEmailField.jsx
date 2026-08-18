import { ADMIN_EMAIL_DOMAIN, TEACHER_EMAIL_DOMAIN, localPartOf } from '../constants/accountEmails';

/**
 * The email field for a staff account, with the domain fixed by the role.
 *
 * Teacher accounts live on @teacher.edu.ph and admin accounts on @admin.com
 * (see src/constants/accountEmails.js for why). A plain text box that accepts
 * anything and is refused by the server teaches that rule one rejection at a
 * time, and the person being refused is an admin adding staff in a batch — the
 * worst moment to be handed a rule they have to remember.
 *
 * So the domain is not typed. It sits beside the box as a label the admin can
 * read but not change, and only the part before the @ is editable. That makes
 * the wrong address unreachable rather than merely refused.
 *
 * localPartOf() cuts at any @ the admin types or pastes, so pasting a whole
 * address — the thing anyone will do first — fills the field with its name half
 * instead of producing "ana@deped.gov.ph@teacher.edu.ph".
 */
export default function DomainEmailField({
  role,
  value,
  onChange,
  id,
  label,
  hint,
  required = true,
  disabled = false,
  autoFocus = false,
}) {
  const domain = role === 'ADMIN' ? ADMIN_EMAIL_DOMAIN : TEACHER_EMAIL_DOMAIN;
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
        <span className="shrink-0 px-3 grid place-items-center bg-slate-50 border-l border-slate-200 text-sm font-bold text-slate-500 select-none">
          @{domain}
        </span>
      </div>
      <p id={hintId} className="text-xs text-slate-400 mt-1">
        {hint || `${role === 'ADMIN' ? 'Admin' : 'Teacher'} accounts always sign in on @${domain}.`}
      </p>
    </div>
  );
}
