import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Asks before taking learners off another section's roster.
 *
 * A User has exactly one Section, so enrolling a name that already has an
 * account in the school does not add them to a second class — it removes them
 * from the first one. That used to happen silently, and was reported back as
 * "1 existing account linked", so an import that repeated a name emptied a
 * colleague's roster without anyone being told which section had lost a pupil.
 *
 * The server now refuses those names outright and returns them as
 * `pendingMoves`; this is what asks, and only a confirmed answer replays the
 * request with `allowMove`.
 */
export default function SectionMoveConfirm({ moves, targetSection, onConfirm, onCancel, busy }) {
  if (!moves?.length) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h2 className="text-lg font-bold text-brand-slate mb-1 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          {moves.length} student{moves.length === 1 ? ' is' : 's are'} already enrolled elsewhere
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          A student belongs to one section at a time. Moving {moves.length === 1 ? 'them' : 'them'} to{' '}
          <span className="font-bold text-brand-slate">{targetSection}</span> takes {moves.length === 1 ? 'them' : 'them'} off
          the roster shown below. Their account, submitted work and grades travel with them; nothing is deleted.
        </p>
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-80 overflow-y-auto mb-5">
          {moves.map(m => (
            <div key={m.username} className="px-3 py-3 text-sm">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="font-medium text-brand-slate truncate">{m.name}</span>
                <span className="text-xs text-slate-500 shrink-0">
                  <span className="font-mono">{m.username}</span> · now in {m.fromSection}
                </span>
              </div>
              {m.preview && (
                <ul className="text-xs space-y-0.5 mt-1.5">
                  {m.preview.carries.map(c => (
                    <li key={`c-${c.subject}`} className="text-emerald-700">
                      ✓ {c.subject} — <span className="font-bold">{c.gradeCount} grade{c.gradeCount === 1 ? '' : 's'} carry over</span>
                    </li>
                  ))}
                  {m.preview.unmatched.map(u => (
                    <li key={`u-${u.subject}`} className="text-amber-700">
                      ⚠ {u.subject} — no matching class here, <span className="font-bold">{u.gradeCount} grade{u.gradeCount === 1 ? '' : 's'} will not carry</span>
                    </li>
                  ))}
                  {m.preview.ambiguous.map((a, i) => (
                    <li key={`a-${i}`} className="text-amber-700">
                      ⚠ {a.subject || 'An unlabelled class'} — {a.reason === 'MULTIPLE_TARGET_CLASSES'
                        ? 'more than one class here teaches it'
                        : 'the class has no subject set'}, {a.gradeCount} grade{a.gradeCount === 1 ? '' : 's'} will not carry
                    </li>
                  ))}
                  {m.preview.willExcuse > 0 && (
                    <li className="text-slate-500">
                      ⓘ {m.preview.willExcuse} activit{m.preview.willExcuse === 1 ? 'y' : 'ies'} already closed before they arrive will be marked <span className="font-medium">Excused</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">
            Leave them where they are
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-brand-navy text-white font-bold hover:bg-blue-900 flex items-center justify-center gap-2 disabled:opacity-40">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Move them here
          </button>
        </div>
      </div>
    </div>
  );
}
