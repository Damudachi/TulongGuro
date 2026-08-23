import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, UploadCloud, X, Loader2, Wifi, WifiOff, ShieldCheck, Info, FileText, Camera, Sparkles, Plus, CheckCircle2, AlertTriangle, ClipboardCheck, Send, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { getQueue, buildJob, enqueue, flushQueue, QUEUE_CHANGED } from '../../utils/offlineQueue';
import { API_URL, apiFetch, MAX_SUBMISSION_PAGES } from '../../config';
import { getStoredUser } from '../../utils/session';
import { saveClassSnapshot, readClassSnapshot } from '../../utils/offlineSnapshot';
import SubmissionImage from '../../components/SubmissionImage';
import ImageRedactor from '../../components/ImageRedactor';
import { isRasterizable, rasterizeToPageImages } from '../../utils/fileRasterize';
import { pageCountOf, isFileSubmission, splitSubmissionIntoPages } from '../../utils/submissionPages';

import { showAlert, showConfirm } from '../../utils/dialog';
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
  NEEDS_GRADING:    { label: 'Needs Grading',    color: 'bg-amber-100 text-amber-700' },
  NEEDS_VALIDATION: { label: 'Needs Validation', color: 'bg-orange-100 text-orange-700' },
  VALIDATED:        { label: 'Validated',         color: 'bg-blue-100 text-blue-700' },
  RELEASED:         { label: 'Released',          color: 'bg-green-100 text-green-700' },
  NONE:             { label: 'No Upload Yet',     color: 'bg-slate-100 text-slate-600' },
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

  // ── Grade release ──
  const [releaseState, setReleaseState] = useState(null);  // { total, reviewed, released, readyToRelease }
  const [isReleasing, setIsReleasing] = useState(false);

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
  // VLM with any name on it still visible. Nothing downstream catches that: the
  // server-side privacy gate was removed once it was clear it fired only after
  // the image had already left the device, and cost a paid-for grading to do it.
  // Redaction here, before the upload, is now the only thing standing in the
  // way — which is why this pass is forced rather than offered. The
  // existing `redacting` state above still handles re-touching an already
  // staged page; this is the forced first pass over what was just picked.
  const [pendingRedaction, setPendingRedaction] = useState(null); // { studentId, queue: File[], index, objectUrl }
  const [privacyBlocked, setPrivacyBlocked] = useState(null); // { studentId, message } when the server refused a scan for PII
  const [preparingFiles, setPreparingFiles] = useState(false); // rendering a picked PDF/Word file to page images, before redaction
  /** Rows with a delete in flight, so the row's controls can't be pressed twice. */
  const [removingStudentIds, setRemovingStudentIds] = useState(new Set());
  /** Rows whose staged pages came out of a submission already on file, rather
   *  than off the camera — i.e. an Edit Upload in progress. Confirming one is a
   *  replacement, and dropping its last page means deleting the submission. */
  const [editingStudentIds, setEditingStudentIds] = useState(new Set());
  /** Rows whose stored image is being fetched and cut back into pages. */
  const [openingEditStudentId, setOpeningEditStudentId] = useState(null);
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

  // ── Release state ──
  const loadReleaseState = useCallback(() => {
    if (!activityId) return;
    apiFetch(`${API_URL}/api/teacher/activities/${activityId}/release`)
      .then(r => r.json())
      .then(d => { if (d.success) setReleaseState(d); })
      .catch(() => {});
  }, [activityId]);

  useEffect(() => { loadReleaseState(); }, [loadReleaseState]);
  // Refresh release counts whenever the submission list changes.
  useEffect(() => { if (activitySubmissions.length > 0) loadReleaseState(); }, [activitySubmissions.length, loadReleaseState]);

  const releaseAll = async () => {
    if (!activityId) return;
    const count = releaseState?.readyToRelease || 0;
    if (count === 0) return;
    if (!(await showConfirm(`Release ${count} validated grade${count > 1 ? 's' : ''} to students? They will be able to see their scores and feedback.`,
      { confirmLabel: 'Release grades' }))) return;
    setIsReleasing(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/activities/${activityId}/release`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // Refresh submissions so badges update to Released.
        const subsRes = await apiFetch(`${API_URL}/api/activities/${activityId}/submissions`);
        const subsData = await subsRes.json();
        if (subsData.success) setActivitySubmissions(subsData.submissions || []);
        loadReleaseState();
      } else {
        showAlert(data.error || 'Could not release the results.');
      }
    } catch {
      showAlert('Could not release the results. Please check your connection.');
    } finally {
      setIsReleasing(false);
    }
  };

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
    if (!(await showConfirm('Stop this AI check? Papers already checked keep their results; the rest will not be checked.',
      { confirmLabel: 'Stop the check', cancelLabel: 'Keep checking', danger: true }))) return;
    setIsCancellingAi(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/ai-jobs/${aiJob.jobId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) {
        showAlert(d?.error || 'Could not stop the check. It is still running.');
        return;
      }
      setAiJob(d);
    } catch {
      showAlert('Could not reach the server. The check is still running.');
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
        showAlert(data.error);
      }
      else showAlert(data.error || 'Could not start the AI check.');
    } catch {
      showAlert('Could not start the AI check. Please check your connection.');
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

  /**
   * Pick a replacement for work that is already on file.
   *
   * Same staging path as a first upload — redact, then Confirm Upload — with
   * the two things that only apply to a replacement said up front: a released
   * result cannot be swapped underneath the learner (the server refuses it in
   * /api/teacher/upload), and replacing a validated paper drops the grade,
   * because that grade was awarded to a different piece of work.
   */
  const requestReplace = async (studentId, sub, source = 'files') => {
    if (sub?.releasedAt) {
      showAlert('This result has already been released to the student, so the photo can no longer be replaced.');
      return;
    }
    if (sub?.status === 'GRADED' &&
      !(await showConfirm('This paper has already been validated. Replacing it will clear that grade so the new photo can be checked fresh. Continue?',
        { confirmLabel: 'Replace the photo', danger: true }))) return;
    // triggerFilePick calls .click() on a hidden <input type="file">, which a
    // browser only honours while a user gesture is still active. The await
    // above resolves inside the dialog button's own click handler, so the
    // activation is the dialog's rather than this button's — still a real
    // gesture, and still inside its window.
    triggerFilePick(studentId, source);
  };

  /**
   * Take a released result back so the work can be redone.
   *
   * "Released — locked" was the whole of what this row offered once a mark went
   * out, and locked meant locked: the photo could not be replaced, the AI could
   * not be re-run, the submission could not be removed. Every one of those
   * refusals protects the learner from a mark changing under them, and together
   * they left the one mistake teachers actually make — validating and releasing
   * the wrong paper — with no route back through the app at all.
   *
   * This is that route. It withdraws the result rather than editing it: the
   * learner stops seeing the mark and is told the work is being looked at
   * again, and the row returns to the same "checked, not yet validated" state a
   * fresh scan lands in — so Replace File, Re-take Photo and Re-check with AI
   * all become available in the usual places, and the teacher goes back through
   * the flow they already know.
   *
   * The marking is not thrown away here. Uploading a replacement clears it (the
   * grade belonged to a different paper), but a teacher who reopens, looks
   * again and decides the mark was right can simply validate and release it
   * again.
   */
  const reopenSubmission = async (student, sub) => {
    if (!sub?.id || !sub.releasedAt) return;
    const studentId = student.id;
    if (!(await showConfirm(
      'Take this result back so it can be redone?\n\n'
      + `${student.name || 'This learner'} will stop seeing the grade and will be told the work is being checked again. `
      + 'You can then replace the file, re-check it with the AI, and release it once more.',
      { title: 'Re-submit this work', confirmLabel: 'Take it back', cancelLabel: 'Leave it released' }))) return;

    setRemovingStudentIds(prev => new Set(prev).add(studentId));
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/submissions/${sub.id}/reopen`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Patched in place rather than refetched, so the row's buttons swap
        // over immediately — the teacher's next click is the replacement they
        // opened this for.
        setActivitySubmissions(prev => prev.map(x =>
          x.id === sub.id ? { ...x, releasedAt: null, status: 'PENDING' } : x));
        loadReleaseState();
      } else {
        showAlert(data.error || 'Could not take this result back. It is still released.');
      }
    } catch {
      showAlert('Could not reach the server. This result is still released.');
    } finally {
      setRemovingStudentIds(prev => { const next = new Set(prev); next.delete(studentId); return next; });
    }
  };

  /**
   * Take the work off the activity entirely, putting the learner back to "not
   * handed in".
   *
   * The gap this closes: Replace swaps the photo and Add Photo/File stitches
   * another page under it, so every route through this screen ended in a
   * submission existing. Scan a paper against the wrong name, run an AI check on
   * it, and there was no way back — the row stayed, the mark stayed with it, and
   * the roster kept reading as though that learner had submitted.
   *
   * The confirm names what goes, because it is more than a photo: the AI score,
   * a validated grade if there is one, and the feedback all live on that row and
   * all go with it. The record of who marked what survives in the audit log by
   * design (GradingAuditLog.submissionId is SetNull, not Cascade).
   */
  const removeSubmission = async (studentId, sub) => {
    if (!sub?.id) return;
    if (sub.releasedAt) {
      showAlert('This result has already been released to the student, so it can no longer be removed.');
      return;
    }
    const hasGrade = sub.hitlScore != null || sub.aiScore != null;
    if (!(await showConfirm(
      hasGrade
        ? 'Remove this submission? The photo and the grade and feedback on it are deleted, and this learner goes back to "not handed in". This cannot be undone.'
        : 'Remove this submission? The photo is deleted and this learner goes back to "not handed in". This cannot be undone.',
      { confirmLabel: 'Remove submission', danger: true }))) return;

    setRemovingStudentIds(prev => new Set(prev).add(studentId));
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/submissions/${sub.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Dropped from local state rather than refetched: the row is gone, and
        // a reload would flash the old one back for as long as the request took.
        setActivitySubmissions(prev => prev.filter(x => x.id !== sub.id));
        // Ends any Edit Upload open on this row: the submission its pages were
        // read out of no longer exists, so a Save would re-create it.
        cancelStaged(studentId);
        loadReleaseState();
      } else {
        showAlert(data.error || 'Could not remove this submission. Nothing has been deleted.');
      }
    } catch {
      showAlert('Could not reach the server. Nothing has been deleted.');
    } finally {
      setRemovingStudentIds(prev => { const next = new Set(prev); next.delete(studentId); return next; });
    }
  };

  /**
   * Open work that is already on file back into the staging tray.
   *
   * "Add Page" and "Remove" used to sit here as two separate one-way doors, and
   * neither could do what a teacher opening them usually wants: look at what
   * went up and fix it. Add Page could only append, Remove could only delete
   * the lot, and picking one page out of a stitched image was not possible at
   * all — a duplicated or unreadable page cost the whole submission and every
   * good page in it.
   *
   * So this puts the upload back into the same tray a fresh one is staged in:
   * the stored image is fetched and cut at the page boundaries the server
   * recorded, and each page becomes a thumbnail again — with its X to drop it,
   * its Cover button to redact it, and the + Page tile to add another. Confirm
   * Replace sends the whole set back, which is a path that already existed and
   * is already tested.
   *
   * Work uploaded before those boundaries were recorded, and work handed in as
   * a PDF or Word file, opens as a single page: pages can still be added, but
   * nothing here knows where to cut a document whose seams were never written
   * down, and guessing would delete part of a child's answer.
   */
  const editUpload = async (studentId, sub) => {
    if (!sub?.id) return;
    if (sub.releasedAt) {
      showAlert('This result has already been released to the student, so the pages can no longer be changed.');
      return;
    }
    if (isFileSubmission(sub.imageUrl)) {
      showAlert('This was handed in as a PDF or Word file, so its pages cannot be edited here. Use Replace File to swap it for another one.');
      return;
    }
    if (sub.status === 'GRADED' &&
      !(await showConfirm('This paper has already been validated. Editing its pages will clear that grade so the new set can be checked fresh. Continue?',
        { confirmLabel: 'Edit the pages', danger: true }))) return;

    setOpeningEditStudentId(studentId);
    try {
      const files = await splitSubmissionIntoPages(sub);
      setStagedByStudentId(prev => ({
        ...prev,
        [studentId]: { pages: files.map(file => ({ file, preview: URL.createObjectURL(file) })) },
      }));
      setEditingStudentIds(prev => new Set(prev).add(studentId));
    } catch {
      showAlert('Could not open this upload for editing — the stored photo could not be read. You can still use Replace File or Re-take Photo to send a new copy.');
    } finally {
      setOpeningEditStudentId(null);
    }
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
    // would skip ImageRedactor entirely, and there is no server-side
    // privacy gate behind it — covering the name here is exactly the guarantee
    // rasterizing exists to give every PDF/Word submission in the first place.
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
      showAlert(`Couldn't render ${failedToRender.length > 1 ? 'these files' : 'this file'} for redaction, so ${failedToRender.length > 1 ? "they weren't" : "it wasn't"} added:\n${failedToRender.map(n => `• ${n}`).join('\n')}\n\nThe file may be corrupted or password-protected. Try converting it to a PDF or image and upload again.`);
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
    setEditingStudentIds(prev => {
      if (!prev.has(studentId)) return prev;
      const next = new Set(prev);
      next.delete(studentId);
      return next;
    });
  };

  /**
   * Drop one staged page.
   *
   * On an Edit Upload, taking the last page out is how a whole submission is
   * deleted — there is no separate Remove button on the row any more, and a
   * submission with no pages is not a thing that can be saved. It goes through
   * removeSubmission, so it asks first and says what goes with it; declining
   * leaves the page where it was.
   */
  const removePage = async (studentId, pageIndex) => {
    const pages = stagedByStudentId[studentId]?.pages || [];
    if (pages.length <= 1 && editingStudentIds.has(studentId)) {
      const sub = submissionsByStudentId[studentId];
      if (sub?.id) {
        await removeSubmission(studentId, sub);
        return;
      }
    }
    setStagedByStudentId(prev => {
      const remaining = (prev[studentId]?.pages || []).filter((_, i) => i !== pageIndex);
      if (remaining.length === 0) {
        const next = { ...prev };
        delete next[studentId];
        return next;
      }
      return { ...prev, [studentId]: { pages: remaining } };
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
      // No appendPages flag: what is in the tray is the whole document, on a
      // first upload and on an Edit Upload alike, so the server always takes
      // the staged pages as the submission rather than stitching them under a
      // copy of themselves.
      const fields = { studentId, activityId, skipGrading: 'true' };
      const job = await enqueue(buildJob(`${API_URL}/api/teacher/upload`, fields, pages.map(p => p.file)));
      setQueuedCount(getQueue().length);
      setQueuedStudentIds(queuedStudentsFor(activityId));
      if (!job) {
        showAlert(`Could not save these ${pages.length} page(s) for later — this device has run out of offline storage. Please reconnect and upload now instead.`);
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
        showAlert(data.error || 'Upload failed. Please try again.');
        setUploadingStudentId(null);
      }
    } catch {
      // Only a genuine network failure should fall back to the offline queue —
      // a server that answered and said no must not be retried behind the
      // teacher's back.
      if (!navigator.onLine) return queueOffline();
      showAlert('Upload failed. Please check your connection and try again.');
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
    showAlert(message);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6 pb-24">
      {/* Rendering a picked PDF/Word file to page images, before redaction */}
      {preparingFiles && (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-3 bg-ink-900/85 backdrop-blur-sm text-white">
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
            <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[120] bg-ink-900/85 text-white text-xs font-bold px-4 py-2 rounded-full">
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

      {/* ── Return All Grades button ── */}
      {releaseState && releaseState.readyToRelease > 0 && (
        <div className="flex items-center justify-between gap-3 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-900">
              {releaseState.readyToRelease} validated grade{releaseState.readyToRelease > 1 ? 's' : ''} ready to return
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              {releaseState.released > 0 && <>{releaseState.released} already released · </>}
              {releaseState.total - releaseState.reviewed > 0 && <>{releaseState.total - releaseState.reviewed} still unreviewed</>}
            </p>
          </div>
          <button
            onClick={releaseAll}
            disabled={isReleasing}
            className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm"
          >
            {isReleasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {isReleasing ? 'Releasing…' : `Return All Grades`}
          </button>
        </div>
      )}
      {releaseState && releaseState.readyToRelease === 0 && releaseState.released > 0 && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
          <span>All {releaseState.released} validated grade{releaseState.released > 1 ? 's have' : ' has'} been released to students.</span>
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
              // Four-way status: Needs Grading (no score), Needs Validation (AI scored, not validated),
              // Validated (teacher approved, not released), Released (visible to student).
              const statusKey = sub?.status === 'GRADED'
                ? (sub.releasedAt ? 'RELEASED' : 'VALIDATED')
                : sub?.status === 'PENDING'
                  ? ((sub.aiScore !== null && sub.aiScore !== undefined) ? 'NEEDS_VALIDATION' : 'NEEDS_GRADING')
                  : 'NONE';
              const statusCfg = SUBMISSION_STATUS[statusKey] || SUBMISSION_STATUS.NONE;
              const scorePercent = sub?.hitlScore ?? sub?.aiScore ?? null;
              const grade = scorePercent !== null ? Math.round((scorePercent / 100) * maxPoints) : null;
              const isUploading = uploadingStudentId === student.id;
              // A submission row is not the same thing as work handed in:
              // enrolling a learner back-fills one PENDING row per activity so
              // the roster can list everybody as awaiting work (see REAL_WORK in
              // access.js). Offering "Replace" against one of those would be
              // offering to replace nothing — this is the row that has something
              // in it to replace.
              const hasWork = !!(sub && (sub.imageUrl || scorePercent !== null));

              return (
                /* Wraps on a phone rather than holding three columns side by
                   side. At 360px the middle column was squeezed to about two
                   characters wide, so the privacy hint set itself one word per
                   line and ran straight underneath the buttons — see the
                   `min-w-0` and the full-width action column below, which are
                   the other half of the same fix. */
                <div key={student.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-3 sm:gap-4 border border-slate-200 rounded-xl p-3">
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
                  <div className="flex-1 min-w-[9rem]">
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
                        {/* An edit is described as an edit. It ends in the same
                            replacement upload, but "Ready to replace" in front
                            of the pages a teacher just opened reads as though
                            their work is about to be thrown away. */}
                        <span className={cn('inline-flex mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full',
                          editingStudentIds.has(student.id) ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
                          {editingStudentIds.has(student.id)
                            ? `Editing — ${stagedPages.length} page${stagedPages.length > 1 ? 's' : ''}`
                            : `Ready to ${hasWork ? 'replace' : 'upload'} — ${stagedPages.length} page${stagedPages.length > 1 ? 's' : ''}`}
                        </span>
                        {hasWork && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            {editingStudentIds.has(student.id)
                              ? 'Add or remove pages, then Save changes. Nothing on file changes until you do'
                              : 'This will take the place of the work already on file'}
                            {sub?.status === 'GRADED' ? ', and clears its grade so the new pages can be checked fresh' : ''}.
                          </p>
                        )}
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
                                  here. In the rare fallback (rendering failed) the
                                  page goes up un-redacted — the grader is told to
                                  ignore any name it sees, but nothing covers it. */}
                              {isImageFile(page.file) ? (
                                <button type="button" onClick={() => setRedacting({ studentId: student.id, pageIndex: i })}
                                  title={`Cover the name on page ${i + 1}`}
                                  className="w-full py-1 bg-ink-800 text-white text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-brand-navy transition-colors">
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
                        <span className={`inline-flex items-center gap-1 mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${statusCfg.color}`}>
                          {statusKey === 'RELEASED' && <CheckCircle2 className="w-3 h-3" />}
                          {statusCfg.label}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Staged pages come first, in both modes.
                      Replace used to be unreachable for exactly the pupils it
                      was written for: in student-submit mode the branch below
                      won on `sub?.id` alone, so picking a replacement staged the
                      photo, drew the thumbnails and the Cover button — and then
                      still showed Review/Replace, with no Confirm Upload
                      anywhere on the row. The pages sat there until the page was
                      reloaded, which is what "I can't replace a submission"
                      looks like from the teacher's side. Whatever is staged is
                      the thing that needs finishing, so it decides the column. */}
                  {staged ? (
                    <div className="flex flex-col items-stretch sm:items-end gap-1.5 shrink-0 w-full sm:w-auto">
                      {sub?.id && (
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                          editingStudentIds.has(student.id)
                            ? 'text-green-700 bg-green-50 border border-green-200'
                            : 'text-blue-700 bg-blue-50 border border-blue-200')}>
                          {editingStudentIds.has(student.id) ? 'Editing pages' : 'Replacing'}
                        </span>
                      )}
                      {/* "Discard" on an edit throws away the changes, not the
                          work — the submission is untouched until Save. Saying
                          "Discard all" there read as though it would take the
                          upload with it. */}
                      <button type="button" onClick={() => cancelStaged(student.id)}
                        className="text-xs text-slate-400 hover:text-red-600 font-medium flex items-center gap-1">
                        <X className="w-3.5 h-3.5" />
                        {editingStudentIds.has(student.id) ? 'Cancel edit' : 'Discard all'}
                      </button>
                      <button type="button" onClick={() => uploadStaged(student.id)}
                        disabled={!piiConfirmed || isUploading}
                        className={cn('text-xs px-3 py-1.5 rounded-md font-medium flex items-center gap-1',
                          piiConfirmed ? 'bg-brand-navy text-white hover:bg-blue-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
                        {isUploading
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : !sub?.id ? 'Confirm Upload'
                            : editingStudentIds.has(student.id) ? 'Save changes'
                              : 'Confirm Replace'}
                      </button>
                      {/* The way out of an upload entirely, kept inside the
                          edit rather than on the row — where it sat next to
                          Review and was pressed by teachers meaning to change
                          one page. Dropping the last page still lands here, but
                          only as a consequence; a teacher who opened this to
                          get rid of the whole thing should not have to work out
                          that deleting pages one at a time is how. Not gated on
                          the privacy checkbox: that confirms what is being sent
                          up, and this only deletes. */}
                      {editingStudentIds.has(student.id) && sub?.id && (
                        <button type="button" onClick={() => removeSubmission(student.id, sub)}
                          disabled={removingStudentIds.has(student.id)}
                          title="Delete this work and its grade — the learner goes back to not handed in"
                          className="text-[11px] font-medium flex items-center gap-1 text-red-500 hover:text-red-700 disabled:opacity-40">
                          {removingStudentIds.has(student.id)
                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Removing…</>
                            : <><Trash2 className="w-3 h-3" /> Remove all pages</>}
                        </button>
                      )}
                    </div>
                  ) : hasWork ? (
                    /* Work is already on file, however it got here — a pupil
                       submitted it, or the teacher scanned it in. It is reviewed
                       from here, and a wrong or unreadable file is still fixable
                       until it is released: Replace stages a new photo through
                       the exact same redact-then-confirm flow as a first upload.
                       Once released to the student it is locked — see the
                       matching guard in /api/teacher/upload — and Re-submit is
                       the one key to that lock (see reopenSubmission). */
                    <div className="flex flex-col items-center gap-1.5 shrink-0 w-full sm:w-28">
                      <Link to={`/teacher/review/${sub.id}`}
                        className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 w-full text-center">
                        Review
                      </Link>
                      {grade !== null && <span className="text-xs font-bold text-brand-slate">{grade}/{maxPoints}</span>}
                      {sub.releasedAt ? (
                        <>
                          <span className="text-[11px] text-slate-400 text-center leading-tight">
                            Released — locked
                          </span>
                          {/* The way out of a released mark that is wrong.
                              Deliberately plain rather than a primary button:
                              taking a grade back off a learner is the unusual
                              path, and the common case here is a teacher
                              reading the row, not fixing it. Not gated on the
                              privacy checkbox — nothing is uploaded by this,
                              and the replacement it leads to is gated on its
                              own. */}
                          <button type="button" onClick={() => reopenSubmission(student, sub)}
                            disabled={removingStudentIds.has(student.id)}
                            title="Take this result back so the work can be replaced and checked again. The learner stops seeing the grade."
                            className="text-[11px] font-medium flex items-center justify-center gap-1 w-full text-brand-navy hover:underline disabled:opacity-40">
                            {removingStudentIds.has(student.id)
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Reopening…</>
                              : <><RotateCcw className="w-3 h-3" /> Re-submit</>}
                          </button>
                        </>
                      ) : (
                        <>
                          {/* "Replace File" and "Re-take Photo" both replace
                              what is on file — they differ only in where the
                              new copy comes from, and the old labels ("Replace"
                              against "Re-take photo") did not say that, which
                              read as two buttons doing the same thing. Named
                              for the source now: one opens the file picker, the
                              other opens the camera. */}
                          <button type="button" onClick={() => requestReplace(student.id, sub)}
                            disabled={!piiConfirmed || removingStudentIds.has(student.id)}
                            title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : 'Swap this work for a file from your device — the current one is discarded'}
                            className={cn('text-xs px-2 py-1.5 rounded-md font-medium flex items-center justify-center gap-1 w-full border',
                              piiConfirmed
                                ? 'border-slate-200 bg-white text-slate-600 hover:border-brand-navy hover:text-brand-navy'
                                : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed')}>
                            <UploadCloud className="w-3 h-3" /> Replace File
                          </button>
                          {/* The camera is the way most replacements are taken —
                              the paper is in the teacher's hand. On a phone the
                              file picker offers it too, but only after a detour
                              through the gallery. */}
                          <button type="button" onClick={() => requestReplace(student.id, sub, 'camera')}
                            disabled={!piiConfirmed || removingStudentIds.has(student.id)}
                            title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : 'Swap this work for a new photo from the camera — the current one is discarded'}
                            className={cn('text-xs px-2 py-1.5 rounded-md font-medium flex items-center justify-center gap-1 w-full border',
                              piiConfirmed
                                ? 'border-slate-200 bg-white text-slate-600 hover:border-brand-navy hover:text-brand-navy'
                                : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed')}>
                            <Camera className="w-3 h-3" /> Re-take Photo
                          </button>
                          <div className="w-full border-t border-slate-100 my-0.5" />
                          {/* One door instead of two one-way ones. "Add Page"
                              could only append and "Remove" could only delete
                              the whole submission, so the ordinary thing a
                              teacher wants here — look at what went up and fix
                              the one page that is wrong — was the one thing
                              neither could do. This opens the upload back into
                              the staging tray it was sent from: every page as a
                              thumbnail with its own X, the + Page tile beside
                              them, and Save changes at the end. Deleting the
                              whole thing is still here — it is what taking the
                              last page out means, and it still asks first. */}
                          <button type="button" onClick={() => editUpload(student.id, sub)}
                            disabled={!piiConfirmed || removingStudentIds.has(student.id) || openingEditStudentId === student.id}
                            title={!piiConfirmed
                              ? 'Confirm the privacy checkbox above first'
                              : 'Open the pages of this upload — remove one, add another, or cover a name'}
                            className={cn('text-xs px-2 py-1.5 rounded-md font-medium flex items-center justify-center gap-1 w-full border',
                              piiConfirmed
                                ? 'border-green-200 bg-green-50 text-green-700 hover:border-green-400 hover:bg-green-100'
                                : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed')}>
                            {openingEditStudentId === student.id
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Opening…</>
                              : <><Pencil className="w-3 h-3" /> Edit Upload{pageCountOf(sub) > 1 ? ` (${pageCountOf(sub)} pages)` : ''}</>}
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 shrink-0 w-full sm:w-28">
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
                      {/* A placeholder row with nothing in it yet still has a
                          review screen, which is where a mark can be typed in
                          for work that was never photographed. */}
                      {sub?.id && (
                        <Link to={`/teacher/review/${sub.id}`}
                          className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 w-full text-center">
                          Review
                        </Link>
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
        /* md:left-64 — the width of the teacher sidebar, same as ScoreEntry's
           bar. Spanning the full viewport instead put this over the rail's
           account block, which is where Sign Out lives on desktop: the way out
           of the app was covered for as long as papers were waiting. */
        <div className="tg-above-dock fixed bottom-0 left-0 right-0 md:left-64 z-40 border-t border-slate-200 bg-white/95 backdrop-blur px-4 pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
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
