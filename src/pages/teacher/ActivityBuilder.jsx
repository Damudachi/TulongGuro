import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Camera, Users, Upload, FileText, X, Trash2, Loader2, Save, PenLine, Medal } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';
import { parseTopicIds, formatTopicIds } from '../../utils/topics';
import {
  badgeLook, BADGE_ICON_KEYS, BADGE_COLOR_KEYS,
  DEFAULT_BADGE_ICON, DEFAULT_BADGE_COLOR,
} from '../../constants/badgeLook';

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
  /**
   * Whether the competency list has actually been answered for.
   *
   * 'loading' | 'ready' | 'failed'. An empty `topics` on its own cannot tell
   * the three apart, and the difference matters: an id on the activity is only
   * knowably "not a DepEd competency" once the list it would be in has
   * arrived. Without this, the moment before the fetch returned — and forever,
   * if it failed offline — every tagged competency was drawn as a raw slug
   * chip under "Other topics", with the checklist hidden so it could not be
   * re-picked.
   */
  const [topicsStatus, setTopicsStatus] = useState('loading');
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
    // The badge this activity awards, and the mark that earns it. Empty string
    // rather than null: this whole object is fed through FormData on create,
    // which has no null, and the server reads '' as "no badge".
    badgeId: '',
    // 75 is DepEd's passing grade and the app's own default (School.passingGrade),
    // so it is the number a teacher is least surprised to find already there.
    // It is only ever *sent* when a badge is actually picked.
    badgePassingScore: 75,
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

  // ── The teacher's badge library ──
  // Loaded whether or not they end up using one: the picker below is the only
  // place a badge gets attached, and an empty list is what tells them the
  // feature exists at all.
  const [teacherBadges, setTeacherBadges] = useState([]);
  const [isLoadingBadges, setIsLoadingBadges] = useState(true);
  const [badgesUnavailable, setBadgesUnavailable] = useState(false);
  // The inline "new badge" form. Null when closed — a teacher deciding on the
  // reward mid-activity should not have to leave the form they are filling in
  // and lose it.
  const [newBadge, setNewBadge] = useState(null);
  const [isCreatingBadge, setIsCreatingBadge] = useState(false);
  const [badgeFormError, setBadgeFormError] = useState('');

  useEffect(() => {
    apiFetch(`${API_URL}/api/teacher/badges`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return setBadgesUnavailable(true);
        setTeacherBadges(d.badges || []);
      })
      .catch(() => setBadgesUnavailable(true))
      .finally(() => setIsLoadingBadges(false));
  }, []);

  const selectedBadge = teacherBadges.find(b => b.id === form.badgeId) || null;

  /**
   * Create a badge without leaving this form, and select it.
   *
   * Deliberately does not touch `form` except to point badgeId at the new
   * badge: a failed create must leave the activity exactly as the teacher left
   * it, including whichever badge was already picked.
   */
  const createBadgeInline = async () => {
    const name = (newBadge?.name || '').trim();
    if (!name) return setBadgeFormError('Give the badge a name — it is what the learner sees on it.');
    setIsCreatingBadge(true);
    setBadgeFormError('');
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/badges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newBadge, name }),
      });
      const data = await res.json();
      if (!data.success) return setBadgeFormError(data.error || 'That badge could not be created.');
      setTeacherBadges(prev => [data.badge, ...prev]);
      setForm(f => ({ ...f, badgeId: data.badge.id }));
      setNewBadge(null);
    } catch {
      setBadgeFormError('Network error while creating the badge.');
    } finally {
      setIsCreatingBadge(false);
    }
  };

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
  /**
   * How many papers have already been marked against this activity's rubric.
   *
   * hitlScore is stored as a percentage of the activity total, so once anything
   * is GRADED the rubric and the points total are part of what that mark means.
   * The server refuses to change either (409 GRADES_RECORDED); this is how the
   * screen says so before a teacher rewrites a rubric that cannot be saved.
   * Class Hub locks its Advanced Edit link on the same rule, so reaching this
   * state means arriving by URL or by browser history.
   */
  const [gradedCount, setGradedCount] = useState(0);
  const isRubricLocked = gradedCount > 0;

  const selectedLesson = classLessons.find(l => l.id === selectedLessonId) || null;
  // form.topic is the stored shape — a comma-separated list of topic ids — so
  // that the submit path keeps posting the form object untouched. The list is
  // derived from it rather than tracked alongside it, which is what stops the
  // two from drifting when an activity is loaded for editing.
  const selectedTopicIds = parseTopicIds(form.topic);
  const selectedTopics = topics.filter(t => selectedTopicIds.includes(t.id));
  // Tags that aren't in the DepEd map: free text typed into the quick-edit
  // form, or a competency from a list this class no longer matches. Shown as
  // removable chips rather than dropped, so nothing sits on the activity that
  // the teacher cannot see or undo.
  //
  // Only once the list has arrived. An id cannot be called unrecognised while
  // the thing that would recognise it is still loading — or never loaded.
  const unknownTopicIds = topicsStatus === 'ready'
    ? selectedTopicIds.filter(id => !topics.some(t => t.id === id))
    : [];

  /**
   * Whether to offer the DepEd competency list at all.
   *
   * depedTopics.js is the MATATAG Grade 6 English map and nothing else, so on
   * any other class the options are simply wrong answers. An activity already
   * tagged with one of them keeps the list visible regardless, or opening it
   * for an edit would show a blank field and silently drop the topics on save.
   */
  const depedTopicsApply =
    selectedTopics.length > 0 ||
    (/grade\s*6/i.test(classMeta?.gradeLevel || '') && /english/i.test(classMeta?.subject || ''));

  // Tags on the activity that cannot be drawn yet, because the list that names
  // them has not arrived. Distinct from unknownTopicIds: these are not unknown,
  // only unresolved, and the difference is what the panel below says out loud.
  const unresolvedTopicIds = topicsStatus === 'ready' ? [] : selectedTopicIds;

  // Whether this class can answer the lesson/topic question at all. A class
  // with no uploaded curriculum and no applicable competency list has nothing
  // to offer, so the field is not shown — and not required. Tags that came
  // from somewhere else count too: they are on the activity, so they have to be
  // on screen where they can be removed.
  const lessonTopicApplies =
    classLessons.length > 0 || depedTopicsApply || unknownTopicIds.length > 0 || unresolvedTopicIds.length > 0;

  /**
   * Map the activity to a curriculum lesson, or to none.
   *
   * The lesson and the competencies used to be one dropdown holding a single
   * value, so choosing either cleared the other — a lesson and a topic could
   * not both be attached, and only one topic ever could. They are separate
   * controls now: a piece of work is often set from one lesson and marked
   * against several competencies, and both are on screen, so neither can sit
   * on the activity invisibly the way the old merged value could.
   */
  const onLessonChange = (id) => {
    setSelectedLessonId(id);
    if (!id) return;
    const lesson = classLessons.find(l => l.id === id);
    if (lesson?.outputType) setForm(prev => ({ ...prev, type: lesson.outputType }));
  };

  /** Add or remove one competency from the activity's list. */
  const toggleTopic = (id) => {
    setForm(prev => {
      const current = parseTopicIds(prev.topic);
      const next = current.includes(id) ? current.filter(t => t !== id) : [...current, id];
      return { ...prev, topic: formatTopicIds(next) };
    });
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

  // A picked template is shown read-only until the teacher asks to change it —
  // and what they change is this activity's copy, never the school's published
  // rubric. Same rule RubricManager states out loud ("editing saves your own
  // copy"); until now the Template tab simply had no way to change anything,
  // so a rubric that was nearly right had to be retyped from scratch in Create.
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  // The template exactly as it was published, for Cancel and for telling
  // "as published" apart from "edited here" in the summary above.
  const [templateBaseline, setTemplateBaseline] = useState(null);

  /** Load a rubric the teacher picked from the dropdown. */
  const applyOption = (val) => {
    setIsEditingTemplate(false);
    // Back to no rubric. A real choice, and the state the form now starts in,
    // so it has to be reachable again after picking something by mistake.
    if (!val) {
      setRubricCriteria([]);
      setSelectedOption('');
      setTemplateBaseline(null);
      return;
    }
    const all = val.startsWith('saved:')
      ? [...schoolRubrics, ...savedRubrics]
      : builtinRubrics;
    const id = val.slice(val.indexOf(':') + 1);
    const found = all.find(r => r.id === id);
    if (!found) return;
    // Deep-copied on the way in. The editor mutates criteria and their bands in
    // place-by-replacement, and `found.criteria` is the object held in the
    // savedRubrics/schoolRubrics list — editing it there would silently rewrite
    // the template in the dropdown, and leave nothing to Cancel back to.
    const criteria = structuredClone(found.criteria || []);
    setRubricCriteria(criteria);
    setTemplateBaseline(structuredClone(criteria));
    setRubricType(rubricTypeOf(found, criteria));
    setSelectedOption(val);
  };

  /** Put the template back exactly as its author published it. */
  const cancelTemplateEdit = () => {
    if (templateBaseline) setRubricCriteria(structuredClone(templateBaseline));
    setIsEditingTemplate(false);
  };

  /** Keep the edits on this activity. The published template is untouched. */
  const finishTemplateEdit = () => {
    if (!rubricCriteria.every(c => c.name?.trim())) {
      alert('Every rubric criterion needs a name.');
      return;
    }
    setIsEditingTemplate(false);
  };

  // Whether the copy on screen still matches the template it came from. Derived
  // rather than tracked with a flag, so typing a change and typing it back is
  // correctly not an edit.
  const templateEdited = !!templateBaseline
    && JSON.stringify(rubricCriteria) !== JSON.stringify(templateBaseline);
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
      .then(data => {
        if (!data.success) return setTopicsStatus('failed');
        setTopics(data.topics);
        setTopicsStatus('ready');
      })
      // Was swallowed silently, which is what made an offline load
      // indistinguishable from a class that simply has no competencies. The
      // tags on the activity are left exactly as they are either way — see the
      // note on topicsStatus.
      .catch(() => setTopicsStatus('failed'));
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
        setGradedCount(data.gradedCount || 0);
        // A locked rubric opens folded: the summary card and the read-only
        // criteria list below it are the whole story, and unfolding the picker
        // would only offer choices the save is going to refuse.
        if (data.gradedCount > 0) setShowRubricEditor(false);
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
          badgeId: activity.badgeId || '',
          // The stored bar, or the default for an activity that awards nothing
          // yet — so picking a badge lands on a sensible number rather than a
          // blank field the save would then refuse.
          badgePassingScore: activity.badgePassingScore ?? 75,
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
    // An edited copy is not the thing it came from, and saying it is would be
    // the one lie this card exists to prevent — a teacher reading "Published by
    // your school" over criteria they reworded has no way to know.
    const edited = templateEdited ? ', edited for this activity' : '';
    const school = schoolRubrics.find(r => `saved:${r.id}` === selectedOption);
    if (school) {
      return {
        name: school.name,
        tone: 'good',
        note: (school.curriculumId
          ? "From your school's curriculum"
          : `Published by your school${scope ? ` for ${scope}` : ''}`) + edited,
      };
    }
    const mine = savedRubrics.find(r => `saved:${r.id}` === selectedOption);
    if (mine) return { name: mine.name, tone: 'neutral', note: `Your own saved template${edited}` };
    const builtin = builtinRubrics.find(b => `builtin:${b.id}` === selectedOption);
    if (builtin) {
      return {
        name: builtin.name,
        tone: 'warn',
        note: `Generic sample — your school hasn't published a rubric for this yet${edited}`,
      };
    }
    return {
      name: 'No rubric set',
      tone: 'warn',
      note: 'Required — pick one below, or write your own. This is what the paper is marked against, and AI checking cannot run without it.',
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

  // Every mode but "Scores only" produces a paper that has to be marked against
  // something. Mirrored on the server, which is what actually enforces it.
  const rubricRequired = form.submissionMode !== 'MANUAL_SCORE';
  const rubricMissing = rubricRequired && activeCriteria.length === 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Saving a form that never loaded would write blank defaults over a real
    // activity's title, points, deadline and rubric.
    if (isEditMode && (isLoadingEdit || loadError)) {
      alert(loadError || 'This activity is still loading. Please wait before saving.');
      return;
    }
    // Work that gets marked has to say what it is marked against, so the rubric
    // is required to publish. It was optional, on the reasoning that a teacher
    // might decide later — but "later" in practice meant an activity that
    // collected papers nobody could check: AI checking refuses to run without
    // one (409 NO_RUBRIC), the review screen has no criteria to score against,
    // and the teacher only found out at the point they tried to mark.
    //
    // Scores-only activities are the exception, and a real one: the teacher
    // types the marks in themselves and no paper is ever read, so there is
    // nothing for a rubric to be applied to. Its editor is hidden for that mode
    // — asking for one here would be asking for something the form doesn't show.
    if (rubricRequired && !activeCriteria.length) {
      alert('Add a grading rubric before publishing. Pick one of your school\'s rubrics, reuse a saved template, or write your own — this is what the paper gets marked against.');
      setShowRubricEditor(true);
      return;
    }
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
    // The lesson and the competencies are two controls answering one required
    // question, so neither can carry `required` on its own — either alone is a
    // complete answer. Only asked where the class has something to answer with:
    // a class whose only possible answer was the competency list is let through
    // when that list failed to load, or the teacher is held at a question with
    // no answerable control on the screen.
    const canAnswerLessonTopic = classLessons.length > 0 || topicsStatus === 'ready';
    if (canAnswerLessonTopic && lessonTopicApplies && !selectedLessonId && selectedTopicIds.length === 0) {
      alert('Say what this activity covers — choose the curriculum lesson, tick at least one competency, or both.');
      return;
    }
    // Trimmed, because the textarea's own `required` is satisfied by a space.
    if (!form.instructions.trim()) {
      alert('Write the instructions students will follow. They are what the work is set against, and the AI reads them when it checks the papers.');
      return;
    }
    // A badge with no usable bar would be saved as unreachable, which looks
    // exactly like a badge that works right up until nobody ever earns it.
    // Mirrored by parsePassingScore on the server, which is what enforces it.
    if (form.badgeId) {
      const bar = Number(form.badgePassingScore);
      if (!Number.isInteger(bar) || bar < 1 || bar > 100) {
        alert('Set the score that earns the badge — a whole number from 1 to 100.');
        return;
      }
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
          {/* Stacks on a phone. Side by side, the name input's intrinsic width
              plus the weight group put the row's minimum past a 390px viewport,
              and because nothing here could shrink the overflow escaped the card
              and scrolled the whole page sideways — the heading ended up off the
              left edge while the fixed dock stayed put. */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
            {/* `sm:contents` dissolves this wrapper from the desktop up, so the
                name and the bin become direct children of the row again and the
                original order — name, weight, bin — is preserved by the `order`
                utilities. On a phone it stays a real row, keeping the bin beside
                the name rather than stranded on a line of its own. */}
            <div className="flex gap-2 items-start sm:contents">
              <input type="text" value={c.name} onChange={e => updateCriterion(i, 'name', e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Criterion name" />
              <button type="button" onClick={() => removeCriterion(i)} className="shrink-0 text-slate-400 hover:text-red-500 mt-1 sm:order-3"><Trash2 className="w-4 h-4" /></button>
            </div>
            {rubricType === 'standard' && (
              <div className="flex items-center gap-2 shrink-0 sm:order-2">
                <input type="number" value={c.points === 0 ? '' : c.points} onChange={e => {
                  const val = e.target.value;
                  updateCriterion(i, 'points', val === '' ? 0 : parseInt(val) || 0);
                }}
                  className="w-20 px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
                <span className="text-slate-500 font-medium">%</span>
                <span className="text-brand-navy font-bold text-sm ml-2 whitespace-nowrap">
                  = {toActivityPoints(c.points) ?? 0} pts
                </span>
              </div>
            )}
          </div>
          <input type="text" value={c.description} onChange={e => updateCriterion(i, 'description', e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Description (optional)" />

          {/* Range bands editor */}
          {rubricType === 'range' && (
            <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-slate-200">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scoring Levels</p>
              {(c.bands || DEFAULT_RANGE_BANDS).map((band, bi) => (
                /* Label and score share the first line; the description takes
                   its own beneath on a phone. Side by side the three inputs
                   needed roughly 370px before the card padding and the rail on
                   the left, so the description ran off the right edge. */
                <div key={bi} className="flex flex-col sm:flex-row gap-1.5 sm:gap-2 sm:items-center">
                  <div className="flex gap-2 items-center sm:contents">
                    <input type="text" value={band.label} onChange={e => updateBand(i, bi, 'label', e.target.value)}
                      className="w-28 shrink-0 px-2 py-1 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Label" />
                    <input type="number" value={band.score} onChange={e => updateBand(i, bi, 'score', e.target.value)}
                      className="w-14 shrink-0 px-2 py-1 border border-slate-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Score" />
                  </div>
                  <input type="text" value={band.description} onChange={e => updateBand(i, bi, 'description', e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 border border-slate-200 rounded text-xs text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-navy" placeholder="Description" />
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
              {/* Frozen alongside the rubric: the two together are what a
                  recorded percentage converts back into. */}
              {isRubricLocked ? (
                <div className="border border-slate-200 bg-slate-50 rounded-lg px-4 py-2 text-center text-slate-600 font-medium">
                  {form.points} pts
                </div>
              ) : (
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-navy focus-within:border-brand-navy bg-white">
                  <button type="button" onClick={() => setForm(f => ({ ...f, points: Math.max(1, (f.points || 0) - 5) }))} className="px-3 py-2 bg-slate-50 text-slate-600 hover:bg-slate-200 font-bold border-r border-slate-200 transition-colors">-</button>
                  <input type="number" min={1} value={form.points === 0 ? '' : form.points} onChange={e => {
                      const val = e.target.value;
                      setForm({ ...form, points: val === '' ? 0 : parseInt(val) || 0 });
                    }}
                    className="w-full px-4 py-2 text-center outline-none" />
                  <button type="button" onClick={() => setForm(f => ({ ...f, points: (f.points || 0) + 5 }))} className="px-3 py-2 bg-slate-50 text-slate-600 hover:bg-slate-200 font-bold border-l border-slate-200 transition-colors">+</button>
                </div>
              )}
            </div>
          </div>

          {/* ── LESSON / TOPICS ──
              Two questions that look like one. A curriculum lesson comes from
              the school's own uploaded scope and sequence and carries an output
              type; a DepEd topic is a fixed competency that sharpens the AI's
              feedback and feeds the topic-breakdown analytics. Neither is shown
              where the class has no answer for it — the DepEd list only covers
              Grade 6 English, and requiring it once forced a Grade 3 Maths
              teacher to tag their work with an English competency chosen at
              random, which then steered the AI's marking towards it.

              The competencies are a checklist, not a single choice: one piece
              of work is routinely set against several — a reflection essay
              marked for both summarising a text and the figures of speech in
              it — and tagging only one of them lost the rest from the analytics
              and from what the AI was told to look for. */}
          {lessonTopicApplies && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Lesson / Topics <span className="text-red-500">*</span>
                </label>
                {/* Required only where the question can actually be answered.
                    The guard above already hides the whole field for a class
                    with no curriculum lessons and no applicable DepEd topics,
                    so this never becomes a dead end. Enforced on submit rather
                    than with `required` on either control, because either one
                    on its own is a complete answer. */}
                <p className="text-xs text-slate-400 mt-0.5">
                  What this activity covers. Pick the curriculum lesson, the competencies, or both —
                  at least one is needed.
                </p>
              </div>

              {classLessons.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Curriculum lesson</label>
                  <select value={selectedLessonId} onChange={e => onLessonChange(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                    <option value="">— None —</option>
                    {classLessons.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.weekNumber ? `Week ${l.weekNumber}: ` : ''}{l.title} ({l.outputType})
                      </option>
                    ))}
                  </select>
                  {selectedLesson && (
                    <p className="text-xs text-slate-400 mt-1">Applies this lesson’s output type.</p>
                  )}
                </div>
              )}

              {depedTopicsApply && topics.length > 0 && (
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-500">
                      DepEd Grade 6 English competencies
                    </label>
                    {selectedTopics.length > 0 && (
                      <span className="text-[11px] font-bold text-brand-navy">{selectedTopics.length} selected</span>
                    )}
                  </div>
                  {/* A checklist rather than a multi-select box: a native
                      multi-select needs ctrl-click to add a second item and
                      silently drops the rest of the selection on a plain click,
                      which on a phone means it cannot be used at all. */}
                  <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {topics.map(t => {
                      const checked = selectedTopicIds.includes(t.id);
                      return (
                        <label key={t.id}
                          className={cn('flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                            checked ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                          <input type="checkbox" checked={checked} onChange={() => toggleTopic(t.id)}
                            className="w-4 h-4 mt-0.5 shrink-0 accent-royal-500" />
                          <span className="min-w-0">
                            <span className="block text-sm text-slate-700 leading-snug">{t.name}</span>
                            {t.term && <span className="block text-[11px] text-slate-400">Term {t.term}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedTopics.length > 0
                      ? 'The AI’s feedback is held to every competency you tick, and the activity is counted under each of them in analytics.'
                      : 'Tick every competency this activity is meant to assess.'}
                  </p>
                </div>
              )}

              {/* The competency list could not be fetched — offline, most
                  likely. Said out loud, because the alternative is a teacher
                  opening an activity they tagged last week and finding the
                  competencies apparently gone. They are not: form.topic is
                  untouched, and saving from here keeps every one of them. */}
              {topicsStatus === 'failed' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800 leading-relaxed">
                    The competency list could not be loaded, so it cannot be changed here right now.
                    {unresolvedTopicIds.length > 0
                      ? ` The ${unresolvedTopicIds.length} competenc${unresolvedTopicIds.length === 1 ? 'y' : 'ies'} already on this activity ${unresolvedTopicIds.length === 1 ? 'is' : 'are'} kept as ${unresolvedTopicIds.length === 1 ? 'it is' : 'they are'} — saving will not drop ${unresolvedTopicIds.length === 1 ? 'it' : 'them'}.`
                      : ' Reconnect and reopen this page to pick from it.'}
                  </p>
                </div>
              )}

              {topicsStatus === 'loading' && unresolvedTopicIds.length > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading the competencies on this activity…
                </p>
              )}

              {unknownTopicIds.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Other topics on this activity</p>
                  <div className="flex flex-wrap gap-2">
                    {unknownTopicIds.map(id => (
                      <span key={id} className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                        {id}
                        <button type="button" onClick={() => toggleTopic(id)} aria-label={`Remove ${id}`}
                          className="text-slate-400 hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Typed in elsewhere, or from a curriculum this class no longer follows. They still tag the activity.
                  </p>
                </div>
              )}
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Instructions for Students <span className="text-red-500">*</span>
            </label>
            {/* Required. Without them the activity reaches the student as a
                title and a date, and reaches the AI checker with a rubric but
                nothing saying what the work was asked to do — the piece of
                context the marking leans on hardest. The server refuses a
                blank one too (INSTRUCTIONS_REQUIRED), so this is the form
                saying it first rather than the only thing enforcing it. */}
            <textarea required rows={4} value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none resize-none"
              placeholder="e.g. Write a 5-paragraph reflection on the novel. Use your own words and give at least two examples from the text." />
            <p className="text-xs text-slate-400 mt-1">
              Students see this on the activity, and the AI reads it as the task the paper was set.
            </p>
          </div>
        </div>

        {/* ── BADGE REWARD ──
            Optional, and the only place a badge is attached to an activity. The
            reward itself lives in the teacher's badge library; what is decided
            here is the condition — which badge, and the mark that earns it.
            Available in every submission mode, "Scores only" included: a
            recitation mark is a mark, and a teacher who wants to celebrate one
            should not have to switch the activity to a photo upload to do it. */}
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-base font-bold text-brand-slate">Badge Reward</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Optional</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Award one of your badges to every student who reaches a score you set on this activity.
            Once earned, a badge is theirs for good — it appears in their Trophy Room and is never taken back.
          </p>

          {badgesUnavailable ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              Your badges could not be loaded, so none can be attached right now. Everything else on this
              activity still saves normally.
            </p>
          ) : isLoadingBadges ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your badges…
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="activity-badge" className="block text-sm font-medium text-slate-700 mb-1">
                  Badge to award
                </label>
                <select id="activity-badge" value={form.badgeId}
                  onChange={e => setForm({ ...form, badgeId: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                  <option value="">— No badge for this activity —</option>
                  {teacherBadges.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {teacherBadges.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">
                    You have no badges yet. Create one below, or manage them all on the{' '}
                    <Link to="/teacher/badges" className="font-bold text-brand-navy hover:underline">Badges</Link> page.
                  </p>
                )}
              </div>

              {/* ── The condition, shown only once there is something to condition ── */}
              {selectedBadge && (
                <>
                  <div>
                    <label htmlFor="badge-bar" className="block text-sm font-medium text-slate-700 mb-1">
                      Score that earns it *
                    </label>
                    <div className="flex items-center gap-2">
                      <input id="badge-bar" type="number" min={1} max={100} step={1}
                        value={form.badgePassingScore}
                        onChange={e => setForm({ ...form, badgePassingScore: e.target.value })}
                        onBlur={e => {
                          // Snapped back into range on blur rather than on every
                          // keystroke: clamping as they type makes "8" become 8
                          // before they can finish typing "85".
                          const n = parseInt(e.target.value, 10);
                          setForm(f => ({ ...f, badgePassingScore: Number.isNaN(n) ? 75 : Math.min(100, Math.max(1, n)) }));
                        }}
                        className="w-28 px-4 py-2 border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-brand-navy outline-none" />
                      <span className="text-slate-500 font-medium">%</span>
                      <span className="text-sm text-slate-500">
                        = {Math.round((Number(form.badgePassingScore) || 0) / 100 * (form.points || 0) * 10) / 10} of {form.points || 0} pts
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      A percentage, so it keeps its meaning if the activity&apos;s total points ever change.
                      Separate from your school&apos;s passing grade — set it wherever this reward belongs.
                    </p>
                  </div>

                  {/* Exactly what will happen, in one sentence, drawn with the
                      badge the learner will actually see. */}
                  {(() => {
                    const style = badgeLook(selectedBadge);
                    const Icon = style.icon;
                    return (
                      <div className={cn('rounded-xl border-2 p-4 flex items-center gap-4', style.shell)}>
                        <div className={cn('p-3 rounded-2xl text-white shrink-0 shadow-pop', style.tile)}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-brand-slate">{selectedBadge.name}</p>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Students who score {form.badgePassingScore || '—'}% or higher on{' '}
                            <span className="font-bold">{form.title.trim() || 'this activity'}</span> earn this badge.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ── Create one without leaving the form ── */}
              {newBadge === null ? (
                <button type="button"
                  onClick={() => { setNewBadge({ name: '', description: '', icon: DEFAULT_BADGE_ICON, color: DEFAULT_BADGE_COLOR }); setBadgeFormError(''); }}
                  className="text-sm text-brand-navy font-medium flex items-center hover:underline">
                  <Plus className="w-4 h-4 mr-1" /> Create a new badge
                </button>
              ) : (
                <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-brand-slate flex items-center gap-1.5">
                      <Medal className="w-4 h-4 text-brand-navy" /> New badge
                    </p>
                    <button type="button" onClick={() => { setNewBadge(null); setBadgeFormError(''); }}
                      className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                  </div>

                  <input type="text" value={newBadge.name} maxLength={60}
                    onChange={e => setNewBadge({ ...newBadge, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-navy outline-none"
                    placeholder="Badge name, e.g. Times Table Champion" />
                  <input type="text" value={newBadge.description} maxLength={200}
                    onChange={e => setNewBadge({ ...newBadge, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-brand-navy outline-none"
                    placeholder="Description (optional)" />

                  <div className="flex flex-wrap gap-1.5">
                    {BADGE_ICON_KEYS.map(key => {
                      const Icon = badgeLook({ icon: key }).icon;
                      const active = newBadge.icon === key;
                      return (
                        <button key={key} type="button" aria-pressed={active} aria-label={key}
                          onClick={() => setNewBadge({ ...newBadge, icon: key })}
                          className={cn('w-9 h-9 rounded-lg grid place-items-center border-2 transition-all',
                            active ? cn(badgeLook(newBadge).tile, 'text-white border-transparent')
                                   : 'bg-white border-slate-200 text-slate-500 hover:border-brand-navy/40')}>
                          <Icon className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {BADGE_COLOR_KEYS.map(key => (
                      <button key={key} type="button" aria-pressed={newBadge.color === key} aria-label={key}
                        onClick={() => setNewBadge({ ...newBadge, color: key })}
                        className={cn('w-9 h-9 rounded-lg grid place-items-center border-2 transition-all',
                          badgeLook({ color: key }).dot,
                          newBadge.color === key ? 'border-brand-slate' : 'border-transparent opacity-70 hover:opacity-100')}>
                        {newBadge.color === key && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </button>
                    ))}
                  </div>

                  {badgeFormError && (
                    <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {badgeFormError}
                    </p>
                  )}

                  {/* type="button" throughout: this sits inside the activity's
                      own <form>, and a submit button here would publish the
                      activity instead of creating the badge. */}
                  <button type="button" onClick={createBadgeInline} disabled={isCreatingBadge}
                    className="flex items-center gap-1.5 bg-brand-navy text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-blue-900 disabled:opacity-60 transition-colors">
                    {isCreatingBadge && <Loader2 className="w-4 h-4 animate-spin" />}
                    Create &amp; use it
                  </button>
                </div>
              )}
            </div>
          )}
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
        <div className={cn('bg-white p-6 rounded-xl border', rubricMissing ? 'border-amber-300' : 'border-slate-200')}>
          <h2 className="text-base font-bold text-brand-slate mb-3">
            Grading Rubric <span className="text-red-500">*</span>
          </h2>

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
              {isRubricLocked ? (
                <span className="shrink-0 text-xs font-bold text-slate-500 bg-white border-2 border-slate-200 px-3 py-1.5 rounded-lg">
                  🔒 Locked
                </span>
              ) : (
                <button type="button" onClick={() => setShowRubricEditor(v => !v)}
                  className="shrink-0 text-xs font-bold text-brand-navy bg-white border-2 border-brand-navy/20 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                  {showRubricEditor ? 'Done' : 'Change'}
                </button>
              )}
            </div>
          </div>

          {isRubricLocked && (
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 mb-4 text-sm">
              <p className="font-bold text-amber-800">
                {gradedCount} paper{gradedCount === 1 ? ' has' : 's have'} already been marked against this rubric
              </p>
              <p className="text-amber-700 text-xs mt-1">
                Marks are stored as a percentage of the {form.points || 0}-point total, so changing the rubric or the
                points now would re-value work that has already been assessed. Everything else on this page — the
                title, the instructions, the deadline — can still be edited and saved.
              </p>
            </div>
          )}

          {/* The full picker stays folded away by default: the resolved rubric
              is right for most activities, and three modes plus four sources is
              a lot to meet head-on when you only wanted to set a deadline. */}
          {/* A locked rubric shows its criteria whatever mode produced it —
              folding a hand-written rubric away to nothing would read as the
              activity having lost it. */}
          {!showRubricEditor && activeCriteria.length > 0 && (rubricMode === 'template' || isRubricLocked) && (
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
                // Pressing the tab you are already on must not reset anything.
                // Without this, a teacher who edited a template and tapped
                // "Template" again — the obvious thing to do to get back to the
                // list — had their edits replaced by the pristine template.
                if (val === rubricMode) return;
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

              {/* Edit / Save. A template that is nearly right — the wording of
                  one band, a criterion worth 4 rather than 3 — used to mean
                  retyping the whole thing in Create, so most teachers took the
                  template as-is whether or not it matched the work they had
                  set. Editing here changes this activity's copy only; the
                  school's published rubric is never written to. */}
              {rubricCriteria.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <p className="text-xs font-bold text-slate-500">
                    {isEditingTemplate
                      ? 'Editing this activity’s copy — the published rubric stays as it is'
                      : templateEdited ? 'Edited for this activity' : 'What this activity will be marked against'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {isEditingTemplate ? (
                      <>
                        <button type="button" onClick={cancelTemplateEdit}
                          className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1">
                          <X className="w-3.5 h-3.5" /> Cancel
                        </button>
                        <button type="button" onClick={handleSaveAsTemplate}
                          title="Keep this version in your own rubric list for future activities"
                          className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors flex items-center gap-1">
                          <Save className="w-3.5 h-3.5" /> Save as template
                        </button>
                        <button type="button" onClick={finishTemplateEdit}
                          className="text-xs font-bold text-white bg-brand-green px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition-colors flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Save
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setIsEditingTemplate(true)}
                          title="Change the wording or points for this activity only"
                          className="text-xs font-bold text-brand-navy border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1">
                          <PenLine className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button type="button" onClick={handleSaveAsTemplate}
                          title="Keep this rubric in your own list for future activities"
                          className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors flex items-center gap-1">
                          <Save className="w-3.5 h-3.5" /> Save as template
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Provenance for the current pick lives in the summary card
                  above, so it stays visible whichever mode is open. */}
              {isEditingTemplate ? renderCriterionEditor(rubricCriteria) : rubricCriteria.map((c, i) => (
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

        {/* A disabled button with no reason on screen reads as a broken page. */}
        {rubricMissing && (
          <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-right">
            Add a grading rubric above to publish this activity.
          </p>
        )}

        <div className="flex justify-end pt-2">
          <button type="button" onClick={() => navigate(-1)}
            className="px-6 py-2 rounded-lg text-slate-600 font-medium hover:bg-slate-100 mr-4 transition-colors">Cancel</button>
          <button type="submit" disabled={isSaving || (!isEditMode && !classId) || rubricMissing}
            title={
              !isEditMode && !classId ? 'Choose which class this activity is for'
                : rubricMissing ? 'Add a grading rubric first — it is what the paper gets marked against'
                  : undefined}
            className="px-6 py-2 rounded-lg bg-brand-navy text-white font-medium hover:bg-blue-900 transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-60 disabled:cursor-not-allowed">
            {isSaving ? (isEditMode ? 'Updating...' : 'Publishing...') : (isEditMode ? 'Update Activity' : 'Publish Activity')}
          </button>
        </div>
      </form>
    </div>
  );
}
