import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, UploadCloud, FileText, CheckCircle2, Clock, Loader2, ChevronRight, AlertTriangle, ShieldCheck, Calendar, Award, RefreshCw, Eye, CloudOff } from 'lucide-react';
import { API_URL, apiFetch, MAX_SUBMISSION_PAGES } from '../../config';
import { getStoredUser } from '../../utils/session';
import SubmissionImage from '../../components/SubmissionImage';
import ImageRedactor from '../../components/ImageRedactor';
import { deadlineInstant, formatDeadline, submissionWindow } from '../../utils/deadlines';
import { isRasterizable, rasterizeToPageImages } from '../../utils/fileRasterize';
import { enqueue, buildJob } from '../../utils/offlineQueue';
import { saveActivitySnapshot, readActivitySnapshot } from '../../utils/offlineSnapshot';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_LABEL = {
  PENDING: { label: 'Awaiting Teacher Review', color: 'bg-sun-100 text-sun-800', icon: Clock },
  GRADED:  { label: 'Graded & Released',       color: 'bg-aqua-100 text-aqua-800', icon: CheckCircle2 },
};

export default function SubmitWork() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activities, setActivities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  // Nobody signed in means there is nothing to fetch, so this must not open on
  // a spinner that only the first commit would take away again.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [resubmitMode, setResubmitMode] = useState(false);
  const [redactingFile, setRedactingFile] = useState(null);  // { objectUrl, originalFile, index }
  const [pendingFiles, setPendingFiles] = useState([]);       // files queued for redaction
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const fileRef = useRef(null);

  // Track whether we arrived via a direct link (so "Back" goes to dashboard)
  const [cameFromLink, setCameFromLink] = useState(false);

  // Set when the list on screen came off this device rather than the server, so
  // every claim the page makes about it can be qualified. Null means live data.
  const [savedListAt, setSavedListAt] = useState(null);
  // The read failed and there was nothing saved to fall back on. Distinct from
  // an empty list: "no activities yet" and "we couldn't reach yours" are
  // different facts, and a student offline was previously told the first one.
  const [listUnreachable, setListUnreachable] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;

    // Auto-select from ?activityId=, whether the list came from the server or
    // off the disk — a student following a link from their dashboard while
    // offline should land on the same activity, not on a bare list.
    const autoSelect = (list) => {
      const activityIdParam = searchParams.get('activityId');
      if (!activityIdParam) return;
      const match = list.find(a => a.id === activityIdParam);
      if (!match) return;
      setCameFromLink(true);
      setSelected(match);
      setShowPrivacyModal(true);
    };

    apiFetch(`${API_URL}/api/student/${user.id}/activities`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setActivities(d.activities);
        // Every successful read refreshes the copy kept for the next dropout.
        // Only the fields in the snapshot's allow-list are written — no grade,
        // no status, no path to a scanned paper.
        saveActivitySnapshot(user.id, d.activities);
        autoSelect(d.activities);
      })
      .catch(() => {
        // No network. Fall back to the list saved on the last online visit so
        // the offline upload queue is reachable at all — without a list there
        // is nothing to select, and a student with a photo of their essay has
        // no way to hand it over. A missing or stale snapshot leaves the empty
        // state, which is what already renders.
        const snapshot = readActivitySnapshot(user.id);
        if (!snapshot) { setListUnreachable(true); return; }
        setActivities(snapshot.activities);
        setSavedListAt(snapshot.savedAt);
        autoSelect(snapshot.activities);
      })
      .finally(() => setIsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectActivity = (activity) => {
    setSelected(activity);
    setPrivacyConfirmed(false);
    setFiles([]);
    setPreviews([]);
    setResult(null);
    setResubmitMode(false);
    setShowPrivacyModal(true);
  };

  const handlePrivacyConfirm = () => {
    setPrivacyConfirmed(true);
    setShowPrivacyModal(false);
  };

  const handlePrivacyCancel = () => {
    setShowPrivacyModal(false);
    setSelected(null);
    setPrivacyConfirmed(false);
    if (cameFromLink) {
      navigate('/student/dashboard');
    }
  };

  const handleBack = () => {
    if (selected) {
      setSelected(null);
      setFiles([]);
      setPreviews([]);
      setResult(null);
      setPrivacyConfirmed(false);
      setResubmitMode(false);
      if (cameFromLink) {
        navigate('/student/dashboard');
      }
    } else {
      navigate(-1);
    }
  };

  const handleFile = async (e) => {
    const selectedFiles = Array.from(e.target.files || e.dataTransfer?.files || []);
    if (selectedFiles.length === 0) return;
    setResult(null);

    // A PDF or Word file is rendered to page images right here in the browser
    // first, so it can go through the exact same redaction canvas as a photo
    // instead of skipping it. A file that fails to render (corrupt,
    // password-protected, unusual encoding) is refused rather than attached
    // as-is — attaching it un-rendered would skip the redaction canvas
    // entirely and rely solely on the server's prompt-based privacy gate.
    const images = selectedFiles.filter(f => (f.type || '').startsWith('image/'));
    const toRasterize = selectedFiles.filter(f => isRasterizable(f));
    const documents = selectedFiles.filter(f => !(f.type || '').startsWith('image/') && !isRasterizable(f));
    const failedToRender = [];

    if (toRasterize.length > 0) {
      setIsPreparingFiles(true);
      for (const f of toRasterize) {
        try {
          const remaining = MAX_SUBMISSION_PAGES - images.length;
          const pages = await rasterizeToPageImages(f, Math.max(remaining, 1));
          images.push(...pages);
        } catch {
          failedToRender.push(f.name);
        }
      }
      setIsPreparingFiles(false);
    }

    if (failedToRender.length > 0) {
      alert(`Couldn't open ${failedToRender.length > 1 ? 'these files' : 'this file'} to check it for your name before uploading, so ${failedToRender.length > 1 ? "they weren't" : "it wasn't"} added:\n${failedToRender.map(n => `• ${n}`).join('\n')}\n\nThe file may be corrupted or password-protected. Try saving it as a PDF or a photo and try again.`);
    }

    if (documents.length > 0) {
      setFiles(prev => [...prev, ...documents].slice(0, MAX_SUBMISSION_PAGES));
      setPreviews(prev => [...prev, ...documents.map(f => ({ document: f.name }))].slice(0, MAX_SUBMISSION_PAGES));
    }
    if (images.length === 0) return;

    // Queue photos (and now, rendered document pages) for PII redaction one at a time
    setPendingFiles(images);
    setRedactingFile({ objectUrl: URL.createObjectURL(images[0]), originalFile: images[0], index: 0 });
  };

  const handleRedactConfirm = (redactedBlob) => {
    // Convert blob to File and add to files list
    const redactedFile = new File([redactedBlob], redactingFile.originalFile.name, { type: 'image/jpeg' });
    const newFiles = [...files, redactedFile].slice(0, MAX_SUBMISSION_PAGES);
    setFiles(newFiles);
    setPreviews(prev => [...prev, URL.createObjectURL(redactedBlob)]);
    // Process next pending file
    const nextIdx = redactingFile.index + 1;
    if (nextIdx < pendingFiles.length) {
      const next = pendingFiles[nextIdx];
      setRedactingFile({ objectUrl: URL.createObjectURL(next), originalFile: next, index: nextIdx });
    } else {
      setRedactingFile(null);
      setPendingFiles([]);
    }
  };

  const handleRedactCancel = () => {
    // Cancel redaction — discard all pending files
    setRedactingFile(null);
    setPendingFiles([]);
  };

  const removeFile = (index) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
    const newPreviews = [...previews];
    URL.revokeObjectURL(newPreviews[index]);
    newPreviews.splice(index, 1);
    setPreviews(newPreviews);
  };

  const handleSubmit = async () => {
    if (!privacyConfirmed) return;
    if (files.length === 0 || !selected) return;
    setIsSubmitting(true);

    const user = JSON.parse(localStorage.getItem('user') || '{}');

    // All pages queue as one job, carried and flushed together — same
    // reasoning as the teacher batch-upload flow's offline path (OQ-1): the
    // server only stitches pages it receives together in one request, so
    // splitting a multi-page submission into separate queued jobs would flush
    // as separate requests that each overwrite the last one's image.
    const queueOffline = async () => {
      const job = await enqueue(buildJob(`${API_URL}/api/student/submit`, { studentId: user.id, activityId: selected.id }, files));
      setIsSubmitting(false);
      if (!job) {
        alert('Could not save this for later — this device has run out of offline storage. Please reconnect and submit now instead.');
        return;
      }
      setResult({ queued: true });
    };

    if (!navigator.onLine) return queueOffline();

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('images', f));
      formData.append('studentId', user.id);
      formData.append('activityId', selected.id);

      const res = await apiFetch(`${API_URL}/api/student/submit`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        const activitiesRes = await apiFetch(`${API_URL}/api/student/${user.id}/activities`);
        const activitiesData = await activitiesRes.json();
        if (activitiesData.success) setActivities(activitiesData.activities);
      } else {
        alert('Submission failed: ' + (data.error || 'Unknown error'));
      }
    } catch {
      // Only a genuine network failure falls back to the offline queue — a
      // server that answered and said no must not be retried behind the
      // student's back.
      if (!navigator.onLine) return queueOffline();
      alert('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-royal-600" />
    </div>
  );

  if (isPreparingFiles) {
    return (
      <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-3 bg-navy-900/85 backdrop-blur-sm text-white">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm font-bold">Preparing your file for preview…</p>
      </div>
    );
  }

  // PII Redaction overlay — appears when files are queued for redaction
  if (redactingFile) {
    return (
      <>
        <ImageRedactor
          imageSrc={redactingFile.objectUrl}
          onConfirm={handleRedactConfirm}
          onCancel={handleRedactCancel}
          perspective="student"
        />
        {pendingFiles.length > 1 && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[120] bg-navy-900/85 text-white text-xs font-bold px-4 py-2 rounded-full">
            Image {redactingFile.index + 1} of {pendingFiles.length}
          </div>
        )}
      </>
    );
  }

  // ─── DATA PRIVACY MODAL ────────────────────────────────────────────
  // Inline JSX rather than a nested component so it isn't remounted on
  // every parent render.
  const privacyModal = (
    /* The card is taller than a phone screen and had no way to scroll, so the
       two buttons sat below the fold behind the system nav bar — the notice
       could be read but not agreed to, which blocks submitting entirely. The
       header and buttons are pinned and only the notice itself scrolls, so the
       action is always on screen no matter how long the copy gets. dvh rather
       than vh because the mobile URL bar changes the answer. */
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-card-lg animate-pop-in
                      flex flex-col max-h-[calc(100dvh-2rem)]">
        <div className="bg-royal-500 p-7 text-center relative overflow-hidden shrink-0">
          <div className="absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/10" aria-hidden="true" />
          <div className="relative">
            <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <h2 className="font-display text-xl font-extrabold text-white">Data Privacy Notice</h2>
            <p className="text-royal-100 text-sm mt-1">Please read before proceeding</p>
          </div>
        </div>

        <div className="p-6 space-y-3 overflow-y-auto overscroll-contain min-h-0">
          <div className="bg-royal-50 border-2 border-royal-100 rounded-2xl p-4">
            <p className="text-sm text-navy-700 font-semibold leading-relaxed">
              🤖 <strong>AI Processing:</strong> Your submitted work will be analyzed by an AI system (Google Gemini) to assist your teacher in grading. Your teacher will always review and finalize your grade.
            </p>
          </div>

          <div className="bg-sun-100 border-2 border-sun-200 rounded-2xl p-4">
            <p className="text-sm text-navy-700 font-semibold leading-relaxed">
              🔒 <strong>Privacy Reminder:</strong> Please ensure that your <strong>name and any personally identifiable information (PII) are NOT visible</strong> in the photo of your work. This helps protect your privacy during AI processing.
            </p>
          </div>

          <div className="bg-cream-100 border-2 border-cream-200 rounded-2xl p-4">
            <p className="text-xs text-navy-600 leading-relaxed font-semibold">
              By clicking "I Understand &amp; Confirm", you acknowledge that:
            </p>
            <ul className="text-xs text-navy-600 mt-2 space-y-1 ml-1">
              <li>• Your work will be processed by AI for grading assistance</li>
              <li>• Your teacher makes the final grading decision</li>
              <li>• No personal information is visible in your submission photos</li>
            </ul>
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 flex gap-3 shrink-0 border-t-2 border-cream-100 bg-white">
          <button onClick={handlePrivacyCancel} className="tg-btn-ghost flex-1">
            Cancel
          </button>
          <button
            onClick={handlePrivacyConfirm}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full py-3 px-4 font-bold text-sm
                       text-white bg-royal-600 shadow-pop hover:bg-royal-700
                       active:translate-y-1 active:shadow-none transition-all"
          >
            <ShieldCheck className="w-4 h-4" /> I Understand &amp; Confirm
          </button>
        </div>
      </div>
    </div>
  );

  // ─── SAVED-LIST NOTICE ─────────────────────────────────────────────
  // Shown on both screens whenever the activities came off this device. The
  // wording promises only what is true offline: the work is saved here, and it
  // goes when the signal does. Never "submitted" — the server has not seen it.
  const savedListNotice = savedListAt && (
    <div className="mb-5 bg-sun-100 border-2 border-sun-200 rounded-3xl p-5 flex items-start gap-3">
      <CloudOff className="w-5 h-5 text-sun-700 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-extrabold text-navy-700">You're offline — this list was saved on this device</p>
        <p className="text-sm text-navy-600 mt-0.5 leading-relaxed">
          Last updated {new Date(savedListAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
          You can still take a photo and submit — it's saved here and sent automatically once you're back online.
        </p>
      </div>
    </div>
  );

  // ─── SUCCESS RESULT SCREEN ─────────────────────────────────────────
  if (result) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
        <div className="space-y-4">
          <div className={cn('text-white px-6 py-8 rounded-3xl text-center', result.queued ? 'bg-sun-600' : 'bg-aqua-600')}>
            <CheckCircle2 className="w-14 h-14 mx-auto mb-3" />
            <h2 className="font-display text-2xl font-extrabold mb-1.5">
              {result.queued ? 'Saved — Will Upload When Online' : 'Output Submitted!'}
            </h2>
            <p className={cn('text-sm', result.queued ? 'text-sun-100' : 'text-aqua-100')}>
              {result.queued
                ? "You're offline right now, so this was saved on your device. It'll upload automatically once you're back online — keep this app open or come back to it later."
                : 'Your essay has been received and is now awaiting teacher review.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={() => { setSelected(null); setFiles([]); setPreviews([]); setResult(null); setPrivacyConfirmed(false); }}
              className="tg-btn-ghost flex-1">
              Submit Another
            </button>
            <button onClick={() => navigate('/student/dashboard')}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full py-3 px-6 font-bold text-sm
                         text-white bg-royal-600 shadow-pop hover:bg-royal-700
                         active:translate-y-1 active:shadow-none transition-all">
              Go to Dashboard <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── SCREEN 2: FULL-SCREEN ASSIGNMENT DETAIL + SUBMIT ──────────────
  if (selected && privacyConfirmed) {
    const sub = selected.mySubmission;
    // isLate and isClosed are different questions once a teacher allows late
    // work: past the due date the activity is still open, it just marks what
    // arrives. The server decides both — this only describes the same rule.
    const { isLate, isClosed, acceptsLate } = submissionWindow(selected);
    const isPastDeadline = isLate;
    const dueDate = deadlineInstant(selected.deadline);

    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
        <button onClick={handleBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-navy-700 mb-5">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* ── Assignment header ── */}
        <div className="bg-royal-500 text-white px-5 py-5 rounded-3xl mb-5">
          <span className="tg-pill bg-white/20 text-white uppercase tracking-wider">{selected.type}</span>
          <h1 className="font-display text-xl font-extrabold mt-2.5 mb-0.5">{selected.title}</h1>
          <p className="text-royal-100 text-sm font-semibold">{selected.className}</p>

          <div className="flex gap-2.5 mt-4 flex-wrap">
            <div className="bg-white/15 px-3.5 py-2 rounded-xl">
              <span className="block text-[10px] uppercase tracking-wider font-extrabold mb-0.5 text-royal-100">Points</span>
              <span className="font-extrabold flex items-center"><Award className="w-4 h-4 mr-1.5" /> {selected.points}</span>
            </div>
            {dueDate && (
              <div className={cn('px-3.5 py-2 rounded-xl', isPastDeadline ? 'bg-red-500/40' : 'bg-white/15')}>
                <span className="block text-[10px] uppercase tracking-wider font-extrabold mb-0.5 text-royal-100">Due Date</span>
                <span className="font-extrabold flex items-center">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  {formatDeadline(selected.deadline, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )}
            {sub && (
              <div className="bg-white/15 px-3.5 py-2 rounded-xl">
                <span className="block text-[10px] uppercase tracking-wider font-extrabold mb-0.5 text-royal-100">Status</span>
                <span className="text-sm font-extrabold flex items-center gap-1">
                  {sub.status === 'GRADED' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  {STATUS_LABEL[sub.status]?.label || sub.status}
                </span>
              </div>
            )}
            {/* A saved list carries no submission of its own (offlineSnapshot.js
                keeps no grade or status), so offline this would read "0/2" and
                assert that no attempt has been used — which it cannot know. */}
            {!savedListAt && (selected.maxAttempts === 0 || selected.maxAttempts > 1) && (
              <div className="bg-white/15 px-3.5 py-2 rounded-xl">
                <span className="block text-[10px] uppercase tracking-wider font-extrabold mb-0.5 text-royal-100">Attempts</span>
                <span className="font-extrabold flex items-center">
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  {selected.maxAttempts === 0
                    ? `${sub ? sub.attemptCount || 1 : 0} · Unlimited`
                    : `${sub ? sub.attemptCount || 1 : 0}/${selected.maxAttempts}`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Instructions ── */}
        {selected.instructions && (
          <div className="tg-card p-6 mb-5">
            <h2 className="font-display font-extrabold text-navy-700 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-royal-500" /> Instructions
            </h2>
            <p className="text-sm text-navy-600 leading-relaxed whitespace-pre-wrap">{selected.instructions}</p>
          </div>
        )}

        {savedListNotice}

        {/* Offline, the page has no submission to check against, so it says so
            rather than guessing. Guessing either way is worse: hiding the form
            strands a student who never submitted, and showing it as a first
            attempt hides that they may be spending their last one. */}
        {savedListAt && (
          <div className="mb-5 bg-white border-2 border-cream-300 rounded-3xl p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-navy-400 shrink-0 mt-0.5" />
            <p className="text-sm text-navy-600 leading-relaxed font-semibold">
              While you're offline we can't check whether you've already submitted this activity, or how many
              attempts you have left. If it turns out this one can't be accepted, we'll tell you as soon as
              you're back online.
            </p>
          </div>
        )}

        {/* ── Privacy confirmed badge ── */}
        <div className="mb-5 p-4 rounded-2xl bg-aqua-100 border-2 border-aqua-200 flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-aqua-700 shrink-0" />
          <p className="text-sm text-navy-700 font-bold">
            Data Privacy acknowledged — AI will assist your teacher in grading.
          </p>
        </div>

        {sub && sub.status === 'PENDING' && !resubmitMode ? (
          /* ── EXISTING SUBMISSION VIEW ── */
          <div className="space-y-4">
            <div className="tg-card p-6">
              <h2 className="font-display font-extrabold text-navy-700 mb-4 flex items-center gap-2">
                <Eye className="w-4 h-4 text-royal-500" /> Your Submitted Output
              </h2>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="tg-pill bg-sun-100 text-sun-800">
                  <Clock className="w-3 h-3" /> Awaiting Teacher Review
                </span>
                {/* Only rendered when there is a real timestamp. The fallback
                    was `sub.updatedAt || Date.now()`, which read the clock
                    during render and, more to the point, stamped a submission
                    with "now" when the server had not told us when it landed. */}
                {sub.updatedAt && (
                  <span className="text-xs font-semibold text-navy-400">
                    Submitted {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {sub.imageUrl && (
                <div className="rounded-2xl overflow-hidden border-2 border-cream-200 bg-cream-50">
                  <SubmissionImage url={sub.imageUrl} alt="Your submitted work" className="w-full object-contain max-h-[600px]" />
                </div>
              )}
            </div>

            {selected.maxAttempts === 0 || (sub.attemptCount || 1) < (selected.maxAttempts || 1) ? (
              <>
                <button
                  onClick={() => setResubmitMode(true)}
                  className="w-full py-4 bg-sun-400 text-navy-700 rounded-3xl font-extrabold text-lg shadow-pop
                             hover:bg-sun-300 active:translate-y-1 active:shadow-none transition-all
                             flex items-center justify-center gap-3"
                >
                  <RefreshCw className="w-5 h-5" /> Re-submit Work
                </button>
                <p className="text-[11px] font-semibold text-navy-400 text-center">
                  {selected.maxAttempts === 0
                    ? `Attempt ${sub.attemptCount || 1}. You can re-submit as many times as you need.`
                    : `Attempt ${sub.attemptCount || 1} of ${selected.maxAttempts || 1}.`} Re-submitting will replace your current submission.
                </p>
              </>
            ) : (
              <div className="w-full py-4 bg-cream-200 text-navy-400 rounded-3xl font-extrabold text-lg text-center">
                All {selected.maxAttempts || 1} attempt(s) used
              </div>
            )}
          </div>
        ) : isClosed ? (
          /* The window is enforced by the server too — this screen only ever
             coloured the date red and still let the button through, so a
             student who had never submitted could upload weeks late. */
          <div className="bg-white border-2 border-red-200 rounded-3xl p-6 text-center">
            <Clock className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="font-display text-lg font-extrabold text-navy-700 mb-1">This activity is closed</p>
            <p className="text-sm text-navy-500">
              {acceptsLate
                ? `Late submissions were accepted until ${formatDeadline(selected.lateUntil, { month: 'long', day: 'numeric', year: 'numeric' })}.`
                : `It closed on ${formatDeadline(selected.deadline, { month: 'long', day: 'numeric', year: 'numeric' })}.`}
              {' '}Talk to your teacher if you still need to submit.
            </p>
          </div>
        ) : (
          /* ── UPLOAD FORM ── */
          <>
            {/* Still open, but past the due date: say so plainly before they
                upload rather than surprising them with a LATE tag afterwards. */}
            {isLate && (
              <div className="mb-5 bg-amber-50 border-2 border-amber-300 rounded-3xl p-5 flex items-start gap-3">
                <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-extrabold text-navy-700">This will be marked late</p>
                  <p className="text-sm text-navy-600 mt-0.5 leading-relaxed">
                    The due date was {formatDeadline(selected.deadline, { month: 'long', day: 'numeric' })}.
                    You can still submit until {formatDeadline(selected.lateUntil, { month: 'long', day: 'numeric' })} —
                    your teacher will see that it came in late and decide how to mark it.
                  </p>
                </div>
              </div>
            )}

            {/* Handwriting tip */}
            <div className="mb-5 bg-sun-100 border-2 border-sun-200 rounded-3xl p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-sun-700 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-navy-700 leading-relaxed">
                    Important: Please ensure your handwritten essay is written clearly and legibly using dark ink on clean paper. Messy or unclear handwriting may result in inaccurate AI grading.
                  </p>
                  <p className="text-sm text-navy-600 mt-2 font-bold">For best results:</p>
                  <ul className="text-sm text-navy-600 mt-1 space-y-0.5 ml-1">
                    <li>• Use a ballpoint pen with dark ink</li>
                    <li>• Write on clean, unlined or lightly-lined paper</li>
                    <li>• Avoid smudges and crossing out</li>
                    <li>• Make sure the photo is well-lit and in focus</li>
                  </ul>
                </div>
              </div>
            </div>

            {resubmitMode && (
              <div className="mb-5 p-4 rounded-2xl bg-sun-100 border-2 border-sun-200 flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-sun-700 shrink-0" />
                <div>
                  <p className="text-sm text-navy-700 font-bold">Re-submitting will replace your previous submission.</p>
                  <button onClick={() => setResubmitMode(false)} className="text-xs font-bold text-sun-800 underline hover:text-navy-700 mt-0.5">
                    Cancel re-submit
                  </button>
                </div>
              </div>
            )}

            {/* Upload area */}
            <div className="mb-6">
              <h2 className="text-xs font-extrabold text-navy-400 uppercase tracking-wider mb-3">
                {resubmitMode ? 'Upload New Essay' : 'Upload Your Essay'}
              </h2>
              <div
                onClick={() => files.length === 0 && fileRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); handleFile(e); }}
                onDragOver={e => e.preventDefault()}
                className={cn('border-2 border-dashed rounded-3xl transition-all',
                  previews.length > 0
                    ? 'border-cream-300 p-4 bg-white'
                    : 'border-cream-300 hover:border-royal-400 hover:bg-royal-50 cursor-pointer bg-white')}
              >
                {previews.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {previews.map((prev, idx) => (
                        <div key={idx} className="relative group rounded-2xl overflow-hidden border-2 border-cream-200 aspect-[3/4]">
                          {prev?.document ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-cream-100 p-3 text-center">
                              <FileText className="w-8 h-8 text-navy-900/40" />
                              <span className="text-[10px] font-bold text-navy-900/70 break-all line-clamp-3">{prev.document}</span>
                            </div>
                          ) : (
                            <img src={prev} alt={`page ${idx+1}`} className="w-full h-full object-cover" />
                          )}
                          <div className="absolute top-2 left-2 bg-navy-900/70 text-white text-[10px] px-2 py-1 rounded-lg font-bold">
                            Page {idx + 1}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                            className="absolute top-2 right-2 bg-red-500 text-white w-7 h-7 flex items-center justify-center rounded-full reveal-on-hover hover:bg-red-600 shadow-pop">
                            <span className="text-xs font-bold">✕</span>
                            <span className="sr-only">Remove page {idx + 1}</span>
                          </button>
                        </div>
                      ))}
                      {files.length < 20 && (
                        <button type="button" onClick={() => fileRef.current?.click()}
                          className="rounded-2xl border-2 border-dashed border-cream-300 flex flex-col items-center justify-center text-navy-400 hover:border-royal-400 hover:bg-royal-50 cursor-pointer aspect-[3/4] transition-all">
                          <Camera className="w-6 h-6 mb-2 text-navy-300" />
                          <span className="text-xs font-extrabold">Add Page</span>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between bg-royal-100 px-4 py-3 rounded-2xl border-2 border-royal-200">
                      <span className="text-sm font-extrabold text-royal-800">{files.length} page(s) attached</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 flex flex-col items-center justify-center text-navy-400">
                    <div className="bg-royal-100 p-5 rounded-3xl mb-4"><Camera className="w-8 h-8 text-royal-600" /></div>
                    <p className="font-display font-extrabold text-navy-700 mb-1">Take a photo of your essay</p>
                    <p className="text-sm font-semibold">or drag &amp; drop an image, PDF, or Word file</p>
                    <div className="mt-4 flex items-center text-royal-700 font-extrabold text-sm">
                      <UploadCloud className="w-4 h-4 mr-1.5" /> Browse Files
                    </div>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="hidden" onChange={handleFile} />
              </div>
            </div>

            {/* Submit */}
            {files.length > 0 && (
              <>
                <button onClick={handleSubmit} disabled={isSubmitting}
                  className="w-full py-4 bg-royal-600 text-white rounded-3xl font-extrabold text-lg shadow-pop
                             hover:bg-royal-700 active:translate-y-1 active:shadow-none transition-all
                             disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-3">
                  {isSubmitting ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</>
                  ) : (
                    <><UploadCloud className="w-5 h-5" /> {resubmitMode ? 'Re-submit Work' : 'Submit Work'}</>
                  )}
                </button>
                <p className="text-[11px] font-semibold text-navy-400 text-center mt-3">
                  ⚠️ AI feedback uses daily processing tokens. Submitting many outputs in a day may result in delayed feedback.
                </p>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── SCREEN 1: ACTIVITY LIST ───────────────────────────────────────
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      {showPrivacyModal && privacyModal}

      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-navy-700 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mb-6">
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Submit Your Work</h1>
        <p className="text-navy-500 text-sm font-semibold mt-1">Choose an activity to view details and upload your work</p>
      </div>

      {savedListNotice}

      {activities.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-cream-300 rounded-[2rem] px-6">
          {listUnreachable ? (
            <>
              <CloudOff className="w-10 h-10 mx-auto mb-3 text-navy-300" />
              <p className="text-sm font-bold text-navy-500">We couldn't load your activities</p>
              <p className="text-xs font-semibold text-navy-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                You may be offline. Once you've opened this page with a signal, your activities are kept here
                so you can still submit the next time you lose it.
              </p>
            </>
          ) : (
            <>
              <FileText className="w-10 h-10 mx-auto mb-3 text-navy-300" />
              <p className="text-sm font-bold text-navy-500">No activities assigned yet</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(activity => {
            const sub = activity.mySubmission;
            const StatusIcon = sub ? (STATUS_LABEL[sub.status]?.icon || Clock) : null;
            const subWindow = submissionWindow(activity);

            return (
              <button key={activity.id} onClick={() => handleSelectActivity(activity)}
                className="w-full text-left p-5 rounded-3xl border-2 border-slate-200 bg-white
                           hover:border-royal-400 hover:-translate-y-0.5 hover:shadow-card transition-all group">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2.5 rounded-2xl bg-royal-100 text-royal-700 shrink-0 group-hover:bg-royal-500 group-hover:text-white transition-colors">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-navy-700 truncate">{activity.title}</p>
                      <p className="text-xs text-navy-500 truncate">{activity.className} • {activity.type} • {activity.points} pts</p>
                      {activity.deadline && (
                        <p className={cn('text-xs mt-0.5 font-semibold',
                          subWindow.isClosed ? 'text-red-500' : subWindow.isLate ? 'text-amber-600' : 'text-navy-400')}>
                          {subWindow.isClosed
                            ? '⏰ Closed'
                            : subWindow.isLate
                              ? `⚠ Late — accepted until ${formatDeadline(activity.lateUntil)}`
                              : `Due: ${formatDeadline(activity.deadline)}`}
                        </p>
                      )}
                      {(activity.maxAttempts === 0 || activity.maxAttempts > 1) && (
                        <p className="text-xs text-navy-400 mt-0.5 font-semibold">
                          {activity.maxAttempts === 0
                            ? (sub ? `Attempt ${sub.attemptCount || 1} · Unlimited re-submits` : 'Unlimited re-submits')
                            : (sub ? `Attempt ${sub.attemptCount || 1}/${activity.maxAttempts}` : `${activity.maxAttempts} attempts allowed`)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {sub && StatusIcon && (
                      <span className={cn('tg-pill whitespace-nowrap', STATUS_LABEL[sub.status]?.color)}>
                        <StatusIcon className="w-3 h-3" /> {STATUS_LABEL[sub.status]?.label}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-navy-300 group-hover:text-royal-600 transition-colors" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
