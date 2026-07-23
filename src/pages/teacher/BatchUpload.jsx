import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, UploadCloud, X, Loader2, Wifi, WifiOff, ShieldCheck, Info, FileText } from 'lucide-react';
import { getQueue, buildJob, enqueue, flushQueue } from '../../utils/offlineQueue';
import { API_URL } from '../../config';
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
  const classId = searchParams.get('classId');

  const [students, setStudents] = useState([]);
  const [activityMeta, setActivityMeta] = useState(null);
  const [activitySubmissions, setActivitySubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(getQueue().length);
  const [isFlushing, setIsFlushing] = useState(false);
  const [piiConfirmed, setPiiConfirmed] = useState(false);

  // Per-student staged (picked but not yet uploaded) files, and upload-in-flight tracking
  const [stagedByStudentId, setStagedByStudentId] = useState({});
  const [uploadingStudentId, setUploadingStudentId] = useState(null);
  const [redactingStudentId, setRedactingStudentId] = useState(null);
  const fileInputRef = useRef(null);
  const pendingUploadStudentId = useRef(null);

  useEffect(() => {
    if (classId) {
      fetch(`${API_URL}/api/classes/${classId}`)
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
    fetch(`${API_URL}/api/activities/${activityId}/submissions`)
      .then(r => r.json())
      .then(d => { if (d.success) setActivitySubmissions(d.submissions || []); })
      .finally(() => setIsLoadingSubmissions(false));
  }, [activityId]);

  const isStudentSubmitMode = activityMeta?.submissionMode === 'STUDENT_SUBMIT';
  const submissionsByStudentId = activitySubmissions.reduce((map, sub) => {
    map[sub.studentId] = sub;
    return map;
  }, {});
  const maxPoints = activityMeta?.points || 100;

  // ── Per-student staged upload (teacher-upload mode) ──
  const triggerFilePick = (studentId) => {
    pendingUploadStudentId.current = studentId;
    fileInputRef.current?.click();
  };

  const handleFilePicked = (e) => {
    const file = e.target.files?.[0];
    const targetStudentId = pendingUploadStudentId.current;
    e.target.value = '';
    if (!file || !targetStudentId) return;
    setStagedByStudentId(prev => ({ ...prev, [targetStudentId]: { file, preview: URL.createObjectURL(file) } }));
  };

  const cancelStaged = (studentId) => {
    setStagedByStudentId(prev => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  };

  const handleRedactConfirm = (redactedBlob) => {
    const redactedFile = new File([redactedBlob], 'redacted.jpg', { type: 'image/jpeg' });
    setStagedByStudentId(prev => ({
      ...prev,
      [redactingStudentId]: { file: redactedFile, preview: URL.createObjectURL(redactedBlob) }
    }));
    setRedactingStudentId(null);
  };
  const handleRedactCancel = () => setRedactingStudentId(null);

  const confirmUpload = async (studentId) => {
    const staged = stagedByStudentId[studentId];
    if (!staged || !piiConfirmed) return;
    setUploadingStudentId(studentId);

    if (!navigator.onLine) {
      const job = buildJob(`${API_URL}/api/teacher/upload`, { studentId, activityId, skipGrading: 'true' }, staged.file);
      enqueue(job);
      setQueuedCount(getQueue().length);
      cancelStaged(studentId);
      setUploadingStudentId(null);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('image', staged.file);
      formData.append('studentId', studentId);
      formData.append('activityId', activityId);
      formData.append('skipGrading', 'true');
      const res = await fetch(`${API_URL}/api/teacher/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setActivitySubmissions(prev => [...prev.filter(s => s.studentId !== studentId), data.submission]);
        cancelStaged(studentId);
        navigate(`/teacher/review/${data.submission.id}`);
      } else {
        alert(data.error || 'Upload failed. Please try again.');
        setUploadingStudentId(null);
      }
    } catch {
      const job = buildJob(`${API_URL}/api/teacher/upload`, { studentId, activityId, skipGrading: 'true' }, staged.file);
      enqueue(job);
      setQueuedCount(getQueue().length);
      cancelStaged(studentId);
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
      {redactingStudentId && (
        <ImageRedactor
          imageSrc={stagedByStudentId[redactingStudentId]?.preview}
          onConfirm={handleRedactConfirm}
          onCancel={handleRedactCancel}
        />
      )}

      {/* Hidden shared file input for per-student upload */}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFilePicked} />

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
            : 'Upload each student\'s essay photo — grade it now, or upload and review it later.'}
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
              const staged = !isStudentSubmitMode ? stagedByStudentId[student.id] : null;
              const statusKey = sub?.status || 'NONE';
              const statusCfg = SUBMISSION_STATUS[statusKey] || SUBMISSION_STATUS.NONE;
              const scorePercent = sub?.hitlScore ?? sub?.aiScore ?? null;
              const grade = scorePercent !== null ? Math.round((scorePercent / 100) * maxPoints) : null;
              const isUploading = uploadingStudentId === student.id;

              return (
                <div key={student.id} className="flex items-center gap-4 border border-slate-200 rounded-xl p-3">
                  <div className="w-20 h-24 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                    {staged ? (
                      <img src={staged.preview} alt="staged upload" className="w-full h-full object-cover" />
                    ) : sub?.imageUrl ? (
                      <img
                        src={sub.imageUrl.startsWith('http') ? sub.imageUrl : `${API_URL}${sub.imageUrl}`}
                        alt="submission"
                        className="w-full h-full object-cover"
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
                    {staged ? (
                      <span className="inline-flex mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        Ready to upload
                      </span>
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
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setRedactingStudentId(student.id)} title="Redact Name"
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200">
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => cancelStaged(student.id)} title="Remove"
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-red-100 hover:text-red-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button type="button" onClick={() => confirmUpload(student.id)}
                        disabled={!piiConfirmed || isUploading}
                        className={cn('text-xs px-3 py-1.5 rounded-md font-medium flex items-center gap-1',
                          piiConfirmed ? 'bg-brand-navy text-white hover:bg-blue-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
                        {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm Upload'}
                      </button>
                    </div>
                  ) : sub?.id ? (
                    <div className="flex flex-col items-center gap-1 shrink-0 w-24">
                      <button type="button" onClick={() => triggerFilePick(student.id)} disabled={!piiConfirmed}
                        title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : 'Upload a new photo (replaces the current one)'}
                        className={cn('text-xs px-3 py-1.5 rounded-md font-medium flex items-center justify-center gap-1 w-full',
                          piiConfirmed ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-100 text-slate-300 cursor-not-allowed')}>
                        <UploadCloud className="w-3.5 h-3.5" /> Upload
                      </button>
                      <Link to={`/teacher/review/${sub.id}`}
                        className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 w-full text-center">
                        Review
                      </Link>
                      {grade !== null && <span className="text-xs font-bold text-brand-slate">{grade}/{maxPoints}</span>}
                    </div>
                  ) : (
                    <button type="button" onClick={() => triggerFilePick(student.id)} disabled={!piiConfirmed}
                      title={!piiConfirmed ? 'Confirm the privacy checkbox above first' : ''}
                      className={cn('text-xs px-3 py-1.5 rounded-md font-medium flex items-center gap-1 shrink-0',
                        piiConfirmed ? 'bg-brand-navy text-white hover:bg-blue-900' : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
                      <UploadCloud className="w-3.5 h-3.5" /> Upload
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
