import { useState } from 'react';
import { X, Copy, Check, KeyRound } from 'lucide-react';

/**
 * The sign-in details for a batch of freshly created student accounts.
 *
 * These used to arrive in a `window.alert`, whose text cannot be selected or
 * copied — so a teacher enrolling forty learners was expected to transcribe
 * forty IDs and passwords by hand before pressing OK, after which they were
 * gone. It was worse for learners with no birthday on the roster: their
 * password is six random digits generated on the server and stored only as a
 * hash, so that alert was the single moment it would ever be readable, and
 * dismissing it locked those children out until an admin reset them one by one.
 * The admin console did not show them at all.
 *
 * Stays on screen until dismissed, selectable, and copies as tab-separated rows
 * so it pastes straight into Excel or a class record sheet.
 */
export default function StudentCredentials({ students, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!students?.length) return null;

  const asText = [
    'Name\tStudent ID\tPassword',
    ...students.map(s => `${s.name}\t${s.username}\t${s.initialPassword}`),
  ].join('\n');

  const copy = () => {
    navigator.clipboard?.writeText(asText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const randomCount = students.filter(s => s.passwordSource !== 'birthday').length;

  return (
    <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-green-800 flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> {students.length} account{students.length === 1 ? '' : 's'} created
          </p>
          <p className="text-xs text-green-700 mt-1">
            Copy these now — it is the only time the passwords are shown.
            {randomCount > 0 && (
              ` ${randomCount} of them ${randomCount === 1 ? 'has' : 'have'} no birthday on the roster, so `
              + `${randomCount === 1 ? 'their password was' : 'their passwords were'} generated at random and cannot be worked out later.`
            )}
          </p>
        </div>
        <button onClick={onClose} aria-label="Dismiss" className="text-green-500 hover:text-green-700 shrink-0">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white border border-green-200 rounded-xl max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-green-50/80 sticky top-0">
            <tr className="text-left text-[11px] uppercase tracking-wider text-green-700">
              <th className="px-3 py-2 font-bold">Name</th>
              <th className="px-3 py-2 font-bold">Student ID</th>
              <th className="px-3 py-2 font-bold">Password</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-50">
            {students.map(s => (
              <tr key={s.id || s.username}>
                <td className="px-3 py-2 text-brand-slate">{s.name}</td>
                <td className="px-3 py-2 font-mono font-bold text-brand-slate select-all">{s.username}</td>
                <td className="px-3 py-2 font-mono font-bold text-brand-slate select-all whitespace-nowrap">
                  {s.initialPassword}
                  {s.passwordSource !== 'birthday' && (
                    <span className="ml-2 text-[10px] font-sans font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full align-middle">
                      random
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={copy}
        className="mt-3 text-xs font-bold text-green-700 bg-white border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 flex items-center gap-1.5">
        {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy all (pastes into Excel)</>}
      </button>
    </div>
  );
}
