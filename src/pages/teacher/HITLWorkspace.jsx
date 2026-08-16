import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Edit2, Info, Sparkles, X, Send, Bot, Loader2, CheckCircle2, ChevronDown, Plus, Trash2, AlertTriangle, SkipForward, Send as SendIcon, RefreshCw } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import SubmissionImage from '../../components/SubmissionImage';
import { ONBOARDING, hasSeenOnboarding, markOnboardingSeen } from '../../utils/onboarding';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Confetti particle positions, generated once at module load.
 *
 * These were four Math.random() calls inside the render body, which re-rolled
 * every particle on every re-render while the celebration was on screen — the
 * confetti visibly teleported rather than falling. Fixed values also make the
 * render pure, which is what React's own lint rules are asking for here.
 */
const CONFETTI = Array.from({ length: 40 }, () => ({
  left: Math.random() * 100,
  duration: 2 + Math.random() * 3,
  delay: Math.random() * 1.5,
  rotation: Math.random() * 360,
}));

/** Try to parse structured AI feedback JSON. Returns null if plain string or if it contains an AI error. */
function parseStructuredFeedback(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.includes('⚠ AI grading is currently unavailable')) return null;

  try {
    let cleanRaw = raw.trim();
    if (cleanRaw.startsWith('```')) {
      const lines = cleanRaw.split('\n');
      if (lines.length > 2) {
        cleanRaw = lines.slice(1, -1).join('\n').trim();
      }
    }
    const obj = JSON.parse(cleanRaw);
    if (obj && typeof obj === 'object' && 'strengths' in obj) {
      return {
        strengths: obj.strengths || '',
        areasForGrowth: Array.isArray(obj.areasForGrowth) ? obj.areasForGrowth : [],
        actionableSteps: Array.isArray(obj.actionableSteps) ? obj.actionableSteps : [],
        skillExplanations: obj.skillExplanations && typeof obj.skillExplanations === 'object' ? obj.skillExplanations : {},
      };
    }
  } catch { /* not JSON */ }
  return null;
}

/** Serialize structured feedback back to a JSON string. */
function serializeStructuredFeedback(sf) {
  return JSON.stringify({
    strengths: sf.strengths,
    areasForGrowth: sf.areasForGrowth,
    actionableSteps: sf.actionableSteps,
    skillExplanations: sf.skillExplanations,
  });
}

/**
 * Everything on this screen a teacher can actually change, as one comparable
 * string: the criterion scores, the feedback and the reading strategy.
 *
 * Scores are sorted by criterion name because object key order is not
 * meaningful — a rubric read back in a different order is the same mark, and
 * must not read as an edit.
 */
function editSnapshot({ scores, readingStrategy, feedback }) {
  const orderedScores = Object.keys(scores || {}).sort()
    .map(key => [key, scores[key]]);
  return JSON.stringify({ orderedScores, readingStrategy: readingStrategy || '', feedback: feedback || '' });
}

/** Build a flat text summary for the AI Co-Pilot context window. */
function flattenFeedback(sf) {
  const parts = [];
  if (sf.strengths) parts.push(`Strengths: ${sf.strengths}`);
  if (sf.areasForGrowth.length) {
    parts.push('Areas for Growth: ' + sf.areasForGrowth.map(a => `"${a.studentQuote}" — ${a.explanation}`).join('; '));
  }
  if (sf.actionableSteps.length) {
    parts.push('Action Steps: ' + sf.actionableSteps.join('; '));
  }
  return parts.join('\n');
}

const EMPTY_STRUCTURED = { strengths: '', areasForGrowth: [], actionableSteps: [], skillExplanations: {} };

export default function HITLWorkspace() {
  const navigate = useNavigate();
  const { submissionId } = useParams();

  // ── Review queue ──
  // Arriving with ?queue=<activityId> turns this screen into a run through the
  // whole activity instead of a single paper: validating advances to the next
  // unreviewed paper rather than dropping the teacher back on the roster. A
  // teacher working 45 papers should press one button per paper, not three.
  const [searchParams] = useSearchParams();
  const queueActivityId = searchParams.get('queue');
  const [queue, setQueue] = useState([]);          // [{ id, studentName, reviewed }]
  const [skipped, setSkipped] = useState([]);      // submission ids passed over this run
  // Submission ids validated during this run. The queue's own `reviewed` flags
  // come from the server on each navigation; this is what the screen knows
  // first-hand, so the run can never be sent back to a paper it just finished
  // because a re-read had not caught up yet.
  const [reviewedNow, setReviewedNow] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [releaseState, setReleaseState] = useState(null);  // { total, reviewed, released, readyToRelease }
  const [isReleasing, setIsReleasing] = useState(false);
  const [isReleasingOne, setIsReleasingOne] = useState(false);

  const [submission, setSubmission] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Structured feedback state
  const [structuredFeedback, setStructuredFeedback] = useState({ ...EMPTY_STRUCTURED });
  const [isStructured, setIsStructured] = useState(false);
  // Legacy plain-text fallback
  const [legacyFeedbackText, setLegacyFeedbackText] = useState('');

  const [readingStrategy, setReadingStrategy] = useState('');
  // Starts empty, not at a plausible-looking 35/25/25. Those invented mid-band
  // numbers survived every branch that didn't explicitly reset them — a
  // submission with no rubricData landed on the review screen already showing
  // 85/100, which a teacher could approve and release without anything ever
  // having been assessed.
  const [scores, setScores] = useState({});
  const [dynamicRubric, setDynamicRubric] = useState(null);
  const [isEditingAssessment, setIsEditingAssessment] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([
    { role: 'ai', text: "Hi! I'm your AI Co-Pilot. Tell me how you'd like to improve this feedback." }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  /** Why the last validate attempt did not record a mark. '' when all is well. */
  const [saveError, setSaveError] = useState('');
  const [covData, setCovData] = useState(null);
  const [skillAnalysisOpen, setSkillAnalysisOpen] = useState(false);
  // Read straight from the onboarding store on first render: shown once, so
  // there is nothing to re-check later and nothing worth a spare render pass.
  const [showTooltip, setShowTooltip] = useState(() => !hasSeenOnboarding(ONBOARDING.TEACHER_COPILOT_TIP));
  const [showCelebration, setShowCelebration] = useState(false);
  const chatEndRef = useRef(null);

  // Replacing the photo is not done from here.
  //
  // This screen is for reading the paper and deciding the mark; swapping the
  // paper underneath a score that has already been checked is a different act,
  // and it belongs where the papers are collected — the upload roster, which
  // has Replace on every learner's row. Keeping a second entry point here meant
  // the picker, the rasterizer and the redaction queue all had to be repeated
  // on a screen whose job is review.
  // Set once the image reports its own dimensions, so a stitched multi-page
  // scan can say so instead of silently showing page one.
  const [isLongScan, setIsLongScan] = useState(false);

  // What this paper looked like when it was loaded (or last saved). The button
  // at the bottom offers to "Save Changes" only when there are changes; without
  // this it said so on every already-validated paper in a run, so a teacher
  // reading through a finished set was asked to save work they had not touched
  // — and each press wrote an identical grade to the record.
  const [baseline, setBaseline] = useState(null);

  // Computed feedbackText for AI Co-Pilot & backwards compat
  const feedbackText = isStructured ? flattenFeedback(structuredFeedback) : legacyFeedbackText;

  // Whether anything has been touched since this paper was loaded or last
  // saved. Compared against the snapshot rather than tracked by each editor, so
  // a value typed and then typed back is correctly not an edit.
  const currentSnapshot = editSnapshot({
    scores,
    readingStrategy,
    feedback: isStructured ? serializeStructuredFeedback(structuredFeedback) : legacyFeedbackText,
  });
  const isDirty = baseline !== null && currentSnapshot !== baseline;

  useEffect(() => {
    // A failure belongs to the paper it happened on — carrying it onto the next
    // learner in a queue run would accuse a save that never ran.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
    setSaveError('');
    // Everything below describes ONE paper, and this screen is reused for the
    // next one in a run rather than remounted — so anything not cleared here
    // becomes a statement about the previous learner. `isApproved` was the
    // dangerous one: it was only ever set to true, so after the first validated
    // paper every subsequent paper in the run arrived already "approved". The
    // baseline is cleared alongside it so nothing reads as edited (or as
    // unedited) until this paper's own values have actually loaded.
    setIsApproved(false);
    setBaseline(null);
    setIsEditingAssessment(false);
    // The rest of one paper's working state. These feed the body of the save
    // request, so a value left over from the previous learner is not a display
    // glitch — it is another child's rubric scores being written to this
    // submission. Each is only assigned by the loader on the branches where the
    // paper actually carries one, so without clearing them here they persist.
    setScores({});
    setDynamicRubric(null);
    setCovData(null);
    setStructuredFeedback({ ...EMPTY_STRUCTURED });
    setLegacyFeedbackText('');
    setReadingStrategy('');
    setIsLongScan(false);
    if (!submissionId || submissionId === 'test123') {
      setLegacyFeedbackText("Your reflection on Crisostomo Ibarra's motivations was deep and insightful. However, the essay lacked clear paragraph transitions.");
      setReadingStrategy("Focus on 'Signpost Words' (however, therefore, consequently) in your next reading assignment.");
      setIsLoading(false);
      return;
    }
    apiFetch(`${API_URL}/api/submissions/${submissionId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.submission) {
          const sub = d.submission;
          setSubmission(sub);

          // Merge AI and HITL feedback
          let finalStructured = { strengths: '', areasForGrowth: [], actionableSteps: [], skillExplanations: {} };
          
          const parsedAi = parseStructuredFeedback(sub.aiFeedback);
          if (parsedAi) {
            finalStructured = { ...parsedAi };
          } else if (sub.aiFeedback) {
            finalStructured.strengths = sub.aiFeedback;
          }
          
          if (sub.hitlFeedback) {
            const parsedHitl = parseStructuredFeedback(sub.hitlFeedback);
            if (parsedHitl) {
              finalStructured = { ...parsedHitl };
            } else {
              // Teacher saved plain text override; put it in strengths, keep AI's arrays if they exist
              finalStructured.strengths = sub.hitlFeedback;
            }
          }
          
          if (finalStructured.strengths?.includes('⚠ AI grading is currently unavailable')) {
            finalStructured.strengths = '';
          }
          
          setStructuredFeedback(finalStructured);
          setIsStructured(true);

          setReadingStrategy(sub.readingStrategy || '');
          // Collected into one variable rather than set from four branches, so
          // the same values that land in the editor are the ones the baseline
          // below is taken from. A baseline read back out of state instead
          // would race the setters and mark an untouched paper as edited.
          let nextScores = null;
          if (sub.rubricData && sub.rubricData !== '[]') {
            try {
              const rd = JSON.parse(sub.rubricData);
              if (Array.isArray(rd)) {
                const initialScores = {};
                rd.forEach(r => initialScores[r.criterionName] = r.score);
                nextScores = initialScores;
                setDynamicRubric(rd);
              } else {
                // Absent criteria default to 0, not to invented mid-band scores.
                // These land straight in the editable score boxes, so a made-up
                // 35/25/25 is a grade the teacher can approve without ever
                // realising nothing was actually assessed.
                nextScores = { content: rd.content?.score ?? 0, organization: rd.organization?.score ?? 0, grammar: rd.grammar?.score ?? 0 };
              }
            } catch { /* unparseable rubricData leaves the editor as it is */ }
          } else if (sub.aiScore === null && sub.status === 'PENDING') {
            if (sub.activity?.rubric) {
              try {
                const parsedRubric = JSON.parse(sub.activity.rubric);
                if (parsedRubric.criteria?.length) {
                  const initialScores = {};
                  parsedRubric.criteria.forEach(c => initialScores[c.name] = 0);
                  nextScores = initialScores;
                } else {
                  nextScores = { content: 0, organization: 0, grammar: 0 };
                }
              } catch { nextScores = { content: 0, organization: 0, grammar: 0 }; }
            } else {
              nextScores = { content: 0, organization: 0, grammar: 0 };
            }
          }
          if (nextScores) setScores(nextScores);
          if (sub.covData) {
            try { setCovData(JSON.parse(sub.covData)); } catch { /* no COV data to show */ }
          }
          setIsApproved(sub.status === 'GRADED');
          setBaseline(editSnapshot({
            scores: nextScores || {},
            readingStrategy: sub.readingStrategy || '',
            feedback: serializeStructuredFeedback(finalStructured),
          }));
        }
      })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [submissionId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory]);

  /**
   * The rubric this submission is graded against, resolved once.
   *
   * Criterion scores are in the rubric's own points (a 15-point criterion is
   * scored 0–15), so the percentage is the sum over the rubric total — not the
   * sum itself. Treating the raw sum as a percentage happened to look right only
   * while a rubric added up to exactly 100; on any other rubric it silently
   * mis-scored the submission, and it was the number being saved as the
   * teacher's final grade.
   */
  const rubricItems = useMemo(() => {
    const palette = ['bg-brand-green', 'bg-amber-400', 'bg-blue-400', 'bg-purple-400', 'bg-pink-400'];

    if (dynamicRubric) {
      let activityCriteria = null;
      try {
        activityCriteria = submission?.activity?.rubric
          ? JSON.parse(submission.activity.rubric).criteria
          : null;
      } catch { /* the AI's own band text is the fallback */ }

      return dynamicRubric.map((r, i) => {
        let fullDesc = r.bandDescription;
        const criterion = activityCriteria?.find(c => c.name === r.criterionName);
        const band = criterion?.bands?.find(
          b => b.label?.toLowerCase() === r.bandDescription?.toLowerCase()
        );
        if (band?.description) fullDesc = `${band.label} — ${band.description}`;
        return { key: r.criterionName, name: r.criterionName, max: r.maxPoints, color: palette[i % 5], desc: fullDesc };
      });
    }

    // No AI result yet (e.g. the student-submit flow): fall back to the rubric
    // the activity is actually graded against, in the same order the AI uses —
    // the activity's own rubric, then the curriculum lesson's.
    for (const source of [submission?.activity?.rubric, submission?.activity?.classLesson?.defaultRubric]) {
      if (!source) continue;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (parsed?.criteria?.length) {
          return parsed.criteria.map((c, i) => ({
            key: c.name, name: c.name, max: c.points || 0, color: palette[i % 5], desc: c.description || '',
          }));
        }
      } catch { /* try the next source, then the legacy shape */ }
    }

    // Nothing, when the activity carries no rubric. There used to be a
    // Content/Organization/Grammar 40/30/30 here, and it was the same mistake
    // the AI grader made from the other end: a teacher marking by hand was
    // shown three criteria nobody at the school had chosen, and the grade saved
    // for that pupil was computed against them. An empty list is honest, and
    // the panel below says how to fix it.
    return [];
  }, [dynamicRubric, submission]);

  // Sum of the criterion scores, in rubric points.
  const totalScore = rubricItems.reduce((sum, item) => sum + (scores[item.key] || 0), 0);
  const rubricTotal = rubricItems.reduce((sum, item) => sum + (item.max || 0), 0);
  // The grade, as a percentage of the rubric — this is what gets saved.
  const scorePercent = rubricTotal > 0 ? (totalScore / rubricTotal) * 100 : 0;
  // What that percentage is worth in the activity's own points.
  const scoreInPoints = (scorePercent / 100) * (submission?.activity?.points || 100);

  // AI grading hasn't produced a result yet. The AI-failure case still counts as
  // "done" so the teacher can fall back to grading manually.
  const aiFailed = !!submission?.aiFeedback?.includes('⚠ AI grading is currently unavailable');
  const awaitingAiCheck = submission?.aiScore === null && submission?.status === 'PENDING' && !aiFailed;
  const canValidate = !awaitingAiCheck && !isAnalyzing;

  // Where the "Done" / "Review for Later" buttons return to. Falls back to the
  // activity's class so a missing classId never lands on an empty roster.
  const rosterLink = submission
    ? `/teacher/batch-upload?activityId=${submission.activityId}${submission.activity?.classId ? `&classId=${submission.activity.classId}` : ''}`
    : '/teacher/dashboard';

  // ── Structured feedback helpers ──
  const updateStrengths = (val) => setStructuredFeedback(prev => ({ ...prev, strengths: val }));

  const updateAreaForGrowth = (idx, field, val) => {
    setStructuredFeedback(prev => {
      const next = [...prev.areasForGrowth];
      next[idx] = { ...next[idx], [field]: val };
      return { ...prev, areasForGrowth: next };
    });
  };

  const removeAreaForGrowth = (idx) => {
    setStructuredFeedback(prev => ({
      ...prev,
      areasForGrowth: prev.areasForGrowth.filter((_, i) => i !== idx),
    }));
  };

  const addAreaForGrowth = () => {
    setStructuredFeedback(prev => ({
      ...prev,
      areasForGrowth: [...prev.areasForGrowth, { studentQuote: '', explanation: '' }],
    }));
  };

  const updateActionStep = (idx, val) => {
    setStructuredFeedback(prev => {
      const next = [...prev.actionableSteps];
      next[idx] = val;
      return { ...prev, actionableSteps: next };
    });
  };

  const removeActionStep = (idx) => {
    setStructuredFeedback(prev => ({
      ...prev,
      actionableSteps: prev.actionableSteps.filter((_, i) => i !== idx),
    }));
  };

  const addActionStep = () => {
    setStructuredFeedback(prev => ({
      ...prev,
      actionableSteps: [...prev.actionableSteps, ''],
    }));
  };

  // ── AI Co-Pilot ──
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatInput('');
    setIsChatLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFeedback: feedbackText, prompt: msg, isStructured })
      });
      const data = await res.json();
      // refineFailed means the AI never actually ran — the server falls back to
      // returning the original text unchanged rather than failing the request.
      // Showing that as a normal AI reply used to be indistinguishable from the
      // AI genuinely deciding your wording didn't need to change, and it came
      // with an "Apply" button that would silently reapply the identical text.
      if (data.refineFailed) {
        setChatHistory(prev => [...prev, { role: 'ai', failed: true, text: data.refineFailedReason || "The AI Co-Pilot couldn't make this change right now." }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'ai', text: data.refinedFeedback, isStructuredResponse: data.isStructured }]);
      }
    } catch {
      setChatHistory(prev => [...prev, { role: 'ai', failed: true, text: 'Error reaching AI. Please check your connection.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const applyFeedback = (text, isStructuredResponse) => {
    if (isStructured && isStructuredResponse) {
      // Try to parse the AI response as structured JSON and merge intelligently
      try {
        const parsed = JSON.parse(text);
        setStructuredFeedback(prev => ({
          ...prev,
          strengths: parsed.strengths || prev.strengths,
          areasForGrowth: Array.isArray(parsed.areasForGrowth) ? parsed.areasForGrowth : prev.areasForGrowth,
          actionableSteps: Array.isArray(parsed.actionableSteps) ? parsed.actionableSteps : prev.actionableSteps,
        }));
      } catch {
        // If JSON parsing fails, fall back to setting strengths
        setStructuredFeedback(prev => ({ ...prev, strengths: text }));
      }
    } else if (isStructured) {
      // Plain text AI response for structured feedback — set as strengths only
      setStructuredFeedback(prev => ({ ...prev, strengths: text }));
    } else {
      setLegacyFeedbackText(text);
    }
    setIsChatOpen(false);
  };

  // ── Save / Validate ──
  /** This paper is done as far as this run is concerned. */
  const markReviewedNow = () =>
    setReviewedNow(prev => (prev.includes(submissionId) ? prev : [...prev, submissionId]));

  /**
   * Records the mark.
   *
   * The response is checked, not just awaited. `fetch` resolves on 4xx, so the
   * earlier bare `await` treated a refusal as a success: the screen approved
   * the paper, fired the celebration and — in a queue run — advanced to the
   * next learner, with nothing written. The server has live refusal paths here
   * (a score it will not trust, 400; a paper belonging to a colleague's class,
   * 403 — see tests/route-wiring.test.js), and a grade of record silently
   * failing to save is the worst failure this screen has.
   */
  const handleValidate = async () => {
    // Already validated and untouched: there is nothing to record, so this is
    // purely "I have read this one, move on". Re-sending an identical grade
    // would write another entry to the paper's grade history and make the
    // record claim the teacher changed a mark they only looked at.
    if (isApproved && !isDirty) {
      if (queueActivityId) {
        markReviewedNow();
        goToNext();
      }
      // Outside a run, closing the editor puts the release/done view back —
      // there is nothing else this press could honestly mean.
      else setIsEditingAssessment(false);
      return;
    }
    setIsSaving(true);
    setSaveError('');
    try {
      if (submissionId && submissionId !== 'test123') {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const hitlFeedback = isStructured
          ? serializeStructuredFeedback(structuredFeedback)
          : legacyFeedbackText;
        const res = await apiFetch(`${API_URL}/api/teacher/submissions/${submissionId}/grade`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // A percentage of the rubric, not the raw point sum — the sum only
            // equalled the percentage when a rubric happened to total 100.
            hitlScore: scorePercent,
            hitlFeedback,
            readingStrategy,
            teacherId: user.id,
            rubricData: dynamicRubric ? dynamicRubric.map(r => ({ ...r, score: scores[r.criterionName] })) : { content: { score: scores.content, max: 40 }, organization: { score: scores.organization, max: 30 }, grammar: { score: scores.grammar, max: 30 } }
          })
        });

        // The server's own wording where there is any — it is more specific
        // than anything this screen could guess ("Score must be between 0 and
        // 100", "not your class").
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          setSaveError(
            data?.error ||
            `The mark was not saved (server said ${res.status}). Nothing has been recorded — please try again.`
          );
          setIsSaving(false);
          return;   // stay on this paper: not approved, no celebration, no advance
        }
      }
      setIsApproved(true);
      // What was just written is the new "unchanged" state, so the button drops
      // back to offering the next paper rather than another save.
      setBaseline(currentSnapshot);
      markReviewedNow();

      // "Time-Saved" Celebration — first validation only
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user.id && !localStorage.getItem(`hasFirstValidation_${user.id}`)) {
        localStorage.setItem(`hasFirstValidation_${user.id}`, 'true');
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 6000);
      }
    } catch {
      // Network-level failure. Same rule as a refusal above: nothing was
      // recorded, so the screen must not move on.
      setSaveError('Could not reach the server, so the mark was not saved. Check your connection and try again.');
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    setIsEditingAssessment(false);
    // In a queue run, validating IS the "next" action. Anywhere else the screen
    // behaves as it always did and waits for the teacher.
    if (queueActivityId) goToNext();
  };

  // ── Queue navigation ──
  //
  // Which papers this run is about, fixed when the run starts.
  //
  // The list used to be every AI-checked paper on the activity, re-derived on
  // each navigation. Two things were wrong with that. Papers validated and
  // released weeks ago were still in it, so checking two new submissions on a
  // five-pupil activity opened a run reading "Paper 2 of 5" and drew a progress
  // bar three-fifths full of work that was already finished and published. And
  // because it was re-derived, narrowing it to unreviewed papers would have
  // shrunk the bar on every step — "Paper 2 of 5" becoming "Paper 1 of 3" as
  // you worked, which is a progress bar that cannot be read.
  //
  // So membership is decided once, from what needed validating at the moment
  // the run opened, and held for the rest of it. Only the reviewed/released
  // flags are refreshed after that.
  const runMembership = useRef({ activityId: null, ids: null });

  useEffect(() => {
    if (!queueActivityId) return;
    apiFetch(`${API_URL}/api/activities/${queueActivityId}/submissions`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        // Only papers that have something to review. An un-checked paper has
        // no draft to approve, so it does not belong in a review run.
        const reviewable = (d.submissions || []).filter(s => s.aiScore !== null || s.status === 'GRADED');

        if (runMembership.current.activityId !== queueActivityId || !runMembership.current.ids) {
          // The papers waiting on a decision, plus whichever one the teacher
          // opened — they may well have arrived on an already-validated paper
          // from the roster, and a run that excluded the paper on screen would
          // be describing a set the teacher is not in.
          const inRun = reviewable.filter(s => s.id === submissionId || s.status !== 'GRADED');
          runMembership.current = {
            activityId: queueActivityId,
            // Nothing pending anywhere: fall back to the whole checked set
            // rather than an empty strip that says "Paper 0 of 0".
            ids: (inRun.length > 0 ? inRun : reviewable).map(s => s.id),
          };
        }

        const inThisRun = new Set(runMembership.current.ids);
        setQueue(reviewable
          .filter(s => inThisRun.has(s.id))
          .map(s => ({
            id: s.id,
            studentName: s.student?.name || 'Student',
            reviewed: s.status === 'GRADED',
            released: !!s.releasedAt
          })));
      })
      .catch(() => {});
  }, [queueActivityId, submissionId]);

  const queueIndex = queue.findIndex(q => q.id === submissionId);

  const loadReleaseState = () => {
    if (!queueActivityId) return;
    apiFetch(`${API_URL}/api/teacher/activities/${queueActivityId}/release`)
      .then(r => r.json())
      .then(d => { if (d.success) setReleaseState(d); })
      .catch(() => {});
  };

  /**
   * The next paper in the run: the next one that still needs validating.
   *
   * Reading order first — the paper after this one in the queue's own order —
   * then wrapping to the top for anything left above. Both halves are needed,
   * and each was a bug on its own:
   *
   *   • "The first unreviewed paper anywhere" ended the run wherever the
   *     unreviewed ones ran out rather than at the end of the set, so
   *     re-opening a finished run offered "Done" on paper 1 of 5.
   *   • Strictly forwards ended the run at whichever paper happened to be last
   *     in the list — enter the queue on that one, validate it, and the summary
   *     appeared with two papers still waiting.
   *
   * The run is over when no paper in this batch still needs validating. Papers
   * skipped in this session are passed over (that is what Skip is for, and the
   * summary offers them back); papers already validated are passed over because
   * there is nothing to do to them.
   *
   * `reviewedNow` is what makes the wrap safe. A run that can go backwards can
   * cycle if a paper never stops being unreviewed, so validation is remembered
   * here as well as read from the server — the local answer cannot lag behind
   * what this screen has just done.
   */
  const queueKnown = queue.length > 0;
  const stillNeedsReview = (q) =>
    q.id !== submissionId && !q.reviewed && !reviewedNow.includes(q.id) && !skipped.includes(q.id);
  const nextInQueue = queue.slice(queueIndex + 1).find(stillNeedsReview)
    || queue.find(stillNeedsReview);
  // Only the genuine end of the run: the queue has loaded, and nothing is left
  // to validate. Without the loaded check, the moment before the fetch returns
  // has an empty queue and therefore no next paper — which is
  // indistinguishable from "you have finished" unless it is asked separately.
  const isLastInRun = !!queueActivityId && queueKnown && !nextInQueue;

  /**
   * What the primary button will actually do, decided once.
   *
   * The label, the icon and the handler all read this, because a button that
   * says one thing and does another is worse than a vague one — and this button
   * carries three different jobs depending on where the teacher is in a run.
   *
   * Note there is no "Done" during a run: finishing IS validating the last
   * paper, and the summary that follows is the done state. A button that said
   * Done before the last paper had been through was offering to end a run the
   * teacher had not finished.
   */
  const validateAction =
    (isApproved && isDirty) ? { label: 'Save Changes', finishes: false }
      : isLastInRun ? { label: 'Validate & done', finishes: true }
        : queueActivityId ? { label: 'Validate & next', finishes: false }
          // Outside a run this only renders while an already-validated paper is
          // being edited, so with nothing changed the press just closes the
          // editor — which is "done", not another validation.
          : isApproved ? { label: 'Done', finishes: true }
            : { label: 'Validate', finishes: false };

  const goToNext = () => {
    // The same paper the button named. Resolved from one place so the label can
    // never promise a next paper the navigation then declines to open.
    if (nextInQueue) {
      navigate(`/teacher/review/${nextInQueue.id}?queue=${queueActivityId}`);
    } else {
      loadReleaseState();
      setShowSummary(true);
    }
  };

  const handleSkip = () => {
    setSkipped(prev => (prev.includes(submissionId) ? prev : [...prev, submissionId]));
    goToNext();
  };

  // Keyboard shortcuts for a queue run. A teacher going through 45 papers is
  // doing the same two actions over and over; reaching for the mouse each time
  // is most of the work. Ignored while the caret is in a field, so editing
  // feedback never triggers them.
  useEffect(() => {
    if (!queueActivityId || showSummary) return;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' && canValidate && !isSaving) { e.preventDefault(); handleValidate(); }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); handleSkip(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const releaseAll = async () => {
    setIsReleasing(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/activities/${queueActivityId}/release`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadReleaseState();
        setQueue(prev => prev.map(q => (q.reviewed ? { ...q, released: true } : q)));
      } else {
        alert(data.error || 'Could not release the results.');
      }
    } catch {
      alert('Could not release the results. Please check your connection.');
    } finally {
      setIsReleasing(false);
    }
  };

  /**
   * Publish this one paper.
   *
   * Releasing used to be reachable only from the end-of-run summary, which
   * only exists in queue mode (`?queue=`). A teacher opening a single paper
   * from the gradebook could validate it and then had nowhere to go: the mark
   * was recorded, status GRADED, so the learner's dashboard reported the
   * activity as already graded — while releasedAt stayed null, so they could
   * not actually see it. The server route for this existed the whole time and
   * simply had no caller.
   */
  const releaseThisOne = async () => {
    setIsReleasingOne(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/submissions/${submissionId}/release`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // Keep the relations already loaded — the route returns the bare row.
        setSubmission(prev => ({ ...prev, releasedAt: data.submission?.releasedAt || new Date().toISOString() }));
      } else {
        alert(data.error || 'Could not release this result.');
      }
    } catch {
      alert('Could not release this result. Please check your connection.');
    } finally {
      setIsReleasingOne(false);
    }
  };

  const handleAnalyze = async () => {
    if (!submissionId) return;
    setIsAnalyzing(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/submissions/${submissionId}/analyze`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success && data.submission) {
        // Keep the relations we already loaded if the response omits them —
        // activity.points is the score denominator and activity.classId is the
        // link back to the class roster.
        const sub = { ...submission, ...data.submission, activity: data.submission.activity || submission?.activity, student: data.submission.student || submission?.student };
        setSubmission(sub);

        // Merge AI and HITL feedback
        let finalStructured = { strengths: '', areasForGrowth: [], actionableSteps: [], skillExplanations: {} };
        
        const parsedAi = parseStructuredFeedback(sub.aiFeedback);
        if (parsedAi) {
          finalStructured = { ...parsedAi };
        } else if (sub.aiFeedback) {
          finalStructured.strengths = sub.aiFeedback;
        }
        
        if (sub.hitlFeedback) {
          const parsedHitl = parseStructuredFeedback(sub.hitlFeedback);
          if (parsedHitl) {
            finalStructured = { ...parsedHitl };
          } else {
            finalStructured.strengths = sub.hitlFeedback;
          }
        }
        
        if (finalStructured.strengths?.includes('⚠ AI grading is currently unavailable')) {
          finalStructured.strengths = '';
        }
        
        setStructuredFeedback(finalStructured);
        setIsStructured(true);

        setReadingStrategy(sub.readingStrategy || '');
        if (sub.rubricData && sub.rubricData !== '[]') {
          try {
            const rd = JSON.parse(sub.rubricData);
            if (Array.isArray(rd)) {
              const initialScores = {};
              rd.forEach(r => initialScores[r.criterionName] = r.score);
              setScores(initialScores);
              setDynamicRubric(rd);
            } else {
              // Absent criteria default to 0 — see the note on the initial
              // state. Never to invented mid-band scores.
              setScores({ content: rd.content?.score ?? 0, organization: rd.organization?.score ?? 0, grammar: rd.grammar?.score ?? 0 });
            }
          } catch { /* unparseable rubricData leaves the editor as it is */ }
        }
        if (sub.covData) {
          try { setCovData(JSON.parse(sub.covData)); } catch { /* no COV data to show */ }
        }
      } else if (data.code === 'PRIVACY_VIOLATION') {
        // The scan was refused before any rubric grading ran. Merge the flagged
        // submission in so the Privacy Act banner renders, and leave the teacher
        // on the page to grade manually — reloading would just hide why.
        setSubmission(prev => ({ ...prev, ...(data.submission || {}), privacyViolation: true }));
      } else {
        alert('Analysis failed: ' + (data.error || 'Unknown error'));
        window.location.reload();
      }
    } catch {
      alert('Network error during analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading submission...</div>;

  const activity = submission?.activity;
  // rubricItems / totalScore / scorePercent are resolved above, before the
  // loading return, because the save handler needs them too.


  const skillLabels = {
    vocabulary: 'Vocabulary',
    punctuation: 'Punctuation',
    thematicFlow: 'Thematic Flow',
    sentenceStructure: 'Sentence Structure',
  };

  const hasSkillExplanations = isStructured && Object.keys(structuredFeedback.skillExplanations).length > 0;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-slate-100 relative overflow-hidden">

      {/* Left: Essay Image */}
      <div className="w-full md:w-5/12 lg:w-1/2 p-4 flex flex-col border-r border-slate-200 bg-slate-50">
        <button onClick={() => navigate(rosterLink)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-4 shrink-0">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Queue
        </button>

        {/* Queue position — where the teacher is in the run, and how much is left. */}
        {queueActivityId && queue.length > 0 && (
          <div className="mb-4 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-bold text-brand-slate">
                Paper {queueIndex >= 0 ? queueIndex + 1 : '–'} of {queue.length}
              </p>
              <p className="text-[11px] text-slate-500">
                {queue.filter(q => q.reviewed).length} reviewed
                {skipped.length > 0 && ` · ${skipped.length} skipped`}
              </p>
            </div>
            <div className="flex gap-1 flex-wrap">
              {queue.map((q) => (
                <button
                  key={q.id}
                  title={`${q.studentName}${q.reviewed ? ' — reviewed' : ''}`}
                  onClick={() => navigate(`/teacher/review/${q.id}?queue=${queueActivityId}`)}
                  className={cn('h-1.5 flex-1 min-w-[8px] rounded-full transition-colors',
                    q.id === submissionId ? 'bg-brand-navy'
                      : q.reviewed ? 'bg-brand-green'
                        : skipped.includes(q.id) ? 'bg-amber-400'
                          : 'bg-slate-300 hover:bg-slate-400')}
                />
              ))}
            </div>
          </div>
        )}
        {/* Scrolls, rather than fitting the whole scan into a fixed box.
            Multi-page work is stitched into one tall image on upload, and
            `object-contain` inside a fixed-height frame shrank that to a
            thumbnail: page two was on screen but far too small to read, which
            is what "the other pages aren't in the review page" looks like.
            Showing it at full panel width and scrolling makes every page
            legible at the size the paper was scanned at. */}
        {/* Taller on a phone, where this column stacks above the review panel
            and `flex-1` has no leftover height to claim — a 300px window is
            not enough of a page to read a paragraph in. */}
        <div className="flex-1 bg-slate-200 rounded-xl border border-slate-300 overflow-auto relative min-h-[70vh] md:min-h-[300px]">
          {submission?.imageUrl ? (
            <SubmissionImage
              url={submission.imageUrl}
              alt="Essay"
              className="w-full h-auto block"
              wrapperClassName="h-full"
              onImageLoad={({ naturalWidth, naturalHeight }) =>
                // Taller than 1.6 pages of A4 (≈1.41 each) — in practice, a
                // stitched scan rather than a single sheet.
                setIsLongScan(naturalHeight / Math.max(naturalWidth, 1) > 2.2)}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
              <div className="w-16 h-20 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center">
                <span className="text-2xl">📝</span>
              </div>
              <span className="text-sm font-medium">Handwritten Essay</span>
              <span className="text-xs">Upload image to see here</span>
            </div>
          )}
          {isLongScan && (
            <div className="sticky bottom-0 left-0 right-0 bg-navy-900/80 text-white text-[11px] font-bold px-3 py-1.5 text-center backdrop-blur-sm">
              Multi-page work — scroll to read the rest
            </div>
          )}
        </div>
        {submission && (
          <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-500">
            <p className="font-semibold text-brand-slate">{submission.student?.name}</p>
            <p>{submission.activity?.title} • {submission.activity?.class?.name}</p>
          </div>
        )}
      </div>

      {/* Right: Review Panel */}
      <div className="w-full md:w-7/12 lg:w-1/2 flex flex-col bg-white max-h-screen overflow-y-auto">
        <div className="p-6 md:p-8 flex-1 space-y-6">

          {/* AI Failure Banner — shows when AI grading failed (score 0 + error feedback) */}
          {submission?.aiFeedback?.includes('⚠ AI grading is currently unavailable') && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-300 rounded-xl text-sm">
              <span className="text-xl shrink-0">🚫</span>
              <div>
                <p className="font-bold text-red-800">AI Grading Unavailable</p>
                <p className="text-red-700 text-xs mt-0.5">
                  {(() => {
                    try {
                      const obj = JSON.parse(submission.aiFeedback);
                      return obj.strengths || submission.aiFeedback;
                    } catch {
                      return submission.aiFeedback;
                    }
                  })()}
                </p>
                <p className="text-red-600 text-xs mt-1 font-medium">Please grade this submission manually using the rubric sliders below.</p>
              </div>
            </div>
          )}

          {/* AI Ready Banner — shows when student submitted but AI hasn't graded yet */}
          {submission?.aiScore === null && submission?.status === 'PENDING' && !submission?.aiFeedback?.includes('⚠') && (
            <div className="flex flex-col items-center justify-center p-8 bg-blue-50 border-2 border-blue-200 rounded-2xl text-center space-y-4">
              <Sparkles className="w-12 h-12 text-blue-400" />
              <div>
                <h3 className="font-bold text-lg text-blue-900">Ready for AI Checking</h3>
                <p className="text-sm text-blue-700 mt-1 max-w-sm mx-auto">This student submission has not been graded yet. Start the AI analysis to generate a rubric score and personalized feedback.</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleAnalyze} disabled={isAnalyzing} className="px-6 py-3 bg-brand-navy text-white rounded-xl font-bold flex items-center gap-2 hover:bg-blue-900 shadow-md transition-all disabled:opacity-70">
                  {isAnalyzing ? <><Loader2 className="w-5 h-5 animate-spin"/> Analyzing...</> : <><Sparkles className="w-5 h-5"/> Start AI Checking</>}
                </button>
                <button
                  onClick={() => navigate(rosterLink)}
                  disabled={isAnalyzing}
                  className="px-6 py-3 bg-white text-slate-600 border-2 border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all disabled:opacity-70"
                >
                  Review for Later
                </button>
              </div>
              <p className="text-xs text-blue-600/70 -mt-1">"Review for Later" just saves this photo — you can come back and grade it anytime.</p>
            </div>
          )}

          {/* Privacy Violation Banner */}
          {submission?.privacyViolation && (
            <div className="flex items-start gap-3 p-4 bg-orange-50 border-2 border-orange-300 rounded-xl text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 text-orange-600" />
              <div>
                <p className="font-bold text-orange-800">Privacy Act Warning</p>
                <p className="text-orange-700 text-xs mt-0.5">
                  The AI detected a student name written on this scanned paper. Please remind the student to omit their name on future submissions to comply with the Data Privacy Act.
                </p>
              </div>
            </div>
          )}

          {/* Grade Level Assumed Banner — this class has no gradeLevel set, so the
              AI silently calibrated its curriculum context, language complexity,
              and score expectations for Grade 6 by default. Surfaced here rather
              than left silent, since it isn't just a label — it can shift what
              counts as a good score for this student. */}
          {submission?.gradeLevelAssumed && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold text-amber-800">Grade Level Not Set</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  This class has no grade level set, so the AI graded this against Grade 6 expectations by default. Set the class's grade level, then re-check this paper if that doesn't match the actual grade.
                </p>
              </div>
            </div>
          )}

          {/* Rubric Parse Failed Banner — a rubric genuinely existed for this
              activity (its own rubric, or its lesson's default) but its JSON
              could not be read, so grading silently fell through to a lower
              tier — the topic's recommended template, or the generic DepEd
              default — instead of what the teacher actually set up. Distinct
              from an activity simply having no rubric at all, which isn't
              flagged: that's the fallback ladder working as intended. */}
          {submission?.rubricParseFailed && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold text-amber-800">Rubric Could Not Be Read</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  This activity's rubric could not be read, so the AI graded against a different, less specific rubric instead. Re-save the activity's rubric (or its lesson's default rubric), then re-check this paper.
                </p>
              </div>
            </div>
          )}

          {/* Score/Feedback Mismatch Banner — a rubric criterion scored below
              its band's maximum but the AI's own areasForGrowth didn't name a
              specific, substantive reason why. The prompt tells the model not
              to let this happen; this is the code-side check for when it does
              anyway, so the contradiction surfaces here instead of shipping
              silently to a student. */}
          {submission?.scoreFeedbackMismatch && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold text-amber-800">Score and Feedback May Not Match</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  A rubric criterion was scored below full marks, but the AI's feedback doesn't clearly explain why. Double-check the score and feedback agree before validating.
                </p>
              </div>
            </div>
          )}

          {/* The AI's own arithmetic disagrees with itself: the headline score
              is not the sum of the criteria it is meant to be, or a criterion
              was scored outside the band the model itself labelled it with.
              Distinct from the banner above, which asks whether a shortfall was
              *explained* — this one is about the numbers not adding up, which
              that check passes straight over. Red rather than amber: the other
              flags say "this may need a second look", this one says two of the
              numbers on this page cannot both be right. Deliberately not
              auto-corrected — picking one of the model's two answers would be
              guessing which. */}
          {submission?.rubricScoreNote && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-300 rounded-xl text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
              <div>
                <p className="font-bold text-red-800">The AI&apos;s Numbers Don&apos;t Add Up</p>
                <p className="text-red-700 text-xs mt-0.5">{submission.rubricScoreNote}</p>
              </div>
            </div>
          )}

          {/* Score Out Of Range Banner — the AI returned a total outside 0-100
              and it was clamped on the way in. The prompt makes the 0-100
              scaling the model's own job ("the total score = sum of all
              criterion scores, scaled to 0-100"), and it gets that arithmetic
              wrong most often when the rubric's criteria don't themselves sum
              to 100 — so the rubric breakdown is the thing worth checking, not
              the total. Flagged rather than hidden: a silent clamp leaves a
              teacher looking at criteria adding to 120 against a total of 100
              with nothing explaining the difference. */}
          {submission?.scoreOutOfRange && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold text-amber-800">Score Was Out Of Range</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  The AI returned a total outside 0&ndash;100, so it was capped to fit. Its arithmetic on this paper
                  can&apos;t be trusted &mdash; work out the score from the rubric breakdown below rather than accepting
                  the total. If this activity&apos;s criteria don&apos;t add up to 100, fixing that will usually stop it recurring.
                </p>
              </div>
            </div>
          )}

          {/* No Text Detected Banner */}
          {submission?.aiScore === 0 && !submission?.aiFeedback?.includes('⚠') && !submission?.privacyViolation && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-sm">
              <span className="text-xl shrink-0">📄</span>
              <div className="flex-1">
                <p className="font-bold text-amber-800">No Readable Text Detected</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  {structuredFeedback?.strengths || submission?.aiFeedback || 'The AI could not find readable handwritten or printed text in this image. The image may be blank, contain only drawings, or be too blurry.'}
                </p>
                <p className="text-amber-600 text-xs mt-1 font-medium">Replace it with a clearer photo (top-left), or try checking this one again — a re-crop or better lighting is sometimes all it takes.</p>
                {submission.status === 'PENDING' && (
                  <button onClick={handleAnalyze} disabled={isAnalyzing}
                    className="mt-2 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-60">
                    {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {isAnalyzing ? 'Checking again…' : 'Check Again'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* CoV Conflict Banner */}
          {covData?.conflict && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-300 rounded-xl text-sm">
              <span className="text-lg shrink-0">🔍</span>
              <div>
                <p className="font-bold text-amber-800">AI Self-Corrected During Verification</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  Original score: <strong>{covData.originalScore}</strong> → Verified score: <strong>{covData.verifiedScore}</strong> (Δ{covData.delta} pts). The AI detected an inconsistency and corrected itself. Review carefully.
                </p>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-6">
            <div>
              <h2 className="text-xl font-bold text-brand-slate">{submission?.student?.name || 'Student Review'}</h2>
              <p className="text-slate-500 text-sm">{submission?.activity?.title || 'Essay Submission'}</p>
              {/* A record, not a penalty — nothing deducts marks for this, so
                  the teacher decides what a late piece is worth.

                  Only ever shown for work a student handed in themselves. On a
                  teacher-upload activity the flag describes when the teacher
                  scanned the stack, not when the child submitted, and it is
                  checked here as well as at the point it is written so that
                  rows stamped before that rule existed stop accusing anyone. */}
              {submission?.isLate && submission?.activity?.submissionMode === 'STUDENT_SUBMIT' && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                  ⏰ Submitted late
                </span>
              )}
              {/* Validated and released are two different states, and this
                  badge used to key on isApproved — which is only status ===
                  'GRADED' — and announce "Released to Student" for a paper
                  nobody had published. A teacher reading that had no reason to
                  look for a release control, while the learner saw the
                  activity reported as graded with no result behind it. */}
              {isApproved && (
                submission?.releasedAt ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> Released to Student
                  </span>
                ) : (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                    <Check className="w-3 h-3" /> Validated — not yet released
                  </span>
                )
              )}
            </div>
            <div className="flex items-center gap-4">
              {!isEditingAssessment ? (
                <button
                  onClick={() => setIsEditingAssessment(true)}
                  className="text-xs font-bold text-brand-navy border-2 border-brand-navy/20 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  Edit Assessment
                </button>
              ) : (
                <button
                  onClick={() => setIsEditingAssessment(false)}
                  className="text-xs font-bold text-slate-500 border-2 border-slate-200 bg-white px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel Edit
                </button>
              )}
              <div className="text-center bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                <span className="block text-xs font-bold text-brand-navy uppercase tracking-wider mb-1">Total Score</span>
                <span className="text-3xl font-bold text-brand-navy">{submission?.aiScore === null && submission?.status === 'PENDING' ? '--' : scoreInPoints.toFixed(1).replace(/\.0$/, '')}<span className="text-xl text-blue-300">/{activity?.points || 100}</span></span>
                <span className="block text-[11px] font-semibold text-blue-400 mt-0.5">
                  {totalScore}/{rubricTotal} rubric pts · {Math.round(scorePercent)}%
                </span>
              </div>
            </div>
          </div>

          {/* Rubric Breakdown — editable sliders */}
          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Rubric Breakdown <span className="text-slate-300 font-normal normal-case">{isEditingAssessment ? '(drag to adjust)' : '(read-only)'}</span></h3>
            {rubricItems.length === 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">This activity has no rubric</p>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  There are no criteria to score against, so nothing can be marked here yet.
                  Set the rubric on the activity — one of your school&apos;s, or your own — and
                  this breakdown fills in.
                </p>
                {submission?.activityId && (
                  <Link to={`/teacher/activity/edit/${submission.activityId}`}
                    className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900">
                    Set the rubric
                  </Link>
                )}
              </div>
            )}
            <div className="space-y-4">
              {rubricItems.map(item => (
                <div key={item.key} className="relative group">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{item.name}</span>
                    <div className="flex items-center gap-2">
                      {/* Rubric points, labelled as such. These were shown as
                          "0% / 15%" and then re-scaled as if the point value
                          were a percentage, so a 12-out-of-15 criterion on a
                          60-point activity reported "7.2 pts". */}
                      <span className="font-bold text-slate-900">{scores[item.key] || 0} / {item.max}</span>
                      <span className="text-xs text-brand-navy font-bold">
                        ({item.max ? Math.round(((scores[item.key] || 0) / item.max) * 100) : 0}%)
                      </span>
                    </div>
                  </div>
                  {item.desc && (
                    <div className="hidden group-hover:block absolute bottom-full mb-2 left-0 right-0 bg-slate-800 text-white text-[10px] p-2 rounded z-10 pointer-events-none">
                      {item.desc}
                    </div>
                  )}
                  <input type="range" min={0} max={item.max} value={scores[item.key] || 0}
                    disabled={!isEditingAssessment}
                    onChange={e => setScores(prev => ({ ...prev, [item.key]: parseInt(e.target.value) }))}
                    className={`w-full accent-brand-navy ${!isEditingAssessment ? 'opacity-50 cursor-not-allowed' : ''}`} />
                  <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
                    {/* Guarded the same way as the percentage label above it.
                        `scores` starts empty, so before a criterion is touched
                        this divided undefined by the max and set the bar to
                        "NaN%" — an invalid width the browser drops, leaving a
                        bar that never moved off zero even once scored. */}
                    <div className={cn('h-2 rounded-full transition-all', item.color)}
                      style={{ width: `${item.max ? Math.max(0, Math.min(100, ((scores[item.key] || 0) / item.max) * 100)) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Skill Analysis — collapsible */}
          {hasSkillExplanations && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setSkillAnalysisOpen(prev => !prev)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              >
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-brand-navy" /> AI Skill Analysis
                </h3>
                <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', skillAnalysisOpen && 'rotate-180')} />
              </button>
              {skillAnalysisOpen && (
                <div className="p-4 space-y-3 border-t border-slate-200">
                  {Object.entries(structuredFeedback.skillExplanations).map(([key, explanation]) => (
                    <div key={key} className="flex items-start gap-2">
                      <span className="text-xs font-bold text-brand-navy bg-blue-50 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                        {skillLabels[key] || key}
                      </span>
                      <p className="text-xs text-slate-600 italic leading-relaxed">{explanation}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Qualitative Feedback — structured or legacy */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Qualitative Feedback</h3>
              <div className="relative">
                <button 
                  onClick={() => {
                    setIsChatOpen(true);
                    if (showTooltip) {
                      setShowTooltip(false);
                      markOnboardingSeen(ONBOARDING.TEACHER_COPILOT_TIP);
                    }
                  }}
                  className="flex items-center text-xs font-bold text-brand-navy bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors border border-blue-200">
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Refine with AI Co-Pilot
                </button>
                {showTooltip && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-brand-navy text-white text-xs font-medium p-3 rounded-xl shadow-xl z-20 animate-fade-in-up">
                    <div className="absolute -top-1 right-8 w-3 h-3 bg-brand-navy rotate-45" />
                    Try asking the AI to make this feedback sound more encouraging!
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-400 rounded-full animate-ping" />
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full" />
                  </div>
                )}
              </div>
            </div>

            {isStructured ? (
              isEditingAssessment ? (
                /* ── EDIT MODE: editable textareas ── */
                <div className="space-y-5">

                  {/* ✅ Strengths */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">✅ Strengths</label>
                    <textarea
                      className="w-full p-4 bg-white border-2 border-emerald-200 rounded-xl text-sm text-slate-700 focus:border-brand-green focus:ring-4 focus:ring-brand-green/10 outline-none transition-all leading-relaxed resize-none"
                      rows={3}
                      value={structuredFeedback.strengths}
                      onChange={e => updateStrengths(e.target.value)}
                    />
                  </div>

                  {/* 📈 Areas for Growth */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-slate-700">📈 Areas for Growth</label>
                      <button onClick={addAreaForGrowth} className="flex items-center text-xs font-bold text-brand-navy bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full transition-colors border border-blue-200">
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </button>
                    </div>
                    <div className="space-y-3">
                      {structuredFeedback.areasForGrowth.map((area, idx) => (
                        <div key={idx} className="relative bg-slate-50 border border-slate-200 rounded-xl p-4 group">
                          <button
                            onClick={() => removeAreaForGrowth(idx)}
                            className="absolute top-2 right-2 p-1 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors reveal-on-hover"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r-lg px-3 py-2 mb-2">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-0.5">Student wrote:</p>
                            <textarea
                              className="w-full bg-transparent text-sm text-amber-900 italic outline-none resize-none leading-relaxed"
                              rows={1}
                              value={area.studentQuote}
                              onChange={e => updateAreaForGrowth(idx, 'studentQuote', e.target.value)}
                              placeholder="Exact quote from essay..."
                            />
                          </div>
                          <textarea
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 resize-none leading-relaxed"
                            rows={2}
                            value={area.explanation}
                            onChange={e => updateAreaForGrowth(idx, 'explanation', e.target.value)}
                            placeholder="Why this needs improvement..."
                          />
                        </div>
                      ))}
                      {structuredFeedback.areasForGrowth.length === 0 && (
                        <p className="text-xs text-slate-400 italic py-2">No areas for growth added yet.</p>
                      )}
                    </div>
                  </div>

                  {/* 🎯 Action Steps */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-slate-700">🎯 Action Steps</label>
                      <button onClick={addActionStep} className="flex items-center text-xs font-bold text-brand-navy bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full transition-colors border border-blue-200">
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {structuredFeedback.actionableSteps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 group">
                          <span className="shrink-0 w-6 h-6 rounded-full bg-brand-navy/10 text-brand-navy text-xs font-bold flex items-center justify-center mt-1">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10"
                            value={step}
                            onChange={e => updateActionStep(idx, e.target.value)}
                            placeholder="Action step..."
                          />
                          <button
                            onClick={() => removeActionStep(idx)}
                            className="shrink-0 p-1.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors reveal-on-hover mt-0.5"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {structuredFeedback.actionableSteps.length === 0 && (
                        <p className="text-xs text-slate-400 italic py-2">No action steps added yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* ── READ-ONLY MODE: beautiful cards like student view ── */
                <div className="space-y-4">

                  {/* ✅ Strengths Card */}
                  {structuredFeedback.strengths && (
                    <div className="bg-emerald-50/70 rounded-2xl border border-emerald-200 p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="bg-green-100 p-1.5 rounded-lg">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        </div>
                        <h4 className="text-sm font-bold text-green-700 uppercase tracking-wider">What the Student Did Well</h4>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">{structuredFeedback.strengths}</p>
                    </div>
                  )}

                  {/* 📈 Areas for Growth Card */}
                  {structuredFeedback.areasForGrowth.length > 0 && (
                    <div className="bg-amber-50/50 rounded-2xl border border-amber-200 p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="bg-amber-100 p-1.5 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                        </div>
                        <h4 className="text-sm font-bold text-amber-700 uppercase tracking-wider">Areas for Growth</h4>
                        <span className="text-xs text-amber-500 font-medium ml-auto">{structuredFeedback.areasForGrowth.length} area{structuredFeedback.areasForGrowth.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-3">
                        {structuredFeedback.areasForGrowth.map((area, idx) => (
                          <div key={idx} className="space-y-2 pb-3 border-b border-amber-100 last:border-0 last:pb-0">
                            <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded-r-lg">
                              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">From the essay:</p>
                              <p className="text-sm text-amber-900 italic leading-relaxed">"{area.studentQuote}"</p>
                            </div>
                            <p className="text-sm text-slate-700 leading-relaxed pl-4">{area.explanation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 🎯 Action Steps Card */}
                  {structuredFeedback.actionableSteps.length > 0 && (
                    <div className="bg-blue-50/50 rounded-2xl border border-blue-200 p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="bg-blue-100 p-1.5 rounded-lg">
                          <Info className="w-4 h-4 text-blue-600" />
                        </div>
                        <h4 className="text-sm font-bold text-blue-700 uppercase tracking-wider">Action Steps</h4>
                        <span className="text-xs text-blue-500 font-medium ml-auto">{structuredFeedback.actionableSteps.length} step{structuredFeedback.actionableSteps.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-2">
                        {structuredFeedback.actionableSteps.map((step, idx) => (
                          <div key={idx} className="flex items-start gap-3">
                            <div className="bg-blue-100 text-blue-700 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                              {idx + 1}
                            </div>
                            <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              isEditingAssessment ? (
                <textarea
                  className="w-full p-4 bg-white border-2 border-slate-200 rounded-xl text-sm text-slate-700 focus:border-brand-navy focus:ring-4 focus:ring-brand-navy/10 outline-none transition-all leading-relaxed resize-none"
                  rows={4}
                  value={legacyFeedbackText}
                  onChange={e => setLegacyFeedbackText(e.target.value)}
                />
              ) : (
                legacyFeedbackText && (
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
                    <p className="text-sm text-slate-700 leading-relaxed">{legacyFeedbackText}</p>
                  </div>
                )
              )
            )}
          </div>

          {/* Reading Strategy */}
          <div className="relative">
            <div className="absolute -left-3 top-4 bottom-4 w-1 bg-brand-amber rounded-r-md" />
            <div className="flex items-center justify-between mb-2 ml-2">
              <h3 className="text-sm font-bold flex items-center text-brand-amber uppercase tracking-wider">
                <Info className="w-4 h-4 mr-1" /> Personalized Reading Strategy
              </h3>
              {isEditingAssessment && <Edit2 className="w-4 h-4 text-brand-amber" />}
            </div>
            {isEditingAssessment ? (
              <textarea
                className="w-full p-4 ml-2 bg-amber-50/50 border-2 border-brand-amber/30 rounded-xl text-sm text-slate-800 focus:border-brand-amber focus:ring-4 focus:ring-brand-amber/20 outline-none transition-all leading-relaxed resize-none"
                rows={3} value={readingStrategy} onChange={e => setReadingStrategy(e.target.value)} />
            ) : (
              readingStrategy && (
                <p className="text-sm text-slate-700 leading-relaxed ml-2 p-4 bg-amber-50/30 rounded-xl">{readingStrategy}</p>
              )
            )}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="bg-white border-t border-slate-200 sticky bottom-0 z-10">
        {/* Sits directly above the button that failed, inside the sticky
            footer, so it cannot be scrolled out of sight — a save failure the
            teacher does not see is the same as no message at all. */}
        {saveError && (
          <div role="alert" className="mx-4 mt-4 flex items-start gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="min-w-0">{saveError}</span>
          </div>
        )}
        {/* tg-above-dock, and px/pt rather than p-4: the mobile dock is fixed at
            bottom-0 with z-40 and is painted after the page, so this bar's
            buttons — the ones that finish a grading run — sat underneath it on a
            phone. The utility lifts the contents clear and adds the iOS
            home-indicator inset; a plain `p-4` would override the padding-bottom
            it works through. */}
        <div className="tg-above-dock px-4 pt-4 flex gap-3">
          {queueActivityId ? (
            <button onClick={handleSkip}
              title="Come back to this one at the end of the run (S)"
              className="py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors flex items-center justify-center gap-2">
              <SkipForward className="w-5 h-5" /> Skip
            </button>
          ) : (
            <button onClick={() => navigate(rosterLink)} className="flex-1 py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors">
              Back
            </button>
          )}
          {isApproved && !isEditingAssessment && !queueActivityId ? (
            // Validated, working on one paper rather than a run. Release is the
            // step that actually reaches the learner, so it is the action here
            // until it has been done — "Done" alone left the mark recorded and
            // invisible, with no route to publishing it from this screen.
            !submission?.releasedAt ? (
              <button
                onClick={releaseThisOne} disabled={isReleasingOne}
                title="Publish this result so the student can see it"
                className="flex-1 py-3 px-4 rounded-xl bg-brand-green text-white font-bold hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                {isReleasingOne ? <Loader2 className="w-5 h-5 animate-spin" /> : <SendIcon className="w-5 h-5" />}
                {isReleasingOne ? 'Releasing…' : 'Release to student'}
              </button>
            ) : (
              <button
                onClick={() => navigate(rosterLink)}
                className="flex-1 py-3 px-4 rounded-xl bg-brand-green text-white font-bold hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> Done
              </button>
            )
          ) : (
            <button onClick={handleValidate} disabled={isSaving || !canValidate}
              title={!canValidate ? 'Run AI checking first — there is nothing to validate yet.' : 'Approve this mark and move on (Enter)'}
              className={cn('flex-1 py-3 px-4 rounded-xl font-bold transition-colors flex items-center justify-center gap-2',
                canValidate
                  ? 'bg-brand-green text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 disabled:opacity-60'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" />
                : validateAction.finishes ? <CheckCircle2 className="w-5 h-5" />
                  : <Check className="w-5 h-5" />}
              {/* The button says what pressing it will actually do.
                  It used to read "Save Changes" on every already-validated
                  paper, edited or not — so most of the way through a run the
                  teacher was offered a save they had no reason to make, and no
                  hint that the same button was what moved them on.

                  No longer "Validate & Release" either: validating records the
                  mark, releasing publishes the set. The teacher does the second
                  one deliberately, at the end, having seen the whole spread. */}
              {isSaving ? 'Saving...'
                : isAnalyzing ? 'AI checking...'
                  : awaitingAiCheck ? 'Waiting for AI check'
                    : validateAction.label}
            </button>
          )}
        </div>
        </div>
      </div>

      {/* ── End of the review run ──
          The whole point of holding release until here: the teacher has now
          seen every paper in the set and can publish them as one decision,
          instead of having published paper 2 before discovering their standard
          had drifted by paper 20. */}
      {showSummary && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 text-center border-b border-slate-100">
              <div className="w-14 h-14 bg-green-50 text-brand-green rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              {/* "Review complete" over "1 of 3 papers reviewed" is the run
                  contradicting itself. The count is the whole activity's — a
                  paper that was never AI-checked is not in this run and cannot
                  be reviewed from it — so the two numbers are about different
                  sets, and the heading has to say which one it is claiming. */}
              <h3 className="text-lg font-bold text-brand-slate mb-1">
                {skipped.length > 0 ? 'Run finished' : 'Checked papers reviewed'}
              </h3>
              <p className="text-sm text-slate-500">
                {releaseState
                  ? `${releaseState.reviewed} of ${releaseState.total} papers in this activity reviewed.`
                  : `${queue.filter(q => q.reviewed).length} of ${queue.length} papers reviewed.`}
                {skipped.length > 0 && ` ${skipped.length} skipped.`}
              </p>
              {/* Where the rest went. Without this the teacher is left to
                  wonder whether the run lost them. */}
              {releaseState && releaseState.total > releaseState.reviewed && (
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  The other {releaseState.total - releaseState.reviewed} haven&apos;t been AI-checked yet,
                  so there was nothing to review — run the check on them from the upload screen.
                </p>
              )}
            </div>

            <div className="p-6 flex flex-col gap-2">
              {releaseState?.readyToRelease > 0 ? (
                <>
                  <p className="text-xs text-slate-500 text-center mb-1">
                    Nothing is visible to your students yet. Releasing publishes all
                    {' '}{releaseState.readyToRelease} reviewed result{releaseState.readyToRelease > 1 ? 's' : ''} at once.
                  </p>
                  <button onClick={releaseAll} disabled={isReleasing}
                    className="w-full py-3 bg-brand-green text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                    {isReleasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
                    Release {releaseState.readyToRelease} result{releaseState.readyToRelease > 1 ? 's' : ''} to students
                  </button>
                </>
              ) : releaseState ? (
                <p className="text-xs text-green-700 text-center bg-green-50 border border-green-200 rounded-lg py-2.5 px-3">
                  All {releaseState.released} reviewed result{releaseState.released === 1 ? '' : 's'} {releaseState.released === 1 ? 'has' : 'have'} been released to students.
                </p>
              ) : null}

              {skipped.length > 0 && (
                <button
                  onClick={() => {
                    const first = skipped[0];
                    setSkipped(prev => prev.filter(id => id !== first));
                    setShowSummary(false);
                    navigate(`/teacher/review/${first}?queue=${queueActivityId}`);
                  }}
                  className="w-full py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                  Go back to {skipped.length} skipped paper{skipped.length > 1 ? 's' : ''}
                </button>
              )}

              <button onClick={() => navigate(rosterLink)}
                className="w-full py-2 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors">
                Back to class list
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Co-Pilot Drawer */}
      <div className={cn('fixed inset-y-0 right-0 w-full md:w-[400px] bg-white shadow-2xl border-l border-slate-200 transform transition-transform duration-300 z-50 flex flex-col',
        isChatOpen ? 'translate-x-0' : 'translate-x-full')}>
        <div className="p-4 bg-brand-navy text-white flex items-center justify-between">
          <div className="flex items-center font-bold">
            <Sparkles className="w-5 h-5 mr-2 text-blue-300" /> AI Co-Pilot
          </div>
          <button onClick={() => setIsChatOpen(false)} className="text-white/70 hover:text-white"><X className="w-6 h-6" /></button>
        </div>
        <div className="bg-blue-50/50 border-b border-slate-100 p-3 text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-600">Current feedback:</strong> "{feedbackText.slice(0, 80)}..."
        </div>
        <div className="flex-1 p-4 overflow-y-auto bg-slate-50 space-y-4">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={cn('flex flex-col max-w-[85%]', msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start')}>
              {msg.role === 'ai' && (
                <div className={cn('flex items-center text-xs mb-1 ml-1 font-bold', msg.failed ? 'text-amber-600' : 'text-slate-500')}>
                  {msg.failed ? <AlertTriangle className="w-3.5 h-3.5 mr-1" /> : <Bot className="w-3.5 h-3.5 mr-1" />}
                  {msg.failed ? 'AI Assistant — couldn\'t run' : 'AI Assistant'}
                </div>
              )}
              <div className={cn('p-3 rounded-2xl text-sm shadow-sm',
                msg.role === 'user' ? 'bg-brand-navy text-white rounded-br-none'
                  : msg.failed ? 'bg-amber-50 border border-amber-200 text-amber-800 rounded-bl-none'
                  : 'bg-white border border-slate-200 text-slate-700 rounded-bl-none')}>
                {msg.text}
              </div>
              {/* No "Apply" action when the AI never actually produced anything —
                  that button used to reapply the untouched original text. */}
              {msg.role === 'ai' && idx > 0 && !msg.failed && (
                <button onClick={() => applyFeedback(msg.text, msg.isStructuredResponse)}
                  className="mt-2 text-xs font-bold text-brand-green flex items-center bg-green-50 px-3 py-1.5 rounded-full hover:bg-green-100 transition-colors border border-green-200">
                  <Check className="w-3.5 h-3.5 mr-1" /> Apply to Feedback
                </button>
              )}
            </div>
          ))}
          {isChatLoading && (
            <div className="flex items-center text-slate-400 text-sm italic mr-auto bg-white border border-slate-200 p-3 rounded-2xl rounded-bl-none">
              <Sparkles className="w-4 h-4 mr-2 animate-pulse text-brand-navy" /> Thinking...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 bg-white border-t border-slate-200">
          <form onSubmit={handleChatSubmit} className="relative">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              placeholder="e.g. Make it more encouraging..."
              className="w-full pl-4 pr-12 py-3 bg-slate-100 border-none rounded-xl focus:ring-2 focus:ring-brand-navy outline-none text-sm"
              disabled={isChatLoading} />
            <button type="submit" disabled={isChatLoading || !chatInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-brand-navy text-white rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
      {isChatOpen && <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setIsChatOpen(false)} />}

      {/* 🎉 Time-Saved Celebration Overlay */}
      {showCelebration && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
          {/* CSS Confetti particles */}
          <div className="absolute inset-0 overflow-hidden">
            {CONFETTI.map((c, i) => (
              <div
                key={i}
                className="absolute w-3 h-3 rounded-sm"
                style={{
                  left: `${c.left}%`,
                  top: '-10px',
                  backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][i % 6],
                  animation: `confettiFall ${c.duration}s ease-in forwards`,
                  animationDelay: `${c.delay}s`,
                  transform: `rotate(${c.rotation}deg)`,
                }}
              />
            ))}
          </div>
          {/* Toast */}
          <div className="bg-white rounded-2xl shadow-2xl border-2 border-green-200 px-8 py-6 text-center animate-bounce-in pointer-events-auto max-w-sm mx-4">
            <div className="text-5xl mb-3">🎉</div>
            <h3 className="text-lg font-bold text-brand-slate mb-1">Great job, Teacher!</h3>
            <p className="text-sm text-slate-600">You just saved <span className="font-bold text-brand-green">~5 minutes</span> of manual grading. TulongGuro has your back!</p>
            <button onClick={() => setShowCelebration(false)} className="mt-4 text-xs font-bold text-brand-navy bg-blue-50 px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors pointer-events-auto">
              Awesome! 🚀
            </button>
          </div>
        </div>
      )}

      {/* Confetti & celebration keyframes */}
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes bounceIn {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.95); }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-bounce-in { animation: bounceIn 0.6s ease-out; }
      `}</style>
    </div>
  );
}
