import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Camera, Users, Upload, FileText, X, Trash2, Loader2, Save } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const DEFAULT_RANGE_BANDS = [
  { label: 'Excellent', score: 5, description: 'Exceeds expectations in all aspects.' },
  { label: 'Very Good', score: 4, description: 'Meets expectations with notable quality.' },
  { label: 'Good', score: 3, description: 'Meets most expectations adequately.' },
  { label: 'Satisfactory', score: 2, description: 'Partially meets expectations.' },
  { label: 'Needs Improvement', score: 1, description: 'Does not meet expectations.' },
];

const RUBRIC_TEMPLATES = [
  {
    id: 'builtin-journal',
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
    id: 'builtin-essay',
    name: 'Standard DepEd Essay Rubric',
    description: 'Standard DepEd rubric for evaluating essay compositions in English and Filipino.',
    gradeRange: 'Grades 4-6',
    criteria: [
      { name: 'Content & Ideas', points: 40, description: 'Depth of ideas, relevance to the topic, supporting details, and understanding of the prompt.' },
      { name: 'Organization', points: 30, description: 'Logical flow, paragraph structure, clear introduction, body, and conclusion. Use of transitions.' },
      { name: 'Language & Grammar', points: 30, description: 'Correct grammar, spelling, punctuation, sentence structure, and vocabulary usage.' }
    ]
  },
  {
    id: 'builtin-creative',
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
    id: 'builtin-research',
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
    id: 'builtin-oral-written',
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

export default function ActivityBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const fileInputRef = useRef(null);
  const rubricFileRef = useRef(null);

  const [isSaving, setIsSaving] = useState(false);
  const [topics, setTopics] = useState([]);
  const [rubricMode, setRubricMode] = useState('template'); // 'template' | 'manual' | 'upload'
  const [rubricType, setRubricType] = useState('standard'); // 'standard' | 'range'
  const [savedRubrics, setSavedRubrics] = useState([]);
  
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (!user.id) return;
        const res = await fetch(`${API_URL}/api/teacher/rubric-templates/${user.id}`);
        const data = await res.json();
        if (data.success && data.templates) {
          const parsedTemplates = data.templates.map(t => ({
            ...t,
            criteria: typeof t.criteria === 'string' ? JSON.parse(t.criteria) : t.criteria
          }));
          setSavedRubrics(parsedTemplates);
        }
      } catch (err) {
        console.error('Failed to load cloud templates:', err);
      }
    };
    fetchTemplates();
  }, []);
  const initialCriteria = (savedRubrics && savedRubrics.length) ? savedRubrics[0].criteria : RUBRIC_TEMPLATES[0].criteria;
  const [rubricCriteria, setRubricCriteria] = useState(initialCriteria);
  const [selectedOption, setSelectedOption] = useState(() => (savedRubrics && savedRubrics.length) ? `saved:${savedRubrics[0].id}` : 'builtin:0');
  const [showAgreement, setShowAgreement] = useState(false);
  const [pendingBuiltinIdx, setPendingBuiltinIdx] = useState(null);
  const [additionalFiles, setAdditionalFiles] = useState([]); // { file, name }[]
  const [rubricFile, setRubricFile] = useState(null);

  // Upload rubric extraction state
  const [extractedCriteria, setExtractedCriteria] = useState(null); // null = not extracted yet
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState(null);

  // Save-as-template modal state
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateTitle, setTemplateTitle] = useState('');

  const [form, setForm] = useState({
    title: '',
    type: 'Essay',
    topic: '',
    points: 100,
    deadline: '',
    instructions: '',
    submissionMode: 'TEACHER_UPLOAD',
  });

  // ── Fetch topics on mount ──
  useEffect(() => {
    fetch(`${API_URL}/api/topics`)
      .then(res => res.json())
      .then(data => { if (data.success) setTopics(data.topics); })
      .catch(() => {});
  }, []);

  // ── Rubric helpers ──
  const updateCriterion = (idx, field, val) => {
    const setter = rubricMode === 'upload' && extractedCriteria ? setExtractedCriteria : setRubricCriteria;
    setter(prev => prev.map((c, i) => i === idx ? { ...c, [field]: field === 'points' ? parseInt(val) || 0 : val } : c));
  };
  const addCriterion = () => {
    const newCriterion = rubricType === 'range'
      ? { name: '', description: '', points: 0, bands: DEFAULT_RANGE_BANDS.map(b => ({ ...b })) }
      : { name: '', description: '', points: 0 };
    const setter = rubricMode === 'upload' && extractedCriteria ? setExtractedCriteria : setRubricCriteria;
    setter(prev => [...prev, newCriterion]);
  };
  const removeCriterion = (idx) => {
    const setter = rubricMode === 'upload' && extractedCriteria ? setExtractedCriteria : setRubricCriteria;
    setter(prev => prev.filter((_, i) => i !== idx));
  };
  const updateBand = (criterionIdx, bandIdx, field, val) => {
    const setter = rubricMode === 'upload' && extractedCriteria ? setExtractedCriteria : setRubricCriteria;
    setter(prev => prev.map((c, ci) => {
      if (ci !== criterionIdx) return c;
      const bands = [...(c.bands || [])];
      bands[bandIdx] = { ...bands[bandIdx], [field]: field === 'score' ? parseInt(val) || 0 : val };
      return { ...c, bands };
    }));
  };

  const activeCriteria = (rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria;
  const totalPoints = activeCriteria.reduce((s, c) => s + (c.points || 0), 0);

  // ── Upload rubric extraction ──
  const handleRubricUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRubricFile(file);
    setExtractionError(null);
    setIsExtracting(true);
    setExtractedCriteria(null);

    try {
      const fd = new FormData();
      fd.append('rubricFile', file);
      const res = await fetch(`${API_URL}/api/teacher/rubric/extract`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success && data.criteria) {
        setExtractedCriteria(data.criteria);
        if (data.rubricType) setRubricType(data.rubricType);
        if (data.totalPoints) setForm(prev => ({ ...prev, points: data.totalPoints }));
      } else {
        setExtractionError(data.error || 'Could not extract rubric criteria.');
      }
    } catch (err) {
      setExtractionError('Network error while extracting rubric. Please try again.');
    } finally {
      setIsExtracting(false);
    }
  };

  const removeRubricFile = () => {
    setRubricFile(null);
    setExtractedCriteria(null);
    setExtractionError(null);
    if (rubricFileRef.current) rubricFileRef.current.value = '';
  };

  // ── Save as template ──
  const handleSaveAsTemplate = () => {
    const criteriaToSave = (rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria;
    if (!criteriaToSave.length) return;
    setTemplateTitle(form.title ? `${form.title} Rubric` : 'My Custom Rubric');
    setShowSaveTemplateModal(true);
  };

  const confirmSaveTemplate = async () => {
    const criteriaToSave = (rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria;
    if (!criteriaToSave.length) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return alert('User not found. Please log in again.');

    try {
      const res = await fetch(`${API_URL}/api/teacher/rubric-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateTitle || 'My Custom Rubric',
          criteria: criteriaToSave,
          teacherId: user.id
        })
      });
      const data = await res.json();
      if (data.success) {
        const savedTemplate = {
          ...data.template,
          criteria: typeof data.template.criteria === 'string' ? JSON.parse(data.template.criteria) : data.template.criteria
        };
        setSavedRubrics(prev => [savedTemplate, ...prev]);
        setShowSaveTemplateModal(false);
        setTemplateTitle('');
        alert(`✓ "${savedTemplate.name}" has been saved to cloud templates.`);
      } else {
        alert('Failed to save template: ' + data.error);
      }
    } catch (err) {
      alert('Network error while saving template.');
    }
  };

  // ── Additional files ──
  const handleAdditionalFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    setAdditionalFiles(prev => [...prev, ...picked.map(f => ({ file: f, name: f.name }))]);
  };
  const removeAdditionalFile = (idx) => setAdditionalFiles(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rubricMode !== 'upload' && totalPoints !== form.points) {
      if (!window.confirm(`Rubric total (${totalPoints} pts) doesn't match activity points (${form.points} pts). Continue?`)) return;
    }
    setIsSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('classId', classId || 'mock-class-id');

      // Build rubric JSON — include extracted criteria for upload mode
      const criteriaForSubmit = (rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria;
      fd.append('rubric', JSON.stringify({ source: rubricMode, type: rubricType, criteria: criteriaForSubmit }));

      additionalFiles.forEach(f => fd.append('additionalFiles', f.file));
      if (rubricFile && rubricMode === 'upload') fd.append('additionalFiles', rubricFile);

      const res = await fetch(`${API_URL}/api/teacher/activities`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) navigate(-1);
      else alert('Error: ' + data.error);
    } catch { alert('Network error'); }
    finally { setIsSaving(false); }
  };

  // ── Criterion Editor (shared by Manual + Upload extracted) ──
  const renderCriterionEditor = (criteria, isUploadExtracted = false) => (
    <div className="space-y-3">
      {criteria.map((c, i) => (
        <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <div className="flex gap-2 items-start">
            <input type="text" value={c.name} onChange={e => updateCriterion(i, 'name', e.target.value)}
              className="flex-1 px-3 py-1.5 border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Criterion name" />
            {rubricType === 'standard' && (
              <input type="number" value={c.points} onChange={e => updateCriterion(i, 'points', e.target.value)}
                className="w-20 px-3 py-1.5 border border-slate-200 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="pts" />
            )}
            <button type="button" onClick={() => removeCriterion(i)} className="text-slate-400 hover:text-red-500 mt-1"><Trash2 className="w-4 h-4" /></button>
          </div>
          <input type="text" value={c.description} onChange={e => updateCriterion(i, 'description', e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Description (optional)" />

          {/* Range bands editor */}
          {rubricType === 'range' && (
            <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-slate-200">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scoring Levels</p>
              {(c.bands || DEFAULT_RANGE_BANDS).map((band, bi) => (
                <div key={bi} className="flex gap-2 items-center">
                  <input type="text" value={band.label} onChange={e => updateBand(i, bi, 'label', e.target.value)}
                    className="w-28 px-2 py-1 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Label" />
                  <input type="number" value={band.score} onChange={e => updateBand(i, bi, 'score', e.target.value)}
                    className="w-14 px-2 py-1 border border-slate-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Score" />
                  <input type="text" value={band.description} onChange={e => updateBand(i, bi, 'description', e.target.value)}
                    className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Description" />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={addCriterion}
        className="text-sm text-brand-navy font-medium flex items-center hover:underline">
        <Plus className="w-4 h-4 mr-1" /> Add Criterion
      </button>
      {rubricType === 'standard' && (
        <div className={cn('text-sm font-bold mt-2 px-3 py-2 rounded-lg', totalPoints === form.points ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50')}>
          Total: {totalPoints}/{form.points} pts {totalPoints !== form.points && `(${form.points - totalPoints > 0 ? '+' : ''}${form.points - totalPoints} remaining)`}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Class
      </button>
      <h1 className="text-2xl font-bold text-brand-slate mb-6">Create New Activity</h1>

      <form className="space-y-6" onSubmit={handleSubmit}>

        {/* ── SUBMISSION MODE ── */}
        <div className="bg-white p-6 rounded-xl border-2 border-brand-navy/10 shadow-sm">
          <h2 className="text-base font-bold text-brand-slate mb-1">How will students submit?</h2>
          <p className="text-xs text-slate-500 mb-4">Choose who uploads the photo of the student output.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button type="button" onClick={() => setForm({ ...form, submissionMode: 'TEACHER_UPLOAD' })}
              className={cn('p-4 rounded-xl border-2 text-left flex flex-col gap-2 transition-all',
                form.submissionMode === 'TEACHER_UPLOAD' ? 'border-brand-navy bg-blue-50 shadow' : 'border-slate-200 hover:border-brand-navy/40')}>
              <div className={cn('p-2 rounded-lg w-fit', form.submissionMode === 'TEACHER_UPLOAD' ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-500')}>
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-brand-slate text-sm">📷 Teacher Uploads</p>
                <p className="text-xs text-slate-500 mt-0.5">Teacher scans student papers via Batch Upload and triggers AI grading.</p>
              </div>
              {form.submissionMode === 'TEACHER_UPLOAD' && <span className="text-xs font-bold text-brand-navy flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Selected</span>}
            </button>
            <button type="button" onClick={() => setForm({ ...form, submissionMode: 'STUDENT_SUBMIT' })}
              className={cn('p-4 rounded-xl border-2 text-left flex flex-col gap-2 transition-all',
                form.submissionMode === 'STUDENT_SUBMIT' ? 'border-brand-green bg-green-50 shadow' : 'border-slate-200 hover:border-brand-green/40')}>
              <div className={cn('p-2 rounded-lg w-fit', form.submissionMode === 'STUDENT_SUBMIT' ? 'bg-brand-green text-white' : 'bg-slate-100 text-slate-500')}>
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-brand-slate text-sm">👤 Student Submits</p>
                <p className="text-xs text-slate-500 mt-0.5">Activity appears on student dashboards. Students upload from the app before the deadline.</p>
              </div>
              {form.submissionMode === 'STUDENT_SUBMIT' && <span className="text-xs font-bold text-brand-green flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Selected</span>}
            </button>
          </div>
        </div>

        {/* ── ACTIVITY DETAILS ── */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
          <h2 className="text-base font-bold text-brand-slate">Activity Details</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
            <input required type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
              placeholder="e.g. Noli Me Tangere Reflection" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                {['Essay', 'Short Answer', 'Journal', 'Reflection', 'Creative Writing', 'Research Paper'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Total Points</label>
              <input type="number" min={1} value={form.points} onChange={e => setForm({ ...form, points: parseInt(e.target.value) || 100 })}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">DepEd Topic (Optional)</label>
            <select value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
              <option value="">— Select a topic (optional) —</option>
              {[1, 2, 3, 4].map(q => {
                const qTopics = topics.filter(t => t.quarter === q);
                return qTopics.length > 0 ? (
                  <optgroup key={q} label={`Quarter ${q}`}>
                    {qTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Deadline {form.submissionMode === 'STUDENT_SUBMIT' && <span className="text-red-500">*</span>}
            </label>
            <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })}
              required={form.submissionMode === 'STUDENT_SUBMIT'}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Instructions for Students</label>
            <textarea rows={4} value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none resize-none"
              placeholder="Write your instructions here..." />
          </div>
        </div>

        {/* ── ADDITIONAL FILES ── */}
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <h2 className="text-base font-bold text-brand-slate mb-1">Additional Materials</h2>
          <p className="text-xs text-slate-500 mb-4">Attach readings, reference images, or supplementary materials for students and AI grading context.</p>

          <div onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center cursor-pointer hover:border-brand-navy hover:bg-blue-50/30 transition-all">
            <Upload className="w-7 h-7 text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-600">Click to attach files</p>
            <p className="text-xs text-slate-400">Images, PDFs, Word documents</p>
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx" className="hidden" onChange={handleAdditionalFiles} />

          {additionalFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {additionalFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-brand-navy" />
                    <span className="text-sm text-slate-700 truncate max-w-[200px]">{f.name}</span>
                  </div>
                  <button type="button" onClick={() => removeAdditionalFile(i)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RUBRIC ── */}
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <h2 className="text-base font-bold text-brand-slate mb-4">Grading Rubric</h2>

          {/* Mode tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            {[['template', '📋 Template'], ['manual', '✏️ Create'], ['upload', '📁 Upload']].map(([val, label]) => (
              <button key={val} type="button" onClick={() => {
                setRubricMode(val);
                if (val === 'template') {
                  const defaultCriteria = savedRubrics && savedRubrics.length ? savedRubrics[0].criteria : RUBRIC_TEMPLATES[0].criteria;
                  setRubricCriteria(defaultCriteria);
                  setSelectedOption(savedRubrics && savedRubrics.length ? `saved:${savedRubrics[0].id}` : 'builtin:0');
                  
                  // Infer type if missing (for older saves)
                  let loadedType = 'standard';
                  if (savedRubrics && savedRubrics.length) {
                    if (savedRubrics[0].type) loadedType = savedRubrics[0].type;
                    else if (savedRubrics[0].criteria?.[0]?.bands?.length > 0) loadedType = 'range';
                  }
                  setRubricType(loadedType);
                } else if (val === 'manual' && rubricMode !== 'manual') {
                  // Start blank in Create mode
                  setRubricCriteria([
                    rubricType === 'range'
                      ? { name: '', description: '', points: 0, bands: DEFAULT_RANGE_BANDS.map(b => ({ ...b })) }
                      : { name: '', description: '', points: 0 }
                  ]);
                }
                if (val !== 'upload') {
                  setRubricFile(null);
                  setExtractedCriteria(null);
                  setExtractionError(null);
                }
              }}
                className={cn('py-2 px-3 text-xs font-bold rounded-lg border-2 transition-all',
                  rubricMode === val ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 text-slate-600 hover:border-brand-navy/50')}>
                {label}
              </button>
            ))}
          </div>

          {/* Rubric Type Toggle (for manual and upload modes) */}
          {(rubricMode === 'manual' || (rubricMode === 'upload' && extractedCriteria)) && (
            <div className="flex gap-2 mb-4">
              <button type="button" onClick={() => setRubricType('standard')}
                className={cn('flex-1 py-2 px-3 text-xs font-bold rounded-lg border-2 transition-all',
                  rubricType === 'standard' ? 'border-brand-green bg-green-50 text-green-700' : 'border-slate-200 text-slate-500 hover:border-green-300')}>
                📊 Standard (Points)
              </button>
              <button type="button" onClick={() => {
                setRubricType('range');
                // Ensure existing criteria get default bands if they don't have any
                const setter = rubricMode === 'upload' && extractedCriteria ? setExtractedCriteria : setRubricCriteria;
                setter(prev => prev.map(c => c.bands && c.bands.length ? c : { ...c, bands: DEFAULT_RANGE_BANDS.map(b => ({ ...b })) }));
              }}
                className={cn('flex-1 py-2 px-3 text-xs font-bold rounded-lg border-2 transition-all',
                  rubricType === 'range' ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:border-purple-300')}>
                📋 Range (Levels)
              </button>
            </div>
          )}

          {/* Template */}
          {rubricMode === 'template' && (
            <div className="space-y-3">
              <select value={selectedOption} onChange={e => {
                  const val = e.target.value;
                  if (val.startsWith('saved:')) {
                    const id = val.slice(6);
                    const found = savedRubrics.find(r => r.id === id);
                    if (found) {
                      setRubricCriteria(found.criteria);
                      setSelectedOption(val);
                      // Infer type if missing
                      let loadedType = found.type;
                      if (!loadedType) {
                        loadedType = found.criteria?.[0]?.bands?.length > 0 ? 'range' : 'standard';
                      }
                      setRubricType(loadedType);
                    }
                  } else if (val.startsWith('builtin:')) {
                    const idx = parseInt(val.split(':')[1] || '0', 10);
                    // Only show notice/agreement for the Essay Writing Rubric
                    const builtin = RUBRIC_TEMPLATES[idx];
                    if (builtin && builtin.id === 'builtin-essay') {
                      setPendingBuiltinIdx(idx);
                      setShowAgreement(true);
                    } else {
                      // apply other built-in rubrics immediately
                      setRubricCriteria(RUBRIC_TEMPLATES[idx].criteria);
                      setSelectedOption(val);
                      setRubricType(RUBRIC_TEMPLATES[idx].type || 'standard');
                    }
                  }
                }}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy mb-3">
                {RUBRIC_TEMPLATES.map((t, i) => <option key={t.id} value={`builtin:${i}`}>{t.name}</option>)}
                {savedRubrics.length > 0 && <optgroup label="Your Saved Rubrics">{savedRubrics.map(r => <option key={r.id} value={`saved:${r.id}`}>{r.name}</option>)}</optgroup>}
              </select>
              {rubricCriteria.map((c, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-brand-green shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-brand-slate">{c.name}</p>
                      <p className="text-xs text-slate-500">{c.description}</p>
                    </div>
                    {rubricType === 'standard' && (
                      <span className="text-sm font-bold text-brand-navy shrink-0">{c.points} pts</span>
                    )}
                  </div>
                  {rubricType === 'range' && c.bands && c.bands.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 ml-8">
                      {c.bands.map((band, bi) => (
                        <div key={bi} className="rounded-lg border border-slate-200 bg-white p-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{band.label}</span>
                            <span className="text-xs font-bold text-brand-slate">{band.score} pts</span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{band.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Manual */}
          {rubricMode === 'manual' && renderCriterionEditor(rubricCriteria)}

          {/* Upload */}
          {rubricMode === 'upload' && (
            <div className="space-y-4">
              {/* Upload area / file display */}
              {!rubricFile ? (
                <div onClick={() => rubricFileRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center cursor-pointer hover:border-brand-navy hover:bg-blue-50/30 transition-all">
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="font-medium text-slate-600 text-sm">Upload Rubric File</p>
                  <p className="text-xs text-slate-400">PDF, image, or Word document</p>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-brand-green" />
                    <span className="text-sm font-medium text-green-700 truncate max-w-[250px]">{rubricFile.name}</span>
                  </div>
                  <button type="button" onClick={removeRubricFile} className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-full hover:bg-red-50">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <input ref={rubricFileRef} type="file" accept="image/*,.pdf,.doc,.docx" className="hidden"
                onChange={handleRubricUpload} />

              {/* Extraction loading */}
              {isExtracting && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  <div>
                    <p className="text-sm font-semibold text-blue-700">Extracting rubric criteria...</p>
                    <p className="text-xs text-blue-500">Gemini is reading your rubric document. This may take a few seconds.</p>
                  </div>
                </div>
              )}

              {/* Extraction error */}
              {extractionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  ⚠ {extractionError}
                </div>
              )}

              {/* Extracted criteria — editable */}
              {extractedCriteria && extractedCriteria.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-brand-slate flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-green" /> Extracted Rubric (Editable)
                    </h3>
                    <button type="button" onClick={handleSaveAsTemplate}
                      className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors flex items-center gap-1">
                      <Save className="w-3.5 h-3.5" /> Save as Template
                    </button>
                  </div>
                  {renderCriterionEditor(extractedCriteria, true)}
                </div>
              )}
            </div>
          )}

          {/* Save as template button for manual mode */}
          {rubricMode === 'manual' && rubricCriteria.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <button type="button" onClick={handleSaveAsTemplate}
                className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors flex items-center gap-1">
                <Save className="w-3.5 h-3.5" /> Save as Template
              </button>
            </div>
          )}

          {/* Removed AI-generated rubric option by request */}
        </div>

        {/* Agreement Modal for built-in rubrics */}
        {showAgreement && typeof pendingBuiltinIdx === 'number' && RUBRIC_TEMPLATES[pendingBuiltinIdx] && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <h3 className="font-bold text-brand-slate text-lg">Pre-defined Rubric Notice</h3>
              </div>
              <p className="text-sm text-slate-600 mb-3">
                You are about to use the pre-defined "{RUBRIC_TEMPLATES[pendingBuiltinIdx].name}" rubric. These rubrics follow DepEd K-12 standards and are provided as a starting point.
              </p>
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                By using this rubric you acknowledge that you have reviewed it and will adapt it as needed for your class and activity level.
              </p>
              <div className="flex gap-3">
                <button onClick={() => { setShowAgreement(false); setPendingBuiltinIdx(null); }}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={() => {
                    const idx = pendingBuiltinIdx;
                    setRubricCriteria(RUBRIC_TEMPLATES[idx].criteria);
                    setSelectedOption(`builtin:${idx}`);
                    setShowAgreement(false);
                    setPendingBuiltinIdx(null);
                  }}
                  className="flex-1 py-2.5 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900">I Agree & Use</button>
              </div>
            </div>
          </div>
        )}

        {/* Save as Template Modal */}
        {showSaveTemplateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Save className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="font-bold text-brand-slate text-lg">Save as Template</h3>
              </div>
              <p className="text-sm text-slate-500 mb-3">Enter a name for your rubric template. You can reuse it when creating future activities.</p>
              <input type="text" value={templateTitle} onChange={e => setTemplateTitle(e.target.value)}
                placeholder="e.g. My Essay Rubric"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 outline-none mb-4" autoFocus />
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowSaveTemplateModal(false); setTemplateTitle(''); }}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={confirmSaveTemplate} disabled={!templateTitle.trim()}
                  className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button type="button" onClick={() => navigate(-1)}
            className="px-6 py-2 rounded-lg text-slate-600 font-medium hover:bg-slate-100 mr-4 transition-colors">Cancel</button>
          <button type="submit" disabled={isSaving}
            className="px-6 py-2 rounded-lg bg-brand-navy text-white font-medium hover:bg-blue-900 transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-60">
            {isSaving ? 'Publishing...' : 'Publish Activity'}
          </button>
        </div>
      </form>
    </div>
  );
}
