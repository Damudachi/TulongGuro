import { Link } from 'react-router-dom';
import { Check, ChevronRight, Eye, X } from 'lucide-react';
import { buildSteps } from '../utils/setupSteps';

/**
 * First-run guidance for a teacher, as a checklist over their own real work.
 *
 * This replaced a four-step modal tour of a seeded "[DEMO] Sandbox Demo Class".
 * The sandbox is gone (see the note where seedDemoSandbox used to live), and
 * with it the reason the tour existed — but the tour was the weaker half of
 * that pairing anyway:
 *
 *   • It taught the product rather than the job. A teacher opening this in
 *     August does not want to understand TulongGuro; they want Grade 6 English
 *     ready before Monday. Every step here produces something they keep.
 *   • Rehearsing on fake data means doing the work twice, and the second time
 *     is the one with forty real names in it.
 *   • It ended by asking the teacher to clean up the sandbox themselves.
 *
 * Progress is derived from row counts the server returns, never from a stored
 * step number — so it is right on a shared staff-room computer, right after a
 * cleared browser, and cannot claim a teacher has done something their own
 * dashboard shows they have not.
 *
 * The one thing the sandbox genuinely offered — seeing AI feedback before
 * trusting it with a real class — is the "See an example" button, which opens
 * a static sample. Nothing it shows can be validated into a grade.
 */

function StepRow({ step, index, isCurrent, onSeeExample }) {
  const showAction = isCurrent && !step.done;

  return (
    <li className={`flex gap-3 p-4 ${isCurrent && !step.done ? 'bg-blue-50/60' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
          step.done
            ? 'bg-brand-green text-white'
            : isCurrent
              ? 'bg-brand-navy text-white'
              : 'bg-slate-200 text-slate-500'
        }`}
        aria-hidden="true"
      >
        {step.done ? <Check className="w-4 h-4" /> : index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${step.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-brand-slate'}`}>
          {step.title}
        </p>

        {/* Only the step in hand carries an explanation. Four paragraphs at
            once is a wall; one is an instruction. */}
        {showAction && <p className="text-sm text-slate-600 leading-relaxed mt-1">{step.body}</p>}

        {step.progress && (
          <p className={`text-xs mt-1 ${step.done ? 'text-brand-green font-semibold' : 'text-slate-500'}`}>
            {step.progress}
          </p>
        )}

        {showAction && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {step.blockedBy ? (
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                {step.blockedBy}
              </span>
            ) : step.to ? (
              <Link
                to={step.to}
                className="text-xs font-bold text-white bg-brand-navy px-4 py-2 rounded-lg hover:bg-blue-900 transition-colors flex items-center gap-1"
              >
                {step.cta} <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              /* Neither blocked nor routable. There used to be a third branch
                 here — a button that opened the class form on the dashboard —
                 and it is gone with the form: a teacher does not create a
                 class. A step in this state is describing where the work
                 happens, not offering to take you there. */
              <span className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                {step.cta}
              </span>
            )}

            {step.id === 'grade' && (
              <button
                onClick={onSeeExample}
                className="text-xs font-bold text-brand-navy bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" /> See an example first
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function SetupChecklist({ setup, onSeeExample, onDismiss }) {
  const steps = buildSteps(setup);
  const doneCount = steps.filter((s) => s.done).length;
  // The first unfinished step is the one being asked for. Everything after it
  // stays collapsed so the card never presents more than one thing to do.
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="mb-6 bg-white border-2 border-blue-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div>
          <h2 className="font-bold text-brand-slate">Setting up your classes</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {doneCount === steps.length
              ? 'All done — everything below is ready.'
              : `Step ${currentIndex + 1} of ${steps.length}. You can leave and come back; your progress is saved as you go.`}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-600 shrink-0"
          aria-label="Hide the setup guide"
          title="Hide — you can reopen it from Setup guide above"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 pb-3">
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-green rounded-full transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            isCurrent={i === currentIndex}
            onSeeExample={onSeeExample}
          />
        ))}
      </ul>
    </div>
  );
}
