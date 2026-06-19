import { useState } from 'react';
import { ClipboardList, Check, ChevronDown, ChevronRight, AlertTriangle, Eye, Copy } from 'lucide-react';

// Pre-defined DepEd K-12 Rubrics
const DEPED_RUBRICS = [
  {
    id: 'essay',
    name: 'Essay Writing Rubric',
    description: 'Standard DepEd rubric for evaluating essay compositions in English and Filipino.',
    gradeRange: 'Grades 4-6',
    criteria: [
      { name: 'Content & Ideas', points: 40, description: 'Depth of ideas, relevance to the topic, supporting details, and understanding of the prompt.' },
      { name: 'Organization', points: 30, description: 'Logical flow, paragraph structure, clear introduction, body, and conclusion. Use of transitions.' },
      { name: 'Language & Grammar', points: 30, description: 'Correct grammar, spelling, punctuation, sentence structure, and vocabulary usage.' }
    ]
  },
  {
    id: 'journal',
    name: 'Journal / Reflection Rubric',
    description: 'For evaluating personal reflections, reading journals, and diary entries.',
    gradeRange: 'Grades 3-6',
    criteria: [
      { name: 'Reflection Depth', points: 35, description: 'Demonstrates genuine thinking, personal connections to the topic, and insightful observations.' },
      { name: 'Content Completeness', points: 35, description: 'Addresses all aspects of the prompt, provides specific examples and details.' },
      { name: 'Language Use', points: 30, description: 'Age-appropriate vocabulary, readable handwriting, basic grammar and sentence structure.' }
    ]
  },
  {
    id: 'creative',
    name: 'Creative Writing Rubric',
    description: 'For evaluating short stories, poems, and other creative writing outputs.',
    gradeRange: 'Grades 4-6',
    criteria: [
      { name: 'Creativity & Imagination', points: 30, description: 'Originality of ideas, unique perspective, vivid imagery, and creative expression.' },
      { name: 'Story Elements', points: 25, description: 'Clear characters, setting, plot (beginning, middle, end), conflict, and resolution.' },
      { name: 'Language & Style', points: 25, description: 'Descriptive language, varied sentence patterns, word choice, and figurative language.' },
      { name: 'Mechanics', points: 20, description: 'Correct spelling, punctuation, capitalization, and paragraph formatting.' }
    ]
  },
  {
    id: 'research',
    name: 'Research Report Rubric',
    description: 'For evaluating research papers, investigative reports, and informational writing.',
    gradeRange: 'Grades 5-6',
    criteria: [
      { name: 'Research Quality', points: 30, description: 'Accuracy of information, use of credible sources, and depth of investigation.' },
      { name: 'Content & Analysis', points: 30, description: 'Clear thesis, supporting evidence, logical arguments, and conclusions drawn from data.' },
      { name: 'Organization & Format', points: 20, description: 'Proper report structure (introduction, body, conclusion), headings, and citations.' },
      { name: 'Language & Mechanics', points: 20, description: 'Formal tone, correct grammar, spelling, and proper academic writing conventions.' }
    ]
  },
  {
    id: 'oral-written',
    name: 'Oral / Written Presentation Rubric',
    description: 'For evaluating written drafts of presentations, speeches, or show-and-tell scripts.',
    gradeRange: 'Grades 3-6',
    criteria: [
      { name: 'Content & Message', points: 35, description: 'Clarity of the main message, supporting points, and relevance to the topic.' },
      { name: 'Organization & Flow', points: 30, description: 'Logical sequence of ideas, smooth transitions, engaging introduction and conclusion.' },
      { name: 'Language & Expression', points: 35, description: 'Appropriate vocabulary, persuasive or informative tone, and correct grammar.' }
    ]
  }
];

export default function RubricManager() {
  const [expandedId, setExpandedId] = useState(null);
  const [showAgreement, setShowAgreement] = useState(null); // rubric id being agreed to
  const [savedRubrics, setSavedRubrics] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedRubrics') || '[]'); }
    catch { return []; }
  });

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  const handleUseRubric = (rubric) => {
    setShowAgreement(rubric.id);
  };

  const confirmUseRubric = (rubric) => {
    const saved = [...savedRubrics];
    if (!saved.find(r => r.id === rubric.id)) {
      saved.push({ ...rubric, savedAt: new Date().toISOString() });
      setSavedRubrics(saved);
      localStorage.setItem('savedRubrics', JSON.stringify(saved));
    }
    setShowAgreement(null);
    alert(`✓ "${rubric.name}" has been saved to your rubrics. You can now select it when creating activities.`);
  };

  const isAlreadySaved = (id) => savedRubrics.some(r => r.id === id);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-brand-navy" /> Grading Rubrics
        </h1>
        <p className="text-slate-500 text-sm mt-1">Pre-defined DepEd K-12 rubrics for standardized grading</p>
      </div>

      {/* Saved Rubrics */}
      {savedRubrics.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Your Saved Rubrics</h2>
          <div className="flex flex-wrap gap-2">
            {savedRubrics.map(r => (
              <span key={r.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-semibold">
                <Check className="w-3.5 h-3.5" /> {r.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* DepEd Rubric Cards */}
      <div className="space-y-4">
        {DEPED_RUBRICS.map(rubric => {
          const isOpen = expandedId === rubric.id;
          const saved = isAlreadySaved(rubric.id);
          const totalPoints = rubric.criteria.reduce((sum, c) => sum + c.points, 0);

          return (
            <div key={rubric.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Header */}
              <button onClick={() => toggleExpand(rubric.id)}
                className="w-full p-5 flex items-start justify-between text-left hover:bg-slate-50 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-brand-slate">{rubric.name}</h3>
                    {saved && <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-700 rounded-full">SAVED</span>}
                  </div>
                  <p className="text-sm text-slate-500">{rubric.description}</p>
                  <div className="flex gap-3 mt-2">
                    <span className="text-xs font-medium text-slate-400">{rubric.gradeRange}</span>
                    <span className="text-xs font-medium text-slate-400">•</span>
                    <span className="text-xs font-medium text-slate-400">{rubric.criteria.length} criteria</span>
                    <span className="text-xs font-medium text-slate-400">•</span>
                    <span className="text-xs font-medium text-slate-400">{totalPoints} total points</span>
                  </div>
                </div>
                {isOpen ? <ChevronDown className="w-5 h-5 text-slate-400 mt-1 shrink-0" />
                         : <ChevronRight className="w-5 h-5 text-slate-400 mt-1 shrink-0" />}
              </button>

              {/* Expanded — Criteria Details */}
              {isOpen && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                  <div className="space-y-3 mb-5">
                    {rubric.criteria.map((c, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                        <div className="w-12 h-12 rounded-lg bg-brand-navy/10 text-brand-navy flex items-center justify-center font-extrabold text-sm shrink-0">
                          {c.points}
                        </div>
                        <div>
                          <p className="font-semibold text-brand-slate text-sm">{c.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    {saved ? (
                      <span className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
                        <Check className="w-4 h-4" /> Already in your rubrics
                      </span>
                    ) : (
                      <button onClick={() => handleUseRubric(rubric)}
                        className="px-4 py-2 bg-brand-navy text-white rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors flex items-center gap-2">
                        <Copy className="w-4 h-4" /> Use This Rubric
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Agreement Modal */}
      {showAgreement && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="font-bold text-brand-slate text-lg">DepEd Rubric Notice</h3>
            </div>
            <p className="text-sm text-slate-600 mb-2">
              This rubric follows <strong>DepEd K-12 standards</strong> for the Philippine public school curriculum.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
              <p className="text-sm text-amber-800">
                By using this rubric, you agree that it is appropriate for your class and activity level.
                You may modify the criteria after saving to better fit your specific requirements.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowAgreement(null)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => confirmUseRubric(DEPED_RUBRICS.find(r => r.id === showAgreement))}
                className="flex-1 py-2.5 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900">
                I Agree & Use
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
