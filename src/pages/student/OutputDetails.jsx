import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb, Trophy, Image as ImageIcon, Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Target, MessageCircle, Sparkles } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Parse feedback: handles both new structured JSON and legacy plain strings
function parseFeedback(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && (parsed.strengths || parsed.areasForGrowth)) {
      return parsed;
    }
  } catch { /* not JSON — legacy format */ }
  // Legacy: treat as plain string
  return { strengths: raw, areasForGrowth: [], actionableSteps: [], skillExplanations: {} };
}

export default function OutputDetails() {
  const navigate = useNavigate();
  const { outputId } = useParams();
  const [sub, setSub] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showImage, setShowImage] = useState(false);
  const [showGrowth, setShowGrowth] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [chatMessage, setChatMessage] = useState('');

  useEffect(() => {
    if (!outputId || outputId === 'test123') {
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
            thematicFlow: "Your ideas were connected but the essay jumped between topics in the second paragraph. Each paragraph should focus on one main idea.",
            sentenceStructure: "Good variety of sentence lengths! A few run-on sentences could be split for clarity."
          }
        }),
        aiFeedback: "Good effort on the topic.",
        readingStrategy: "Focus on identifying 'Signpost Words' (however, therefore, consequently) when reading the next chapter. This will help you use them in your own writing.",
        rubricData: JSON.stringify({ content: { score: 35, max: 40 }, organization: { score: 25, max: 30 }, grammar: { score: 28, max: 30 } }),
        student: { name: 'Juan Dela Cruz' }, updatedAt: new Date().toISOString()
      });
      setIsLoading(false);
      return;
    }
    fetch(`${API_URL}/api/submissions/${outputId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSub(d.submission); })
      .finally(() => setIsLoading(false));
  }, [outputId]);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-brand-green" /></div>;
  if (!sub) return <div className="p-8 text-center text-slate-500">Submission not found.</div>;

  const score = sub.hitlScore ?? sub.aiScore ?? 0;
  const feedback = parseFeedback(sub.hitlFeedback || sub.aiFeedback);
  const rubric = sub.rubricData ? JSON.parse(sub.rubricData) : {
    content: { score: 35, max: 40 }, organization: { score: 25, max: 30 }, grammar: { score: 28, max: 30 }
  };
  const rubricItems = [
    { name: 'Content & Ideas', ...rubric.content, color: 'bg-brand-green' },
    { name: 'Organization', ...rubric.organization, color: 'bg-amber-400' },
    { name: 'Grammar', ...rubric.grammar, color: 'bg-blue-400' },
  ];

  const hasStructuredFeedback = feedback && (feedback.areasForGrowth?.length > 0 || feedback.actionableSteps?.length > 0);

  // Handle deep-link to chatbot — dispatch a custom event
  const askStudyBuddy = (question, contextData = null) => {
    window.dispatchEvent(new CustomEvent('open-study-buddy', { 
      detail: { message: question, context: contextData } 
    }));
  };

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
            <span className="text-2xl text-green-200">/100</span>
          </div>
        </div>

        <div className="p-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Rubric Breakdown</h3>
          <div className="space-y-5">
            {rubricItems.map((item, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-medium text-slate-700">{item.name}</span>
                  <span className="font-bold text-slate-900">{item.score}/{item.max}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div className={cn('h-3 rounded-full transition-all duration-700', item.color)}
                    style={{ width: `${(item.score / item.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
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
                  
                  {/* Contextual Ask Study Buddy button */}
                  <div className="pl-4">
                    <button
                      onClick={() => askStudyBuddy(`Can you help me understand this mistake: "${item.studentQuote}"?`, {
                        assignmentTitle: sub.activity?.title,
                        mistakeQuote: item.studentQuote,
                        teacherExplanation: item.explanation
                      })}
                      className="inline-flex items-center justify-center gap-2 py-2 px-3 bg-gradient-to-r from-emerald-50 to-green-50 border border-green-200 rounded-lg text-xs font-bold text-green-700 hover:border-green-300 hover:shadow-sm transition-all"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Ask Study Buddy about this
                    </button>
                  </div>
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
              <img src={sub.imageUrl?.startsWith('http') ? sub.imageUrl : `${API_URL}${sub.imageUrl}`} alt="Original essay" className="w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
