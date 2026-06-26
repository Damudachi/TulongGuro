import { X, Trophy, FileText, Target, BookOpen, ExternalLink, Sparkles } from 'lucide-react';
import { API_URL } from '../config';

/**
 * Renders a preview of what the student will see when they view their graded paper.
 */
export default function StudentPreviewModal({ submission, onClose }) {
  if (!submission) return null;

  const hitlFeedback = submission.hitlFeedback ? JSON.parse(submission.hitlFeedback) : null;
  const aiFeedback = submission.aiFeedback ? JSON.parse(submission.aiFeedback) : null;
  const fb = hitlFeedback || aiFeedback || {};
  
  const score = submission.hitlScore ?? submission.aiScore ?? 0;
  
  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl relative flex flex-col md:flex-row my-8 animate-fade-in-up border border-slate-200">
        
        {/* Header Ribbon - Mobile only */}
        <div className="md:hidden bg-brand-navy p-4 flex justify-between items-center rounded-t-2xl">
          <h2 className="text-white font-bold flex items-center"><Sparkles className="w-4 h-4 mr-2 text-amber-300" /> Student View Preview</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Left Column: Image & Basic Info */}
        <div className="w-full md:w-1/2 p-6 border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50 flex flex-col rounded-l-2xl">
          <div className="hidden md:flex justify-between items-center mb-6">
            <h2 className="text-brand-slate font-bold flex items-center text-sm">
              <Sparkles className="w-4 h-4 mr-2 text-amber-500" /> Previewing as Student
            </h2>
          </div>
          
          <div className="aspect-[3/4] bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm relative mb-4">
            <img src={`${API_URL}${submission.imageUrl}`} alt="Student submission" className="w-full h-full object-contain" />
          </div>
          
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mb-1">Total Score</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-brand-navy">{score}</span>
              <span className="text-lg font-bold text-slate-400">/ 100</span>
            </div>
          </div>
        </div>

        {/* Right Column: Feedback */}
        <div className="w-full md:w-1/2 p-6 flex flex-col relative bg-white rounded-r-2xl">
          <button onClick={onClose} className="hidden md:flex absolute top-4 right-4 w-8 h-8 bg-slate-100 rounded-full items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
          
          <h3 className="text-2xl font-bold text-brand-slate mb-6 pr-8">Teacher's Feedback</h3>

          <div className="space-y-6 flex-1 overflow-y-auto pr-2">
            
            {/* Praise */}
            <div className="bg-green-50 border border-green-100 p-5 rounded-xl">
              <h4 className="flex items-center text-green-800 font-bold mb-2">
                <Trophy className="w-5 h-5 mr-2" /> What you did well
              </h4>
              <p className="text-green-700 text-sm leading-relaxed">{fb.strengths || "Great effort!"}</p>
            </div>

            {/* Next Steps / Actionable Steps */}
            {fb.actionableSteps && fb.actionableSteps.length > 0 && (
              <div className="bg-blue-50 border border-blue-100 p-5 rounded-xl">
                <h4 className="flex items-center text-blue-800 font-bold mb-3">
                  <Target className="w-5 h-5 mr-2" /> Your Next Steps
                </h4>
                <ul className="space-y-2">
                  {fb.actionableSteps.map((step, idx) => (
                    <li key={idx} className="flex items-start text-sm text-blue-700">
                      <div className="w-5 h-5 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold mr-2 shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Areas for Growth / Targeted Help */}
            {fb.areasForGrowth && fb.areasForGrowth.length > 0 && (
              <div>
                <h4 className="font-bold text-brand-slate mb-3 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-slate-400" /> Targeted Help
                </h4>
                <div className="space-y-3">
                  {fb.areasForGrowth.map((area, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                      <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 mb-3 relative">
                        <div className="absolute -left-1.5 -top-1.5 w-6 h-6 bg-amber-200 rounded-full flex items-center justify-center border border-white shadow-sm font-serif text-amber-700 font-bold text-sm">"</div>
                        <p className="text-sm font-serif text-amber-800 italic ml-2">{area.studentQuote}</p>
                      </div>
                      <p className="text-sm text-slate-600">{area.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reading Strategy */}
            {fb.readingStrategy && fb.readingStrategy !== 'N/A' && (
              <div className="bg-purple-50 border border-purple-100 p-5 rounded-xl mb-4">
                <h4 className="flex items-center text-purple-800 font-bold mb-2">
                  <BookOpen className="w-5 h-5 mr-2" /> Reading Strategy
                </h4>
                <p className="text-purple-700 text-sm">{fb.readingStrategy}</p>
              </div>
            )}

          </div>
          
          <div className="mt-6 pt-4 border-t border-slate-100">
            <button onClick={onClose} className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors">
              Close Preview
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
