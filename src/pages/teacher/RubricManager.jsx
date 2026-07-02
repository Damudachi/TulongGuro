import { useState } from 'react';
import { ClipboardList, Check, ChevronDown, ChevronRight, AlertTriangle, Eye, Copy } from 'lucide-react';

// Band label → color mapping for UI
const BAND_COLORS = {
  Outstanding: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  Proficient:  { bg: 'bg-blue-100',  text: 'text-blue-700',  border: 'border-blue-200' },
  Developing:  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  Beginning:   { bg: 'bg-red-100',   text: 'text-red-700',   border: 'border-red-200' },
};

// Pre-defined DepEd K-12 Rubrics with MATATAG banded scoring
const DEPED_RUBRICS = [
  {
    id: 'essay',
    name: 'Essay Writing Rubric',
    description: 'Standard DepEd rubric for evaluating essay compositions in English and Filipino.',
    gradeRange: 'Grades 4-6',
    criteria: [
      {
        name: 'Content & Ideas', points: 40,
        description: 'Depth of ideas, relevance to the topic, supporting details, and understanding of the prompt.',
        bands: [
          { range: '35-40', label: 'Outstanding', description: 'Rich, original ideas with specific supporting details that fully address the prompt.' },
          { range: '25-34', label: 'Proficient', description: 'Clear ideas with adequate supporting details. Minor gaps in addressing the prompt.' },
          { range: '15-24', label: 'Developing', description: 'Basic ideas present but lack depth, specifics, or full relevance to the prompt.' },
          { range: '0-14',  label: 'Beginning', description: 'Ideas unclear, off-topic, or missing. Little to no supporting detail.' }
        ]
      },
      {
        name: 'Organization', points: 30,
        description: 'Logical flow, paragraph structure, clear introduction, body, and conclusion. Use of transitions.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Seamless structure with clear intro, body, and conclusion. Transitions guide the reader naturally.' },
          { range: '19-26', label: 'Proficient', description: 'Recognizable structure with mostly smooth transitions. Minor lapses in flow.' },
          { range: '10-18', label: 'Developing', description: 'Some structure is present but paragraphs may be disorganized or transitions are weak.' },
          { range: '0-9',   label: 'Beginning', description: 'No clear structure. Ideas are randomly placed with no transitions.' }
        ]
      },
      {
        name: 'Language & Grammar', points: 30,
        description: 'Correct grammar, spelling, punctuation, sentence structure, and vocabulary usage.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Nearly error-free grammar and spelling. Varied sentence patterns and rich vocabulary.' },
          { range: '19-26', label: 'Proficient', description: 'Few grammatical errors that do not impede understanding. Adequate vocabulary.' },
          { range: '10-18', label: 'Developing', description: 'Frequent errors in grammar or spelling that sometimes obscure meaning.' },
          { range: '0-9',   label: 'Beginning', description: 'Pervasive errors that make the writing very difficult to understand.' }
        ]
      }
    ]
  },
  {
    id: 'journal',
    name: 'Journal / Reflection Rubric',
    description: 'For evaluating personal reflections, reading journals, and diary entries.',
    gradeRange: 'Grades 3-6',
    criteria: [
      {
        name: 'Reflection Depth', points: 35,
        description: 'Demonstrates genuine thinking, personal connections to the topic, and insightful observations.',
        bands: [
          { range: '31-35', label: 'Outstanding', description: 'Deep, thoughtful reflection with personal insights and meaningful connections to the topic.' },
          { range: '22-30', label: 'Proficient', description: 'Shows genuine reflection with some personal connections. Observations are relevant.' },
          { range: '12-21', label: 'Developing', description: 'Surface-level reflection with limited personal connection or insight.' },
          { range: '0-11',  label: 'Beginning', description: 'Little to no reflection. Responses are generic or unrelated to the topic.' }
        ]
      },
      {
        name: 'Content Completeness', points: 35,
        description: 'Addresses all aspects of the prompt, provides specific examples and details.',
        bands: [
          { range: '31-35', label: 'Outstanding', description: 'Fully addresses every part of the prompt with vivid, specific examples and thorough detail.' },
          { range: '22-30', label: 'Proficient', description: 'Addresses most parts of the prompt with adequate examples. Minor omissions.' },
          { range: '12-21', label: 'Developing', description: 'Partially addresses the prompt. Examples are vague or incomplete.' },
          { range: '0-11',  label: 'Beginning', description: 'Prompt is largely ignored. Very few or no examples provided.' }
        ]
      },
      {
        name: 'Language Use', points: 30,
        description: 'Age-appropriate vocabulary, readable handwriting, basic grammar and sentence structure.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Age-appropriate vocabulary used effectively. Clear handwriting and very few grammar errors.' },
          { range: '19-26', label: 'Proficient', description: 'Mostly correct grammar and readable handwriting. Vocabulary is appropriate.' },
          { range: '10-18', label: 'Developing', description: 'Some grammar issues and hard-to-read handwriting. Vocabulary is limited.' },
          { range: '0-9',   label: 'Beginning', description: 'Many grammar errors. Handwriting is illegible and vocabulary is very basic or incorrect.' }
        ]
      }
    ]
  },
  {
    id: 'creative',
    name: 'Creative Writing Rubric',
    description: 'For evaluating short stories, poems, and other creative writing outputs.',
    gradeRange: 'Grades 4-6',
    criteria: [
      {
        name: 'Creativity & Imagination', points: 30,
        description: 'Originality of ideas, unique perspective, vivid imagery, and creative expression.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Highly original ideas with vivid imagery and a unique, imaginative perspective throughout.' },
          { range: '19-26', label: 'Proficient', description: 'Shows creativity with some vivid details. Ideas are interesting but may lack full originality.' },
          { range: '10-18', label: 'Developing', description: 'Limited creativity. Ideas are predictable with few vivid or imaginative details.' },
          { range: '0-9',   label: 'Beginning', description: 'No evidence of creativity or imagination. Writing is flat and unoriginal.' }
        ]
      },
      {
        name: 'Story Elements', points: 25,
        description: 'Clear characters, setting, plot (beginning, middle, end), conflict, and resolution.',
        bands: [
          { range: '22-25', label: 'Outstanding', description: 'Well-developed characters, vivid setting, and a complete plot with engaging conflict and satisfying resolution.' },
          { range: '16-21', label: 'Proficient', description: 'Identifiable characters and setting. Plot has a beginning, middle, and end with minor gaps.' },
          { range: '9-15',  label: 'Developing', description: 'Some story elements present but characters or plot are underdeveloped or incomplete.' },
          { range: '0-8',   label: 'Beginning', description: 'Story elements are mostly missing. No clear characters, setting, or plot structure.' }
        ]
      },
      {
        name: 'Language & Style', points: 25,
        description: 'Descriptive language, varied sentence patterns, word choice, and figurative language.',
        bands: [
          { range: '22-25', label: 'Outstanding', description: 'Expressive language with varied sentences, strong word choice, and effective figurative language.' },
          { range: '16-21', label: 'Proficient', description: 'Good word choice with some sentence variety. Attempts at descriptive or figurative language.' },
          { range: '9-15',  label: 'Developing', description: 'Basic word choice with little sentence variety. Rare use of descriptive language.' },
          { range: '0-8',   label: 'Beginning', description: 'Very limited vocabulary. Sentences are repetitive and lack any descriptive quality.' }
        ]
      },
      {
        name: 'Mechanics', points: 20,
        description: 'Correct spelling, punctuation, capitalization, and paragraph formatting.',
        bands: [
          { range: '18-20', label: 'Outstanding', description: 'Nearly perfect spelling, punctuation, and capitalization. Paragraphs are well-formatted.' },
          { range: '13-17', label: 'Proficient', description: 'Few mechanical errors. Paragraphing is mostly correct.' },
          { range: '7-12',  label: 'Developing', description: 'Noticeable errors in spelling or punctuation. Inconsistent paragraphing.' },
          { range: '0-6',   label: 'Beginning', description: 'Many mechanical errors throughout. No evidence of paragraphing or formatting.' }
        ]
      }
    ]
  },
  {
    id: 'research',
    name: 'Research Report Rubric',
    description: 'For evaluating research papers, investigative reports, and informational writing.',
    gradeRange: 'Grades 5-6',
    criteria: [
      {
        name: 'Research Quality', points: 30,
        description: 'Accuracy of information, use of credible sources, and depth of investigation.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Information is accurate and well-sourced from multiple credible references. Deep investigation evident.' },
          { range: '19-26', label: 'Proficient', description: 'Mostly accurate information with some credible sources. Adequate depth of research.' },
          { range: '10-18', label: 'Developing', description: 'Some inaccuracies or reliance on weak sources. Research lacks depth.' },
          { range: '0-9',   label: 'Beginning', description: 'Information is inaccurate, unsourced, or largely absent. No evidence of research.' }
        ]
      },
      {
        name: 'Content & Analysis', points: 30,
        description: 'Clear thesis, supporting evidence, logical arguments, and conclusions drawn from data.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Strong thesis with compelling evidence and logical analysis. Conclusions are well-supported by data.' },
          { range: '19-26', label: 'Proficient', description: 'Clear thesis with adequate evidence. Analysis is logical with minor gaps in reasoning.' },
          { range: '10-18', label: 'Developing', description: 'Thesis is vague. Evidence is limited and analysis is superficial.' },
          { range: '0-9',   label: 'Beginning', description: 'No clear thesis. Evidence and analysis are missing or irrelevant.' }
        ]
      },
      {
        name: 'Organization & Format', points: 20,
        description: 'Proper report structure (introduction, body, conclusion), headings, and citations.',
        bands: [
          { range: '18-20', label: 'Outstanding', description: 'Excellent report structure with clear headings, proper citations, and professional formatting.' },
          { range: '13-17', label: 'Proficient', description: 'Good structure with headings. Citations are present but may have minor formatting issues.' },
          { range: '7-12',  label: 'Developing', description: 'Some structure visible but headings or citations are missing or inconsistent.' },
          { range: '0-6',   label: 'Beginning', description: 'No discernible structure, headings, or citations. Formatting is absent.' }
        ]
      },
      {
        name: 'Language & Mechanics', points: 20,
        description: 'Formal tone, correct grammar, spelling, and proper academic writing conventions.',
        bands: [
          { range: '18-20', label: 'Outstanding', description: 'Consistently formal tone with near-perfect grammar and spelling. Academic conventions followed.' },
          { range: '13-17', label: 'Proficient', description: 'Mostly formal tone. Few grammar or spelling errors. Academic style is generally maintained.' },
          { range: '7-12',  label: 'Developing', description: 'Informal tone in places. Several grammar or spelling errors. Academic style is inconsistent.' },
          { range: '0-6',   label: 'Beginning', description: 'Casual or inappropriate tone. Many errors make the writing hard to follow.' }
        ]
      }
    ]
  },
  {
    id: 'oral-written',
    name: 'Oral / Written Presentation Rubric',
    description: 'For evaluating written drafts of presentations, speeches, or show-and-tell scripts.',
    gradeRange: 'Grades 3-6',
    criteria: [
      {
        name: 'Content & Message', points: 35,
        description: 'Clarity of the main message, supporting points, and relevance to the topic.',
        bands: [
          { range: '31-35', label: 'Outstanding', description: 'Main message is powerful and clear with strong supporting points fully relevant to the topic.' },
          { range: '22-30', label: 'Proficient', description: 'Message is clear with adequate supporting points. Mostly relevant to the topic.' },
          { range: '12-21', label: 'Developing', description: 'Message is present but unclear. Supporting points are weak or partially relevant.' },
          { range: '0-11',  label: 'Beginning', description: 'No clear message. Supporting points are missing or off-topic.' }
        ]
      },
      {
        name: 'Organization & Flow', points: 30,
        description: 'Logical sequence of ideas, smooth transitions, engaging introduction and conclusion.',
        bands: [
          { range: '27-30', label: 'Outstanding', description: 'Ideas flow logically with smooth transitions. Introduction hooks the audience and conclusion is memorable.' },
          { range: '19-26', label: 'Proficient', description: 'Mostly logical sequence with some transitions. Introduction and conclusion are present.' },
          { range: '10-18', label: 'Developing', description: 'Sequence is sometimes hard to follow. Transitions are weak or missing.' },
          { range: '0-9',   label: 'Beginning', description: 'No logical sequence. Ideas are jumbled with no introduction or conclusion.' }
        ]
      },
      {
        name: 'Language & Expression', points: 35,
        description: 'Appropriate vocabulary, persuasive or informative tone, and correct grammar.',
        bands: [
          { range: '31-35', label: 'Outstanding', description: 'Engaging, audience-appropriate vocabulary with a convincing tone and excellent grammar.' },
          { range: '22-30', label: 'Proficient', description: 'Good vocabulary and appropriate tone. Few grammatical errors.' },
          { range: '12-21', label: 'Developing', description: 'Limited vocabulary. Tone is inconsistent and grammar errors are noticeable.' },
          { range: '0-11',  label: 'Beginning', description: 'Poor vocabulary and inappropriate tone. Grammar errors impede communication.' }
        ]
      }
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
                      <div key={i} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-lg bg-brand-navy/10 text-brand-navy flex items-center justify-center font-extrabold text-sm shrink-0">
                            {c.points}
                          </div>
                          <div>
                            <p className="font-semibold text-brand-slate text-sm">{c.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>
                          </div>
                        </div>
                        {/* Scoring Bands */}
                        {c.bands && c.bands.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 ml-0 sm:ml-15">
                            {c.bands.map((band, bi) => {
                              const color = BAND_COLORS[band.label] || BAND_COLORS.Beginning;
                              return (
                                <div key={bi} className={`rounded-lg border ${color.border} bg-white p-2.5`}>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-brand-slate">{band.range}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>{band.label}</span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 leading-relaxed">{band.description}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
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
