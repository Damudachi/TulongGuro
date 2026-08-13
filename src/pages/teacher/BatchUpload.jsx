import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, UploadCloud, X, Loader2, Wifi, WifiOff, ShieldCheck, Info, FileText, Camera, Sparkles, Plus, CheckCircle2, AlertTriangle, ClipboardCheck, RefreshCw } from 'lucide-react';
import { getQueue, buildJob, enqueue, flushQueue, QUEUE_CHANGED } from '../../utils/offlineQueue';
import { API_URL, apiFetch, MAX_SUBMISSION_PAGES } from '../../config';
import { getStoredUser } from '../../utils/session';
import { saveClassSnapshot, readClassSnapshot } from '../../utils/offlineSnapshot';
import SubmissionImage from '../../components/SubmissionImage';
import ImageRedactor from '../../components/ImageRedactor';
import { isRasterizable, rasterizeToPageImages } from '../../utils/fileRasterize';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** A PDF or Word file is rendered to page images before staging (see
 *  handleFilePicked), so by the time a page reaches this check it is almost
 *  always already an image. This only still applies to the rare file that
 *  failed to render and fell back to being staged as-is. */
const isImageFile = (file) => (file?.type || '').startsWith('image/');

/** Which learners on this activity have an upload sitting in the offline queue.
 *  Queued jobs carry the studentId and activityId they were built with, so the
 *  queue is the source of truth and nothing has to be mirrored beside it. */
const queuedStudentsFor = (activityId) => new Set(
  getQueue()
    .filter((job) => job.fields?.activityId === activityId)
    .map((job) => job.fields?.studentId)
    .filter(Boolean)
);

const SUBMISSION_STATUS = {
  PENDING: { label: 'Needs Review', color: 'bg-amber-100 text-amber-700' },
  GRADED: { label: 'Graded', color: 'bg-green-100 text-green-700' },
  NONE: { label: 'No Upload Yet', color: 'bg-slate-100 text-slate-600' },
};

export default function BatchUpload() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activityId = searchParams.get('activityId');
  // classId can be missing when we're linked here without it — resolve it from
  // the activity so the roster still loads instead of rendering "No students found".
  const [classId, setClassId] = useState(searchParams.get('classId') || '');

  const [students, setStudents] = useState([]);
  // Set when the roster came off this device rather than the server.
  const [rosterSavedAt, setRosterSavedAt] = useState(null);
  const [activityMeta, setActivityMeta] = useState(null);
  const [activitySubmissions, setActivitySubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(getQueue().length);
  // Who on this activity has work waiting to upload. Derived from the queue
  // rather than tracked alongside it, so a reload — or a flush that happened on
  // another screen — can never leave the two disagreeing.
  const [queuedStudentIds, setQueuedStudentIds] = useState(() => queuedStudentsFor(activityId));
  const [isFlushing, setIsFlushing] = useState(false);
  const [piiConfirmed, setPiiConfirmed] = useState(false);

  // ── Class-wide AI check ──
  // What one "AI-check all" press would cost, and how the run is going. The
  // check is a server-side job rather than a held-open request: a class set
  // takes minutes, which is longer than school wifi will keep a request alive.
  const [aiPlan, setAiPlan] = useState(null);     // { ready, batchSize, requestsNeeded, capacity }
  const [aiJob, setAiJob] = useState(null);
  const [isStartingAi, setIsStartingAi] = useState(false);
  const [isCancellingAi, setIsCancellingAi] = useState(false);

  // Per-student staged pages (picked but not yet uploaded), and upload-in-flight tracking.
  // Shape: { [studentId]: { pages: [{ file, preview }] } }
  const [stagedByStudentId, setStagedByStudentId] = useState({});
  const [uploadingStudentId, setUploadingStudentId] = useState(null);
  const [redacting, setRedacting] = useState(null);   // { studentId, pageIndex }
  // Forces every freshly-picked photo through the redactor before it's staged —
  // mirrors the student's own upload flow (SubmitWork.jsx), which has always
  // done this. Teacher upload used to skip it entirely: a picked photo went
  // straight into stagedByStudentId, and on submit, straight to the third-party
  // VLM with any name on it still visible. The server's privacy gate can refuse
  // to grade it afterwards, but by then the image has already left the device —
  // this stops that at the source instead of catching it after the fact. The
  // existing `redacting` state above still handles re-touching an already
  // staged page; this is the forced first pass over what was just picked.
  const [pendingRedaction, setPendingRedaction] = useState(null); // { studentId, queue: File[], index, objectUrl }
  const [privacyBlocked, setPrivacyBlocked] = useState(null); // { studentId, message } when the server refused a scan for PII
  const [preparingFiles, setPreparingFiles] = useState(false); // rendering a picked PDF/Word file to page images, before redaction
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const pendingUploadStudentId = useRef(null);

  useEffect(() => {
    if (classId || !activityId) return;
    apiFetch(`${API_URL}/api/activities/${activityId}`)
      .then(r => r.json())
      .then(d => { if (d.success && d.activity?.classId) setClassId(d.activity.classId); })
      .catch(() => {});
  }, [classId, activityId]);

  useEffect(() => {
    if (classId) {
      apiFetch(`${API_URL}/api/classes/${classId}`)
        .then(r => r.json())
        .then(d => {
          if (!d.success) return;
          setStudents(d.classData?.section?.students || []);
          const activity = d.classData?.activities?.find(a => a.id === activityId) || null;
          setActivityMeta(activity);
          saveClassSnapshot(getStoredUser().id, classId, d.classData);
        })
        .catch(() => {
          // Without a roster this page renders "No students found" and the
          // offline queue below it can never be reached — there is no way to
          // say which scanned paper belongs to whom. This is the one snapshot
          // that stores learner names, and this is what it is for.
          const snapshot = readClassSnapshot(getStoredUser().id, classId);
          if (!snapshot) return;
          setStudents(snapshot.section?.students || []);
          setActivityMeta(snapshot.activities.find(a => a.id === activityId) || null);
          setRosterSavedAt(snapshot.savedAt);
        });
    }
  }, [classId, activityId]);

  // Connectivity, kept separate from the roster read above so that switching
  // activity doesn't tear down and re-register these listeners.
  useEffect(() => {
    const syncQueue = () => {
      setQueuedCount(getQueue().length);
      setQueuedStudentIds(queuedStudentsFor(activityId));
    };
    const goOnline = () => { setIsOnline(true); syncQueue(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // The reconnect flush is started by TeacherLayout, so without this the
    // "saved on this device" pills would sit there after the work had gone.
    window.addEventListener(QUEUE_CHANGED, syncQueue);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(QUEUE_CHANGED, syncQueue);
    };
  }, [activityId]);

  useEffect(() => {
    if (!activityId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
    setIsLoadingSubmissions(true);
    apiFetch(`${API_URL}/api/activities/${activityId}/submissions`)
      .then(r => r.json())
      .then(d => { if (d.success) setActivitySubmissions(d.submissions || []); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoadingSubmissions(false));
  }, [activityId]);

  // Memoised on activityId so the effects below can depend on it honestly
  // without re-firing on every render.
  const refreshAiPlan = useCallback(() => {
    if (!activityId) return;
    apiFetch(`${API_URL}/api/teacher/activities/${activityId}/ai-check`)
      .then(r => r.json())
      .then(d => { if (d.success) setAiPlan(d); })
      .catch(() => {});
  }, [activityId]);

  useEffect(refreshAiPlan, [refreshAiPlan, activitySubmissions.length]);

  // Poll a running job. Stops as soon as the server reports it finished, so a
  // completed run costs no further requests.
  useEffect(() => {
    if (!aiJob?.jobId || aiJob.state !== 'running') return;
    const timer = setInterval(() => {
      apiFetch(`${API_URL}/api/teacher/ai-jobs/${aiJob.jobId}`)
        .then(r => r.json())
        .then(d => {
          if (!d.success) {
            // The job vanished server-side — either it genuinely doesn't
            // exist, or the server redeployed mid-batch and every in-memory
            // job (this one included) was lost with it. Without this, the
            // teacher was left on a spinner polling forever: state stayed
            // 'running' since nothing here ever changed it. bootId (present
            // even on this 404) tells the two apart.
            const restarted = d.bootId && aiJob.bootId && d.bootId !== aiJob.bootId;
            setAiJob(prev => prev && {
              ...prev,
              state: 'finished',
              stoppedMessage: restarted
                ? 'The server restarted while this check was running. Papers already checked were saved; anything still in progress was not — check the roster and re-run if needed.'
                : (d.error || 'This AI check is no longer available.')
            });
            return;
          }
          setAiJob(d);
          if (d.state !== 'running') {
            refreshAiPlan();
            // Pull the refreshed scores in so the roster reflects the run.
            apiFetch(`${API_URL}/api/activities/${activityId}/submissions`)
              .then(r => r.json())
              .then(s => { if (s.success) setActivitySubmissions(s.submissions || []); })
              .catch(() => {}) /* a failed read leaves the empty state, which is what renders */;
          }
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [aiJob?.jobId, aiJob?.state, aiJob?.bootId, activityId, refreshAiPlan]);

  /**
   * Ask the server to stop the run.
   *
   * It finishes the paper it is on and skips the rest, so what has already
   * been checked stays checked — the poll above picks up the new state on its
   * next tick and the panel switches to the finished summary.
   */
  const cancelAiCheck = async () => {
    if (!aiJob?.jobId) return;
    if (!window.confirm('Stop this AI check? Papers already checked keep their results; the rest will not be checked.')) return;
    setIsCancellingAi(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/ai-jobs/${aiJob.jobId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) {
        alert(d?.error || 'Could not stop the check. It is still running.');
        return;
      }
      setAiJob(d);
    } catch {
      alert('Could not reach the server. The check is still running.');
    } finally {
      setIsCancellingAi(false);
    }
  };

  const startAiCheck = async () => {
    setIsStartingAi(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/activities/${activityId}/ai-check`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setAiJob(data);
      else if (data.code === 'NO_RUBRIC') {
        // The rubric was removed while this screen was open, or the page was
        // loaded before it was. Re-read the plan so the panel switches to the
        // "set the rubric" card instead of leaving a button that keeps failing.
        refreshAiPlan();
        alert(data.error);
      }
      else alert(data.error || 'Could not start the AI check.');
    } catch {
      alert('Could not start the AI check. Please check your connection.');
    } finally {
      setIsStartingAi(false);
    }
  };

  const isStudentSubmitMode = activityMeta?.submissionMode === 'STUDENT_SUBMIT';
  const submissionsByStudentId = activitySubmissions.reduce((map, sub) => {
    map[sub.studentId] = sub;
    return map;
  }, {});
  const maxPoints = activityMeta?.points || 100;

  // ── Per-student staged upload (teacher-upload mode) ──
  // The cap lives in config.js and is enforced by the server; this is the same
  // number so the UI never lets a teacher stage pages that would be refused.
  const MAX_PAGES = MAX_SUBMISSION_PAGES;

  const triggerFilePick = (studentId, source = 'files') => {
    pendingUploadStudentId.current = studentId;
    (source === 'camera' ? cameraInputRef : fileInputRef).current?.click();
  };

  const handleFilePicked = async (e) => {
    const picked = Array.from(e.target.files || []);
    const targetStudentId = pendingUploadStudentId.current;
    e.target.value = '';
    if (picked.length === 0 || !targetStudentId) return;

    // A PDF or Word file is rendered to page images right here in the browser
    // first, so it can go through the exact same redaction canvas as a photo.
    // A file that fails to render (corrupt, password-protected, unusual
    // encoding) is refused rather than staged as-is: staging it un-rendered
    // would skip ImageRedactor entirely and rely solely on the server's
    // prompt-based privacy gate, which is exactly the guarantee rasterizing
    // exists to give every PDF/Word submission in the first place.
    const images = picked.filter(isImageFile);
    const toRasterize = picked.filter(f => isRasterizable(f));
    const documents = picked.filter(f => !isImageFile(f) && !isRasterizable(f));
    const failedToRender = [];

    if (toRasterize.length > 0) {
      setPreparingFiles(true);
      const existingCount = (stagedByStudentId[targetStudentId]?.pages || []).length;
      for (const f of toRasterize) {
        try {
          const remaining = MAX_PAGES - existingCount - images.length;
          const pages = await rasterizeToPageImages(f, Math.max(remaining, 1));
          images.push(...pages);
        } catch {
          failedToRender.push(f.name);
        }
      }
      setPreparingFiles(false);
    }

    if (failedToRender.length > 0) {
      alert(`Couldn't render ${failedToRender.length > 1 ? 'these files' : 'this file'} for redaction, so ${failedToRender.length > 1 ? "they weren't" : "it wasn't"} added:\n${failedToRender.map(n => `• ${n}`).join('\n')}\n\nThe file may be corrupted or password-protected. Try converting it to a PDF or image and upload again.`);
    }

    if (documents.length > 0) {
      setStagedByStudentId(prev => {
        const existing = prev[targetStudentId]?.pages || [];
        const added = documents.map(file => ({ file, preview: URL.createObjectURL(file) }));
        return { ...prev, [targetStudentId]: { pages: [...existing, ...added].slice(0, MAX_PAGES) } };
      });
    }
    if (images.length > 0) {
      setPendingRedaction({ studentId: targetStudentId, queue: images, index: 0, objectUrl: URL.createObjectURL(images[0]) });
    }
  };

  const handlePendingRedactionConfirm = (redactedBlob) => {
    const { studentId, queue, index, objectUrl } = pendingRedaction;
    URL.revokeObjectURL(objectUrl);
    const redactedFile = new File([redactedBlob], queue[index].name, { type: 'image/jpeg' });
    setStagedByStudentId(prev => {
      const existing = prev[studentId]?.pages || [];
      const added = { file: redactedFile, preview: URL.createObjectURL(redactedBlob) };
      return { ...prev, [studentId]: { pages: [...existing, added].slice(0, MAX_PAGES) } };
    });
    const nextIndex = index + 1;
    if (nextIndex < queue.length) {
      setPendingRedaction({ studentId, queue, index: nextIndex, objectUrl: URL.createObjectURL(queue[nextIndex]) });
    } else {
      setPendingRedaction(null);
    }
  };
  // A hard cancel, matching the student flow: discards every photo still
  // waiting in this pick action, not just the one on screen. A teacher who
  // backs out mid-queue can simply pick the photos again.
  const handlePendingRedactionCancel = () => {
    URL.revokeObjectURL(pendingRedaction.objectUrl);
    setPendingRedaction(null);
  };

  const cancelStaged = (studentId) => {
    setStagedByStudentId(prev => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  };

  const removePage = (studentId, pageIndex) => {
    setStagedByStudentId(prev => {
      const pages = (prev[studentId]?.pages || []).filter((_, i) => i !== pageIndex);
      if (pages.length === 0) {
        const next = { ...prev };
        delete next[studentId];
        return next;
      }
      return { ...prev, [studentId]: { pages } };
    });
  };

  const handleRedactConfirm = (redactedBlob) => {
    const { studentId, pageIndex } = redacting;
    const redactedFile = new File([redactedBlob], `redacted-${pageIndex + 1}.jpg`, { type: 'image/jpeg' });
    setStagedByStudentId(prev => {
      const pages = [...(prev[studentId]?.pages || [])];
      pages[pageIndex] = { file: redactedFile, preview: URL.createObjectURL(redactedBlob) };
      return { ...prev, [studentId]: { pages } };
    });
    setRedacting(null);
  };
  const handleRedactCancel = () => setRedacting(null);

  /**
   * Upload the staged pages for a student.
   *
   * Saves the work and nothing more — there is no longer a prompt asking whether
   * to start AI checking. Checking is a class-wide action on the bar at the
   * bottom of this screen, which is both fewer taps per pupil and the only way
   * the teacher can see what a run will cost before starting it.
   */
  const uploadStaged = async (studentId) => {
    const pages = stagedByStudentId[studentId]?.pages || [];
    if (pages.length === 0 || !piiConfirmed) return;
    setPrivacyBlocked(prev => (prev?.studentId === studentId ? null : prev));
    setUploadingStudentId(studentId);

    const queueOffline = async () => {
      // All staged pages are queued as one job, carried and flushed together —
      // matching the online path, which POSTs every page in a single multipart
      // request so the server can stitch them into one composite image.
      // Queuing them as separate jobs would flush as separate requests, each
      // overwriting the submission's image instead of being combined.
      const job = await enqueue(buildJob(`${API_URL}/api/teacher/upload`, { studentId, activityId, skipGrading: 'true' }, pages.map(p => p.file)));
      setQueuedCount(getQueue().length);
      setQueuedStudentIds(queuedStudentsFor(activityId));
      if (!job) {
        alert(`Could not save these ${pages.length} page(s) for later — this device has run out of offline storage. Please reconnect and upload now instead.`);
      }
      cancelStaged(studentId);
      setUploadingStudentId(null);
    };

    if (!navigator.onLine) return queueOffline();

    try {
      const formData = new FormData();
      pages.forEach(p => formData.append('images', p.file));
      formData.append('studentId', studentId);
      formData.append('activityId', activityId);
      formData.append('skipGrading', 'true');
      const res = await apiFetch(`${API_URL}/api/teacher/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setActivitySubmissions(prev => [...prev.filter(s => s.studentId !== studentId), data.submission]);
        cancelStaged(studentId);
        setUploadingStudentId(null);
      } else if (data.code === 'PRIVACY_VIOLATION') {
        // The server refused the scan and discarded it, so the staged pages are
        // deliberately kept: the teacher needs them to redact and retry, and
        // clearing them here would lose the only copy on this device.
        setPrivacyBlocked({ studentId, message: data.error });
        setUploadingStudentId(null);
      } else {
        alert(data.error || 'Upload failed. Please try again.');
        setUploadingStudentId(null);
      }
    } catch {
      // Only a genuine network failure should fall back to the offline queue —
      // a server that answered and said no must not be retried behind the
      // teacher's back.
      if (!navigator.onLine) return queueOffline();
      alert('Upload failed. Please check your connection and try again.');
      setUploadingStudentId(null);
    }
  };

  const handleFlushQueue = async () => {
    setIsFlushing(true);
    const result = await flushQueue();
    setQueuedCount(getQueue().length);
    setQueuedStudentIds(queuedStudentsFor(activityId));
    setIsFlushing(false);
    // A queue that was entirely dropped (every job permanently rejected by the
    // server — e.g. released elsewhere while offline) reports "0 succeeded, 0
    // failed" without this, which reads as nothing happened at all.
    let message = `Queue flushed: ${result.succeeded} succeeded, ${result.failed} failed`;
    if (result.dropped > 0) {
      message += `, ${result.dropped} could not be saved`;
      const reasons = [...new Set(result.droppedReasons.map(d => d.reason))];
      message += `:\n${reasons.map(r => `• ${r}`).join('\n')}`;
    }
    alert(message);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6 pb-24">
      {/* Rendering a picked PDF/Word file to page images, before redaction */}
      {preparingFiles && (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-3 bg-slate-900/85 backdrop-blur-sm text-white">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-bold">Preparing the file for preview…</p>
        </div>
      )}

      {/* PII Redactor Overlay — re-touching an already staged page */}
      {redacting && (
        <ImageRedactor
          imageSrc={stagedByStudentId[redacting.studentId]?.pages[redacting.pageIndex]?.preview}
          onConfirm={handleRedactConfirm}
          onCancel={handleRedactCancel}
        />
      )}

      {/* PII Redactor Overlay — forced first pass over freshly picked photos */}
      {pendingRedaction && (
        <>
          <ImageRedactor
            imageSrc={pendingRedaction.objectUrl}
            onConfirm={handlePendingRedactionConfirm}
            onCancel={handlePendingRedactionCancel}
          />
          {pendingRedaction.queue.length > 1 && (
            <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[120] bg-navy-900/85 text-white text-xs font-bold px-4 py-2 rounded-full">
              Photo {pendingRedaction.index + 1} of {pendingRedaction.queue.length}
            </div>
          )}
        </>
      )}

      {/* Hidden shared file inputs for per-student upload */}
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="hidden" onChange={handleFilePicked} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFilePicked} />

      {/* Offline Banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            <strong>You're offline.</strong>{' '}
            {queuedCount > 0
              ? <><strong>{queuedCount}</strong> paper{queuedCount > 1 ? 's' : ''} saved on this device so far — they upload automatically once you're connected again.</>
              : <>Your essays will be saved and uploaded automatically once you're connected again.</>}
            {rosterSavedAt && (
              <> This class list was saved on {new Date(rosterSavedAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric' })} —
              anyone enrolled since then won't be in it, and each upload is checked by the server when it sends.</>
            )}
          </span>
        </div>
      )}
      {isOnline && queuedCount > 0 && (
        <div className="flex items-center justify-between gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 shrink-0 text-blue-500" />
            <span><strong>{queuedCount}</strong> paper{queuedCount > 1 ? 's' : ''} queued from offline session — ready to upload.</span>
          </div>
          <button onClick={handleFlushQueue} disabled={isFlushing}
            className="shrink-0 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {isFlushing ? 'Uploading...' : 'Upload Now'}
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        {/* Back to the activity list for this class, not the dashboard. This
            screen is always reached from a specific activity, so the dashboard
            is two steps further out than where the teacher came from. */}
        <button onClick={() => navigate(classId ? `/teacher/class/${classId}` : '/teacher/dashboard')}
          className="flex items-center text-sm text-slate-500 hover:text-brand-slate">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-brand-slate">
          {isStudentSubmitMode ? 'Student Submissions' : 'Teacher Upload'}
        </h1>
        <p className="text-slate-500 text-sm">
          {isStudentSubmitMode
            ? 'Students submit their own work here. For anyone without a device, upload on their behalf using the buttons beside their name.'
            : 'Take a photo or upload each student\'s output — add multiple pages if the output spans more than one sheet. Grade it now, or save it and review it later.'}
        </p>
      </div>

      {/* PII Guard — mandatory before any upload, in either mode. It gates the
          teacher's own uploads, which are now possible for a pupil without a
          device even on a student-submit activity. */}
      <div className={cn('p-4 rounded-xl border text-sm', piiConfirmed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200')}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={piiConfirmed}
              onChange={(e) => setPiiConfirmed(e.target.checked)}
              className="mt-0.5 w-5 h-5 accent-brand-green shrink-0"
            />
            <div>
              <p className={cn('font-bold', piiConfirmed ? 'text-green-800' : 'text-amber-800')}>
                {piiConfirmed ? '✅ Privacy Confirmed' : '⚠ Privacy Act Confirmation Required'}
              </p>
              <p className={cn('text-xs mt-0.5', piiConfirmed ? 'text-green-600' : 'text-amber-600')}>
                I confirm that the student's name is covered, folded, or not visible in the uploaded image(s). No personally identifiable information (PII) is included.
              </p>
            </div>
        </label>
      </div>

      {/* Handwriting Legibility Banner */}
      {(
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-300 leading-relaxed">
              <span className="font-semibold text-blue-400">ℹ️ Note:</span> The AI works best with clear, readable handwriting. If a submission is difficult to read, the results may be inaccurate and should be reviewed manually.
            </p>
          </div>
        </div>
      )}

      {/* Student List */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        {isLoadingSubmissions ? (
          <div className="flex items-center justify-center h-32 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading submissions...
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No students found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {students.map((student) => {
              const sub = submissionsByStudentId[student.id] || null;
              const stagedPages = stagedByStudentId[student.id]?.pages || [];
              const staged = stagedPages.length > 0;
              const statusKey = sub?.status || 'NONE';
              const statusCfg = SUBMISSION_STATUS[statusKey] || SUBMISSION_STATUS.NONE;
              const scorePercent = sub?.hitlScore ?? sub?.aiScore ?? null;
              const grade = scorePercent !== null ? Math.round((scorePercent / 100) * maxPoints) : null;
              const isUploading = uploadingStudentId === student.id;

              return (
                <div key={student.id} className="flex items-center gap-4 border border-slate-200 rounded-xl p-3">
                  <div className="w-20 h-24 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative">
                    {staged ? (
                      <>
                        {isImageFile(stagedPages[0].file) ? (
                          <img src={stagedPages[0].preview} alt="staged upload" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-slate-100 px-1 text-center">
                            <FileText className="w-6 h-6 text-slate-400" />
                            <span className="text-[9px] font-bold text-slate-500 uppercase truncate max-w-full">
                              {stagedPages[0].file.name.split('.').pop()}
                            </span>
                          </div>
                        )}
                        {stagedPages.length > 1 && (
                          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                            {stagedPages.length} pages
                          </span>
                        )}
                      </>
                    ) : sub?.imageUrl ? (
                      <SubmissionImage
                        url={sub.imageUrl}
                        alt="submission"
                        className="w-full h-full object-cover"
                        compact
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                        No upload
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-brand-slate truncate">{student.name}</p>
                    <p className="text-xs text-slate-500">{student.username}</p>
                    {/* Queuing offline cleared the staged pages and said nothing,
                        so the papers appeared to vanish and the only way to find
                        out whether anything had been saved was to reconnect and
                        watch. This is the receipt: it is read from the queue, so
                        it survives a reload and disappears on its own once the
                        job has actually flushed. */}
                    {queuedStudentIds.has(student.id) && (
                      <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                        <WifiOff className="w-3 h-3" /> Saved on this device — uploads when you're back online
                      </span>
                    )}
                    {privacyBlocked?.studentId === student.id && (
                      <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-orange-50 border border-orange-300">
                        <ShieldCheck className="w-4 h-4 shrink-0 text-orange-600 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-orange-800">Not uploaded — name detected on the paper</p>
                          <p className="text-[11px] text-orange-700 mt-0.5">{privacyBlocked.message}</p>
                          <p className="text-[11px] text-orange-600 mt-1">
                            Tap a page below and use the shield button to black out the name, then upload again.
                          </p>
                        </div>
                        <button type="button" onClick={() => setPrivacyBlocked(null)}
                          title="Dismiss" className="ml-auto shrink-0 text-orange-400 hover:text-orange-700">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {staged ? (
                      <>
                        <span className="inline-flex mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          Ready to upload — {stagedPages.length} page{stagedPages.length > 1 ? 's' : ''}
                        </span>
                        {/* Both controls are always visible, never hover-only.
                            They used to appear on :hover, which does not exist
                            on the phones this is used on — so on the target
                            device the redaction tool was unreachable, and
                            covering the name is a Data Privacy Act requirement,
                            not a power-user extra. Thumbnails are also sized for
                            a fingertip rather than a cursor. */}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {stagedPages.map((page, i) => (
                            <div key={i} className="relative w-16 rounded-md border border-slate-200 overflow-hidden">
                              {isImageFile(page.file) ? (
                                <img src={page.preview} alt={`page ${i + 1}`} className="w-full h-16 object-cover" />
                              ) : (
                                <div className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-slate-100 px-1 text-center">
                                  <FileText className="w-5 h-5 text-slate-400" />
                                  <span className="text-[8px] font-bold text-slate-500 uppercase">
                                    {page.file.name.split('.').pop()}
                                  </span>
                                </div>
                              )}
                              {/* Redaction paints on a canvas, so it only applies
                                  to image pages — which, since PDF/Word are now
                                  rasterized before staging, is nearly always what's
                                  here. The rare fallback (rendering failed) is still
                                  read by the server's privacy gate before grading. */}
                              {isImageFile(page.file) ? (
                                <button type="button" onClick={() => setRedacting({ studentId: student.id, pageIndex: i })}
                                  title={`Cover the name on page ${i + 1}`}
                                  className="w-full py-1 bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-brand-navy transition-colors">
                                  <ShieldCheck className="w-3 h-3" /> Cover
                                </button>
                              ) : (
                                <div className="w-full py-1 bg-slate-200 text-slate-500 text-[10px] font-bold text-center">File</div>
                              )}
                              <button type="button" onClick={() => removePage(student.id, i)}
                                title={`Remove page ${i + 1}`} aria-label={`Remove page ${i + 1}`}
                                className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:bg-red-600 transition-colors">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          {stagedPages.length < MAX_PAGES && (
                            <button type="button" onClick={() => triggerFilePick(student.id)} title="Add another page"
                              className="w-16 h-[88px] rounded-md border-2 border-dashed border-slate-300 text-slate-400 flex flex-col items-center justify-center gap-0.5 hover:border-brand-navy hover:text-brand-navy transition-colors">
                              <Plus className="w-4 h-4" />
                              <span className="text-[10px] font-bold">Page</span>
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 flex items-start gap-1">
                          <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                          Tap <span className="font-semibold">Cover</span> on any page to black out the student&apos;s name before uploading. PDF and Word files are converted to page images so they can be redacted the same way — if a file can&apos;t be converted, it&apos;s checked for names on the server instead.
                        </p>
                      </>
                    ) : (
                      <>
                        {sub?.createdAt && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            Submitted {new Date(sub.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                          </p>
                        )}
                        <span className={`inline-flex mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      </>
                    )}
                  </div>

                  {/* In student-submit mode a pupil who has already handed work
                      in is normally just reviewed — a genuine self-submission
                      isn't the teacher's to overwrite. But once it's picked up
                      here (whether the pupil submitted it or a teacher scanned
                      it in on their behalf), a wrong file is still fixable up
                      until it's released: Replace stages a new photo through
                      the exact same redact-then-confirm flow as a first upload.
                      Once released to the student, it's locked — see the
                      matching guard in /api/teacher/upload. */}
                  {isStudentSubmitMode && sub?.id ? (
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      <Link to={`/teacher/review/${sub.id}`}
                        className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 w-full text-center">
                        Review
                      </Link>
                      {grade !== null && <span className="text-xs font-bold text-brand-slate">{grade}/{maxPoints}</span>}
                      {!sub.releasedAt && (
                        <button type="button"
                          onClick={() => {
                            if (sub.status === 'GRADED' && !window.confirm('This paper has already been validated. Replacing it will clear that grade so the new photo can be checked fresh. Continue?')) return;
                            triggerFilePick(student.id);
                          }}
                          disabled={!piiConfirmed}
                          title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : 'Wrong file, or too blurry to read? Upload a replacement.'}
                          className={cn('text-[11px] font-medium flex items-center gap-1',
                            piiConfirmed ? 'text-slate-500 hover:text-brand-navy' : 'text-slate-300 cursor-not-allowed')}>
                          <RefreshCw className="w-3 h-3" /> Replace
                        </button>
                      )}
                    </div>
                  ) : staged ? (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button type="button" onClick={() => cancelStaged(student.id)}
                        className="text-xs text-slate-400 hover:text-red-600 font-medium flex items-center gap-1">
                        <X className="w-3.5 h-3.5" /> Discard all
                      </button>
                      <button type="button" onClick={() => uploadStaged(student.id)}
                        disabled={!piiConfirmed || isUploading}
                        className={cn('text-xs px-3 py-1.5 rounded-md font-medium flex items-center gap-1',
                          piiConfirmed ? 'bg-brand-navy text-white hover:bg-blue-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
                        {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm Upload'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 shrink-0 w-28">
                      <div className="flex gap-1 w-full">
                        <button type="button" onClick={() => triggerFilePick(student.id, 'camera')} disabled={!piiConfirmed}
                          title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : 'Take a photo'}
                          className={cn('text-xs px-2 py-1.5 rounded-md font-medium flex items-center justify-center gap-1 flex-1',
                            piiConfirmed ? 'bg-brand-navy text-white hover:bg-blue-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
                          <Camera className="w-3.5 h-3.5" /> Photo
                        </button>
                        <button type="button" onClick={() => triggerFilePick(student.id)} disabled={!piiConfirmed}
                          title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : 'Choose image files (multiple pages allowed)'}
                          className={cn('text-xs px-2 py-1.5 rounded-md font-medium flex items-center justify-center gap-1 flex-1',
                            piiConfirmed ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-100 text-slate-300 cursor-not-allowed')}>
                          <UploadCloud className="w-3.5 h-3.5" /> Files
                        </button>
                      </div>
                      {sub?.id && (
                        <>
                          <Link to={`/teacher/review/${sub.id}`}
                            className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 w-full text-center">
                            Review
                          </Link>
                          {grade !== null && <span className="text-xs font-bold text-brand-slate">{grade}/{maxPoints}</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Class-wide AI check ── */}
      {(aiPlan?.ready > 0 || aiJob) && (
        <div className="tg-above-dock fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur px-4 pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
          <div className="max-w-5xl mx-auto">
            {/* Running */}
            {aiJob?.state === 'running' ? (
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-brand-navy shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-slate">
                    Checking {aiJob.done + aiJob.flagged + aiJob.failed + aiJob.superseded} of {aiJob.total} papers…
                  </p>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-brand-navy transition-all duration-500"
                      style={{ width: `${Math.round(((aiJob.done + aiJob.flagged + aiJob.failed + aiJob.superseded) / Math.max(aiJob.total, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    You can leave this page — the check keeps running.
                  </p>
                </div>
                {/* The server has always been able to stop a run; nothing ever
                    asked it to. A teacher who starts a 30-paper check on the
                    wrong activity had no way back, and the daily AI quota is
                    small enough that one mistaken run can block the rest of
                    the day's marking. Papers already checked are kept. */}
                <button onClick={cancelAiCheck} disabled={isCancellingAi}
                  title="Stop after the paper being checked right now"
                  className="shrink-0 text-xs font-bold text-slate-600 border-2 border-slate-200 px-3 py-2 rounded-lg
                             hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 transition-colors">
                  {isCancellingAi ? 'Stopping…' : 'Stop check'}
                </button>
              </div>
            ) : aiJob ? (
              /* Finished */
              <div className="flex items-center gap-3 flex-wrap">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-slate">
                    {aiJob.done} checked
                    {aiJob.flagged > 0 && <span className="text-orange-600"> · {aiJob.flagged} flagged for a name on the paper</span>}
                    {aiJob.failed > 0 && <span className="text-red-600"> · {aiJob.failed} failed</span>}
                    {aiJob.superseded > 0 && <span className="text-slate-500"> · {aiJob.superseded} already validated by a teacher, AI result discarded</span>}
                    {aiJob.skipped > 0 && <span className="text-amber-600"> · {aiJob.skipped} not reached</span>}
                  </p>
                  {aiJob.stoppedMessage && (
                    <p className="text-[11px] text-amber-700 mt-0.5 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {aiJob.stoppedMessage}
                    </p>
                  )}
                  {aiJob.realignments > 0 && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {aiJob.realignments} batch{aiJob.realignments > 1 ? 'es were' : ' was'} re-checked one paper at a time to guarantee each result went to the right student.
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setAiJob(null)}
                    className="text-xs px-3 py-2 rounded-lg font-bold text-slate-500 hover:bg-slate-100">
                    Dismiss
                  </button>
                  {aiJob.done > 0 && (
                    <button
                      onClick={() => {
                        const first = aiJob.items.find(i => i.state === 'done');
                        if (first) navigate(`/teacher/review/${first.submissionId}?queue=${activityId}`);
                      }}
                      className="text-xs px-4 py-2 rounded-lg font-bold bg-brand-navy text-white hover:bg-blue-900 flex items-center gap-1.5">
                      <ClipboardCheck className="w-4 h-4" /> Review {aiJob.done} paper{aiJob.done > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              </div>
            ) : aiPlan.hasRubric === false ? (
              /* No rubric on the activity.

                 A dead button with no explanation is the worst version of this,
                 so the panel says what is missing, why it matters, and offers
                 the two ways out — the school's own rubrics, or writing one.
                 The server refuses this case regardless (409 NO_RUBRIC); this
                 is so the teacher never has to find that out by pressing it. */
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-slate flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    No rubric set for this activity
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    AI checking needs the criteria you are marking against. Choose one of your
                    school&apos;s rubrics or write your own, and the {aiPlan.ready} waiting
                    paper{aiPlan.ready > 1 ? 's' : ''} can be checked.
                  </p>
                </div>
                <button onClick={() => navigate(`/teacher/activity/edit/${activityId}`)}
                  className="shrink-0 text-sm px-5 py-2.5 rounded-xl font-bold bg-brand-navy text-white hover:bg-blue-900 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" /> Set the rubric
                </button>
              </div>
            ) : (
              /* Ready to start */
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-slate">
                    {aiPlan.ready} paper{aiPlan.ready > 1 ? 's' : ''} ready for AI checking
                  </p>
                  {/* Shown before the teacher spends it, not after they hit the
                      wall halfway down the class list. */}
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    ≈ {aiPlan.requestsNeeded} request{aiPlan.requestsNeeded > 1 ? 's' : ''}
                    {aiPlan.batchSize > 1 && <> ({aiPlan.batchSize} papers per request)</>}
                    {aiPlan.capacity?.configured && <> · about {aiPlan.capacity.remaining} check{aiPlan.capacity.remaining === 1 ? '' : 's'} left today (estimate)</>}
                  </p>
                  {aiPlan.capacity?.configured && aiPlan.capacity.remaining < aiPlan.requestsNeeded && (
                    <p className="text-[11px] text-amber-700 mt-0.5 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      This is more than today's remaining limit. The run will check what it can and leave the rest un-scored.
                    </p>
                  )}
                </div>
                <button onClick={startAiCheck} disabled={isStartingAi}
                  className="shrink-0 text-sm px-5 py-2.5 rounded-xl font-bold bg-brand-navy text-white hover:bg-blue-900 disabled:opacity-60 flex items-center gap-2">
                  {isStartingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  AI-check {aiPlan.ready} paper{aiPlan.ready > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
