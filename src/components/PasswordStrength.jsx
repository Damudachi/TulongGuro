import { Check, X } from 'lucide-react';
import { passwordChecklist, passwordStrength } from '../constants/password';

/**
 * The live requirements list and strength bar under a new-password field.
 *
 * ── Why the requirements are always visible, not revealed on failure ──
 * A rule you are only told about after you break it reads as the system
 * changing its mind. Teachers here are typing on a shared machine between
 * classes; the four things are listed from the first keystroke and tick over
 * as they are met, so the field is answerable before it is submitted.
 *
 * The bar agrees with the list rather than second-guessing it: meeting all four
 * turns the list green, unblocks the form, and reads "Strong" — a meter saying
 * "Fair" over a fully-ticked checklist is a form contradicting itself, and it
 * used to. Above that there is one more step for length or a symbol, which is
 * advice and not a gate, because a meter that refuses is just a rule with worse
 * manners. See constants/password.js for the scale.
 *
 * Renders nothing until something is typed: four red crosses sitting under an
 * empty box reads as four errors the user has already made.
 */
export default function PasswordStrength({ value, className = '' }) {
  if (!value) return null;

  const checks = passwordChecklist(value);
  const { score, label } = passwordStrength(value);
  const met = checks.filter((c) => c.met).length;

  // Fixed dark-to-light ramp rather than a themed scale: this is a severity
  // signal, and a red that lightens in dark mode stops reading as a warning.
  const barTone = score === 0 ? 'bg-rose-500'
    : score === 1 ? 'bg-amber-500'
    : 'bg-emerald-500';
  const textTone = score === 0 ? 'text-rose-600'
    : score === 1 ? 'text-amber-600'
    : 'text-emerald-700';

  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barTone}`}
            style={{ width: `${(Math.max(score, met === 0 ? 0 : 1) / 4) * 100}%` }}
          />
        </div>
        <span className={`text-xs font-bold shrink-0 ${textTone}`}>{label}</span>
      </div>

      <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((c) => (
          <li
            key={c.id}
            className={`flex items-center gap-1.5 text-xs ${c.met ? 'text-emerald-700' : 'text-slate-500'}`}
          >
            {c.met
              ? <Check className="w-3.5 h-3.5 shrink-0" />
              : <X className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
