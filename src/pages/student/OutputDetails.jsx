import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb, Trophy, Image as ImageIcon, Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Target, Sparkles } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import SubmissionImage from '../../components/SubmissionImage';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Parse feedback: handles both new structured JSON and legacy plain strings
function parseFeedback(hitl, ai) {
  let finalStructured = { strengths: '', areasForGrowth: [], actionableSteps: [], skillExplanations: {} };

  // Parse AI first
  if (ai) {
    try {
      let cleanRaw = ai.trim();
      if (cleanRaw.startsWith('```')) {
        const lines = cleanRaw.split('\n');
        if (lines.length > 2) cleanRaw = lines.slice(1, -1).join('\n').trim();
      }
      const parsed = JSON.parse(cleanRaw);
      if (parsed && typeof parsed === 'object') {
        finalStructured = { ...finalStructured, ...parsed };
      }
    } catch {
      finalStructured.strengths = ai;
    }
  }

  // Parse HITL override
  if (hitl) {
    try {
      let cleanRaw = hitl.trim();
      if (cleanRaw.startsWith('```')) {
        const lines = cleanRaw.split('\n');
        if (lines.length > 2) cleanRaw = lines.slice(1, -1).join('\n').trim();
      }
      const parsed = JSON.parse(cleanRaw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        finalStructured = { ...finalStructured, ...parsed };
      } else {
        finalStructured.strengths = hitl; // fallback if empty json?
      }
    } catch {
      // Plain text teacher override
      finalStructured.strengths = hitl;
    }
  }

  // Prevent AI error strings from polluting the UI
  if (finalStructured.strengths?.includes('⚠ AI grading is currently unavailable')) {
    finalStructured.strengths = '';
  }

  return finalStructured;
}

export default function OutputDetails() {
  const navigate = useNavigate();
  const { outputId } = useParams();
  const [sub, setSub] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showImage, setShowImage] = useState(false);
  const [showGrowth, setShowGrowth] = useState(false);
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    if (!outputId || outputId === 'test123') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the built-in demo record; the real path below is an async read
      setSub({
        activity: { title: 'Noli Me Tangere Reflection', class: { name: 'Filipino 10' } },
        hitlScore: 88, aiScore: 85,
        hitlFeedback: JSON.stringify({
          strengths: "Napakagaling! Your reflection showed a deep understanding of Crisostomo Ibarra's motivations. You made a strong connection between his desire for reform and the challenges he faced.",
          areasForGrowth: [
            { studentQuote: "Ibarra is want to change the Philippines because he is educated.", explanation: "This sentence has a subject-verb agreement issue. Try: 'Ibarra wants to change the Philippines because he is educated.' Notice how 'want' becomes 'wants' when the subject is 'he' or 'she'." },
            { studentQuote: "The novel is about love and country and also about the friars and corruption.", explanation: "This sentence tries to say too many things at once. Try splitting it into two shorter sentences to make each idea clearer." }
          ],
          actionableSteps: [
            "Rewrite your opening sentence to start with a hook — try asking a question like 'What would you do if you saw injustice?'",
            "Practice using transition words: 'However,' 'Because of this,' 'As a result' to connect your paragraphs."
          ],
          skillExplanations: {
            vocabulary: "You used good words like 'reform' and 'educated,' but some sentences relied on basic words like 'good' and 'bad.' Try using more descriptive alternatives.",
            punctuation: "Most sentences had correct periods and commas. Watch out for missing commas after transition words.",
            thematicFlow: "Your ideas were connected but the essay jumped between topics in the second paragraph. Each paragraph focus on one main idea.",
            sentenceStructure: "Good variety of sentence lengths! A few run-on sentences could be split for clarity."
          }
        }),
        aiFeedback: "Good effort on the topic.",
        readingStrategy: "When you read a new text, ask yourself 'Why did the character do that?' after every major action.",
        rubricData: JSON.stringify({ content: { score: 38, max: 40 }, organization: { score: 25, max: 30 }, grammar: { score: 25, max: 30 } }),
        student: { name: 'Juan Dela Cruz' }, updatedAt: new Date().toISOString()
      });
      setIsLoading(false);
      return;
    }
    apiFetch(`${API_URL}/api/submissions/${outputId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSub(d.submission); })
      // Without this a dropped connection rejected unhandled. The page still
      // falls through to "Submission not found", which is the right thing to
      // show, but the rejection should not escape.
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [outputId]);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-brand-green" /></div>;
  if (!sub) return <div className="p-8 text-center text-slate-500">Submission not found.</div>;

  const percentageScore = sub?.hitlScore ?? sub?.aiScore ?? 0;
  const maxPoints = sub?.activity?.points || 100;
  const score = ((percentageScore / 100) * maxPoints).toFixed(1).replace(/\.0$/, '');
  const feedback = parseFeedback(sub.hitlFeedback, sub.aiFeedback);
  // No invented scores. Every branch below either renders what the teacher/AI
  // actually recorded or renders nothing — an empty rubricItems list shows the
  // "not broken down yet" state further down. The old fallbacks here filled the
  // breakdown with fixed 35/40, 25/30, 28/30 figures whenever rubricData was
  // missing or unparseable, so a student could be shown a per-criterion score
  // nobody had ever given them, on a rubric their activity may not even use.
  let rubricItems = [];
  try {
    const rawRubric = sub.rubricData ? JSON.parse(sub.rubricData) : null;
    if (Array.isArray(rawRubric)) {
      rubricItems = rawRubric.map((r, i) => {
        let fullDesc = r.bandDescription;
        if (sub?.activity?.rubric) {
          try {
            const activityRubric = JSON.parse(sub.activity.rubric);
            const criteria = activityRubric.criteria?.find(c => c.name === r.criterionName);
            if (criteria && criteria.bands) {
              const band = criteria.bands.find(b => b.label.toLowerCase() === r.bandDescription?.toLowerCase());
              if (band && band.description) {
                fullDesc = `${band.label} — ${band.description}`;
              }
            }
          } catch { /* ignore */ }
        }
        return {
          name: r.criterionName, score: r.score, max: r.maxPoints, desc: fullDesc,
          color: ['bg-brand-green', 'bg-amber-400', 'bg-blue-400', 'bg-purple-400', 'bg-pink-400'][i % 5]
        };
      });
    } else if (rawRubric && typeof rawRubric === 'object') {
      // Legacy shape: a fixed {content, organization, grammar} object written
      // before rubrics became dynamic arrays. Map whichever of those keys are
      // actually present rather than assuming all three exist.
      const LEGACY_KEYS = [
        ['content', 'Content & Ideas', 'bg-brand-green'],
        ['organization', 'Organization', 'bg-amber-400'],
        ['grammar', 'Grammar', 'bg-blue-400'],
      ];
      rubricItems = LEGACY_KEYS
        .filter(([key]) => rawRubric[key] && typeof rawRubric[key].score === 'number')
        .map(([key, name, color]) => ({ name, ...rawRubric[key], color }));
    }
  } catch {
    // Unparseable rubricData means we don't know the breakdown. Show none.
    rubricItems = [];
  }

  const hasStructuredFeedback = feedback && (feedback.areasForGrowth?.length > 0 || feedback.actionableSteps?.length > 0);



  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      {/* Score Card */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6 shadow-sm">
        <div className="bg-gradient-to-br from-brand-green to-emerald-600 p-6 text-center text-white relative">
          <div className="absolute top-4 right-4 opacity-20"><Trophy className="w-16 h-16" /></div>
          <h1 className="text-xl font-bold mb-1 relative z-10">{sub.activity?.title}</h1>
          <p className="text-green-100 text-sm relative z-10">
            {sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
          <div className="mt-6 relative z-10">
            <span className="text-6xl font-extrabold tracking-tight">{score}</span>
            <span className="text-2xl text-green-200">/{maxPoints}</span>
          </div>
        </div>

        <div className="p-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Rubric Breakdown</h3>
          {rubricItems.length === 0 ? (
            <p className="text-sm text-slate-500">
              Your teacher hasn't recorded a per-criterion breakdown for this work yet. Your
              overall score and written feedback are shown above.
            </p>
          ) : (
          <div className="space-y-5">
            {rubricItems.map((item, i) => {
              // A criterion worth 0 points divides to NaN (or Infinity), which
              // renders as "NaN%" next to a child's mark and an invalid bar
              // width. Show the raw points and no percentage instead — the
              // percentage is the derived figure, so it is the one to drop.
              const pct = item.max > 0
                ? Math.max(0, Math.min(100, (item.score / item.max) * 100))
                : null;
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="font-medium text-slate-700">{item.name}</span>
                    <div className="flex items-center gap-2">
                      {/* Criterion scores are raw rubric points (e.g. 38 of 40), not
                          percentages. They used to be labelled "%" and then re-scaled
                          as if they were, which showed a pupil "38% / 40%" worth
                          "38 pts" on a 100-point activity. */}
                      <span className="font-bold text-slate-900">{item.score} / {item.max}</span>
                      {pct !== null && (
                        <span className="text-xs text-brand-navy font-bold">({Math.round(pct)}%)</span>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3">
                    <div className={cn('h-3 rounded-full transition-all duration-700', item.color)}
                      style={{ width: `${pct ?? 0}%` }} />
                  </div>
                  {/* Was a hover-only tooltip. Learners are on phones and
                      tablets, where there is no hover at all, so the band the
                      teacher actually awarded — the sentence explaining *why*
                      this score — was unreachable on the device most of them
                      use. Shown plainly instead. */}
                  {item.desc && (
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{item.desc}</p>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>

      {/* AI Disclosure — BP-5: nothing previously told the student or parent
          receiving this grade that AI was involved in preparing it. */}
      <div className="flex items-start gap-2.5 bg-sky-50 border border-sky-100 rounded-2xl p-4 mb-4 text-sky-800">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
        <p className="text-xs leading-relaxed">
          This feedback was prepared with AI assistance and reviewed by your teacher before being shown to you.
        </p>
      </div>

      {/* ✅ Strengths — Always visible */}
      {feedback?.strengths && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-green-100 p-1.5 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="text-sm font-bold text-green-700 uppercase tracking-wider">What You Did Well</h3>
          </div>
          <p className="text-slate-700 leading-relaxed text-[15px]">{feedback.strengths}</p>
        </div>
      )}

      {/* 📝 Areas for Growth — Expandable Accordion */}
      {hasStructuredFeedback && feedback.areasForGrowth?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4 shadow-sm">
          <button
            onClick={() => setShowGrowth(!showGrowth)}
            className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="bg-amber-100 p-1.5 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-bold text-amber-700 uppercase tracking-wider">Where I Can Grow</h3>
                <p className="text-xs text-slate-500 mt-0.5">{feedback.areasForGrowth.length} area{feedback.areasForGrowth.length > 1 ? 's' : ''} to improve</p>
              </div>
            </div>
            {showGrowth ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>

          {showGrowth && (
            <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
              {feedback.areasForGrowth.map((item, idx) => (
                <div key={idx} className="space-y-3 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                  {/* Student Quote */}
                  <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded-r-lg">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">From your essay:</p>
                    <p className="text-sm text-amber-900 italic leading-relaxed">"{item.studentQuote}"</p>
                  </div>
                  {/* Explanation */}
                  <p className="text-sm text-slate-700 leading-relaxed pl-4">{item.explanation}</p>

                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 🎯 Action Steps — Expandable Accordion */}
      {hasStructuredFeedback && feedback.actionableSteps?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6 shadow-sm">
          <button
            onClick={() => setShowActions(!showActions)}
            className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="bg-blue-100 p-1.5 rounded-lg">
                <Target className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-bold text-blue-700 uppercase tracking-wider">Your Action Steps</h3>
                <p className="text-xs text-slate-500 mt-0.5">{feedback.actionableSteps.length} thing{feedback.actionableSteps.length > 1 ? 's' : ''} to try</p>
              </div>
            </div>
            {showActions ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>

          {showActions && (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4">
              <div className="space-y-3">
                {feedback.actionableSteps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="bg-blue-100 text-blue-700 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legacy fallback — plain text feedback */}
      {!hasStructuredFeedback && feedback?.strengths && !feedback.strengths.startsWith('{') && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Teacher's Feedback</h3>
          <p className="text-slate-700 leading-relaxed text-[15px]">{feedback.strengths}</p>
        </div>
      )}

      {/* Reading Strategy */}
      {sub.readingStrategy && sub.readingStrategy !== 'N/A' && (
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border-2 border-brand-amber p-6 mb-6 relative overflow-hidden shadow-sm">
          <div className="absolute -right-4 -top-4 opacity-10"><Lightbulb className="w-32 h-32 text-brand-amber" /></div>
          <div className="flex items-center mb-4 relative z-10">
            <div className="bg-brand-amber text-white p-2 rounded-lg mr-3 shadow-inner"><Lightbulb className="w-6 h-6" /></div>
            <h2 className="text-xl font-bold text-slate-800">Your Reading Strategy</h2>
          </div>
          <p className="text-slate-800 leading-relaxed font-medium relative z-10 text-[15px]">"{sub.readingStrategy}"</p>
        </div>
      )}

      {/* Skill Explanations */}
      {feedback?.skillExplanations && Object.keys(feedback.skillExplanations).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-violet-500" />
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Skill Analysis</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(feedback.skillExplanations).map(([skill, explanation]) => {
              if (!explanation || explanation === 'N/A') return null;
              const labels = { vocabulary: 'Vocabulary', punctuation: 'Punctuation', thematicFlow: 'Thematic Flow', sentenceStructure: 'Sentence Structure' };
              const colors = { vocabulary: 'bg-purple-100 text-purple-700', punctuation: 'bg-pink-100 text-pink-700', thematicFlow: 'bg-indigo-100 text-indigo-700', sentenceStructure: 'bg-teal-100 text-teal-700' };
              return (
                <div key={skill} className="flex items-start gap-3">
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5', colors[skill] || 'bg-slate-100 text-slate-600')}>
                    {labels[skill] || skill}
                  </span>
                  <p className="text-xs text-slate-600 leading-relaxed">{explanation}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Original Submission */}
      {sub.imageUrl && (
        <div>
          <button onClick={() => setShowImage(!showImage)}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-4 px-6 rounded-2xl flex items-center justify-center transition-colors shadow-md">
            <ImageIcon className="w-5 h-5 mr-2" /> {showImage ? 'Hide' : 'View'} Original Submission
          </button>
          {showImage && (
            <div className="mt-4 rounded-2xl overflow-hidden border border-slate-200 shadow">
              <SubmissionImage url={sub.imageUrl} alt="Original essay" className="w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
