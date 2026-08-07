import { X, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * A worked example of what the AI hands back, shown before a teacher trusts it
 * with a real class.
 *
 * This is the replacement for the seeded demo submission, and the difference
 * that matters is that it is a picture rather than a record. The sandbox put a
 * fabricated score of 85 into the database against a fabricated student, where
 * it could be opened in the review workspace and validated — at which point an
 * invented number became a real grade of record on a real (if fake) account,
 * counted in averages and exports like any other. Everything below is a
 * constant in this file. It cannot be graded, released, exported or counted.
 *
 * Deliberately labelled as a sample twice: in the header and again on the
 * score, because the whole failure mode of the thing it replaces was someone
 * mistaking an example for their own data.
 */

const SAMPLE = {
  activity: 'Narrative Essay: My Favourite Place',
  points: 100,
  score: 85,
  strengths:
    'You described your favourite place with real feeling, and the reader can picture it. Your opening sentence makes them want to keep reading.',
  growth: [
    {
      quote: 'I go their every summer.',
      explanation: "'Their' shows belonging. For a place, use 'there' — 'I go there every summer.'",
    },
    {
      quote: 'It was fun we swam and ate.',
      explanation: 'Two ideas are joined without punctuation. Try: ‘It was fun. We swam and ate.’',
    },
  ],
  steps: [
    "Practise the difference between 'there', 'their' and 'they're'.",
    'Read your work aloud — where you pause for breath, you usually need a full stop.',
  ],
  rubric: [
    { name: 'Content', score: 36, max: 40 },
    { name: 'Organisation', score: 26, max: 30 },
    { name: 'Grammar', score: 23, max: 30 },
  ],
};

export default function ExampleFeedback({ onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Example of AI feedback"
    >
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Sparkles className="w-3 h-3" /> Sample — not your class
            </span>
            <h2 className="text-lg font-bold text-brand-slate mt-2">What you see after an AI check</h2>
            <p className="text-xs text-slate-500 mt-0.5">{SAMPLE.activity}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-brand-navy">{SAMPLE.score}</span>
            <span className="text-sm text-slate-500">/ {SAMPLE.points} suggested</span>
            <span className="ml-auto text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              sample
            </span>
          </div>

          {/* Said before the feedback rather than after it: the point of the
              screen is that the teacher decides, and that should not be a
              footnote. */}
          <p className="text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-xl p-3 leading-relaxed">
            This is a <strong>suggestion</strong>. You can change the score and edit every line of the feedback.
            Nothing reaches a learner until you press <strong>Release</strong>.
          </p>

          <section>
            <h3 className="text-sm font-bold text-brand-slate flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-4 h-4 text-brand-green" /> What the learner did well
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">{SAMPLE.strengths}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-brand-slate flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> What to work on
            </h3>
            <ul className="space-y-2">
              {SAMPLE.growth.map((item) => (
                <li key={item.quote} className="border border-slate-200 rounded-xl p-3">
                  <p className="text-sm font-mono text-slate-700">&ldquo;{item.quote}&rdquo;</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.explanation}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-bold text-brand-slate mb-2">Rubric breakdown</h3>
            <ul className="space-y-1.5">
              {SAMPLE.rubric.map((row) => (
                <li key={row.name} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-slate-600">{row.name}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-navy rounded-full" style={{ width: `${(row.score / row.max) * 100}%` }} />
                  </div>
                  <span className="w-14 text-right font-semibold text-slate-600">{row.score}/{row.max}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-bold text-brand-slate mb-2">Next steps for the learner</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
              {SAMPLE.steps.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </section>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full py-3 bg-brand-navy text-white font-bold rounded-xl hover:bg-blue-900 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
