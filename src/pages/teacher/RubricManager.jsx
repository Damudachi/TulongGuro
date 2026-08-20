import { useState, useEffect } from 'react';
import { ClipboardList, ChevronDown, ChevronRight, Edit2, Trash2, Plus, X, UploadCloud, Loader2, AlertTriangle, Percent, ListOrdered } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';

import { showAlert, showConfirm } from '../../utils/dialog';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Helper for dynamic band colors based on label
const getBandColor = (label, index, totalBands) => {
  if (!label) return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
  const normalizedLabel = label.toLowerCase();
  
  if (normalizedLabel.includes('outstanding') || normalizedLabel.includes('excellent')) {
    return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
  }
  if (normalizedLabel.includes('proficient') || normalizedLabel.includes('very good')) {
    return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' };
  }
  if (normalizedLabel.includes('good') || normalizedLabel.includes('developing') || normalizedLabel.includes('satisfactory')) {
    if (normalizedLabel.includes('satisfactory')) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' };
    }
    return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' };
  }
  if (normalizedLabel.includes('beginning') || normalizedLabel.includes('needs improvement') || normalizedLabel.includes('poor')) {
    return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
  }

  // Fallback by position
  if (totalBands > 1) {
    const ratio = index / (totalBands - 1);
    if (ratio <= 0.25) return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
    if (ratio <= 0.5) return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' };
    if (ratio <= 0.75) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' };
    return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
  }
  
  return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
};

const detectRubricType = (rubric) => {
  if (rubric.type) return rubric.type;
  if (!rubric.criteria || !rubric.criteria.length) return 'standard';
  return rubric.criteria.some(c => c.bands && c.bands.length > 0) ? 'range' : 'standard';
};

const DEFAULT_RANGE_BANDS = [
  { label: 'Excellent', score: 5, description: 'Exceeds expectations.' },
  { label: 'Very Good', score: 4, description: 'Meets expectations.' },
  { label: 'Good', score: 3, description: 'Meets most expectations.' },
  { label: 'Satisfactory', score: 2, description: 'Partially meets.' },
  { label: 'Needs Improvement', score: 1, description: 'Does not meet.' },
];

export default function RubricManager() {
  const [expandedId, setExpandedId] = useState(null);
  const [savedRubrics, setSavedRubrics] = useState([]);
  // School-wide and curriculum-derived rubrics. Kept apart from the teacher's
  // own because they are read-only here — they belong to the school, and
  // listing them as "Your Saved Rubrics" invited a teacher to edit a rubric
  // every other class in the school is graded against.
  const [schoolRubrics, setSchoolRubrics] = useState([]);
  const [prebuiltRubrics, setPrebuiltRubrics] = useState([]);
  // Never changes for the life of the page — read on the first render instead
  // of being set from an effect after one render without it.
  const teacherId = getStoredUser().id || null;

  // Edit State
  const [editingRubric, setEditingRubric] = useState(null);
  // Which shape a brand-new rubric will have, asked before the editor opens.
  // The two are marked in genuinely different units — percentage weights versus
  // banded points — and the editor renders differently for each, so it is a
  // choice rather than something to infer from an empty rubric.
  const [newRubricType, setNewRubricType] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    apiFetch(`${API_URL}/api/rubric-templates/builtin`)
      .then(res => res.json())
      .then(data => { if (data.success && data.templates) setPrebuiltRubrics(data.templates); })
      .catch(() => {});
  }, []);

  const fetchSavedRubrics = async (tId) => {
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/rubric-templates/${tId}`);
      if (res.ok) {
        const data = await res.json();
        const templates = data.templates || data || [];
        const parsed = (Array.isArray(templates) ? templates : []).map(r => ({
          ...r,
          criteria: typeof r.criteria === 'string' ? JSON.parse(r.criteria) : r.criteria
        })).filter(r => r.criteria && Array.isArray(r.criteria));
        setSavedRubrics(parsed.filter(r => !r.isSchoolWide));
        setSchoolRubrics(parsed.filter(r => r.isSchoolWide));
      }
    } catch (e) {
      console.error('Failed to fetch rubrics:', e);
      setSavedRubrics([]);
      setSchoolRubrics([]);
    }
  };

  // Declared after fetchSavedRubrics on purpose. It sat above the function and
  // called it — a temporal-dead-zone reference that only works because effects
  // run after render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async read; nothing is set before the first await
    if (teacherId) fetchSavedRubrics(teacherId);
  }, [teacherId]);

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  const isAlreadySaved = (name) => savedRubrics.some(r => r.name === name);

  const deleteRubric = async (id) => {
    if (!id) return;
    if (!(await showConfirm('Delete this custom rubric? Activities already built from it keep the copy they were given.',
      { confirmLabel: 'Delete rubric', danger: true }))) return;
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/rubric-templates/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) fetchSavedRubrics(teacherId);
      else showAlert(data.error || 'Could not delete this rubric.');
    } catch {
      showAlert('Network error while deleting the rubric.');
    }
  };

  /**
   * ── Making a rubric of your own ──
   *
   * This screen could only ever show rubrics and copy one. Everything that
   * actually *creates* a teacher rubric lived inside the activity builder, so a
   * teacher who wanted one had to start an activity they might not want in
   * order to write it, and the page called "Grading Rubrics" — the obvious
   * place to go — had no way to make one. Both routes it needs already existed
   * on the server; only the buttons were missing.
   *
   * Two ways in, because teachers arrive with two different things in hand:
   * a blank sheet, or the rubric their department already wrote in a Word or
   * PDF file.
   */

  /** A blank rubric of the chosen shape, opened straight into the editor. */
  const startCreating = (type) => {
    setNewRubricType(null);
    setEditingRubric({
      // No id and no _id: saveEditedRubric reads isNew to know this is a
      // create rather than an edit of something that already exists.
      isNew: true,
      type,
      name: '',
      description: '',
      gradeRange: '',
      criteria: [{
        name: '', points: type === 'standard' ? 100 : 5, description: '',
        ...(type === 'range' ? { bands: JSON.parse(JSON.stringify(DEFAULT_RANGE_BANDS)) } : {}),
      }],
    });
  };

  /**
   * Read a rubric out of an uploaded document and open it in the editor.
   *
   * Deliberately lands in the editor rather than saving straight off. What
   * comes back is an extraction, not a transcription — criterion weights get
   * rescaled, band descriptions get condensed — and a rubric is what every
   * paper in the class is then marked against. It is reviewed before it is
   * kept, the same way the activity builder shows the extracted criteria
   * before the activity is published.
   */
  const handleRubricUpload = async (e) => {
    const file = e.target.files?.[0];
    // Cleared immediately so picking the same file twice still fires a change
    // event — otherwise a failed extraction cannot be retried without choosing
    // a different file first.
    e.target.value = '';
    if (!file) return;

    setUploadError('');
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('rubricFile', file);
      // No activityPoints: this rubric is not being written for one activity,
      // so there is no total to divide the criteria into. The server falls back
      // to percentage weights, which is the right shape for a reusable template.
      const res = await apiFetch(`${API_URL}/api/teacher/rubric/extract`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success || !Array.isArray(data.criteria) || data.criteria.length === 0) {
        setUploadError(data?.error
          || 'No criteria could be read from that file. A rubric table in Word, PDF or an image works best.');
        return;
      }

      setEditingRubric({
        isNew: true,
        type: data.rubricType || (data.criteria.some(c => c.bands?.length) ? 'range' : 'standard'),
        // The filename with its extension dropped: it is almost always what the
        // teacher calls this rubric, and it is editable in the very next field.
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 80),
        description: '',
        gradeRange: '',
        criteria: data.criteria,
      });
    } catch {
      setUploadError('Network error while reading that file. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const startEditing = (rubric) => {
    setEditingRubric(JSON.parse(JSON.stringify(rubric))); // Deep copy
  };

  const saveEditedRubric = async () => {
    if(!editingRubric || !teacherId) return;
    const editType = detectRubricType(editingRubric);
    if (editType === 'standard') {
      const totalWeight = editingRubric.criteria.reduce((sum, c) => sum + (parseInt(c.points) || 0), 0);
      if(totalWeight !== 100) {
        showAlert(`Standard rubric weight must total 100%. Currently it is ${totalWeight}%.`);
        return;
      }
    }

    if (!editingRubric.name?.trim()) {
      showAlert('Give this rubric a name so you can find it in the picker later.');
      return;
    }
    if (editingRubric.criteria.some(c => !c.name?.trim())) {
      showAlert('Every criterion needs a name — an unnamed one tells neither the AI nor the student what was marked.');
      return;
    }

    // Built-ins and the school's own rubrics aren't the teacher's to change, so
    // editing one saves a private copy instead of rewriting the original. A
    // rubric created or uploaded here is new outright and keeps the name it was
    // given — there is no original for it to be a copy of.
    const isBorrowed = !editingRubric.isNew && (
      prebuiltRubrics.some(r => r.id === editingRubric.id)
      || schoolRubrics.some(r => r.id === editingRubric.id)
    );

    try {
      if (isBorrowed || editingRubric.isNew) {
        // Create new
        const res = await apiFetch(`${API_URL}/api/teacher/rubric-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teacherId,
            name: editingRubric.isNew ? editingRubric.name.trim() : `${editingRubric.name} (Customized)`,
            description: editingRubric.description,
            gradeRange: editingRubric.gradeRange,
            criteria: editingRubric.criteria,
            isPublic: false
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success !== false) {
          setEditingRubric(null);
          fetchSavedRubrics(teacherId);
        } else {
          // The duplicate-name refusal names the rubric already using it, which
          // is the whole point of that guard — swallowing it left the teacher
          // pressing Save on a form that silently did nothing.
          showAlert(data.error || 'Could not save this rubric.');
        }
      } else {
        // Update existing
        const res = await apiFetch(`${API_URL}/api/teacher/rubric-templates/${editingRubric._id || editingRubric.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...editingRubric, teacherId })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setEditingRubric(null);
          fetchSavedRubrics(teacherId);
        } else {
          showAlert(data.error || 'Could not save this rubric.');
        }
      }
    } catch (e) {
      console.error(e);
      showAlert('Failed to save rubric');
    }
  };

  /** variant: 'mine' (editable) | 'school' (read-only, copy to edit) | 'builtin' */
  const renderRubricCard = (rubric, variant) => {
    if (!rubric || !rubric.criteria) return null;
    const rubricId = rubric._id || rubric.id;
    const isCustom = variant === 'mine';
    const isOpen = expandedId === rubricId;
    const saved = isCustom ? false : isAlreadySaved(rubric.name);
    const totalPoints = rubric.criteria.reduce((sum, c) => sum + (parseInt(c.points)||0), 0);
    const type = detectRubricType(rubric);

    return (
      <div key={rubric._id || rubric.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
        <button onClick={() => toggleExpand(rubric._id || rubric.id)}
          className="w-full p-5 flex items-start justify-between text-left hover:bg-slate-50 transition-colors">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-brand-slate">{rubric.name}</h3>
              {type === 'standard' 
                ? <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-700 rounded-full">STANDARD</span>
                : <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">RANGE</span>
              }
              {saved && <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">SAVED</span>}
              {variant === 'school' && (
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
                  {rubric.curriculumId ? 'FROM CURRICULUM' : 'SCHOOL-WIDE'}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">{rubric.description}</p>
            <div className="flex gap-3 mt-2">
              <span className="text-xs font-medium text-slate-400">{rubric.gradeRange || 'All Grades'}</span>
              <span className="text-xs font-medium text-slate-400">•</span>
              <span className="text-xs font-medium text-slate-400">{rubric.criteria.length} criteria</span>
              <span className="text-xs font-medium text-slate-400">•</span>
              <span className="text-xs font-medium text-slate-400">{totalPoints} total {type === 'standard' ? '%' : 'pts'}</span>
            </div>
          </div>
          {isOpen ? <ChevronDown className="w-5 h-5 text-slate-400 mt-1 shrink-0" />
                   : <ChevronRight className="w-5 h-5 text-slate-400 mt-1 shrink-0" />}
        </button>

        {isOpen && (
          <div className="border-t border-slate-100 px-5 pb-5 pt-4">
            <div className="space-y-3 mb-5">
              {rubric.criteria.map((c, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-brand-navy/10 text-brand-navy flex items-center justify-center font-extrabold text-sm shrink-0">
                      {type === 'standard' ? `${c.points}%` : c.points}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-brand-slate text-sm">{c.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>
                    </div>
                  </div>
                  {/* Scoring Bands */}
                  {type === 'range' && c.bands && c.bands.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 ml-0 sm:ml-20">
                      {c.bands.map((band, bi) => {
                        const color = getBandColor(band.label, bi, c.bands.length);
                        return (
                          <div key={bi} className={`rounded-lg border ${color.border} bg-white p-2.5`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-brand-slate">{band.score || band.range} pts</span>
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
            <div className="flex gap-3 items-center">
              <button onClick={() => startEditing(rubric)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors flex items-center gap-2">
                <Edit2 className="w-4 h-4" /> {isCustom ? 'Edit Rubric' : 'Copy & Edit'}
              </button>
              {isCustom && (
                /* rubric.id, not rubric._id — these rows come from Postgres and
                   have never had a Mongo-style _id, so every delete request was
                   going to .../rubric-templates/undefined. */
                <button onClick={() => deleteRubric(rubricId)}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
              {variant === 'school' && (
                <span className="text-xs text-slate-400">Published by your school — editing saves your own copy.</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="mb-8 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-navy" /> Grading Rubrics
          </h1>
          <p className="text-slate-500 text-sm mt-1">Write, upload and manage the rubrics your activities are graded against</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* A label wrapping a hidden input: a <button> cannot open a file
              picker without reaching for a ref, and the label already is the
              control the browser wants here. */}
          <label className={cn('border border-slate-200 bg-white text-brand-slate px-4 py-2.5 rounded-lg text-sm font-bold hover:border-brand-navy flex items-center gap-2',
            isUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer')}>
            {isUploading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading file…</>
              : <><UploadCloud className="w-4 h-4" /> Upload Rubric</>}
            <input type="file" className="hidden" disabled={isUploading}
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
              onChange={handleRubricUpload} />
          </label>
          <button onClick={() => { setNewRubricType('choose'); setUploadError(''); }}
            className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2">
            <Plus className="w-4 h-4" /> Create Rubric
          </button>
        </div>
      </div>

      {uploadError && (
        <div role="alert" className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-800">Could not read that rubric</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{uploadError}</p>
          </div>
          <button onClick={() => setUploadError('')} className="text-amber-500 hover:text-amber-700 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Ordered by authority: what the school published, then the teacher's
          own, then generic samples. */}
      {schoolRubrics.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Your School's Rubrics</h2>
          <p className="text-xs text-slate-400 mb-3">Published by your admin or generated from an uploaded curriculum. These are applied to your activities first.</p>
          <div className="space-y-4">
            {schoolRubrics.map(r => renderRubricCard(r, 'school'))}
          </div>
        </div>
      )}

      {savedRubrics.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Your Saved Rubrics</h2>
          <div className="space-y-4">
            {savedRubrics.map(r => renderRubricCard(r, 'mine'))}
          </div>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Generic DepEd Samples</h2>
        <p className="text-xs text-slate-400 mb-3">Grade 6 English starting points, used only when nothing above applies.</p>
        <div className="space-y-4">
          {prebuiltRubrics.map(r => renderRubricCard(r, 'builtin'))}
        </div>
      </div>

      {/* ── Which shape, before the blank editor opens ──
          Standard and Range are not two skins of one thing: one splits 100% of
          the mark between criteria, the other scores each criterion on its own
          band ladder, and the editor and the grader both branch on it. Asking
          once here is cheaper than a teacher filling in five criteria and then
          finding the columns are the wrong units. */}
      {newRubricType === 'choose' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Create a rubric</h2>
            <p className="text-slate-500 text-sm mb-5">How is this one marked?</p>

            <button onClick={() => startCreating('standard')}
              className="w-full text-left border-2 border-slate-200 rounded-xl p-4 mb-3 hover:border-brand-navy hover:bg-slate-50 transition-colors flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-green-100 text-green-700 grid place-items-center shrink-0">
                <Percent className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-brand-slate">Standard — percentage weights</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Each criterion takes a share of the mark, and the shares add up to 100%.
                  Content 40%, Organisation 30%, Grammar 30%.
                </span>
              </span>
            </button>

            <button onClick={() => startCreating('range')}
              className="w-full text-left border-2 border-slate-200 rounded-xl p-4 hover:border-brand-navy hover:bg-slate-50 transition-colors flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 grid place-items-center shrink-0">
                <ListOrdered className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-brand-slate">Range — scoring bands</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Each criterion is scored on its own ladder, with a description per level.
                  Excellent 5, Very Good 4, Good 3, and so on.
                </span>
              </span>
            </button>

            <button onClick={() => setNewRubricType(null)}
              className="mt-4 w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Full-Screen Edit Modal */}
      {editingRubric && (() => {
        const type = detectRubricType(editingRubric);
        return (
          <div className="fixed inset-0 bg-slate-100 z-50 overflow-y-auto">
            <div className="max-w-4xl mx-auto bg-white min-h-screen shadow-2xl relative flex flex-col">
              <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex items-center justify-between z-10">
                <h2 className="font-bold text-lg text-brand-slate flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-brand-navy" />
                  {editingRubric.isNew ? 'New Rubric' : 'Edit Rubric'}
                  {editingRubric.isNew && (
                    <span className="text-xs font-normal text-slate-500">
                      ({type === 'standard' ? 'percentage weights' : 'scoring bands'})
                    </span>
                  )}
                  {!editingRubric.isNew
                    && (prebuiltRubrics.some(r => r.id === editingRubric.id) || schoolRubrics.some(r => r.id === editingRubric.id))
                    && <span className="text-xs font-normal text-slate-500">(Will save as your own copy)</span>}
                </h2>
                <button onClick={() => setEditingRubric(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 flex-1">
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rubric Name</label>
                  <input type="text" value={editingRubric.name} autoFocus={!!editingRubric.isNew}
                    onChange={e => setEditingRubric({...editingRubric, name: e.target.value})}
                    placeholder="e.g. Narrative Essay Rubric"
                    className="w-full border border-slate-200 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy" />
                  <p className="text-xs text-slate-400 mt-1">This is the name you'll pick from when building an activity.</p>
                </div>

                <div className="space-y-3 mb-6">
                  <label className="block text-sm font-medium text-slate-700">Criteria</label>
                  {editingRubric.criteria.map((c, i) => (
                    <div key={i} className="p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-2">
                          <input type="text" value={c.name} onChange={e => {
                              const newC = [...editingRubric.criteria];
                              newC[i].name = e.target.value;
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="w-full p-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy font-bold" placeholder="Criterion name" />
                          <textarea value={c.description || ''} onChange={e => {
                              const newC = [...editingRubric.criteria];
                              newC[i].description = e.target.value;
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="w-full p-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy text-slate-600 min-h-[60px]" placeholder="Description..." />
                        </div>
                        <div className="flex flex-col gap-2 w-24">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-xs font-bold text-slate-500 uppercase">{type === 'standard' ? 'Percent %' : 'Points'}</span>
                            <input type="number" value={c.points === 0 ? '' : c.points} onChange={e => {
                                const newC = [...editingRubric.criteria];
                                newC[i].points = e.target.value === '' ? 0 : parseInt(e.target.value) || 0;
                                setEditingRubric({...editingRubric, criteria: newC});
                              }}
                              className="w-full text-center font-bold text-lg p-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-navy" />
                          </div>
                          <button onClick={() => {
                              const newC = editingRubric.criteria.filter((_, idx) => idx !== i);
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="text-red-500 hover:text-red-700 text-xs font-medium text-center p-1">
                            Remove
                          </button>
                        </div>
                      </div>

                      {type === 'range' && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-2 mt-2">
                          <p className="text-xs font-bold text-purple-700">Scoring Bands</p>
                          {c.bands?.map((b, bi) => (
                            <div key={bi} className="flex gap-2">
                              <input type="text" value={b.label} onChange={e => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands[bi].label = e.target.value;
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="w-1/4 p-1.5 text-xs border border-slate-200 rounded font-bold" placeholder="Label (e.g. Excellent)" />
                              <input type="number" value={b.score || ''} onChange={e => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands[bi].score = parseInt(e.target.value) || 0;
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="w-16 p-1.5 text-xs border border-slate-200 rounded text-center" placeholder="Pts" />
                              <input type="text" value={b.description || ''} onChange={e => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands[bi].description = e.target.value;
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="flex-1 min-w-0 p-1.5 text-xs border border-slate-200 rounded" placeholder="Band description..." />
                              <button onClick={() => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands = newC[i].bands.filter((_, bidx) => bidx !== bi);
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="text-slate-400 hover:text-red-500 p-1.5">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          <button onClick={() => {
                              const newC = [...editingRubric.criteria];
                              if (!newC[i].bands) newC[i].bands = [];
                              newC[i].bands.push({ label: 'New Band', score: 0, description: '' });
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Add Band
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <button onClick={() => {
                      setEditingRubric({
                        ...editingRubric,
                        criteria: [...editingRubric.criteria, {
                          name: '', points: 0, description: '',
                          ...(type === 'range' ? { bands: JSON.parse(JSON.stringify(DEFAULT_RANGE_BANDS)) } : {})
                        }]
                      })
                    }}
                    className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 font-medium hover:bg-slate-50 hover:border-brand-navy hover:text-brand-navy transition-colors flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Add Criterion
                  </button>
                </div>
              </div>

              <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 flex items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="text-sm font-medium">
                  {type === 'standard' && (
                    <span className={editingRubric.criteria.reduce((s, c) => s + (parseInt(c.points)||0), 0) === 100 ? "text-green-600" : "text-amber-600"}>
                      Total Weight: {editingRubric.criteria.reduce((s, c) => s + (parseInt(c.points)||0), 0)}% (Must be 100%)
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setEditingRubric(null)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">
                    Cancel
                  </button>
                  <button onClick={saveEditedRubric} className="px-6 py-2.5 bg-brand-navy text-white font-bold rounded-lg hover:bg-blue-900 shadow-md">
                    Save Rubric
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
