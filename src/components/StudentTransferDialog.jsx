import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, Archive, FolderInput } from 'lucide-react';
import { firstNameFromRoster } from '../utils/roster';

/**
 * Transferring one named learner to another section.
 *
 * Two steps, because they are two different decisions and running them
 * together is what made the roster-import path hard to trust: *where* a child
 * goes is an administrative fact, and *what happens to the work they leave
 * behind* is a judgement about their record. The second only exists when there
 * is work — a learner with nothing submitted skips it entirely, and the server
 * agrees (it returns `needsChoice: false` and does the move in one call).
 *
 *   1. PICK   — which section, out of the ones in this school.
 *   2. CHOOSE — migrate their activities, or leave them behind.
 *
 * Step 2's numbers come from the server, not from anything counted here: the
 * same transfers.buildMovePreview that drives SectionMoveConfirm. A dialog
 * that estimated its own "3 grades carry over" would eventually disagree with
 * the gradebook, which is exactly the class of bug the shared preview exists
 * to stop.
 *
 * The destructive answer is never the default and never the primary button.
 * "Leave them behind" archives real work a child did, so it is offered as the
 * secondary action with the consequence spelled out in full above it.
 */
export default function StudentTransferDialog({
  student, sections, choice, busy, onPick, onDecide, onCancel,
}) {
  // Reset per learner is the caller's job, done with `key={student.id}` on this
  // component — a fresh student remounts it. Clearing it from an effect here
  // instead would be a cascading render, and would also have to fire *before*
  // the first paint to be safe: without the reset, opening the dialog on a
  // second learner arrives with the previous one's destination already
  // selected, one click away from moving the wrong child.
  const [toSectionId, setToSectionId] = useState('');

  if (!student) return null;

  const label = (s) => (s.gradeLevel ? `${s.gradeLevel} — ${s.name}` : s.name);
  const preview = choice?.preview;
  const carried = preview ? preview.carries.reduce((n, c) => n + c.gradeCount, 0) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">

        {/* ── Step 1: where to ── */}
        {!choice && (
          <>
            <h2 className="text-lg font-bold text-brand-slate mb-1">Transfer {student.name}</h2>
            <p className="text-sm text-slate-500 mb-4">
              A student belongs to one section at a time, so this takes them off this roster and puts them
              on the one you choose. Their account and password do not change.
            </p>

            {sections.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3 mb-5">
                There is no other section in your school to transfer them to yet. Create one first.
              </p>
            ) : (
              <label className="block mb-5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Transfer to</span>
                <select
                  value={toSectionId}
                  onChange={(e) => setToSectionId(e.target.value)}
                  className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-brand-slate focus:outline-none focus:ring-2 focus:ring-brand-navy/30"
                >
                  <option value="">Choose a section…</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>
                      {label(s)}{s.teacher?.name ? ` · ${s.teacher.name}` : ''} · {s._count?.students ?? 0} student{(s._count?.students ?? 0) === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={onCancel} disabled={busy}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">
                Cancel
              </button>
              <button onClick={() => onPick(toSectionId)} disabled={busy || !toSectionId}
                className="flex-1 py-2.5 rounded-lg bg-brand-navy text-white font-bold hover:bg-blue-900 flex items-center justify-center gap-2 disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Continue
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: what happens to their work ── */}
        {choice && (
          <>
            <h2 className="text-lg font-bold text-brand-slate mb-1 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              {student.name} has {choice.activityCount} submitted activit{choice.activityCount === 1 ? 'y' : 'ies'}
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Moving them from <span className="font-bold text-brand-slate">{choice.fromSection}</span> to{' '}
              <span className="font-bold text-brand-slate">{choice.toSection}</span>. Should that work move with them?
            </p>

            {preview && (
              <div className="border border-slate-200 rounded-xl p-3 mb-5">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">If you migrate</p>
                <ul className="text-xs space-y-1">
                  {/* Keyed on subject + gradeLevel + index for the same reason
                      SectionMoveConfirm is: one section can hold two classes
                      in the same subject at different grade levels, and
                      classKey treats those as distinct. */}
                  {preview.carries.map((c, i) => (
                    <li key={`c-${c.subject}-${c.gradeLevel}-${i}`} className="text-emerald-700">
                      <Check className="w-3 h-3 inline" /> {c.subject} ({c.gradeLevel}) — <span className="font-bold">{c.gradeCount} grade{c.gradeCount === 1 ? '' : 's'} carry over</span>
                    </li>
                  ))}
                  {preview.unmatched.map((u, i) => (
                    <li key={`u-${u.subject}-${u.gradeLevel}-${i}`} className="text-amber-700">
                      ⚠ {u.subject} ({u.gradeLevel}) — no matching class in {choice.toSection}, <span className="font-bold">{u.gradeCount} grade{u.gradeCount === 1 ? '' : 's'} will not carry</span>
                    </li>
                  ))}
                  {preview.ambiguous.map((a, i) => (
                    <li key={`a-${a.subject}-${a.gradeLevel}-${i}`} className="text-amber-700">
                      ⚠ {a.subject || 'An unlabelled class'} ({a.gradeLevel}) — {a.reason === 'MULTIPLE_TARGET_CLASSES'
                        ? 'more than one class there teaches it'
                        : 'the class has no subject set'}, {a.gradeCount} grade{a.gradeCount === 1 ? '' : 's'} will not carry
                    </li>
                  ))}
                  {carried === 0 && preview.unmatched.length === 0 && preview.ambiguous.length === 0 && (
                    <li className="text-slate-500">Nothing graded yet, so there is no mark to carry either way.</li>
                  )}
                  {preview.willExcuse > 0 && (
                    <li className="text-slate-500 pt-1">
                      ⓘ {preview.willExcuse} activit{preview.willExcuse === 1 ? 'y' : 'ies'} already closed in {choice.toSection} before they arrive will be marked <span className="font-medium">Excused</span> either way — they were not there for it.
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="space-y-2 mb-5">
              <button onClick={() => onDecide(true)} disabled={busy}
                className="w-full text-left border-2 border-brand-navy bg-blue-50/50 rounded-xl p-3 hover:bg-blue-50 disabled:opacity-40">
                <span className="flex items-center gap-2 font-bold text-brand-navy text-sm">
                  <FolderInput className="w-4 h-4 shrink-0" /> Migrate their activities
                </span>
                <span className="block text-xs text-slate-500 mt-1">
                  Their submitted work and grades follow them into {choice.toSection} and count toward their
                  average there, wherever a class teaches the same subject.
                </span>
              </button>

              <button onClick={() => onDecide(false)} disabled={busy}
                className="w-full text-left border border-slate-200 rounded-xl p-3 hover:bg-red-50 hover:border-red-200 disabled:opacity-40">
                <span className="flex items-center gap-2 font-bold text-red-600 text-sm">
                  <Archive className="w-4 h-4 shrink-0" /> Do not migrate — remove it from {choice.fromSection}
                </span>
                <span className="block text-xs text-slate-500 mt-1">
                  All {choice.activityCount} submission{choice.activityCount === 1 ? '' : 's'} {choice.activityCount === 1 ? 'is' : 'are'} archived:
                  they leave {choice.fromSection}'s gradebook, exports and averages, do not follow them, and
                  {firstNameFromRoster(student.name) || student.name} starts in {choice.toSection} with a clean record. The work is kept
                  in the archive rather than deleted, so this can be undone.
                </span>
              </button>
            </div>

            <button onClick={onCancel} disabled={busy}
              className="w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-40">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Cancel — leave them where they are
            </button>
          </>
        )}
      </div>
    </div>
  );
}
