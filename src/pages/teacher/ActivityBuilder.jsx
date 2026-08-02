import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Camera, Users, Upload, FileText, X, Trash2, Loader2, Save } from 'lucide-react';
import { API_URL } from '../../config';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const getBandColor = (label, index, totalBands) => {
  if (!label) return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
  const n = label.toLowerCase();
  if (n.includes('outstanding') || n.includes('excellent')) return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
  if (n.includes('proficient') || n.includes('very good')) return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' };
  if (n.includes('satisfactory')) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' };
  if (n.includes('good') || n.includes('developing')) return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' };
  if (n.includes('beginning') || n.includes('needs improvement') || n.includes('poor')) return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
  if (totalBands > 1) {
    const ratio = index / (totalBands - 1);
    if (ratio <= 0.25) return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
    if (ratio <= 0.5) return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' };
    if (ratio <= 0.75) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' };
    return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
  }
  return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
};

const DEFAULT_RANGE_BANDS = [
  { label: 'Excellent', score: 5, description: 'Exceeds expectations in all aspects.' },
  { label: 'Very Good', score: 4, description: 'Meets expectations with notable quality.' },
  { label: 'Good', score: 3, description: 'Meets most expectations adequately.' },
  { label: 'Satisfactory', score: 2, description: 'Partially meets expectations.' },
  { label: 'Needs Improvement', score: 1, description: 'Does not meet expectations.' },
];

export default function ActivityBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activityId: editActivityId } = useParams();
  const isEditMode = !!editActivityId;
  const classId = searchParams.get('classId');
  const fileInputRef = useRef(null);
  const rubricFileRef = useRef(null);
  const [isLoadingEdit, setIsLoadingEdit] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [topics, setTopics] = useState([]);
  const [classLessons, setClassLessons] = useState([]);
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [rubricMode, setRubricMode] = useState('template'); // 'template' | 'manual' | 'upload'
  const [rubricType, setRubricType] = useState('standard'); // 'standard' | 'range'
  const [savedRubrics, setSavedRubrics] = useState([]);
  const [builtinRubrics, setBuiltinRubrics] = useState([]);

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

  // ── Fetch built-in curriculum-aligned rubric templates ──
  useEffect(() => {
    fetch(`${API_URL}/api/rubric-templates/builtin`)
      .then(res => res.json())
      .then(data => { if (data.success && data.templates) setBuiltinRubrics(data.templates); })
      .catch(() => {});
  }, []);

  const [rubricCriteria, setRubricCriteria] = useState([{ name: '', description: '', points: 100 }]);
  const [selectedOption, setSelectedOption] = useState('builtin:__pending');

  // Once built-in rubrics load, apply the first one as the default — but only if the
  // teacher hasn't already picked something else (saved rubric, or a topic-recommended one).
  useEffect(() => {
    if (builtinRubrics.length && selectedOption === 'builtin:__pending') {
      if (savedRubrics.length) {
        setRubricCriteria(savedRubrics[0].criteria);
        setSelectedOption(`saved:${savedRubrics[0].id}`);
      } else {
        setRubricCriteria(builtinRubrics[0].criteria);
        setRubricType(builtinRubrics[0].type || 'standard');
        setSelectedOption(`builtin:${builtinRubrics[0].id}`);
      }
    }
  }, [builtinRubrics, savedRubrics]);
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
    maxAttempts: 1,
  });

  // ── Fetch topics on mount ──
  useEffect(() => {
    fetch(`${API_URL}/api/topics`)
      .then(res => res.json())
      .then(data => { if (data.success) setTopics(data.topics); })
      .catch(() => {});
  }, []);

  // Fetch class lessons from parsed curriculum
  useEffect(() => {
    if (!classId) return;
    fetch(`${API_URL}/api/teacher/classes/${classId}/lessons`)
      .then(res => res.json())
      .then(data => { if (data.success) setClassLessons(data.lessons || []); })
      .catch(() => {});
  }, [classId]);

  // ── Edit Mode: Fetch existing activity and pre-fill form ──
  useEffect(() => {
    if (!isEditMode || !editActivityId) return;
    setIsLoadingEdit(true);
    fetch(`${API_URL}/api/activities/${editActivityId}/submissions`)
      .then(r => r.json())
      .catch(() => null);
    // Fetch the activity from the class activities list
    // We need a direct activity fetch. Let's use the submissions endpoint parent activity.
    // Actually, there's no direct activity fetch, so we'll use the class endpoint.
    // For now, we'll fetch from a search across teacher classes.
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) { setIsLoadingEdit(false); return; }
    fetch(`${API_URL}/api/teacher/${user.id}/classes`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) return;
        for (const cls of data.classes) {
          const activity = cls.activities?.find(a => a.id === editActivityId);
          if (activity) {
            setForm({
              title: activity.title || '',
              type: activity.type || 'Essay',
              topic: activity.topic || '',
              points: activity.points || 100,
              deadline: activity.deadline ? String(activity.deadline).split('T')[0] : '',
              instructions: activity.instructions || '',
              submissionMode: activity.submissionMode || 'TEACHER_UPLOAD',
              maxAttempts: activity.maxAttempts || 1,
            });
            // Pre-fill rubric if it exists
            if (activity.rubric) {
              try {
                const parsed = JSON.parse(activity.rubric);
                if (parsed.criteria?.length) {
                  setRubricCriteria(parsed.criteria);
                  if (parsed.type) setRubricType(parsed.type);
                  if (parsed.source) setRubricMode(parsed.source);
                  setSelectedOption('custom');
                }
              } catch {}
            }
            break;
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingEdit(false));
  }, [isEditMode, editActivityId]);

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
  const totalPercentage = activeCriteria.reduce((s, c) => s + (c.points || 0), 0);

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
    if (rubricMode !== 'upload' && totalPercentage !== 100) {
      alert(`Rubric weight must total 100%. Currently it is ${totalPercentage}%.`);
      return;
    }
    if (!form.points || form.points < 1) {
      alert("Total Points must be greater than 0.");
      return;
    }
    setIsSaving(true);
    try {
      if (isEditMode) {
        // UPDATE existing activity via JSON
        const criteriaForSubmit = (rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria;
        const res = await fetch(`${API_URL}/api/teacher/activities/${editActivityId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            classLessonId: selectedLessonId || null,
            rubric: JSON.stringify({ source: rubricMode, type: rubricType, criteria: criteriaForSubmit })
          })
        });
        const data = await res.json();
        if (data.success) navigate(-1);
        else alert('Error: ' + data.error);
      } else {
        // CREATE new activity via FormData
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        fd.append('classId', classId || 'mock-class-id');
        if (selectedLessonId) fd.append('classLessonId', selectedLessonId);

        // Build rubric JSON — include extracted criteria for upload mode
        const criteriaForSubmit = (rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria;
        fd.append('rubric', JSON.stringify({ source: rubricMode, type: rubricType, criteria: criteriaForSubmit }));

        additionalFiles.forEach(f => fd.append('additionalFiles', f.file));
        if (rubricFile && rubricMode === 'upload') fd.append('additionalFiles', rubricFile);

        const res = await fetch(`${API_URL}/api/teacher/activities`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) navigate(-1);
        else alert('Error: ' + data.error);
      }
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
              <div className="flex items-center gap-2">
                <input type="number" value={c.points === 0 ? '' : c.points} onChange={e => {
                  const val = e.target.value;
                  updateCriterion(i, 'points', val === '' ? 0 : parseInt(val) || 0);
                }}
                  className="w-20 px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
                <span className="text-slate-500 font-medium">%</span>
                <span className="text-brand-navy font-bold text-sm ml-2">
                  = {((c.points / 100) * (form.points || 0)).toFixed(1).replace(/\.0$/, '')} pts
                </span>
              </div>
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
        <div className={cn('text-sm font-bold mt-2 px-3 py-2 rounded-lg', totalPercentage === 100 ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50')}>
          Total Weight: {totalPercentage}% {totalPercentage !== 100 && `(${100 - totalPercentage > 0 ? '+' : ''}${100 - totalPercentage}% remaining)`}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Class
      </button>
      <h1 className="text-2xl font-bold text-brand-slate mb-6">{isEditMode ? 'Edit Activity' : 'Create New Activity'}</h1>

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
                <p className="text-xs text-slate-500 mt-0.5">Teacher scans student papers via Scan & Grade Papers and triggers AI grading.</p>
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
                {ACTIVITY_TYPES.map(t => <option key={t}>{t}</option>)}
                {/* A lesson's outputType (or an older activity) may use a type not in the
                    list — keep it selectable so it isn't silently rewritten to Essay. */}
                {form.type && !ACTIVITY_TYPES.includes(form.type) && <option key={form.type}>{form.type}</option>}
              </select>
              <p className="text-xs text-slate-400 mt-1">The gradebook shows one column per type.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Total Points</label>
              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-navy focus-within:border-brand-navy bg-white">
                <button type="button" onClick={() => setForm(f => ({ ...f, points: Math.max(1, (f.points || 0) - 5) }))} className="px-3 py-2 bg-slate-50 text-slate-600 hover:bg-slate-200 font-bold border-r border-slate-200 transition-colors">-</button>
                <input type="number" min={1} value={form.points === 0 ? '' : form.points} onChange={e => {
                    const val = e.target.value;
                    setForm({ ...form, points: val === '' ? 0 : parseInt(val) || 0 });
                  }}
                  className="w-full px-4 py-2 text-center outline-none" />
                <button type="button" onClick={() => setForm(f => ({ ...f, points: (f.points || 0) + 5 }))} className="px-3 py-2 bg-slate-50 text-slate-600 hover:bg-slate-200 font-bold border-l border-slate-200 transition-colors">+</button>
              </div>
            </div>
          </div>

          {classLessons.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Curriculum Lesson / Topic</label>
              <select value={selectedLessonId} onChange={e => {
                const lessonId = e.target.value;
                setSelectedLessonId(lessonId);
                if (lessonId) {
                  const lesson = classLessons.find(l => l.id === lessonId);
                  if (lesson?.outputType) {
                    setForm(prev => ({ ...prev, type: lesson.outputType }));
                  }
                  // Auto-apply default rubric if lesson has one
                  if (lesson?.defaultRubric) {
                    try {
                      const parsed = typeof lesson.defaultRubric === 'string' ? JSON.parse(lesson.defaultRubric) : lesson.defaultRubric;
                      if (parsed.criteria?.length) {
                        setRubricCriteria(parsed.criteria);
                        setRubricMode('template');
                        setSelectedOption('lesson-rubric');
                      }
                    } catch {}
                  }
                }
              }}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                <option value="">— Select a lesson from curriculum —</option>
                {classLessons.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.weekNumber ? `Week ${l.weekNumber}: ` : ''}{l.title} ({l.outputType})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Selecting a lesson auto-applies its output type and default rubric.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">DepEd Topic *</label>
            <select required value={form.topic} onChange={e => {
                const topicId = e.target.value;
                setForm({ ...form, topic: topicId });
                if (topicId) {
                  const topicInfo = topics.find(t => t.id === topicId);
                  const recommended = topicInfo?.recommendedRubricId
                    ? builtinRubrics.find(t => t.id === topicInfo.recommendedRubricId)
                    : null;
                  if (recommended) {
                    setRubricCriteria(recommended.criteria);
                    setRubricType(recommended.type || 'standard');
                    setRubricMode('template');
                    setSelectedOption(`builtin:${recommended.id}`);
                  }
                }
              }}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
              <option value="">— Select a topic —</option>
              {[1, 2, 3].map(term => {
                const termTopics = topics.filter(t => t.term === term);
                return termTopics.length > 0 ? (
                  <optgroup key={term} label={`Term ${term}`}>
                    {termTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
            <p className="text-xs text-slate-400 mt-1">Selecting a topic suggests a matching rubric below — you can still change it.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Deadline {form.submissionMode === 'STUDENT_SUBMIT' && <span className="text-red-500">*</span>}
            </label>
            <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })}
              min={form.submissionMode === 'STUDENT_SUBMIT' ? new Date().toISOString().split('T')[0] : undefined}
              required={form.submissionMode === 'STUDENT_SUBMIT'}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
          </div>

          {form.submissionMode === 'STUDENT_SUBMIT' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Max Submission Attempts
              </label>
              {/* Keep the raw string while typing. Coercing with `|| 1` on every
                  keystroke made clearing the field snap back to 1, so the value
                  could only ever be changed with the arrows. Clamped on blur. */}
              <input type="number" min={1} max={10} value={form.maxAttempts}
                onChange={e => setForm({ ...form, maxAttempts: e.target.value })}
                onBlur={e => {
                  const n = parseInt(e.target.value, 10);
                  setForm(f => ({ ...f, maxAttempts: Number.isNaN(n) ? 1 : Math.min(10, Math.max(1, n)) }));
                }}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
              <p className="text-xs text-slate-400 mt-1">How many times a student can re-submit before the deadline (default: 1).</p>
            </div>
          )}

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
                  const defaultCriteria = savedRubrics && savedRubrics.length ? savedRubrics[0].criteria : builtinRubrics[0]?.criteria;
                  if (defaultCriteria) setRubricCriteria(defaultCriteria);
                  setSelectedOption(savedRubrics && savedRubrics.length ? `saved:${savedRubrics[0].id}` : (builtinRubrics[0] ? `builtin:${builtinRubrics[0].id}` : 'builtin:__pending'));

                  // Infer type if missing (for older saves)
                  let loadedType = 'standard';
                  if (savedRubrics && savedRubrics.length) {
                    if (savedRubrics[0].type) loadedType = savedRubrics[0].type;
                    else if (savedRubrics[0].criteria?.[0]?.bands?.length > 0) loadedType = 'range';
                  } else if (builtinRubrics[0]?.type) {
                    loadedType = builtinRubrics[0].type;
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
                📊 Standard (Percentage)
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
                    const id = val.slice(8);
                    const builtin = builtinRubrics.find(t => t.id === id);
                    if (builtin) {
                      setRubricCriteria(builtin.criteria);
                      setSelectedOption(val);
                      setRubricType(builtin.type || 'standard');
                    }
                  }
                }}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy mb-3">
                {builtinRubrics.map(t => <option key={t.id} value={`builtin:${t.id}`}>{t.name}</option>)}
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
                      <div className="flex flex-col items-center justify-center shrink-0 min-w-[60px]">
                        <span className="text-sm font-bold text-brand-navy">{c.points}%</span>
                        <span className="text-[11px] font-semibold text-slate-400">({((c.points / 100) * (form.points || 0)).toFixed(1).replace(/\.0$/, '')} pts)</span>
                      </div>
                    )}
                  </div>
                  {rubricType === 'range' && c.bands && c.bands.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 ml-8">
                      {c.bands.map((band, bi) => {
                        const color = getBandColor(band.label, bi, c.bands.length);
                        return (
                          <div key={bi} className={`rounded-lg border ${color.border} bg-white p-2`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>{band.label}</span>
                              <span className="text-xs font-bold text-brand-slate">{band.score} pts</span>
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
            {isSaving ? (isEditMode ? 'Updating...' : 'Publishing...') : (isEditMode ? 'Update Activity' : 'Publish Activity')}
          </button>
        </div>
      </form>
    </div>
  );
}
