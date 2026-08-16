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
    // `b?.score` and the NaN filter, because a sparse or partially-filled band
    // array must degrade to a real number here rather than poisoning the total
    // — NaN compares false against every threshold, so it slips past the
    // validation that exists to catch a zero-weight rubric.
    const scores = bands.map(b => bandScoreNumber(b?.score)).filter(n => Number.isFinite(n));
    const top = Math.max(...scores, 0);
    return { ...c, bands, points: top };
  });
}

export default function ActivityBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activityId: editActivityId } = useParams();
  const isEditMode = !!editActivityId;
  const classIdFromUrl = searchParams.get('classId');
  // Which class this activity belongs to, when the URL didn't say.
  //
  // /teacher/activity/new is reachable without a classId — the setup checklist
  // links straight here — and the form used to send the literal string
  // 'mock-class-id' in that case. There is no such class, so Postgres refused
  // the insert on Activity_classId_fkey and the teacher got a raw Prisma error
  // in an alert box after filling the whole form in. The class is a fact about
  // the activity, so it is asked for like any other required field.
  const [pickedClassId, setPickedClassId] = useState('');
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const classId = classIdFromUrl || pickedClassId;
  const needsClassPicker = !isEditMode && !classIdFromUrl;
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

  // The teacher's classes, for the picker above. Only fetched when the URL
  // didn't name one — coming from a class hub, this is already decided.
  useEffect(() => {
    if (!needsClassPicker) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
    setIsLoadingClasses(true);
    apiFetch(`${API_URL}/api/teacher/${user.id}/classes`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        const list = d.classes || [];
        setTeacherClasses(list);
        // One class is not a choice. Pre-selecting it is the difference between
        // a form that works and one that asks a question with a single answer.
        if (list.length === 1) setPickedClassId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingClasses(false));
  }, [needsClassPicker]);

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

  // Empty, and it stays empty until the teacher chooses. A single blank
  // criterion used to sit here as the starting shape, which read as "a rubric
  // that needs filling in" rather than "no rubric yet" — and saved as a
  // nameless criterion if the teacher never opened the editor.
  const [rubricCriteria, setRubricCriteria] = useState([]);
  const [selectedOption, setSelectedOption] = useState('');
  // Open from the start on a new activity: with nothing pre-selected, the
  // picker is the next thing the teacher needs, and folding it away would hide
  // the school's own rubrics behind a click.
  const [showRubricEditor, setShowRubricEditor] = useState(!isEditMode);

  const selectedLesson = classLessons.find(l => l.id === selectedLessonId) || null;
  const selectedTopic = topics.find(t => t.id === form.topic) || null;

  /**
   * Whether to offer the DepEd competency list at all.
   *
   * depedTopics.js is the MATATAG Grade 6 English map and nothing else, so on
   * any other class the options are simply wrong answers. An activity that is
   * already tagged keeps the list visible regardless, or opening it for an edit
   * would show a blank field and silently drop the topic on save.
   */
  const depedTopicsApply =
    !!form.topic ||
    (/grade\s*6/i.test(classMeta?.gradeLevel || '') && /english/i.test(classMeta?.subject || ''));

  // The merged picker holds one value for two different mappings, tagged by
  // source so a lesson id and a topic id can never be mistaken for each other.
  const lessonTopicValue = selectedLessonId
    ? `lesson:${selectedLessonId}`
    : form.topic ? `topic:${form.topic}` : '';

  /**
   * An activity is mapped to a lesson or to a topic, never both — picking one
   * has to clear the other, or the old value stays attached invisibly and keeps
   * steering the rubric and the AI prompt.
   */
  const onLessonTopicChange = (value) => {
    const [kind, id] = value.split(/:(.*)/s);
    if (kind === 'lesson') {
      setSelectedLessonId(id);
      setForm(prev => {
        const lesson = classLessons.find(l => l.id === id);
        return { ...prev, topic: '', ...(lesson?.outputType ? { type: lesson.outputType } : {}) };
      });
    } else if (kind === 'topic') {
      setSelectedLessonId('');
      setForm(prev => ({ ...prev, topic: id }));
    } else {
      setSelectedLessonId('');
      setForm(prev => ({ ...prev, topic: '' }));
    }
  };

  // No rubric is chosen for the teacher — not from the lesson they picked, not
  // from the school's library, not from a DepEd sample.
  //
  // There used to be a resolver here that applied the best available default
  // whenever a source loaded or the activity was mapped to a lesson. It is gone
  // on purpose: writing the rubric is the teacher's work, and a form that
  // arrives pre-filled invites it to be accepted unread. Everything the resolver
  // used to rank still appears in the picker below, in the same order — offered,
  // which is a different act from applied.

  /** Load a rubric the teacher picked from the dropdown. */
  const applyOption = (val) => {
    // Back to no rubric. A real choice, and the state the form now starts in,
    // so it has to be reachable again after picking something by mistake.
    if (!val) {
      setRubricCriteria([]);
      setSelectedOption('');
      return;
    }
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
  //
  // Asks for the activity directly. This used to fetch every class the teacher
  // owns and hunt for the activity in `cls.activities` — a list the classes
  // endpoint deliberately caps at the 10 most recent per class. Editing the
  // eleventh-oldest activity therefore found nothing, left every field at its
  // blank default, and then refused to save with "Every rubric criterion needs
  // a name" — about an activity whose rubric was perfectly intact. A teacher
  // who filled that name in to get past it would have overwritten the real
  // title, points, deadline and rubric with defaults.
  //
  // GET /api/activities/:id existed the whole time, is school-scoped, and
  // returns every field this form needs.
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (!isEditMode || !editActivityId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
    setIsLoadingEdit(true);
    setLoadError('');
    apiFetch(`${API_URL}/api/activities/${editActivityId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !data?.success || !data.activity) {
          // Said out loud rather than leaving a blank form that looks like a
          // new activity and silently discards the real one on save.
          setLoadError(data?.error || 'This activity could not be loaded, so nothing has been filled in. Go back and try again.');
          return;
        }
        const activity = data.activity;
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
            }
          } catch { /* a rubric that will not parse leaves the editor as it is */ }
        }
      })
      .catch(() => setLoadError('Could not reach the server, so this activity has not been loaded.'))
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
      // Seeded from the same defaults the editor renders when a criterion has
      // no bands of its own. Starting from [] instead let an edit to the third
      // row write index 2 of an empty array, leaving holes at 0 and 1 — and a
      // hole spreads as `undefined`, so Math.max returned NaN, the rubric
      // total became NaN, and `total <= 0` is *false* for NaN, so the
      // "adds up to zero" guard waved it through and saved null weights.
      const bands = (c.bands?.length ? c.bands : DEFAULT_RANGE_BANDS).map(b => ({ ...b }));
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
    return {
      name: 'No rubric set',
      tone: 'warn',
      note: 'Pick one below, or write your own. AI checking needs a rubric before it can run.',
    };
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
    } catch {
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
    } catch {
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
    // Saving a form that never loaded would write blank defaults over a real
    // activity's title, points, deadline and rubric.
    if (isEditMode && (isLoadingEdit || loadError)) {
      alert(loadError || 'This activity is still loading. Please wait before saving.');
      return;
    }
    // An activity may be saved with no rubric at all. The teacher may not have
    // decided yet, or may be setting the work up now and marking it later — and
    // refusing the save was what forced *something* to be attached, which is how
    // an unread default became the rubric of record. AI checking is what needs a
    // rubric, and that is where it is asked for (409 NO_RUBRIC on the server).
    //
    // A rubric that IS present still has to be a usable one. The three checks
    // below mirror validateRubric() on the server, which is what actually
    // enforces them: an uploaded rubric used to skip every check, so an
    // extraction that came back with unnamed criteria or zero weights was saved
    // and then scored every submission at 0%.
    if (activeCriteria.length) {
      // Only standard rubrics are weighted in percent; a range rubric's total is
      // whatever its bands add up to, so holding it to 100 made it unsavable —
      // the points field it would need to fix is hidden in range mode.
      if (rubricType === 'standard' && rubricMode !== 'upload' && totalPercentage !== 100) {
        alert(`Rubric weight must total 100%. Currently it is ${totalPercentage}%.`);
        return;
      }
      if (!activeCriteria.every(c => c.name?.trim())) {
        alert('Every rubric criterion needs a name.');
        setShowRubricEditor(true);
        return;
      }
      // `> 0` rather than `<= 0`: NaN fails both, and the version that asked
      // `<= 0` therefore let a broken total through instead of catching it.
      if (!(totalPercentage > 0)) {
        alert('The rubric criteria add up to zero, so nothing could be scored against it.');
        setShowRubricEditor(true);
        return;
      }
    }
    if (!form.points || form.points < 1) {
      alert("Total Points must be greater than 0.");
      return;
    }
    // An activity has to belong to a real class. This used to fall back to the
    // string 'mock-class-id', which the database rejected on the foreign key
    // after the teacher had filled the entire form in.
    if (!isEditMode && !classId) {
      alert(teacherClasses.length === 0
        ? 'Create a class first — an activity has to belong to one.'
        : 'Please choose which class this activity is for.');
      return;
    }
    setIsSaving(true);
    // Null, not an empty rubric object. validateRubric() on the server reads
    // null as "no rubric, allowed" and an empty criteria list as a broken one,
    // and the grader's own check asks the same question of the stored value.
    const rubricForSubmit = activeCriteria.length
      ? JSON.stringify({
          source: rubricMode,
          type: rubricType,
          criteria: normalizeCriteria((rubricMode === 'upload' && extractedCriteria) ? extractedCriteria : rubricCriteria)
        })
      : null;

    try {
      if (isEditMode) {
        // UPDATE existing activity via JSON
        const res = await apiFetch(`${API_URL}/api/teacher/activities/${editActivityId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            classLessonId: selectedLessonId || null,
            rubric: rubricForSubmit
          })
        });
        const data = await res.json();
        if (data.success) navigate(-1);
        else alert('Error: ' + data.error);
      } else {
        // CREATE new activity via FormData
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        fd.append('classId', classId);
        if (selectedLessonId) fd.append('classLessonId', selectedLessonId);

        // Omitted entirely when there is no rubric: FormData has no null, and
        // appending the string "null" would reach validateRubric as a rubric
        // that cannot be read rather than as no rubric.
        if (rubricForSubmit) fd.append('rubric', rubricForSubmit);

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
  const renderCriterionEditor = (criteria) => (
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

      {/* Edit mode fills these fields from the server. Showing the blank form
          while that is in flight reads as "this activity has no title" rather
          than "not loaded yet", which is the state a teacher would type over. */}
      {isLoadingEdit && (
        <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 mb-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading this activity…
        </div>
      )}

      {loadError && (
        <div role="alert" className="flex items-start gap-2 text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 mb-6">
          <X className="w-4 h-4 shrink-0 mt-0.5" /> {loadError}
        </div>
      )}

      <form className="space-y-6" onSubmit={handleSubmit}>

        {/* ── CLASS ──
            Only when the URL didn't say. Opened from a class hub the answer is
            already known and asking again would be noise; opened from the setup
            checklist it is the one thing the form cannot infer. */}
        {needsClassPicker && (
          <div className="bg-white p-6 rounded-xl border-2 border-brand-navy/10 shadow-sm">
            <h2 className="text-base font-bold text-brand-slate mb-1">Which class is this for? *</h2>
            <p className="text-xs text-slate-500 mb-4">The activity, and every mark given for it, belongs to this class.</p>
            {isLoadingClasses ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your classes…
              </div>
            ) : teacherClasses.length === 0 ? (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                You don&apos;t have a class yet, and an activity has to belong to one.{' '}
                <button type="button" onClick={() => navigate('/teacher/dashboard')} className="font-bold underline">
                  Create a class first
                </button>.
              </div>
            ) : (
              <select required value={pickedClassId} onChange={e => setPickedClassId(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                <option value="">— Choose a class —</option>
                {teacherClasses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.section?.name ? ` · ${c.section.name}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* ── SUBMISSION MODE ── */}
        <div className="bg-white p-6 rounded-xl border-2 border-brand-navy/10 shadow-sm">
          <h2 className="text-base font-bold text-brand-slate mb-1">How will students submit?</h2>
          <p className="text-xs text-slate-500 mb-4">Choose who uploads the photo of the student output — or skip photos entirely and just record scores.</p>
          {/* Every card renders the "Selected" badge and hides it with
              `invisible` rather than dropping it from the DOM. A grid row sizes
              itself to its tallest card, so a badge that only existed while
              selected made the whole block grow the moment the card with the
              longest blurb — Scores Only — was picked, and shrink again on the
              way out. Reserving the line keeps the height fixed whatever is
              chosen. `mt-auto` then pins all three badges to a shared baseline
              instead of letting each float under its own blurb. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                mode: 'TEACHER_UPLOAD', icon: Camera, label: '📷 Teacher Uploads',
                hint: 'Teacher scans student papers via Scan & Grade Papers and triggers AI grading.',
                on: 'border-brand-navy bg-blue-50 shadow', off: 'hover:border-brand-navy/40',
                chip: 'bg-brand-navy text-white', badge: 'text-brand-navy',
              },
              {
                mode: 'STUDENT_SUBMIT', icon: Users, label: '👤 Student Submits',
                hint: 'Activity appears on student dashboards. Students upload from the app before the deadline.',
                on: 'border-brand-green bg-green-50 shadow', off: 'hover:border-brand-green/40',
                chip: 'bg-brand-green text-white', badge: 'text-brand-green',
              },
              // No photo, no AI — for work that was marked in the room: recitation,
              // an oral quiz, a board exercise. The score still counts toward the
              // student's average like any other activity.
              {
                mode: 'MANUAL_SCORE', icon: PenLine, label: '✍️ Scores Only',
                hint: "No photo or AI. Type each student's points straight into the class list — for recitation, oral quizzes, or seatwork marked on the spot.",
                on: 'border-lilac-500 bg-lilac-50 shadow', off: 'hover:border-lilac-400',
                chip: 'bg-lilac-500 text-white', badge: 'text-lilac-700',
              },
            ].map(o => {
              const active = form.submissionMode === o.mode;
              return (
                <button key={o.mode} type="button" aria-pressed={active}
                  onClick={() => setForm({ ...form, submissionMode: o.mode })}
                  className={cn('p-4 rounded-xl border-2 text-left flex flex-col gap-2 transition-all',
                    active ? o.on : cn('border-slate-200', o.off))}>
                  <div className={cn('p-2 rounded-lg w-fit', active ? o.chip : 'bg-slate-100 text-slate-500')}>
                    <o.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-brand-slate text-sm">{o.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{o.hint}</p>
                  </div>
                  <span className={cn('mt-auto text-xs font-bold flex items-center gap-1',
                    active ? o.badge : 'invisible')}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Selected
                  </span>
                </button>
              );
            })}
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

          {/* ── LESSON / TOPIC ──
              One field, two sources. This used to be two required dropdowns
              sitting next to each other — "Curriculum Lesson / Topic" and
              "DepEd Topic *" — which read as the same question asked twice.
              They are not quite: a curriculum lesson comes from the school's
              own uploaded scope and sequence and carries a rubric, while a
              DepEd topic is a fixed competency that sharpens the AI's feedback
              and feeds the topic-breakdown analytics. But only one of them
              describes any given activity, and the DepEd list only covers
              Grade 6 English — so requiring it forced a Grade 3 Maths teacher
              to tag their work with an English competency chosen at random,
              which then steered the AI's marking towards it. Merged into one
              optional picker: whichever source actually fits. */}
          {(classLessons.length > 0 || depedTopicsApply) && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Lesson / Topic <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <select value={lessonTopicValue} onChange={e => onLessonTopicChange(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                <option value="">— Not linked to a lesson —</option>
                {classLessons.length > 0 && (
                  <optgroup label="From your school's curriculum">
                    {classLessons.map(l => (
                      <option key={l.id} value={`lesson:${l.id}`}>
                        {l.weekNumber ? `Week ${l.weekNumber}: ` : ''}{l.title} ({l.outputType})
                      </option>
                    ))}
                  </optgroup>
                )}
                {depedTopicsApply && topics.length > 0 && (
                  <optgroup label="DepEd Grade 6 English competencies">
                    {/* Flattened with the term in the label — optgroups cannot
                        nest, and the term is what tells two similarly-worded
                        competencies apart. */}
                    {topics.map(t => (
                      <option key={t.id} value={`topic:${t.id}`}>
                        {t.term ? `Term ${t.term} · ` : ''}{t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                {selectedLessonId
                  ? 'Applies this lesson’s output type and default rubric.'
                  : selectedTopic
                    ? 'Focuses the AI’s feedback on this competency, and groups the activity under it in analytics.'
                    : 'Links the activity to a curriculum lesson or a DepEd competency. Leave blank if neither fits.'}
              </p>
            </div>
          )}

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

        {/* ── RUBRIC ──
            Hidden for MANUAL_SCORE ("Score only"): the teacher types the marks
            in themselves and no paper is ever read, so there is nothing for a
            rubric to be applied to. Leaving it on screen asked for a decision
            that changes nothing and implied the AI would be marking against
            it. The whole panel goes rather than being disabled — a greyed-out
            section still reads as something you have failed to fill in. */}
        {form.submissionMode !== 'MANUAL_SCORE' ? (
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
                  // Re-apply whichever template the dropdown is pointing at.
                  // Coming from Create or Upload it is pointing at nothing, and
                  // that is the honest state to return to — no rubric, rather
                  // than the first one on the list.
                  if (selectedOption.startsWith('saved:') || selectedOption.startsWith('builtin:')) {
                    applyOption(selectedOption);
                  } else {
                    applyOption('');
                  }
                } else if (val === 'manual' && rubricMode !== 'manual') {
                  // Start blank in Create mode
                  setSelectedOption('custom');
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
              {/* What the school published for these students first, generic
                  samples last. Nothing here is pre-selected — the teacher
                  chooses, and the empty entry below is a real choice they can
                  come back to, not a placeholder. */}
              <select value={selectedOption} onChange={e => applyOption(e.target.value)}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy mb-2">
                <option value="">No rubric yet — choose one</option>
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
                  {renderCriterionEditor(extractedCriteria)}
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
        ) : (
          // Said rather than silently omitted: a panel that disappears when a
          // mode is picked looks like a bug unless the reason is on screen.
          <div className="bg-white p-6 rounded-xl border border-slate-200">
            <h2 className="text-base font-bold text-brand-slate mb-1">Grading Rubric</h2>
            <p className="text-sm text-slate-500">
              Not needed for <span className="font-semibold">Score only</span> — you enter the marks yourself,
              so there is no paper for the AI to read and nothing to grade against. Pick another submission
              mode above if you want AI checking and feedback.
            </p>
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
          <button type="submit" disabled={isSaving || (!isEditMode && !classId)}
            title={!isEditMode && !classId ? 'Choose which class this activity is for' : undefined}
            className="px-6 py-2 rounded-lg bg-brand-navy text-white font-medium hover:bg-blue-900 transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-60 disabled:cursor-not-allowed">
            {isSaving ? (isEditMode ? 'Updating...' : 'Publishing...') : (isEditMode ? 'Update Activity' : 'Publish Activity')}
          </button>
        </div>
      </form>
    </div>
  );
}
