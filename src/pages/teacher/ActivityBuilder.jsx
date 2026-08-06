import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Camera, Users, Upload, FileText, X, Trash2, Loader2, Save, PenLine } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
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

/** Criteria out of a rubric that may be a JSON string, an object, or already an array. */
function readCriteria(source) {
  if (!source) return null;
  try {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source;
    const criteria = Array.isArray(parsed) ? parsed : parsed?.criteria;
    return criteria?.length ? criteria : null;
  } catch { return null; }
}

/** Rubrics saved before `type` existed are told apart by whether they carry bands. */
function rubricTypeOf(rubric, criteria) {
  if (rubric?.type) return rubric.type;
  return criteria?.[0]?.bands?.length > 0 ? 'range' : 'standard';
}

/**
 * A range-rubric band's point value, as a number.
 *
 * Rubrics extracted from an uploaded image/PDF store this correctly as a plain
 * number (`score: 30`, with the human-readable "27-30" kept separately in
 * `range`). Rubrics generated from an uploaded curriculum document used to
 * store the range text itself in `score` (e.g. `"36-40"`) — `Number()` on that
 * is `NaN`, which `?? 0`/`|| 0` then silently turned into a real 0. That
 * doesn't just misdisplay a number: every criterion normalizes to 0 points, the
 * rubric's total reads as 0, and activity creation is refused with "the rubric
 * criteria add up to zero" for a curriculum rubric that was never actually
 * empty. The backend prompt that generates these was fixed to stop doing this
 * on new uploads, but rubrics already saved with the old shape still need to
 * resolve to a real number here.
 */
function bandScoreNumber(score) {
  const direct = Number(score);
  if (!Number.isNaN(direct)) return direct;
  // Falls back to the last number in the string — a range's upper bound, so
  // "36-40" resolves to 40, matching what "the top of this band" means.
  const matches = String(score ?? '').match(/\d+(\.\d+)?/g);
  return matches?.length ? Number(matches[matches.length - 1]) : 0;
}

/**
 * A range rubric's real per-criterion point value comes from its bands, not
 * the (often hidden, sometimes stale) top-level `points` field — this is what
 * actually gets saved and is what validation must check. A no-op for standard
 * rubrics, which are weighted directly.
 */
function normalizeRangeCriteria(criteria, rubricType, defaultBands) {
  if (rubricType !== 'range') return criteria;
  return criteria.map(c => {
    const bands = c.bands?.length ? c.bands : defaultBands;
    const top = Math.max(...bands.map(b => bandScoreNumber(b.score)), 0);
    return { ...c, bands, points: top };
  });
}

/**
 * Which rubric a new activity should start from, most specific source first.
 *
 * The curriculum outranks the built-ins deliberately. A rubric that came from
 * the school's own curriculum was written for this grade level, this subject
 * and this kind of output; the built-ins in rubricTemplates.js are Grade 6
 * English samples and are only ever a last resort. Before this ordering
 * existed, whichever fetch resolved first won — and the built-in list is served
 * from memory while the school's rubrics come from Postgres, so the Grade 6
 * English default beat the curriculum on essentially every activity.
 *
 * Returns null when nothing at all has loaded yet, so the caller leaves the
 * form untouched rather than blanking it.
 */
function resolveDefaultRubric({ lesson, schoolRubrics, myRubrics, builtins, topicInfo, outputType }) {
  const pick = (rubric, option, criteria) =>
    ({ option, criteria, type: rubricTypeOf(rubric, criteria) });

  // 1) The curriculum lesson this activity is mapped to.
  const lessonCriteria = readCriteria(lesson?.defaultRubric);
  if (lessonCriteria) {
    const parsed = typeof lesson.defaultRubric === 'string' ? JSON.parse(lesson.defaultRubric) : lesson.defaultRubric;
    return pick(parsed, 'lesson-rubric', lessonCriteria);
  }

  // 2) A school rubric published for this kind of output. Curriculum uploads
  //    save their rubrics tagged by outputType, so this is how an "Essay"
  //    activity finds the curriculum's essay rubric without a lesson mapping.
  const byOutput = outputType && schoolRubrics.find(r => r.outputType === outputType);
  if (byOutput?.criteria?.length) return pick(byOutput, `saved:${byOutput.id}`, byOutput.criteria);

  // 3) Any other school rubric. The API already narrowed these to this class's
  //    grade level and subject, so anything left here applies.
  const school = schoolRubrics.find(r => r.criteria?.length);
  if (school) return pick(school, `saved:${school.id}`, school.criteria);

  // 4) The teacher's own most recent template.
  const mine = myRubrics.find(r => r.criteria?.length);
  if (mine) return pick(mine, `saved:${mine.id}`, mine.criteria);

  // 5) The built-in the DepEd topic recommends.
  const recommended = topicInfo?.recommendedRubricId
    ? builtins.find(b => b.id === topicInfo.recommendedRubricId)
    : null;
  if (recommended?.criteria?.length) return pick(recommended, `builtin:${recommended.id}`, recommended.criteria);

  // 6) Failing everything else, the first built-in.
  if (builtins[0]?.criteria?.length) return pick(builtins[0], `builtin:${builtins[0].id}`, builtins[0].criteria);

  return null;
}

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
  // Declared before the rubric resolver below, which reads form.type and form.topic.
  const [form, setForm] = useState({
    title: '',
    type: 'Essay',
    topic: '',
    points: 100,
    deadline: '',
    instructions: '',
    lateUntil: '',
    submissionMode: 'TEACHER_UPLOAD',
    maxAttempts: 1,
    component: 'WW',
  });
  const [rubricMode, setRubricMode] = useState('template'); // 'template' | 'manual' | 'upload'
  const [rubricType, setRubricType] = useState('standard'); // 'standard' | 'range'
  const [savedRubrics, setSavedRubrics] = useState([]);     // the teacher's own templates
  const [schoolRubrics, setSchoolRubrics] = useState([]);   // published by the admin / curriculum
  const [builtinRubrics, setBuiltinRubrics] = useState([]);
  const [classMeta, setClassMeta] = useState(null);         // { gradeLevel, subject }

  // The class's grade level and subject, used to narrow which school rubrics
  // apply. Without it a Grade 3 Math teacher was offered Grade 6 English rubrics.
  useEffect(() => {
    if (!classId) return;
    apiFetch(`${API_URL}/api/classes/${classId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.classData) {
          setClassMeta({ gradeLevel: data.classData.gradeLevel || '', subject: data.classData.subject || '' });
        } else setClassMeta({ gradeLevel: '', subject: '' });
      })
      .catch(() => setClassMeta({ gradeLevel: '', subject: '' }));
  }, [classId]);

  useEffect(() => {
    // Wait for the class before asking, so the request can be scoped to it.
    // Rubrics tagged for "any" grade/subject come through either way.
    if (classId && !classMeta) return;
    const fetchTemplates = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (!user.id) return;
        const qs = new URLSearchParams();
        if (classMeta?.gradeLevel) qs.set('gradeLevel', classMeta.gradeLevel);
        if (classMeta?.subject) qs.set('subject', classMeta.subject);
        const res = await apiFetch(`${API_URL}/api/teacher/rubric-templates/${user.id}?${qs.toString()}`);
        const data = await res.json();
        if (data.success && data.templates) {
          const parsedTemplates = data.templates.map(t => ({
            ...t,
            criteria: typeof t.criteria === 'string' ? JSON.parse(t.criteria) : t.criteria
          }));
          // Split them: a school rubric is the school's policy, a saved one is
          // this teacher's own note to self. Showing both under "Your Saved
          // Rubrics" made a curriculum rubric look like something they wrote.
          setSchoolRubrics(parsedTemplates.filter(t => t.isSchoolWide));
          setSavedRubrics(parsedTemplates.filter(t => !t.isSchoolWide));
        }
      } catch (err) {
        console.error('Failed to load cloud templates:', err);
      }
    };
    fetchTemplates();
  }, [classId, classMeta]);

  // ── Fetch built-in curriculum-aligned rubric templates ──
  useEffect(() => {
    apiFetch(`${API_URL}/api/rubric-templates/builtin`)
      .then(res => res.json())
      .then(data => { if (data.success && data.templates) setBuiltinRubrics(data.templates); })
      .catch(() => {});
  }, []);

  const [rubricCriteria, setRubricCriteria] = useState([{ name: '', description: '', points: 100 }]);
  const [selectedOption, setSelectedOption] = useState('');
  // Set as soon as the teacher makes a rubric decision of their own. Until then
  // the resolver below is free to keep improving the default as slower sources
  // (the school's rubrics, the class lessons) arrive.
  const [rubricTouched, setRubricTouched] = useState(false);
  // The picker starts folded; the summary card above it says what is in force.
  // Opened automatically below if nothing could be resolved.
  const [showRubricEditor, setShowRubricEditor] = useState(false);

  const selectedLesson = classLessons.find(l => l.id === selectedLessonId) || null;
  const selectedTopic = topics.find(t => t.id === form.topic) || null;

  // Apply the best available default, re-running whenever a new source loads or
  // the teacher maps the activity to a lesson or topic. Stops the moment the
  // teacher chooses a rubric themselves.
  useEffect(() => {
    if (rubricTouched || isEditMode || rubricMode !== 'template') return;
    const applied = resolveDefaultRubric({
      lesson: selectedLesson,
      schoolRubrics,
      myRubrics: savedRubrics,
      builtins: builtinRubrics,
      topicInfo: selectedTopic,
      outputType: form.type,
    });
    if (!applied) return;
    setRubricCriteria(applied.criteria);
    setRubricType(applied.type);
    setSelectedOption(applied.option);
  }, [rubricTouched, isEditMode, rubricMode, selectedLesson, schoolRubrics, savedRubrics, builtinRubrics, selectedTopic, form.type]);

  // Nothing could be resolved — no school rubrics, no curriculum, and the
  // built-ins failed to load. Open the picker rather than leave the teacher
  // looking at "No rubric selected" with no obvious next step.
  useEffect(() => {
    if (!rubricTouched && !isEditMode && rubricMode === 'template' && !selectedOption && builtinRubrics.length === 0) {
      setShowRubricEditor(true);
    }
  }, [rubricTouched, isEditMode, rubricMode, selectedOption, builtinRubrics]);

  /** Load a rubric the teacher picked from the dropdown. */
  const applyOption = (val) => {
    const all = val.startsWith('saved:')
      ? [...schoolRubrics, ...savedRubrics]
      : builtinRubrics;
    const id = val.slice(val.indexOf(':') + 1);
    const found = all.find(r => r.id === id);
    if (!found) return;
    const criteria = found.criteria;
    setRubricCriteria(criteria);
    setRubricType(rubricTypeOf(found, criteria));
    setSelectedOption(val);
    setRubricTouched(true);
  };
  const [additionalFiles, setAdditionalFiles] = useState([]); // { file, name }[]
  const [rubricFile, setRubricFile] = useState(null);

  // Upload rubric extraction state
  const [extractedCriteria, setExtractedCriteria] = useState(null); // null = not extracted yet
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState(null);

  // Save-as-template modal state
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateTitle, setTemplateTitle] = useState('');

  // ── Fetch topics on mount ──
  useEffect(() => {
    apiFetch(`${API_URL}/api/topics`)
      .then(res => res.json())
      .then(data => { if (data.success) setTopics(data.topics); })
      .catch(() => {});
  }, []);

  // Fetch class lessons from parsed curriculum
  useEffect(() => {
    if (!classId) return;
    apiFetch(`${API_URL}/api/teacher/classes/${classId}/lessons`)
      .then(res => res.json())
      .then(data => { if (data.success) setClassLessons(data.lessons || []); })
      .catch(() => {});
  }, [classId]);

  // ── Edit Mode: Fetch existing activity and pre-fill form ──
  useEffect(() => {
    if (!isEditMode || !editActivityId) return;
    setIsLoadingEdit(true);
    apiFetch(`${API_URL}/api/activities/${editActivityId}/submissions`)
      .then(r => r.json())
      .catch(() => null);
    // Fetch the activity from the class activities list
    // We need a direct activity fetch. Let's use the submissions endpoint parent activity.
    // Actually, there's no direct activity fetch, so we'll use the class endpoint.
    // For now, we'll fetch from a search across teacher classes.
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) { setIsLoadingEdit(false); return; }
    apiFetch(`${API_URL}/api/teacher/${user.id}/classes`)
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
              lateUntil: activity.lateUntil ? String(activity.lateUntil).split('T')[0] : '',
              instructions: activity.instructions || '',
              submissionMode: activity.submissionMode || 'TEACHER_UPLOAD',
              maxAttempts: activity.maxAttempts || 1,
              component: activity.component || 'WW',
            });
            // Pre-fill rubric if it exists. This is the activity's rubric of
            // record, so nothing may overwrite it.
            if (activity.classLessonId) setSelectedLessonId(activity.classLessonId);
            if (activity.rubric) {
              try {
                const parsed = JSON.parse(activity.rubric);
                if (parsed.criteria?.length) {
                  setRubricCriteria(parsed.criteria);
                  setRubricType(rubricTypeOf(parsed, parsed.criteria));
                  if (parsed.source) setRubricMode(parsed.source);
                  setSelectedOption('custom');
                  setRubricTouched(true);
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
  // Runs the same range-band normalization that will actually be saved, so the
  // "Total Weight" preview and the submit-time validation both check the real
  // value rather than a raw, hidden points field that range mode never asks
  // the teacher to fill in themselves.
  const totalPercentage = normalizeRangeCriteria(activeCriteria, rubricType, DEFAULT_RANGE_BANDS)
    .reduce((s, c) => s + (c.points || 0), 0);

  /**
   * What one criterion is worth in this activity's own points.
   *
   * Divides by the rubric's own total rather than by 100, which is what the
   * grading engine does: a score is `earned / rubricTotal` scaled to
   * activity.points, so a rubric out of 50 or 60 converts correctly too.
   *
   * Applies to range rubrics as well as standard ones. Curriculum rubrics are
   * extracted with scoring bands, so they classify as `range` — gating this on
   * `standard` meant the conversion never appeared on exactly the rubrics
   * teachers use most.
   */
  const toActivityPoints = (criterionPoints) => {
    if (!totalPercentage || !form.points) return null;
    const value = (criterionPoints / totalPercentage) * form.points;
    return value.toFixed(1).replace(/\.0$/, '');
  };

  /**
   * One line naming the rubric actually in force and where it came from.
   *
   * The rubric section offers three modes, two types and four possible sources,
   * and used to show none of that — a teacher could not tell a rubric their
   * school wrote from a generic Grade 6 English sample, or notice that picking
   * a topic had swapped it. Naming the source is what makes the precedence
   * rules legible instead of something that just happens to the form.
   */
  const rubricSummary = (() => {
    const scope = [classMeta?.subject, classMeta?.gradeLevel].filter(Boolean).join(' ');
    if (rubricMode === 'upload') {
      return extractedCriteria?.length
        ? { name: rubricFile?.name || 'Uploaded rubric', tone: 'neutral', note: 'Read from the file you uploaded' }
        : { name: 'No rubric yet', tone: 'warn', note: 'Upload a rubric file to continue' };
    }
    if (rubricMode === 'manual') {
      return { name: 'Custom rubric', tone: 'neutral', note: 'Written by you, for this activity only' };
    }
    if (selectedOption === 'lesson-rubric') {
      return {
        name: selectedLesson?.title || 'Curriculum lesson rubric',
        tone: 'good',
        note: "From your school's curriculum, for this lesson",
      };
    }
    if (selectedOption === 'custom') {
      return { name: 'Custom rubric', tone: 'neutral', note: 'Saved with this activity' };
    }
    const school = schoolRubrics.find(r => `saved:${r.id}` === selectedOption);
    if (school) {
      return {
        name: school.name,
        tone: 'good',
        note: school.curriculumId
          ? "From your school's curriculum"
          : `Published by your school${scope ? ` for ${scope}` : ''}`,
      };
    }
    const mine = savedRubrics.find(r => `saved:${r.id}` === selectedOption);
    if (mine) return { name: mine.name, tone: 'neutral', note: 'Your own saved template' };
    const builtin = builtinRubrics.find(b => `builtin:${b.id}` === selectedOption);
    if (builtin) {
      return {
        name: builtin.name,
        tone: 'warn',
        note: "Generic sample — your school hasn't published a rubric for this yet",
      };
    }
    return { name: 'No rubric selected', tone: 'warn', note: '' };
  })();

  const SUMMARY_TONES = {
    good: 'border-emerald-200 bg-emerald-50/60',
    neutral: 'border-slate-200 bg-slate-50',
    warn: 'border-amber-200 bg-amber-50/60',
  };

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
      const res = await apiFetch(`${API_URL}/api/teacher/rubric/extract`, { method: 'POST', body: fd });
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
      const res = await apiFetch(`${API_URL}/api/teacher/rubric-templates`, {
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

  /**
   * A range rubric scores through its bands, so its criteria carry no weight of
   * their own — the editor doesn't even show the field. Everything downstream
   * (the AI prompt, the review sliders, the saved percentage) needs a maximum
   * per criterion, so derive it from the highest band. Without this a range
   * rubric reached the review screen with a total of 0 and scored every
   * submission at 0%. Delegates to normalizeRangeCriteria so this and
   * totalPercentage above can never drift apart on what "the total" means —
   * that drift is exactly what let a curriculum rubric's real weight go
   * unnoticed by validation while the save path already computed it correctly.
   */
  const normalizeCriteria = (criteria) => normalizeRangeCriteria(criteria, rubricType, DEFAULT_RANGE_BANDS);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Only standard rubrics are weighted in percent; a range rubric's total is
    // whatever its bands add up to, so holding it to 100 made it unsavable —
    // the points field it would need to fix is hidden in range mode.
    if (rubricType === 'standard' && rubricMode !== 'upload' && totalPercentage !== 100) {
      alert(`Rubric weight must total 100%. Currently it is ${totalPercentage}%.`);
      return;
    }
    // These three mirror validateRubric() on the server, which is what actually
    // enforces them — an uploaded rubric used to skip every check, so an
    // extraction that came back with unnamed criteria or zero weights was
    // saved and then scored every submission at 0%.
    if (!activeCriteria.length) {
      alert('This activity needs a rubric with at least one criterion.');
      setShowRubricEditor(true);
      return;
    }
    if (!activeCriteria.every(c => c.name?.trim())) {
      alert('Every rubric criterion needs a name.');
      setShowRubricEditor(true);
      return;
    }
    if (totalPercentage <= 0) {
      alert('The rubric criteria add up to zero, so nothing could be scored against it.');
      setShowRubricEditor(true);
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
        const criteriaForSubmit = normalizeCriteria((rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria);
        const res = await apiFetch(`${API_URL}/api/teacher/activities/${editActivityId}`, {
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
        const criteriaForSubmit = normalizeCriteria((rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria);
        fd.append('rubric', JSON.stringify({ source: rubricMode, type: rubricType, criteria: criteriaForSubmit }));

        additionalFiles.forEach(f => fd.append('additionalFiles', f.file));
        if (rubricFile && rubricMode === 'upload') fd.append('additionalFiles', rubricFile);

        const res = await apiFetch(`${API_URL}/api/teacher/activities`, { method: 'POST', body: fd });
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
                  = {toActivityPoints(c.points) ?? 0} pts
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
          {totalPercentage === 100 && (
            <span className="font-medium text-slate-500"> — the full {form.points || 0} points</span>
          )}
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
          <p className="text-xs text-slate-500 mb-4">Choose who uploads the photo of the student output — or skip photos entirely and just record scores.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            {/* No photo, no AI — for work that was marked in the room: recitation,
                an oral quiz, a board exercise. The score still counts toward the
                student's average like any other activity. */}
            <button type="button" onClick={() => setForm({ ...form, submissionMode: 'MANUAL_SCORE' })}
              className={cn('p-4 rounded-xl border-2 text-left flex flex-col gap-2 transition-all',
                form.submissionMode === 'MANUAL_SCORE' ? 'border-lilac-500 bg-lilac-50 shadow' : 'border-slate-200 hover:border-lilac-400')}>
              <div className={cn('p-2 rounded-lg w-fit', form.submissionMode === 'MANUAL_SCORE' ? 'bg-lilac-500 text-white' : 'bg-slate-100 text-slate-500')}>
                <PenLine className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-brand-slate text-sm">✍️ Scores Only</p>
                <p className="text-xs text-slate-500 mt-0.5">No photo or AI. Type each student's points straight into the class list — for recitation, oral quizzes, or seatwork marked on the spot.</p>
              </div>
              {form.submissionMode === 'MANUAL_SCORE' && <span className="text-xs font-bold text-lilac-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Selected</span>}
            </button>
          </div>
        </div>

        {/* ── GRADING COMPONENT ── */}
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <h2 className="text-base font-bold text-brand-slate mb-1">What does this count as?</h2>
          <p className="text-xs text-slate-500 mb-4">
            Your school sets what each component is worth. Within a component, scores are
            weighted by points — a 50-point activity counts half as much as a 100-point one.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: 'WW', label: 'Written Work', hint: 'Quizzes, seatwork, written exercises' },
              { key: 'PT', label: 'Performance Task', hint: 'Essays, projects, demonstrations' },
              { key: 'QA', label: 'Quarterly Assessment', hint: 'The quarterly exam' },
            ].map(c => (
              <button key={c.key} type="button" onClick={() => setForm({ ...form, component: c.key })}
                className={cn('p-3 rounded-xl border-2 text-left transition-all',
                  form.component === c.key ? 'border-brand-navy bg-blue-50 shadow' : 'border-slate-200 hover:border-brand-navy/40')}>
                <p className="font-bold text-brand-slate text-sm">{c.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{c.hint}</p>
              </button>
            ))}
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
              {/* Picking a lesson only records the mapping. The resolver above
                  applies its rubric — as the highest-priority source — so a
                  later edit to the topic can no longer overwrite it. */}
              <select value={selectedLessonId} onChange={e => {
                const lessonId = e.target.value;
                setSelectedLessonId(lessonId);
                const lesson = classLessons.find(l => l.id === lessonId);
                if (lesson?.outputType) {
                  setForm(prev => ({ ...prev, type: lesson.outputType }));
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
            {/* The topic's recommended rubric is only a fallback — see
                resolveDefaultRubric. This field is required, so applying it
                here unconditionally wiped out the curriculum rubric of every
                teacher who mapped a lesson before filling the form in. */}
            <select required value={form.topic} onChange={e => {
                setForm({ ...form, topic: e.target.value });
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
            <p className="text-xs text-slate-400 mt-1">Used to focus the AI's feedback on this skill. It only suggests a rubric if nothing more specific applies.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Deadline {form.submissionMode === 'STUDENT_SUBMIT' && <span className="text-red-500">*</span>}
            </label>
            <input type="date" value={form.deadline}
              onChange={e => {
                const deadline = e.target.value;
                // A late window that closes before the due date would refuse
                // work that was never late, so drop it rather than keep a
                // combination the server will silently discard anyway.
                setForm(f => ({ ...f, deadline, lateUntil: f.lateUntil && deadline && f.lateUntil < deadline ? '' : f.lateUntil }));
              }}
              min={form.submissionMode === 'STUDENT_SUBMIT' ? new Date().toISOString().split('T')[0] : undefined}
              required={form.submissionMode === 'STUDENT_SUBMIT'}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
            {form.submissionMode === 'STUDENT_SUBMIT' && (
              <p className="text-xs text-slate-400 mt-1">Work sent after this date is marked late. Closes here unless you allow late submissions below.</p>
            )}
          </div>

          {/* ── LATE SUBMISSIONS ── */}
          {form.submissionMode === 'STUDENT_SUBMIT' && form.deadline && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.lateUntil}
                  onChange={e => setForm(f => ({ ...f, lateUntil: e.target.checked ? f.deadline : '' }))}
                  className="w-4 h-4 accent-royal-500"
                />
                <span className="text-sm font-medium text-slate-700">Accept late submissions</span>
              </label>
              {form.lateUntil ? (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Accept late work until</label>
                  <input type="date" value={form.lateUntil}
                    min={form.deadline}
                    onChange={e => setForm({ ...form, lateUntil: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-navy outline-none" />
                  <p className="text-xs text-slate-500 mt-1.5">
                    Students can still submit until this date. Their work is flagged
                    <span className="mx-1 text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">LATE</span>
                    for you — no marks are deducted automatically, so you decide what a late piece is worth.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-400 mt-1.5 ml-6">The activity closes on the due date.</p>
              )}
            </div>
          )}

          {form.submissionMode === 'STUDENT_SUBMIT' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Max Submission Attempts
              </label>
              {/* 0 means unlimited. Keep the raw string while typing — coercing
                  with `|| 1` on every keystroke made clearing the field snap
                  back to 1, so it could only be changed with the arrows. */}
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={String(form.maxAttempts) === '0'}
                  onChange={e => setForm({ ...form, maxAttempts: e.target.checked ? 0 : 1 })}
                  className="w-4 h-4 accent-royal-500"
                />
                <span className="text-sm font-medium text-slate-700">Unlimited attempts</span>
              </label>
              {String(form.maxAttempts) !== '0' && (
                <input type="number" min={1} value={form.maxAttempts}
                  onChange={e => setForm({ ...form, maxAttempts: e.target.value })}
                  onBlur={e => {
                    const n = parseInt(e.target.value, 10);
                    setForm(f => ({ ...f, maxAttempts: Number.isNaN(n) ? 1 : Math.max(1, n) }));
                  }}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" />
              )}
              <p className="text-xs text-slate-400 mt-1">
                {String(form.maxAttempts) === '0'
                  ? 'Students can re-submit as many times as they like, up to the deadline.'
                  : 'How many times a student can re-submit before the deadline (default: 1).'}
              </p>
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
          <h2 className="text-base font-bold text-brand-slate mb-3">Grading Rubric</h2>

          {/* What this activity will actually be graded against. Always shown,
              whichever mode produced it, so the answer is never a guess. */}
          <div className={cn('rounded-xl border p-4 mb-4', SUMMARY_TONES[rubricSummary.tone])}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Using</p>
                <p className="font-bold text-brand-slate text-sm truncate">{rubricSummary.name}</p>
                {rubricSummary.note && <p className="text-xs text-slate-600 mt-0.5">{rubricSummary.note}</p>}
                {activeCriteria.length > 0 && rubricSummary.tone !== 'warn' && (
                  /* Says what the rubric is worth in *this* activity's points.
                     "100 pts total" on a 50-point activity reads like the rubric
                     overrides the activity and leaves the teacher doing the
                     arithmetic. */
                  <p className="text-xs text-slate-500 mt-1.5">
                    {activeCriteria.length} criteria · {totalPercentage} rubric pts
                    {form.points ? ` → graded out of ${form.points}` : ''}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setShowRubricEditor(v => !v)}
                className="shrink-0 text-xs font-bold text-brand-navy bg-white border-2 border-brand-navy/20 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                {showRubricEditor ? 'Done' : 'Change'}
              </button>
            </div>
          </div>

          {/* The full picker stays folded away by default: the resolved rubric
              is right for most activities, and three modes plus four sources is
              a lot to meet head-on when you only wanted to set a deadline. */}
          {!showRubricEditor && activeCriteria.length > 0 && rubricMode === 'template' && (
            <ul className="space-y-1.5">
              {activeCriteria.map((c, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-700 truncate">{c.name}</span>
                  <span className="text-slate-400 text-xs shrink-0">
                    {c.points}{rubricType === 'standard' ? '%' : ' pts'}
                    {toActivityPoints(c.points) && ` · ${toActivityPoints(c.points)} of ${form.points}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {showRubricEditor && (
          <>
          {/* Mode tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            {[['template', '📋 Template'], ['manual', '✏️ Create'], ['upload', '📁 Upload']].map(([val, label]) => (
              <button key={val} type="button" onClick={() => {
                setRubricMode(val);
                if (val === 'template') {
                  // Re-apply whichever template the dropdown is pointing at. If
                  // it isn't pointing at one (the teacher came from Create or
                  // Upload), hand control back to the resolver so the best
                  // available default is chosen instead of just the first one.
                  if (selectedOption.startsWith('saved:') || selectedOption.startsWith('builtin:')) {
                    applyOption(selectedOption);
                  } else {
                    setRubricTouched(false);
                  }
                } else if (val === 'manual' && rubricMode !== 'manual') {
                  // Start blank in Create mode
                  setRubricTouched(true);
                  setSelectedOption('custom');
                  setRubricCriteria([
                    rubricType === 'range'
                      ? { name: '', description: '', points: 0, bands: DEFAULT_RANGE_BANDS.map(b => ({ ...b })) }
                      : { name: '', description: '', points: 0 }
                  ]);
                } else if (val === 'upload') {
                  setRubricTouched(true);
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
              {/* Ordered to match resolveDefaultRubric: what the school
                  published for these students first, generic samples last. */}
              <select value={selectedOption} onChange={e => applyOption(e.target.value)}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy mb-2">
                {/* Real entries for the two states that aren't a template, so the
                    dropdown never renders blank while criteria are shown below. */}
                {selectedOption === 'lesson-rubric' && (
                  <option value="lesson-rubric">
                    From this curriculum lesson{selectedLesson?.title ? ` — ${selectedLesson.title}` : ''}
                  </option>
                )}
                {selectedOption === 'custom' && <option value="custom">Custom rubric for this activity</option>}
                {schoolRubrics.length > 0 && (
                  <optgroup label="Your school's rubrics">
                    {schoolRubrics.map(r => (
                      <option key={r.id} value={`saved:${r.id}`}>
                        {r.name}{r.outputType ? ` (${r.outputType})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {savedRubrics.length > 0 && (
                  <optgroup label="Your saved rubrics">
                    {savedRubrics.map(r => <option key={r.id} value={`saved:${r.id}`}>{r.name}</option>)}
                  </optgroup>
                )}
                <optgroup label="Generic DepEd samples (Grade 6 English)">
                  {builtinRubrics.map(t => <option key={t.id} value={`builtin:${t.id}`}>{t.name}</option>)}
                </optgroup>
              </select>

              {/* Provenance for the current pick lives in the summary card
                  above, so it stays visible whichever mode is open. */}
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
                        <span className="text-[11px] font-semibold text-slate-400">({toActivityPoints(c.points) ?? 0} pts)</span>
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
          </>
          )}
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
