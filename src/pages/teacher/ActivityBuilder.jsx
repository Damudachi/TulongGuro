import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Plus, Camera, Users, Upload, FileText, X, Trash2, Loader2, Save, PenLine, Medal } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';
import { parseTopicIds, formatTopicIds, lessonTopicId, lessonIdFromTopicId, isLessonTopicId, termForWeek, readCompetencies, lessonDisplayName } from '../../utils/topics';
import { showAlert } from '../../utils/dialog';
import { todayInPH } from '../../utils/deadlines';
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
  /**
   * Where leaving this screen goes — saving, cancelling and the back link all.
   *
   * navigate(-1) was used for all three, which made "leave" mean "retrace one
   * step". Saving an activity then landed wherever the teacher happened to come
   * from, and on the ordinary dashboard -> class -> activity path the class
   * screen's own back button would afterwards walk forward into the activity
   * again, because that was genuinely the previous entry.
   */
  const exitTo = classId ? `/teacher/class/${classId}` : '/teacher/dashboard';
  const needsClassPicker = !isEditMode && !classIdFromUrl;
  const fileInputRef = useRef(null);
  const rubricFileRef = useRef(null);
  const [isLoadingEdit, setIsLoadingEdit] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [topics, setTopics] = useState([]);
  /**
   * Whether the retired DepEd competency list has been answered for.
   *
   * 'loading' | 'ready' | 'failed'. An empty `topics` on its own cannot tell
   * the three apart, and the difference decides whether a tag this form does
   * not recognise is drawn yet: while the list is still on its way it may
   * still turn out to have a name, so drawing it as a raw slug would flicker.
   * A failed fetch is treated as answered — the chip loses its label and
   * nothing else, which beats hiding a tag the teacher is still marked against.
   */
  const [topicsStatus, setTopicsStatus] = useState('loading');
  const [classLessons, setClassLessons] = useState([]);
  /**
   * Whether the class's lesson list has actually been answered for.
   *
   * An empty `classLessons` cannot tell "this class has no curriculum" apart
   * from "the fetch has not come back yet", and the difference decides what
   * gets written to Activity.classLessonId on save. Without it, opening an
   * activity for edit and pressing Save before the lessons arrived resolved
   * the mapped lesson to nothing and cleared the column — taking the lesson's
   * rubric and the AI's lesson context with it.
   */
  const [lessonsLoaded, setLessonsLoaded] = useState(false);
  // Declared before the rubric resolver below, which reads form.type and form.topic.
  const [form, setForm] = useState({
    title: '',
    // Blank, not 'Essay'. A pre-filled Type is a decision the form made and the
    // teacher never did — and it is the field the gradebook groups columns by,
    // so a quiz left on the default kept getting averaged in with the essays
    // with nothing on screen looking wrong. Nothing fills this in any more:
    // ticking a lesson used to overwrite it from the curriculum file's
    // extracted output type, and that is gone too (see toggleTopic).
    type: '',
    topic: '',
    // Which grading term this activity belongs to: '1' | '2' | '3', or '' for
    // not yet chosen. A string because it rides through FormData on create,
    // which stringifies everything anyway — the server normalises it.
    term: '',
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

  // form.topic is the stored shape — a comma-separated list of ids — so that
  // the submit path keeps posting the form object untouched. Everything below
  // is derived from it rather than tracked alongside it, which is what stops
  // the two from drifting when an activity is loaded for editing.
  const selectedTopicIds = parseTopicIds(form.topic);

  /**
   * What this activity can be tagged with: the class's own curriculum lessons.
   *
   * One source now, where there used to be two. The other was a hardcoded
   * DepEd competency list in server/depedTopics.js, which existed for one
   * reason: the curriculum extraction read past the Learning Competencies
   * column of the uploaded document, so a lesson reached the AI as a one-line
   * description and something had to supply the actual marking criteria. That
   * list covered Grade 6 English and nothing else, so every other subject had
   * no competencies at all — and the two controls asked what teachers rightly
   * read as the same question twice.
   *
   * The extraction keeps that column now (see normalizeCompetencies on the
   * server), so a lesson carries its own competencies, from the school's own
   * scope and sequence, in every subject. One list, one source, and the
   * competencies are shown on the row so it is visible what the AI will mark
   * against. Competencies tagged before this change still resolve for display
   * — see legacyTopicName — they are simply no longer offered.
   *
   * `term` is what the picker filters on. A lesson records a week number and no
   * term, so its term is inferred (see termForWeek); a lesson with no week at
   * all is placed in every term rather than hidden from all of them.
   */
  // `detail` no longer carries the lesson's output type. The curriculum
  // document's idea of what a week produces is a suggestion extracted by the
  // AI, and printing it here beside a checkbox read as an instruction — while
  // the teacher setting the activity is the one who decides whether this piece
  // of work is an essay, a summary or a short answer. The Type field above is
  // where that decision is made and it is theirs alone; see toggleTopic.
  const coverageOptions = classLessons.map(l => ({
    id: lessonTopicId(l.id),
    name: lessonDisplayName(l),
    detail: null,
    term: termForWeek(l.weekNumber),
    competencies: readCompetencies(l.competencies),
    lesson: l,
  }));
  const coverageById = new Map(coverageOptions.map(o => [o.id, o]));
  const selectedCoverage = selectedTopicIds.map(id => coverageById.get(id)).filter(Boolean);

  // Filtered to the chosen term. Before a term is picked everything is shown,
  // so the control is never empty at the moment it first appears; a lesson that
  // cannot be placed in a term stays visible in every term rather than becoming
  // unreachable.
  //
  // Anything already ticked survives the filter whatever its term. A teacher
  // who tags a Term 2 lesson and then switches the activity to Term 1 has not
  // untagged it — and a tag that is on the activity but not on the screen is
  // one they cannot see, cannot remove, and will still be marked against.
  const visibleCoverage = form.term
    ? coverageOptions.filter(o =>
        o.term === null ||
        String(o.term) === String(form.term) ||
        selectedTopicIds.includes(o.id))
    : coverageOptions;

  /**
   * The lesson that supplies the rubric, the output type and the AI's lesson
   * context — the single `Activity.classLessonId`.
   *
   * Derived from the ticked lessons rather than held separately, so the one
   * stored on the row and the ones shown in the checklist cannot disagree.
   * First ticked wins; the rest ride along in `topic` and reach the grading
   * prompt through the "ALSO COVERS" block.
   */
  const selectedLessonIds = selectedTopicIds
    .map(lessonIdFromTopicId)
    .filter(Boolean)
    // Checked against the real list only once there is one to check against.
    // Filtering unconditionally meant that in the window before the lessons
    // arrived every tag looked stale, so a save in that window wrote null over
    // a perfectly good lesson mapping.
    .filter(id => !lessonsLoaded || classLessons.some(l => l.id === id));
  const selectedLessonId = selectedLessonIds[0] || '';
  const selectedLesson = classLessons.find(l => l.id === selectedLessonId) || null;

  /**
   * The name of a competency tagged before the list stopped being offered.
   *
   * /api/topics is still fetched for exactly this: an activity a Grade 6
   * English teacher tagged last term holds ids like `t1-02-hyperbole-irony`,
   * and dropping the map outright would redraw those as raw slugs on the one
   * screen where they can be removed. Read-only — nothing here can add one.
   */
  const legacyTopicName = (id) => topics.find(t => t.id === id)?.name || null;

  // Tags that resolve against no lesson: a retired DepEd competency, free text
  // typed into the quick-edit form, or a lesson deleted when the curriculum was
  // re-parsed. Shown as removable chips rather than dropped, so nothing sits on
  // the activity that the teacher cannot see or undo.
  //
  // Only once the legacy list has been answered for. An id cannot be called
  // unnameable while the thing that would name it is still loading — or never
  // loaded.
  //
  // 'failed' counts as answered here, not as still loading. The list is only a
  // source of names now, so a fetch that never returned costs the chip its
  // label and nothing else — hiding the tag instead would be strictly worse.
  const unknownTopicIds = topicsStatus === 'loading'
    ? []
    : selectedTopicIds.filter(id => !coverageById.has(id));

  // Tags that cannot be drawn yet, because the list that names them has not
  // arrived. Distinct from unknownTopicIds: these are not unknown, only
  // unresolved, and the difference is what the panel below says out loud.
  const unresolvedTopicIds = topicsStatus === 'loading'
    ? selectedTopicIds.filter(id => !coverageById.has(id))
    : [];

  // Whether this class can answer the coverage question at all. A class whose
  // curriculum has not been uploaded or parsed has nothing to offer, so the
  // field is not shown — and not required. Tags that came from somewhere else
  // count too: they are on the activity, so they have to be on screen where
  // they can be removed.
  const lessonTopicApplies =
    coverageOptions.length > 0 || unknownTopicIds.length > 0 || unresolvedTopicIds.length > 0;

  /**
   * Tick or untick one lesson this activity covers.
   *
   * Ticking one used to also overwrite the activity's Type with the lesson's
   * outputType, carried over from the old single-select lesson dropdown. That
   * is gone. Two reasons, and the second is the one that matters:
   *
   *   - outputType is not the school's word. It is inferred by the AI when the
   *     curriculum document is parsed, so what it silently applied was a guess
   *     about a week's intended output, not a decision anybody made.
   *   - it overwrote a field the teacher had already filled in. Set the Type to
   *     Short Answer, then tick the week whose extracted output says Summary,
   *     and the Type changed underneath — a control moving on its own while
   *     they were looking somewhere else, with the gradebook column and the
   *     grading prompt both following it.
   *
   * Type is now only ever what the teacher chose. Ticking a lesson does what it
   * says on the label: it records the competencies this work is marked against.
   */
  const toggleTopic = (id) => {
    const removing = selectedTopicIds.includes(id);

    setForm(prev => {
      const current = parseTopicIds(prev.topic);
      const next = removing ? current.filter(t => t !== id) : [...current, id];
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
      showAlert('Every rubric criterion needs a name.');
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
  // The document's own total, when the weights had to be rebased off it. null
  // when the rubric already totalled 100, or when nothing has been uploaded.
  // Said out loud rather than done quietly: the numbers on screen no longer
  // match the paper in the teacher's hand, and they should know why.
  const [weightsScaledFrom, setWeightsScaledFrom] = useState(null);
  // Set instead of weightsScaledFrom when the criteria came back as equal
  // shares of this activity's Total Points rather than as percentages of 100.
  // Two pieces of state rather than one flag, because the two notices say
  // opposite things about what was kept: one keeps the document's shares, the
  // other deliberately does not.
  const [weightsEqualisedTo, setWeightsEqualisedTo] = useState(null);

  // Save-as-template modal state
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateTitle, setTemplateTitle] = useState('');

  // ── The retired DepEd competency list, fetched only to name old tags ──
  //
  // This list is no longer offered for tagging — see coverageOptions — but
  // activities tagged from it before it was retired still hold ids like
  // `t1-02-hyperbole-irony`, and this is the screen where those can be seen and
  // removed. Without the names they would redraw as raw slugs.
  useEffect(() => {
    apiFetch(`${API_URL}/api/topics`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) return setTopicsStatus('failed');
        setTopics(data.topics);
        setTopicsStatus('ready');
      })
      // Was swallowed silently, which is what made an offline load
      // indistinguishable from a class that simply has no old tags. The tags on
      // the activity are left exactly as they are either way — see the note on
      // topicsStatus.
      .catch(() => setTopicsStatus('failed'));
  }, []);

  // Fetch class lessons from parsed curriculum
  useEffect(() => {
    if (!classId) return;
    apiFetch(`${API_URL}/api/teacher/classes/${classId}/lessons`)
      .then(res => res.json())
      .then(data => { if (data.success) setClassLessons(data.lessons || []); })
      .catch(() => {})
      // Answered either way. A failed read must not leave the form believing
      // the list is still on its way, or the guard above never lifts.
      .finally(() => setLessonsLoaded(true));
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
          // Empty, not 'Essay'. Same reason as the blank default above: an
          // activity saved without a type is one nobody chose a type for, and
          // filling it in on open would put an answer in front of the teacher
          // that the record does not actually contain.
          type: activity.type || '',
          // A legacy activity carries its lesson only in classLessonId, and the
          // checklist below reads lessons out of `topic`. Folding it in on
          // open is what makes that lesson appear ticked rather than missing —
          // and saving writes it back to both, so nothing is lost either way.
          topic: formatTopicIds(
            activity.classLessonId
              ? [...parseTopicIds(activity.topic), lessonTopicId(activity.classLessonId)]
              : activity.topic
          ),
          term: activity.term == null ? '' : String(activity.term),
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
        if (activity.rubric) {
          try {
            const parsed = JSON.parse(activity.rubric);
            if (parsed.criteria?.length) {
              setRubricCriteria(parsed.criteria);
              setRubricType(rubricTypeOf(parsed, parsed.criteria));
              if (parsed.source) setRubricMode(parsed.source);
              // Upload mode reads from extractedCriteria and nothing else — see
              // activeCriteria — so a rubric saved from an uploaded file has to
              // be loaded into it, or reopening that activity shows an empty
              // dropzone where its criteria should be. They arrive editable and
              // named as read from a file, which is what they are.
              if (parsed.source === 'upload') setExtractedCriteria(parsed.criteria);
              setSelectedOption('custom');
            }
          } catch { /* a rubric that will not parse leaves the editor as it is */ }
        }
      })
      .catch(() => setLoadError('Could not reach the server, so this activity has not been loaded.'))
      .finally(() => setIsLoadingEdit(false));
  }, [isEditMode, editActivityId]);

  // ── Rubric helpers ──
  /**
   * Whichever list the editor on screen is editing — the same one activeCriteria
   * reads, and keyed the same way, so an edit can never land in the list the
   * save path is ignoring. `prev || []` because Upload mode's list starts as
   * null; the editor is not drawn in that state, so this is a guard and not a
   * path anyone reaches.
   */
  const editCriteria = (fn) => {
    const setter = rubricMode === 'upload' ? setExtractedCriteria : setRubricCriteria;
    setter(prev => fn(prev || []));
  };
  const updateCriterion = (idx, field, val) => {
    editCriteria(prev => prev.map((c, i) => i === idx ? { ...c, [field]: field === 'points' ? parseInt(val) || 0 : val } : c));
  };
  const addCriterion = () => {
    const newCriterion = rubricType === 'range'
      ? { name: '', description: '', points: 0, bands: DEFAULT_RANGE_BANDS.map(b => ({ ...b })) }
      : { name: '', description: '', points: 0 };
    editCriteria(prev => [...prev, newCriterion]);
  };
  const removeCriterion = (idx) => {
    editCriteria(prev => prev.filter((_, i) => i !== idx));
  };
  const updateBand = (criterionIdx, bandIdx, field, val) => {
    editCriteria(prev => prev.map((c, ci) => {
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

  /**
   * The rubric this form is actually working on, and the only list the save
   * path reads.
   *
   * Keyed on the mode alone. It used to fall back to `rubricCriteria` whenever
   * `extractedCriteria` was null, which meant that in Upload mode — before a
   * file was picked, while it was being read, and permanently after a failed
   * read — the form quietly went on holding whatever the Template or Create tab
   * had left behind. Two ways that surfaced, both from this one line:
   *
   *  - A teacher who picked a school rubric and then switched to Upload could
   *    press Publish with nothing uploaded. The summary card said "No rubric
   *    yet" while the save wrote the template's criteria under source 'upload' —
   *    a rubric they were told they did not have, mislabelled as a file they
   *    never sent, and thereafter exempt from the 100% rule validateRubric
   *    applies to hand-built ones.
   *  - Create mode leaves one blank criterion behind, so the same switch made
   *    Publish fail on "Every rubric criterion needs a name" — with no criterion
   *    fields on screen to fix, because Upload mode only draws them for
   *    extracted criteria. A dead end you could only leave by guessing.
   *
   * `rubricCriteria` is left untouched rather than cleared, so switching back to
   * Create or Template still finds the work that was there.
   */
  const activeCriteria = rubricMode === 'upload' ? (extractedCriteria || []) : rubricCriteria;
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
    setWeightsScaledFrom(null);
    setWeightsEqualisedTo(null);

    try {
      const fd = new FormData();
      fd.append('rubricFile', file);
      // What the criteria are divided into. With it, they come back as equal
      // shares of this activity's own mark and the rubric total IS the activity
      // total; without it (an empty Total Points box) the server falls back to
      // percentage weights, which is what it has always done.
      if (form.points) fd.append('activityPoints', String(form.points));
      const res = await apiFetch(`${API_URL}/api/teacher/rubric/extract`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success && data.criteria) {
        setExtractedCriteria(data.criteria);
        if (data.rubricType) setRubricType(data.rubricType);
        // The activity's Total Points is deliberately NOT touched here. It used
        // to be overwritten with the uploaded document's own total, so a teacher
        // who had set a 50-point activity and then attached a rubric written out
        // of 20 found their activity silently reworth 20 — a rubric is what the
        // work is judged against, not how much it is worth, and the two are
        // separate fields for that reason. The traffic runs the other way now:
        // Total Points is what the criteria are divided into.
        //
        // Exactly one of these is ever set. divideEqually ran (the criteria are
        // equal shares of this activity's mark), or scaleCriteriaTo100 did (they
        // are percentages keeping the document's own shares), or neither did —
        // a banded rubric is left exactly as the document wrote it.
        setWeightsEqualisedTo(data.weightsEqualised ? data.equalisedTo : null);
        setWeightsScaledFrom(!data.weightsEqualised && data.weightsScaled ? data.totalPoints : null);
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
    setWeightsScaledFrom(null);
    setWeightsEqualisedTo(null);
    if (rubricFileRef.current) rubricFileRef.current.value = '';
  };

  // ── Save as template ──
  const handleSaveAsTemplate = () => {
    if (!activeCriteria.length) return;
    setTemplateTitle(form.title ? `${form.title} Rubric` : 'My Custom Rubric');
    setShowSaveTemplateModal(true);
  };

  const confirmSaveTemplate = async () => {
    const criteriaToSave = activeCriteria;
    if (!criteriaToSave.length) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return showAlert('User not found. Please log in again.');

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
        showAlert(`"${savedTemplate.name}" has been saved to cloud templates.`, { variant: 'success' });
      } else {
        showAlert('Failed to save template: ' + data.error);
      }
    } catch {
      showAlert('Network error while saving template.');
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
      showAlert(loadError || 'This activity is still loading. Please wait before saving.');
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
      showAlert('Add a grading rubric before publishing. Pick one of your school\'s rubrics, reuse a saved template, or write your own — this is what the paper gets marked against.');
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
        showAlert(`Rubric weight must total 100%. Currently it is ${totalPercentage}%.`);
        return;
      }
      if (!activeCriteria.every(c => c.name?.trim())) {
        showAlert('Every rubric criterion needs a name.');
        setShowRubricEditor(true);
        return;
      }
      // `> 0` rather than `<= 0`: NaN fails both, and the version that asked
      // `<= 0` therefore let a broken total through instead of catching it.
      if (!(totalPercentage > 0)) {
        showAlert('The rubric criteria add up to zero, so nothing could be scored against it.');
        setShowRubricEditor(true);
        return;
      }
    }
    if (!form.points || form.points < 1) {
      showAlert("Total Points must be greater than 0.");
      return;
    }
    // The lesson and the competencies are two controls answering one required
    // question, so neither can carry `required` on its own — either alone is a
    // complete answer. Only asked where the class has something to answer with:
    // a class whose only possible answer was the competency list is let through
    // when that list failed to load, or the teacher is held at a question with
    // no answerable control on the screen.
    if (coverageOptions.length > 0 && selectedTopicIds.length === 0) {
      showAlert('Say what this activity covers — tick at least one lesson from the curriculum.');
      return;
    }
    // Required, because the gradebook's term filter and every term-scoped
    // export read this column: an activity left untagged is one that quietly
    // drops out of the term record a teacher assembles from them. Asked here
    // rather than with `required` on the buttons, so the message can say why.
    if (!form.term) {
      showAlert('Choose which term this activity belongs to. The gradebook and its exports are filtered by term, and an activity with none is left out of all of them.');
      return;
    }
    // Same shape as the term check above, and asked for the same reason: the
    // gradebook shows one column per type, so an activity without one has no
    // column to sit in.
    if (!form.type) {
      showAlert('Choose what kind of work this is. The gradebook shows one column per type, so an activity without one has nowhere to sit.');
      return;
    }
    // Trimmed, because the textarea's own `required` is satisfied by a space.
    if (!form.instructions.trim()) {
      showAlert('Write the instructions students will follow. They are what the work is set against, and the AI reads them when it checks the papers.');
      return;
    }
    // A badge with no usable bar would be saved as unreachable, which looks
    // exactly like a badge that works right up until nobody ever earns it.
    // Mirrored by parsePassingScore on the server, which is what enforces it.
    if (form.badgeId) {
      const bar = Number(form.badgePassingScore);
      if (!Number.isInteger(bar) || bar < 1 || bar > 100) {
        showAlert('Set the score that earns the badge — a whole number from 1 to 100.');
        return;
      }
    }
    // An activity has to belong to a real class. This used to fall back to the
    // string 'mock-class-id', which the database rejected on the foreign key
    // after the teacher had filled the entire form in.
    if (!isEditMode && !classId) {
      showAlert(teacherClasses.length === 0
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
          // activeCriteria, so what is saved is what the form validated and what
          // the summary card named — see the note on it for the three ways those
          // came apart when this read the two lists for itself.
          criteria: normalizeCriteria(activeCriteria)
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
        if (data.success) navigate(exitTo);
        else showAlert('Error: ' + data.error);
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
        if (data.success) navigate(exitTo);
        else showAlert('Error: ' + data.error);
      }
    } catch { showAlert('Network error'); }
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
      {/* Same rule as ClassHub's: the link names a place, so it goes to that
          place rather than to whatever the previous history entry happens to
          be. Falls back to the dashboard only when there is no class to go
          back to — /teacher/activity/new is reachable without one. */}
      <button onClick={() => navigate(exitTo)}
        className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> {classId ? 'Back to Class' : 'Back to Dashboard'}
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
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Type <span className="text-red-500">*</span>
              </label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                <option value="">-- Select --</option>
                {ACTIVITY_TYPES.map(t => <option key={t}>{t}</option>)}
                {/* An activity saved before the Type field became the
                    teacher's alone can carry a type this list never had (it
                    came from a lesson's extracted outputType). Keep it
                    selectable so opening such an activity does not silently
                    rewrite it to Essay. */}
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

          {/* ── TERM ──
              Universal: every DepEd school runs three terms, whatever the
              subject, so unlike the competency list below this is asked of
              every class. It does two jobs at once — it is what the gradebook
              and its exports filter on, and it narrows the checklist under it
              from a whole year of curriculum to one term's worth, which is the
              thing that made that list unusable. */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Term <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3].map(t => {
                const active = String(form.term) === String(t);
                return (
                  <button key={t} type="button"
                    onClick={() => setForm(f => ({ ...f, term: String(t) }))}
                    aria-pressed={active}
                    className={cn(
                      'px-5 py-2 rounded-lg text-sm font-bold border transition-colors',
                      active
                        ? 'bg-brand-navy text-white border-brand-navy'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-brand-navy'
                    )}>
                    Term {t}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              The gradebook and its exports are filtered by term. Picking one also narrows the
              list below to that term&rsquo;s curriculum.
            </p>
          </div>

          {/* ── WHAT THIS ACTIVITY COVERS ──
              One checklist over one source: the lessons in this class's own
              curriculum, ticked as many as apply.

              There used to be a second control beside it — a hardcoded DepEd
              Grade 6 English competency list — and it existed because the
              curriculum extraction read past the Learning Competencies column
              of the uploaded document. A lesson reached the AI as a one-line
              description, so something had to supply the actual marking
              criteria, and the only thing that could covered one subject out of
              every subject a school teaches. Teachers were right that the two
              controls asked the same question twice.

              The extraction keeps that column now, so a lesson carries its own
              competencies in every subject, from the school's own scope and
              sequence. They are printed under the lesson because they are what
              the AI will be held to — a teacher ticking a box should be able to
              see what they are agreeing to mark against. */}
          {/* No curriculum parsed for this class, so there is nothing to tick.
              Said out loud rather than by hiding the field. Until the DepEd
              competency list was retired, a Grade 6 English class with no
              uploaded curriculum still had that list to fall back on; now the
              lessons are the only source, and a class without them tags
              nothing — which means the AI marks this work against its
              instructions and rubric alone. That is a real reduction in the
              quality of the feedback, and a teacher is owed the reason and the
              fix rather than an absent control they never knew existed. */}
          {!lessonTopicApplies && lessonsLoaded && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800 leading-relaxed">
                <span className="font-semibold">No curriculum lessons for this class.</span>{' '}
                Activities here cannot be tagged to a lesson, so the AI marks them against your
                instructions and rubric only — without the Learning Competencies it would otherwise
                be held to. Upload and parse this class&rsquo;s curriculum, or ask your admin to add
                one for {classMeta?.subject || 'this subject'}, and the lessons will appear here.
              </p>
            </div>
          )}

          {lessonTopicApplies && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  What this activity covers <span className="text-red-500">*</span>
                </label>
                {/* Required only where the question can actually be answered.
                    The guard above already hides the whole field for a class
                    whose curriculum has not been parsed, so this never becomes
                    a dead end. Enforced on submit rather than with `required`
                    on a checkbox, which cannot express "at least one of these". */}
                <p className="text-xs text-slate-400 mt-0.5">
                  Tick every lesson this work is set against. The AI is held to their competencies,
                  and the activity is counted under each in analytics.
                </p>
              </div>

              {visibleCoverage.length > 0 ? (
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-500">
                      {form.term ? `Term ${form.term} lessons` : 'Curriculum lessons'}
                    </label>
                    {selectedCoverage.length > 0 && (
                      <span className="text-[11px] font-bold text-brand-navy">{selectedCoverage.length} selected</span>
                    )}
                  </div>
                  {/* A checklist rather than a multi-select box: a native
                      multi-select needs ctrl-click to add a second item and
                      silently drops the rest of the selection on a plain click,
                      which on a phone means it cannot be used at all. */}
                  <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {visibleCoverage.map(o => {
                      const checked = selectedTopicIds.includes(o.id);
                      return (
                        <label key={o.id}
                          className={cn('flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                            checked ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                          <input type="checkbox" checked={checked} onChange={() => toggleTopic(o.id)}
                            className="w-4 h-4 mt-0.5 shrink-0 accent-royal-500" />
                          <span className="min-w-0">
                            <span className="block text-sm text-slate-700 leading-snug">{o.name}</span>
                            {(o.detail || (!form.term && o.term)) && (
                              <span className="block text-[11px] text-slate-400">
                                {o.detail}
                                {o.detail && !form.term && o.term ? ' · ' : ''}
                                {!form.term && o.term ? `Term ${o.term}` : ''}
                              </span>
                            )}
                            {/* What the AI will actually mark for. Printed
                                rather than summarised: these are copied
                                verbatim from the curriculum guide, and a
                                teacher agreeing to them should see the same
                                words the model will. */}
                            {o.competencies.length > 0 ? (
                              <span className="block mt-1 text-[11px] text-slate-500 leading-snug">
                                {o.competencies.map((c, i) => (
                                  <span key={i} className="block">• {c}</span>
                                ))}
                              </span>
                            ) : (
                              /* Said out loud, because a lesson with no
                                 competencies grades against its description
                                 alone — weaker feedback, and not obvious from
                                 a row that otherwise looks identical. */
                              <span className="block mt-1 text-[11px] text-amber-700">
                                No competencies found for this lesson in the curriculum file — the AI
                                will mark against its description only.
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedLesson && (
                    <p className="text-xs text-slate-400 mt-1">
                      Output type comes from &ldquo;{selectedLesson.title}&rdquo;
                      {selectedLessonIds.length > 1 && `, the first of ${selectedLessonIds.length} lessons ticked`}.
                    </p>
                  )}
                </div>
              ) : coverageOptions.length > 0 ? (
                /* Everything was filtered away by the term picker — a real
                   state, not an empty curriculum, and one that reads as a
                   broken control unless it says so. */
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  No lesson in this class&rsquo;s curriculum is scheduled for Term {form.term}.
                  Pick another term, or ask your admin to check the uploaded scope and sequence.
                </p>
              ) : null}

              {topicsStatus === 'loading' && unresolvedTopicIds.length > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading the tags on this activity&hellip;
                </p>
              )}

              {unknownTopicIds.length > 0 && (
                <div>
                  {/* Tags from before the competency list was retired, plus
                      anything typed in elsewhere. Read-only and removable:
                      nothing here can be added back, but an activity tagged
                      last term must not have those tags silently vanish from
                      the one screen where they can be seen. */}
                  <p className="text-xs font-medium text-slate-500 mb-1">Other tags on this activity</p>
                  <div className="flex flex-wrap gap-2">
                    {unknownTopicIds.map(id => (
                      <span key={id} className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                        {isLessonTopicId(id) ? 'Removed curriculum lesson' : (legacyTopicName(id) || id)}
                        <button type="button" onClick={() => toggleTopic(id)} aria-label={`Remove ${id}`}
                          className="text-slate-400 hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    From a DepEd competency list this app no longer offers, or typed in elsewhere.
                    They still tag the activity and still count in analytics.
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Deadline {form.submissionMode === 'STUDENT_SUBMIT' && <span className="text-red-500">*</span>}
            </label>
            {/* min: Philippine today, not UTC today — before 8 AM in Manila the
                two are different days, and the UTC one let a teacher setting up
                before class pick a due date that had already passed. The quick
                edit in ClassHub uses the same floor. */}
            <input type="date" value={form.deadline}
              onChange={e => {
                const deadline = e.target.value;
                // A late window that closes before the due date would refuse
                // work that was never late, so drop it rather than keep a
                // combination the server will silently discard anyway.
                setForm(f => ({ ...f, deadline, lateUntil: f.lateUntil && deadline && f.lateUntil < deadline ? '' : f.lateUntil }));
              }}
              min={form.submissionMode === 'STUDENT_SUBMIT' ? todayInPH() : undefined}
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
                editCriteria(prev => prev.map(c => c.bands && c.bands.length ? c : { ...c, bands: DEFAULT_RANGE_BANDS.map(b => ({ ...b })) }));
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

              {/* The weights were rebased. Explained where the changed numbers
                  are, because the criteria on screen no longer match the
                  document the teacher just uploaded, and an unexplained "25"
                  where the paper says "4" reads as a misreading rather than as
                  arithmetic. Says what it kept, which is the part that
                  matters — the shares are the rubric. */}
              {weightsScaledFrom != null && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm text-blue-800 leading-relaxed">
                    Your rubric adds up to <strong>{weightsScaledFrom}</strong>, so the criteria below have
                    been converted to percentages of 100 — each one keeps exactly the share of the mark it
                    had in your document. Your activity is still worth <strong>{form.points} points</strong>;
                    that is set in Total Points above and a rubric never changes it.
                  </p>
                </div>
              )}

              {/* The criteria were re-pointed as equal shares of this activity's
                  mark. Said plainly, and said as a change rather than as a
                  reading, because the numbers on screen are deliberately NOT
                  the document's: a teacher who uploaded a 40/30/30 rubric and
                  sees 17/17/16 needs to know that was done on purpose and that
                  they can put it back. */}
              {weightsEqualisedTo != null && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm text-blue-800 leading-relaxed">
                    The criteria below have been divided <strong>equally</strong> into this activity&apos;s{' '}
                    <strong>{weightsEqualisedTo} points</strong>, so the rubric adds up to exactly what the
                    activity is worth and each criterion is marked out of real points rather than a
                    percentage. Any uneven remainder goes to the first criteria, so the total lands exactly.
                    If your document weighted them differently, edit the points below — they are yours to set.
                  </p>
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
          <button type="button" onClick={() => navigate(exitTo)}
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
