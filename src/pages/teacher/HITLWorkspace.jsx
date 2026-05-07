import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Edit2, Info, Sparkles, X, Send, Bot, Loader2, CheckCircle2 } from 'lucide-react';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

export default function HITLWorkspace() {
  const navigate = useNavigate();
  const { submissionId } = useParams();

  const [submission, setSubmission] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedbackText, setFeedbackText] = useState('');
  const [readingStrategy, setReadingStrategy] = useState('');
  const [scores, setScores] = useState({ content: 35, organization: 25, grammar: 25 });
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([
    { role: 'ai', text: "Hi! I'm your AI Co-Pilot. Tell me how you'd like to improve this feedback." }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [covData, setCovData] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!submissionId || submissionId === 'test123') {
      // Demo mode
      setFeedbackText("Your reflection on Crisostomo Ibarra's motivations was deep and insightful. However, the essay lacked clear paragraph transitions.");
      setReadingStrategy("Focus on 'Signpost Words' (however, therefore, consequently) in your next reading assignment.");
      setIsLoading(false);
      return;
    }
    fetch(`http://localhost:3000/api/submissions/${submissionId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.submission) {
          const sub = d.submission;
          setSubmission(sub);
          setFeedbackText(sub.hitlFeedback || sub.aiFeedback || '');
          setReadingStrategy(sub.readingStrategy || '');
          if (sub.rubricData) {
            try {
              const rd = JSON.parse(sub.rubricData);
              setScores({ content: rd.content?.score ?? 35, organization: rd.organization?.score ?? 25, grammar: rd.grammar?.score ?? 25 });
            } catch { }
          }
          if (sub.covData) {
            try { setCovData(JSON.parse(sub.covData)); } catch { }
          }
          if (sub.status === 'GRADED') setIsApproved(true);
        }
      })
      .finally(() => setIsLoading(false));
  }, [submissionId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory]);

  const totalScore = scores.content + scores.organization + scores.grammar;

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatInput('');
    setIsChatLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/teacher/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFeedback: feedbackText, prompt: msg })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'ai', text: data.refinedFeedback }]);
    } catch {
      setChatHistory(prev => [...prev, { role: 'ai', text: 'Error reaching AI. Please check your connection.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const applyFeedback = (text) => { setFeedbackText(text); setIsChatOpen(false); };

  const handleValidate = async () => {
    setIsSaving(true);
    try {
      if (submissionId && submissionId !== 'test123') {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        await fetch(`http://localhost:3000/api/teacher/submissions/${submissionId}/grade`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hitlScore: totalScore,
            hitlFeedback: feedbackText,
            readingStrategy,
            teacherId: user.id,
            rubricData: { content: { score: scores.content, max: 40 }, organization: { score: scores.organization, max: 30 }, grammar: { score: scores.grammar, max: 30 } }
          })
        });
      }
      setIsApproved(true);
    } catch (e) {
      alert('Save failed. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading submission...</div>;

  const rubricItems = [
    { key: 'content', name: 'Content & Ideas', max: 40, color: 'bg-brand-green' },
    { key: 'organization', name: 'Organization', max: 30, color: 'bg-amber-400' },
    { key: 'grammar', name: 'Grammar', max: 30, color: 'bg-blue-400' },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-slate-100 relative overflow-hidden">

      {/* Left: Essay Image */}
      <div className="w-full md:w-5/12 lg:w-1/2 p-4 flex flex-col border-r border-slate-200 bg-slate-50">
        <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-4 shrink-0">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Queue
        </button>
        <div className="flex-1 bg-slate-200 rounded-xl border border-slate-300 overflow-hidden relative min-h-[300px]">
          {submission?.imageUrl ? (
            <img src={`http://localhost:3000${submission.imageUrl}`} alt="Essay" className="w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
              <div className="w-16 h-20 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center">
                <span className="text-2xl">📝</span>
              </div>
              <span className="text-sm font-medium">Handwritten Essay</span>
              <span className="text-xs">Upload image to see here</span>
            </div>
          )}
        </div>
        {submission && (
          <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-500">
            <p className="font-semibold text-brand-slate">{submission.student?.name}</p>
            <p>{submission.activity?.title} • {submission.activity?.class?.name}</p>
          </div>
        )}
      </div>

      {/* Right: Review Panel */}
      <div className="w-full md:w-7/12 lg:w-1/2 flex flex-col bg-white max-h-screen overflow-y-auto">
        <div className="p-6 md:p-8 flex-1 space-y-6">

          {/* CoV Conflict Banner */}
          {covData?.conflict && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-300 rounded-xl text-sm">
              <span className="text-lg shrink-0">🔍</span>
              <div>
                <p className="font-bold text-amber-800">AI Self-Corrected During Verification</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  Original score: <strong>{covData.originalScore}</strong> → Verified score: <strong>{covData.verifiedScore}</strong> (Δ{covData.delta} pts). The AI detected an inconsistency and corrected itself. Review carefully.
                </p>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-6">
            <div>
              <h2 className="text-xl font-bold text-brand-slate">{submission?.student?.name || 'Student Review'}</h2>
              <p className="text-slate-500 text-sm">{submission?.activity?.title || 'Essay Submission'}</p>
              {isApproved && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Released to Student
                </span>
              )}
            </div>
            <div className="text-center bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
              <span className="block text-xs font-bold text-brand-navy uppercase tracking-wider mb-1">Total Score</span>
              <span className="text-3xl font-bold text-brand-navy">{totalScore}<span className="text-xl text-blue-300">/100</span></span>
            </div>
          </div>

          {/* Rubric Breakdown — editable sliders */}
          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Rubric Breakdown <span className="text-slate-300 font-normal normal-case">(drag to adjust)</span></h3>
            <div className="space-y-4">
              {rubricItems.map(item => (
                <div key={item.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{item.name}</span>
                    <span className="font-bold text-slate-900">{scores[item.key]}/{item.max}</span>
                  </div>
                  <input type="range" min={0} max={item.max} value={scores[item.key]}
                    onChange={e => setScores(prev => ({ ...prev, [item.key]: parseInt(e.target.value) }))}
                    className="w-full accent-brand-navy" />
                  <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
                    <div className={cn('h-2 rounded-full transition-all', item.color)} style={{ width: `${(scores[item.key] / item.max) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Qualitative Feedback */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Qualitative Feedback</h3>
              <button onClick={() => setIsChatOpen(true)}
                className="flex items-center text-xs font-bold text-brand-navy bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors border border-blue-200">
                <Sparkles className="w-3.5 h-3.5 mr-1" /> Refine with AI Co-Pilot
              </button>
            </div>
            <textarea className="w-full p-4 bg-white border-2 border-slate-200 rounded-xl text-sm text-slate-700 focus:border-brand-navy focus:ring-4 focus:ring-brand-navy/10 outline-none transition-all leading-relaxed resize-none"
              rows={4} value={feedbackText} onChange={e => setFeedbackText(e.target.value)} />
          </div>

          {/* Reading Strategy */}
          <div className="relative">
            <div className="absolute -left-3 top-4 bottom-4 w-1 bg-brand-amber rounded-r-md" />
            <div className="flex items-center justify-between mb-2 ml-2">
              <h3 className="text-sm font-bold flex items-center text-brand-amber uppercase tracking-wider">
                <Info className="w-4 h-4 mr-1" /> Personalized Reading Strategy
              </h3>
              <Edit2 className="w-4 h-4 text-brand-amber" />
            </div>
            <textarea className="w-full p-4 ml-2 bg-amber-50/50 border-2 border-brand-amber/30 rounded-xl text-sm text-slate-800 focus:border-brand-amber focus:ring-4 focus:ring-brand-amber/20 outline-none transition-all leading-relaxed resize-none"
              rows={3} value={readingStrategy} onChange={e => setReadingStrategy(e.target.value)} />
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="p-4 bg-white border-t border-slate-200 flex gap-3 sticky bottom-0 z-10">
          <button onClick={() => navigate(-1)} className="flex-1 py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors">
            Back
          </button>
          {isApproved ? (
            <button onClick={() => navigate('/teacher/dashboard')} className="flex-1 py-3 px-4 rounded-xl bg-brand-green text-white font-bold hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Done — Back to Dashboard
            </button>
          ) : (
            <button onClick={handleValidate} disabled={isSaving}
              className="flex-1 py-3 px-4 rounded-xl bg-brand-green text-white font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-60">
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              {isSaving ? 'Saving...' : 'Validate & Release'}
            </button>
          )}
        </div>
      </div>

      {/* AI Co-Pilot Drawer */}
      <div className={cn('fixed inset-y-0 right-0 w-full md:w-[400px] bg-white shadow-2xl border-l border-slate-200 transform transition-transform duration-300 z-50 flex flex-col',
        isChatOpen ? 'translate-x-0' : 'translate-x-full')}>
        <div className="p-4 bg-brand-navy text-white flex items-center justify-between">
          <div className="flex items-center font-bold">
            <Sparkles className="w-5 h-5 mr-2 text-blue-300" /> AI Co-Pilot
          </div>
          <button onClick={() => setIsChatOpen(false)} className="text-white/70 hover:text-white"><X className="w-6 h-6" /></button>
        </div>
        <div className="bg-blue-50/50 border-b border-slate-100 p-3 text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-600">Current feedback:</strong> "{feedbackText.slice(0, 80)}..."
        </div>
        <div className="flex-1 p-4 overflow-y-auto bg-slate-50 space-y-4">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={cn('flex flex-col max-w-[85%]', msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start')}>
              {msg.role === 'ai' && (
                <div className="flex items-center text-xs text-slate-500 mb-1 ml-1 font-bold">
                  <Bot className="w-3.5 h-3.5 mr-1" /> AI Assistant
                </div>
              )}
              <div className={cn('p-3 rounded-2xl text-sm shadow-sm',
                msg.role === 'user' ? 'bg-brand-navy text-white rounded-br-none' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-none')}>
                {msg.text}
              </div>
              {msg.role === 'ai' && idx > 0 && (
                <button onClick={() => applyFeedback(msg.text)}
                  className="mt-2 text-xs font-bold text-brand-green flex items-center bg-green-50 px-3 py-1.5 rounded-full hover:bg-green-100 transition-colors border border-green-200">
                  <Check className="w-3.5 h-3.5 mr-1" /> Apply to Feedback
                </button>
              )}
            </div>
          ))}
          {isChatLoading && (
            <div className="flex items-center text-slate-400 text-sm italic mr-auto bg-white border border-slate-200 p-3 rounded-2xl rounded-bl-none">
              <Sparkles className="w-4 h-4 mr-2 animate-pulse text-brand-navy" /> Thinking...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 bg-white border-t border-slate-200">
          <form onSubmit={handleChatSubmit} className="relative">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              placeholder="e.g. Make it more encouraging..."
              className="w-full pl-4 pr-12 py-3 bg-slate-100 border-none rounded-xl focus:ring-2 focus:ring-brand-navy outline-none text-sm"
              disabled={isChatLoading} />
            <button type="submit" disabled={isChatLoading || !chatInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-brand-navy text-white rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
      {isChatOpen && <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setIsChatOpen(false)} />}
    </div>
  );
}
