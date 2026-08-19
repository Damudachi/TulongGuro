import { useState } from 'react';
import { ArrowRight, Loader2, UserMinus, Users } from 'lucide-react';

/**
 * Asks who inherits a teacher's work before the account is removed.
 *
 * Removing a teacher used to be refused outright the moment they had a class:
 * "This teacher still has classes. Reassign or delete them first." That is the
 * right instinct — a class carries every activity, score and piece of feedback
 * its pupils have produced, and a block section carries the pupils' accounts —
 * but it left the admin to move a year's classes one at a time from a different
 * screen, and gave them no way at all to hand over a section whose roster was
 * the thing standing in the way.
 *
 * So the refusal became a question. Pick a colleague, and the server moves the
 * classes with their whole history, and the sections with their rosters, then
 * deletes the account — in one transaction, so a failure halfway cannot leave a
 * teacher who owns nothing and still exists.
 *
 * Only the owner changes. No pupil moves classroom, and no mark is recomputed.
 */
export default function TeacherHandover({ teacher, colleagues, reason, busy, onCancel, onConfirm }) {
  const [successorId, setSuccessorId] = useState('');
  if (!teacher) return null;

  const classes = teacher._count?.taughtClasses || 0;
  const sections = teacher._count?.ownedSections || 0;

  return (
    <div className="fixed inset-0 z-[150] bg-ink-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-card-lg flex flex-col max-h-[calc(100dvh-2rem)]">
        <div className="p-6 pb-3 shrink-0">
          <h2 className="text-lg font-bold text-brand-slate mb-1 flex items-center gap-2">
            <UserMinus className="w-5 h-5 text-amber-500 shrink-0" />
            Who takes over from {teacher.name}?
          </h2>
          {/* The server's own words when it refused a plain delete, so the admin
              reads the specific blocker rather than a generic summary of it. */}
          <p className="text-sm text-slate-500">
            {reason || (
              <>
                {teacher.name} still holds{' '}
                {classes > 0 && <strong>{classes} class{classes === 1 ? '' : 'es'}</strong>}
                {classes > 0 && sections > 0 && ' and '}
                {sections > 0 && <strong>{sections} block section{sections === 1 ? '' : 's'}</strong>}
                . Their account cannot be removed until somebody else owns them.
              </>
            )}
          </p>
        </div>

        <div className="px-6 overflow-y-auto overscroll-contain min-h-0">
          {colleagues.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center text-sm text-slate-500">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              There is no other teacher in this school to hand the work to. Add one first, or reassign
              the classes and sections yourself before removing this account.
            </div>
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Hand everything to</p>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 mb-4">
                {colleagues.map(c => (
                  <label key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl">
                    <input type="radio" name="tg-successor" value={c.id} checked={successorId === c.id}
                      onChange={() => setSuccessorId(c.id)} className="accent-royal-500 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-brand-slate truncate">{c.name}</span>
                      <span className="block text-xs text-slate-400 truncate">{c.email}</span>
                    </span>
                    <span className="text-[11px] text-slate-400 shrink-0">
                      {c._count?.taughtClasses || 0} class(es)
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {/* Said before the button, not after: an admin agreeing to this is
              agreeing to a move they cannot undo from this screen, and the one
              thing that does NOT travel is the least obvious of the lot. */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-5 text-xs text-slate-600 space-y-1.5">
            <p className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-aqua-600 shrink-0" />
              <span>
                Classes move with every activity, submission, score and comment intact. Block sections move
                with their rosters — no learner changes section, and no mark is recalculated.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-aqua-600 shrink-0" />
              <span>Their saved rubrics and the badges they wrote move too, so inherited activities keep working.</span>
            </p>
            <p className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
              <span>
                Their AI grading examples are deleted rather than handed on — those record how
                <em> this </em> teacher edited AI feedback, and would make the AI copy someone who has left.
              </span>
            </p>
          </div>
        </div>

        <div className="px-6 pb-6 pt-1 flex flex-col-reverse sm:flex-row gap-2 shrink-0">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">
            Keep this teacher
          </button>
          <button onClick={() => onConfirm(successorId)} disabled={busy || !successorId}
            className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Hand over &amp; remove
          </button>
        </div>
      </div>
    </div>
  );
}
