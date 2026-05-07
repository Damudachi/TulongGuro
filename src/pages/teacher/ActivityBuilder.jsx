import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Camera, Users, Sparkles, Upload, FileText, X, Loader2, Trash2 } from 'lucide-react';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const RUBRIC_TEMPLATES = [
  { name: 'Standard Essay (DepEd)', criteria: [{ name: 'Content & Ideas', description: 'Depth and relevance of ideas', points: 40 }, { name: 'Organization', description: 'Logical flow and structure', points: 30 }, { name: 'Language & Grammar', description: 'Grammar, vocabulary, spelling', points: 30 }] },
  { name: 'Creative Writing', criteria: [{ name: 'Creativity & Originality', description: 'Unique and imaginative content', points: 30 }, { name: 'Literary Devices', description: 'Use of figurative language', points: 25 }, { name: 'Story Structure', description: 'Beginning, middle, end flow', points: 25 }, { name: 'Grammar & Mechanics', description: 'Correct usage and spelling', points: 20 }] },
];

export default function ActivityBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const fileInputRef = useRef(null);
  const rubricFileRef = useRef(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [rubricMode, setRubricMode] = useState('template'); // 'template' | 'manual' | 'upload' | 'ai'
  const [rubricCriteria, setRubricCriteria] = useState(RUBRIC_TEMPLATES[0].criteria);
  const [additionalFiles, setAdditionalFiles] = useState([]); // { file, name }[]
  const [rubricFile, setRubricFile] = useState(null);

  const [form, setForm] = useState({
    title: '',
    type: 'Essay',
    points: 100,
    deadline: '',
    instructions: '',
    submissionMode: 'TEACHER_UPLOAD',
  });

  // ── Rubric helpers ──
  const updateCriterion = (idx, field, val) => {
    setRubricCriteria(prev => prev.map((c, i) => i === idx ? { ...c, [field]: field === 'points' ? parseInt(val) || 0 : val } : c));
  };
  const addCriterion = () => setRubricCriteria(prev => [...prev, { name: '', description: '', points: 0 }]);
  const removeCriterion = (idx) => setRubricCriteria(prev => prev.filter((_, i) => i !== idx));
  const totalPoints = rubricCriteria.reduce((s, c) => s + (c.points || 0), 0);

  const handleGenerateRubric = async () => {
    setIsGeneratingRubric(true);
    try {
      const res = await fetch('http://localhost:3000/api/teacher/generate-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: form.instructions, activityType: form.type, points: form.points })
      });
      const data = await res.json();
      if (data.success) setRubricCriteria(data.criteria);
    } catch { alert('Failed to generate rubric'); }
    finally { setIsGeneratingRubric(false); }
  };

  // ── Additional files ──
  const handleAdditionalFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    setAdditionalFiles(prev => [...prev, ...picked.map(f => ({ file: f, name: f.name }))]);
  };
  const removeAdditionalFile = (idx) => setAdditionalFiles(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (totalPoints !== form.points && rubricMode !== 'upload') {
      if (!window.confirm(`Rubric total (${totalPoints} pts) doesn't match activity points (${form.points} pts). Continue?`)) return;
    }
    setIsSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('classId', classId || 'mock-class-id');
      fd.append('rubric', JSON.stringify({ source: rubricMode, criteria: rubricCriteria }));
      additionalFiles.forEach(f => fd.append('additionalFiles', f.file));
      if (rubricFile && rubricMode === 'upload') fd.append('additionalFiles', rubricFile);

      const res = await fetch('http://localhost:3000/api/teacher/activities', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) navigate(-1);
      else alert('Error: ' + data.error);
    } catch { alert('Network error'); }
    finally { setIsSaving(false); }
  };

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            {[['template', '📋 Template'], ['manual', '✏️ Create'], ['upload', '📁 Upload'], ['ai', '✨ AI Generate']].map(([val, label]) => (
              <button key={val} type="button" onClick={() => {
                setRubricMode(val);
                if (val === 'template') setRubricCriteria(RUBRIC_TEMPLATES[0].criteria);
              }}
                className={cn('py-2 px-3 text-xs font-bold rounded-lg border-2 transition-all',
                  rubricMode === val ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 text-slate-600 hover:border-brand-navy/50')}>
                {label}
              </button>
            ))}
          </div>

          {/* Template */}
          {rubricMode === 'template' && (
            <div className="space-y-3">
              <select onChange={e => setRubricCriteria(RUBRIC_TEMPLATES[parseInt(e.target.value)].criteria)}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy mb-3">
                {RUBRIC_TEMPLATES.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
              </select>
              {rubricCriteria.map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <CheckCircle2 className="w-5 h-5 text-brand-green shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-brand-slate">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.description}</p>
                  </div>
                  <span className="text-sm font-bold text-brand-navy shrink-0">{c.points} pts</span>
                </div>
              ))}
            </div>
          )}

          {/* Manual */}
          {rubricMode === 'manual' && (
            <div className="space-y-3">
              {rubricCriteria.map((c, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <div className="flex gap-2 items-start">
                    <input type="text" value={c.name} onChange={e => updateCriterion(i, 'name', e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Criterion name" />
                    <input type="number" value={c.points} onChange={e => updateCriterion(i, 'points', e.target.value)}
                      className="w-20 px-3 py-1.5 border border-slate-200 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="pts" />
                    <button type="button" onClick={() => removeCriterion(i)} className="text-slate-400 hover:text-red-500 mt-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <input type="text" value={c.description} onChange={e => updateCriterion(i, 'description', e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Description (optional)" />
                </div>
              ))}
              <button type="button" onClick={addCriterion}
                className="text-sm text-brand-navy font-medium flex items-center hover:underline">
                <Plus className="w-4 h-4 mr-1" /> Add Criterion
              </button>
              <div className={cn('text-sm font-bold mt-2 px-3 py-2 rounded-lg', totalPoints === form.points ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50')}>
                Total: {totalPoints}/{form.points} pts {totalPoints !== form.points && `(${form.points - totalPoints > 0 ? '+' : ''}${form.points - totalPoints} remaining)`}
              </div>
            </div>
          )}

          {/* Upload */}
          {rubricMode === 'upload' && (
            <div>
              <div onClick={() => rubricFileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center cursor-pointer hover:border-brand-navy hover:bg-blue-50/30 transition-all">
                <Upload className="w-8 h-8 text-slate-400 mb-2" />
                <p className="font-medium text-slate-600 text-sm">Upload Rubric File</p>
                <p className="text-xs text-slate-400">PDF, image, or Word document</p>
              </div>
              <input ref={rubricFileRef} type="file" accept="image/*,.pdf,.doc,.docx" className="hidden"
                onChange={e => setRubricFile(e.target.files?.[0] || null)} />
              {rubricFile && (
                <div className="mt-3 flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-brand-green" />
                  <span className="text-sm font-medium text-green-700">{rubricFile.name}</span>
                </div>
              )}
            </div>
          )}

          {/* AI Generate */}
          {rubricMode === 'ai' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-brand-navy">
                <p className="font-bold mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4" /> AI Rubric Generator</p>
                <p className="text-xs text-blue-700">Gemini will create a rubric based on your activity instructions and type. Make sure the Instructions field above is filled in for best results.</p>
              </div>

              {rubricCriteria.length > 0 && (
                <div className="space-y-2">
                  {rubricCriteria.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <Sparkles className="w-4 h-4 text-brand-navy shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-bold text-brand-slate">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.description}</p>
                      </div>
                      <span className="text-sm font-bold text-brand-navy shrink-0">{c.points} pts</span>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" onClick={handleGenerateRubric} disabled={isGeneratingRubric}
                className="w-full py-3 bg-brand-navy text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-900 transition-colors disabled:opacity-60">
                {isGeneratingRubric ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate with AI</>}
              </button>
            </div>
          )}
        </div>

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
