import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, UploadCloud, X, Loader2, Wifi, WifiOff, ShieldCheck, Info, FileText, Camera, Sparkles, Plus, CheckCircle2, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { getQueue, buildJob, enqueue, flushQueue } from '../../utils/offlineQueue';
import { API_URL, apiFetch } from '../../config';
import SubmissionImage from '../../components/SubmissionImage';
import ImageRedactor from '../../components/ImageRedactor';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

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
  const [activityMeta, setActivityMeta] = useState(null);
  const [activitySubmissions, setActivitySubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(getQueue().length);
  const [isFlushing, setIsFlushing] = useState(false);
  const [piiConfirmed, setPiiConfirmed] = useState(false);

  // ── Class-wide AI check ──
  // What one "AI-check all" press would cost, and how the run is going. The
  // check is a server-side job rather than a held-open request: a class set
  // takes minutes, which is longer than school wifi will keep a request alive.
  const [aiPlan, setAiPlan] = useState(null);     // { ready, batchSize, requestsNeeded, capacity }
  const [aiJob, setAiJob] = useState(null);
  const [isStartingAi, setIsStartingAi] = useState(false);

  // Per-student staged pages (picked but not yet uploaded), and upload-in-flight tracking.
  // Shape: { [studentId]: { pages: [{ file, preview }] } }
  const [stagedByStudentId, setStagedByStudentId] = useState({});
  const [uploadingStudentId, setUploadingStudentId] = useState(null);
  const [redacting, setRedacting] = useState(null);   // { studentId, pageIndex }
  const [confirmingStudent, setConfirmingStudent] = useState(null); // student pending the "start AI checking?" prompt
  const [privacyBlocked, setPrivacyBlocked] = useState(null); // { studentId, message } when the server refused a scan for PII
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
        });
    }
    const goOnline = () => { setIsOnline(true); setQueuedCount(getQueue().length); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [classId]);

  useEffect(() => {
    if (!activityId) return;
    setIsLoadingSubmissions(true);
    apiFetch(`${API_URL}/api/activities/${activityId}/submissions`)
      .then(r => r.json())
      .then(d => { if (d.success) setActivitySubmissions(d.submissions || []); })
      .finally(() => setIsLoadingSubmissions(false));
  }, [activityId]);

  const refreshAiPlan = () => {
    if (!activityId) return;
    apiFetch(`${API_URL}/api/teacher/activities/${activityId}/ai-check`)
      .then(r => r.json())
      .then(d => { if (d.success) setAiPlan(d); })
      .catch(() => {});
  };

  useEffect(refreshAiPlan, [activityId, activitySubmissions.length]);

  // Poll a running job. Stops as soon as the server reports it finished, so a
  // completed run costs no further requests.
  useEffect(() => {
    if (!aiJob?.jobId || aiJob.state !== 'running') return;
    const timer = setInterval(() => {
      apiFetch(`${API_URL}/api/teacher/ai-jobs/${aiJob.jobId}`)
        .then(r => r.json())
        .then(d => {
          if (!d.success) return;
          setAiJob(d);
          if (d.state !== 'running') {
            refreshAiPlan();
            // Pull the refreshed scores in so the roster reflects the run.
            apiFetch(`${API_URL}/api/activities/${activityId}/submissions`)
              .then(r => r.json())
              .then(s => { if (s.success) setActivitySubmissions(s.submissions || []); });
          }
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [aiJob?.jobId, aiJob?.state, activityId]);

  const startAiCheck = async () => {
    setIsStartingAi(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/activities/${activityId}/ai-check`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setAiJob(data);
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
  // Capped at 12, not 20. Pages are stitched into one image before they go to
  // the model, and the model refuses an image past roughly 62 megapixels —
  // measured as 16 pages of a 1654px-wide scan, but only 12 pages of a phone
  // photo, which the pipeline caps at 1920px wide. Allowing 20 meant a teacher
  // could stage a submission that was guaranteed to fail on both models.
  const MAX_PAGES = 12;

  const triggerFilePick = (studentId, source = 'files') => {
    pendingUploadStudentId.current = studentId;
    (source === 'camera' ? cameraInputRef : fileInputRef).current?.click();
  };

  const handleFilePicked = (e) => {
    const picked = Array.from(e.target.files || []);
    const targetStudentId = pendingUploadStudentId.current;
    e.target.value = '';
    if (picked.length === 0 || !targetStudentId) return;
    setStagedByStudentId(prev => {
      const existing = prev[targetStudentId]?.pages || [];
      const added = picked.map(file => ({ file, preview: URL.createObjectURL(file) }));
      return { ...prev, [targetStudentId]: { pages: [...existing, ...added].slice(0, MAX_PAGES) } };
    });
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
   * @param {boolean} startAiChecking — when true, jump straight to the AI review
   *   workspace after upload; when false the photo is saved for later review.
   */
  const uploadStaged = async (studentId, startAiChecking) => {
    const pages = stagedByStudentId[studentId]?.pages || [];
    if (pages.length === 0 || !piiConfirmed) return;
    setConfirmingStudent(null);
    setPrivacyBlocked(prev => (prev?.studentId === studentId ? null : prev));
    setUploadingStudentId(studentId);

    const queueOffline = async () => {
      // The offline queue carries one image per job, so multi-page outputs are
      // queued as separate pages and re-stitched server-side on flush.
      // Sequential because enqueue() encodes each photo and checks the shared
      // storage budget — running them together can overshoot it.
      let queued = 0;
      for (const p of pages) {
        const job = await enqueue(buildJob(`${API_URL}/api/teacher/upload`, { studentId, activityId, skipGrading: 'true' }, p.file));
        if (job) queued++;
      }
      setQueuedCount(getQueue().length);
      if (queued < pages.length) {
        alert(`Only ${queued} of ${pages.length} page(s) could be saved for later — this device has run out of offline storage. Please reconnect and upload the rest.`);
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
        if (startAiChecking) {
          navigate(`/teacher/review/${data.submission.id}`);
        } else {
          setUploadingStudentId(null);
        }
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
    setIsFlushing(false);
    alert(`Queue flushed: ${result.succeeded} succeeded, ${result.failed} failed`);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6 pb-24">
      {/* PII Redactor Overlay */}
      {redacting && (
        <ImageRedactor
          imageSrc={stagedByStudentId[redacting.studentId]?.pages[redacting.pageIndex]?.preview}
          onConfirm={handleRedactConfirm}
          onCancel={handleRedactCancel}
        />
      )}

      {/* "Start AI checking now?" confirmation */}
      {confirmingStudent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-blue-50 text-brand-navy rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-brand-slate mb-1">Start AI checking now?</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Upload {(stagedByStudentId[confirmingStudent.id]?.pages || []).length} page(s) for{' '}
                <span className="font-semibold text-brand-slate">{confirmingStudent.name}</span>. You can have the AI
                check it right away, or just save the photo and review it later.
              </p>
            </div>
            <div className="px-6 pb-6 flex flex-col gap-2">
              <button onClick={() => uploadStaged(confirmingStudent.id, true)}
                className="w-full py-3 bg-brand-navy text-white rounded-xl font-bold hover:bg-blue-900 transition-colors flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4" /> Yes, start AI checking
              </button>
              <button onClick={() => uploadStaged(confirmingStudent.id, false)}
                className="w-full py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                No, just save it for later
              </button>
              <button onClick={() => setConfirmingStudent(null)}
                className="w-full py-2 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden shared file inputs for per-student upload */}
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFilePicked} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFilePicked} />

      {/* Offline Banner */}
      {!isStudentSubmitMode && !isOnline && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span><strong>You're offline.</strong> Your essays will be saved and uploaded automatically once you're connected again. </span>
        </div>
      )}
      {!isStudentSubmitMode && isOnline && queuedCount > 0 && (
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
        <button onClick={() => navigate('/teacher/dashboard')} className="flex items-center text-sm text-slate-500 hover:text-brand-slate">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-brand-slate">
          {isStudentSubmitMode ? 'Student Submissions' : 'Teacher Upload'}
        </h1>
        <p className="text-slate-500 text-sm">
          {isStudentSubmitMode
            ? 'Review student-submitted outputs for this activity.'
            : 'Take a photo or upload each student\'s output — add multiple pages if the output spans more than one sheet. Grade it now, or save it and review it later.'}
        </p>
      </div>

      {/* PII Guard — Mandatory Privacy Confirmation */}
      {!isStudentSubmitMode && (
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
      )}

      {/* Handwriting Legibility Banner */}
      {!isStudentSubmitMode && (
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
              const stagedPages = !isStudentSubmitMode ? (stagedByStudentId[student.id]?.pages || []) : [];
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
                        <img src={stagedPages[0].preview} alt="staged upload" className="w-full h-full object-cover" />
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
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {stagedPages.map((page, i) => (
                            <div key={i} className="relative w-10 h-12 rounded-md overflow-hidden border border-slate-200 group/page">
                              <img src={page.preview} alt={`page ${i + 1}`} className="w-full h-full object-cover" />
                              <button type="button" onClick={() => setRedacting({ studentId: student.id, pageIndex: i })}
                                title={`Redact name on page ${i + 1}`}
                                className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover/page:opacity-100 transition-opacity flex items-center justify-center">
                                <ShieldCheck className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => removePage(student.id, i)} title={`Remove page ${i + 1}`}
                                className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/page:opacity-100 transition-opacity">
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ))}
                          {stagedPages.length < MAX_PAGES && (
                            <button type="button" onClick={() => triggerFilePick(student.id)} title="Add another page"
                              className="w-10 h-12 rounded-md border-2 border-dashed border-slate-300 text-slate-400 flex items-center justify-center hover:border-brand-navy hover:text-brand-navy transition-colors">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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

                  {isStudentSubmitMode ? (
                    sub?.id ? (
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <Link to={`/teacher/review/${sub.id}`}
                          className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900">
                          Review
                        </Link>
                        {grade !== null && <span className="text-xs font-bold text-brand-slate">{grade}/{maxPoints}</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium shrink-0">No submission</span>
                    )
                  ) : staged ? (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button type="button" onClick={() => cancelStaged(student.id)}
                        className="text-xs text-slate-400 hover:text-red-600 font-medium flex items-center gap-1">
                        <X className="w-3.5 h-3.5" /> Discard all
                      </button>
                      <button type="button" onClick={() => setConfirmingStudent(student)}
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
      {!isStudentSubmitMode && (aiPlan?.ready > 0 || aiJob) && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
          <div className="max-w-5xl mx-auto">
            {/* Running */}
            {aiJob?.state === 'running' ? (
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-brand-navy shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-slate">
                    Checking {aiJob.done + aiJob.flagged + aiJob.failed} of {aiJob.total} papers…
                  </p>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-brand-navy transition-all duration-500"
                      style={{ width: `${Math.round(((aiJob.done + aiJob.flagged + aiJob.failed) / Math.max(aiJob.total, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    You can leave this page — the check keeps running.
                  </p>
                </div>
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
