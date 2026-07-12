import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, UploadCloud, X, Play, CheckCircle2, Clock, Loader2, User, Wifi, WifiOff, Trash2, AlertTriangle, Info, ShieldCheck } from 'lucide-react';
import { getQueue, buildJob, enqueue, flushQueue } from '../../utils/offlineQueue';
import { API_URL } from '../../config';
import ImageRedactor from '../../components/ImageRedactor';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS = {
  waiting:    { label: 'Waiting',    color: 'bg-slate-100 text-slate-500',   icon: Clock },
  processing: { label: 'Processing', color: 'bg-blue-100 text-blue-600',     icon: Loader2 },
  ready:      { label: 'AI Graded',  color: 'bg-green-100 text-green-600',   icon: CheckCircle2 },
  mock:       { label: 'AI Failed',  color: 'bg-red-100 text-red-600',       icon: X },
  notext:     { label: 'No Text',    color: 'bg-amber-100 text-amber-700',   icon: Clock },
  queued:     { label: 'Queued',     color: 'bg-amber-100 text-amber-700',   icon: Clock },
  error:      { label: 'Error',      color: 'bg-red-100 text-red-600',       icon: X },
  privacy:    { label: 'Name Detected', color: 'bg-red-100 text-red-600',    icon: AlertTriangle },
};

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

  const [files, setFiles] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activityMeta, setActivityMeta] = useState(null);
  const [activitySubmissions, setActivitySubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(getQueue().length);
  const [isFlushing, setIsFlushing] = useState(false);
  const [piiConfirmed, setPiiConfirmed] = useState(false);
  const [redactingFileId, setRedactingFileId] = useState(null);  // id of file being redacted
  const fileInputRef = useRef(null);

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
    if (!activityId || activityMeta?.submissionMode !== 'STUDENT_SUBMIT') return;
    setIsLoadingSubmissions(true);
    fetch(`${API_URL}/api/activities/${activityId}/submissions`)
      .then(r => r.json())
      .then(d => { if (d.success) setActivitySubmissions(d.submissions || []); })
      .finally(() => setIsLoadingSubmissions(false));
  }, [activityId, activityMeta?.submissionMode]);

  const handleFileDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer?.files || e.target.files || []);
    const imageFiles = dropped.filter(f => f.type.startsWith('image/'));
    setFiles(prev => [...prev, ...imageFiles.map(f => ({
      file: f, id: Math.random().toString(36).slice(2),
      status: 'waiting', preview: URL.createObjectURL(f)
    }))]);
  };

  const removeFile = (id) => setFiles(prev => prev.filter(f => f.id !== id));

  const handleRetakeFile = (id, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFiles(prev => prev.map(f => f.id === id ? {
      ...f, file, status: 'waiting', preview: URL.createObjectURL(file), statusDetail: undefined, aiSource: undefined, aiScore: undefined, submissionId: undefined
    } : f));
  };

  const handleRedactFile = (fileId) => setRedactingFileId(fileId);
  const handleRedactConfirm = (redactedBlob) => {
    const redactedFile = new File([redactedBlob], 'redacted.jpg', { type: 'image/jpeg' });
    setFiles(prev => prev.map(f => f.id === redactingFileId ? {
      ...f, file: redactedFile, preview: URL.createObjectURL(redactedBlob)
    } : f));
    setRedactingFileId(null);
  };
  const handleRedactCancel = () => setRedactingFileId(null);

  const handleGrade = async () => {
    if (!files.length) return;
    // REQUIRE student selection AND PII confirmation before grading
    if (!selectedStudent) {
      alert('⚠️ Please select a student before starting AI grading. Each submission must be assigned to a student.');
      return;
    }
    if (!piiConfirmed) {
      alert('⚠️ Please confirm that the student\'s name is not visible in the image before grading.');
      return;
    }
    setIsRunning(true);
    const newResults = [];

    for (const fileItem of files) {
      if (fileItem.status !== 'waiting') continue;
      setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'processing' } : f));

      const formData = new FormData();
      formData.append('image', fileItem.file);
      formData.append('studentId', selectedStudent || students[0]?.id || 'mock-student-id');
      formData.append('activityId', activityId || 'mock-activity-id');

      if (!navigator.onLine) {
        // Queue for later
        const job = buildJob(`${API_URL}/api/teacher/upload`, {
          studentId: selectedStudent || students[0]?.id || 'mock-student-id',
          activityId: activityId || 'mock-activity-id'
        }, fileItem.file);
        enqueue(job);
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'queued' } : f));
        setQueuedCount(getQueue().length);
        continue;
      }

      try {
        const res = await fetch(`${API_URL}/api/teacher/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok && data.privacyViolation) {
          setFiles(prev => prev.map(f => f.id === fileItem.id ? {
            ...f, status: 'privacy',
            statusDetail: '🔒 ' + (data.error || 'Student name detected. Please retake the photo.')
          } : f));
          continue;
        } else if (data.success) {
          // Determine actual status from AI response
          let fileStatus = 'ready';
          let statusDetail = `✅ AI Score: ${data.aiResult?.score}/100`;
          if (data.aiSource === 'mock') {
            fileStatus = 'mock';
            statusDetail = `⚠ AI unavailable: ${(data.aiError || 'Unknown error').slice(0, 80)}`;
          } else if (data.noTextDetected) {
            fileStatus = 'notext';
            statusDetail = '⚠ No readable text detected in image';
          }
          setFiles(prev => prev.map(f => f.id === fileItem.id ? {
            ...f, status: fileStatus, submissionId: data.submission.id,
            aiSource: data.aiSource, aiScore: data.aiResult?.score, statusDetail
          } : f));
          newResults.push(data.submission);
        } else {
          // Auto-delete files that fail AI processing or are rejected
          setFiles(prev => prev.filter(f => f.id !== fileItem.id));
        }
      } catch {
        // Network error — queue it
        const job = buildJob(`${API_URL}/api/teacher/upload`, {
          studentId: selectedStudent || students[0]?.id || 'mock-student-id',
          activityId: activityId || 'mock-activity-id'
        }, fileItem.file);
        enqueue(job);
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'queued' } : f));
        setQueuedCount(getQueue().length);
      }
    }

    setResults(newResults);
    setIsRunning(false);
    if (newResults.length > 0) navigate(`/teacher/review/${newResults[0].id}`);
  };

  const handleFlushQueue = async () => {
    setIsFlushing(true);
    const result = await flushQueue();
    setQueuedCount(getQueue().length);
    setIsFlushing(false);
    alert(`Queue flushed: ${result.succeeded} succeeded, ${result.failed} failed`);
  };

  const hasWaiting = files.some(f => f.status === 'waiting');
  const hasQueued = files.some(f => f.status === 'queued');
  const normalizedSearch = studentSearch.trim().toLowerCase();
  const filteredStudents = students.filter((s) => {
    if (!normalizedSearch) return true;
    return s.name.toLowerCase().includes(normalizedSearch) || s.username.toLowerCase().includes(normalizedSearch);
  });
  const selectedStudentLabel = selectedStudent
    ? students.find(s => s.id === selectedStudent)
    : null;
  const isStudentSubmitMode = activityMeta?.submissionMode === 'STUDENT_SUBMIT';
  const submissionsByStudentId = activitySubmissions.reduce((map, sub) => {
    map[sub.studentId] = sub;
    return map;
  }, {});

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6 pb-24">
      {/* PII Redactor Overlay */}
      {redactingFileId && (
        <ImageRedactor
          imageSrc={files.find(f => f.id === redactingFileId)?.preview}
          onConfirm={handleRedactConfirm}
          onCancel={handleRedactCancel}
        />
      )}

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
        <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>
        {!isStudentSubmitMode && hasWaiting && !isRunning && !selectedStudent && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Please select a student below before grading.
        </div>
      )}
      {!isStudentSubmitMode && hasWaiting && !isRunning && (
        <button onClick={handleGrade}
          disabled={!selectedStudent || !piiConfirmed}
          className={cn('px-4 py-2 rounded-lg text-sm font-bold flex items-center shadow-md',
            selectedStudent && piiConfirmed
              ? 'bg-brand-navy text-white hover:bg-blue-900'
              : 'bg-slate-300 text-slate-500 cursor-not-allowed')}
        >
          <Play className="w-4 h-4 mr-2" />
          {isOnline ? `Start AI Grading (${files.filter(f => f.status === 'waiting').length})` : `Queue for Upload (${files.filter(f => f.status === 'waiting').length})`}
        </button>
      )}
      {!isStudentSubmitMode && hasWaiting && !isRunning && (
        <p className="text-[11px] text-slate-400 mt-1.5">⚠️ AI feedback has a daily usage limit. Grading many papers may use up your limit for today.</p>
      )}
        {!isStudentSubmitMode && isRunning && (
          <span className="flex items-center text-brand-navy text-sm font-semibold">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isOnline ? 'Analyzing with Gemini...' : 'Saving to queue...'}
          </span>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold text-brand-slate">
          {isStudentSubmitMode ? 'Student Submissions' : 'Scan Essays'}
        </h1>
        <p className="text-slate-500 text-sm">
          {isStudentSubmitMode
            ? 'Review student-submitted outputs for this activity.'
            : 'Upload handwritten essay photos for AI grading • Works offline'}
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

      {/* Student Selector */}
      {!isStudentSubmitMode && students.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
            <User className="w-4 h-4" /> Assign to Student <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => {
                setStudentSearch(e.target.value);
                setIsDropdownOpen(true);
                if (selectedStudent) setSelectedStudent('');
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
              placeholder={selectedStudentLabel ? `${selectedStudentLabel.name} (${selectedStudentLabel.username})` : "Type to search student name or ID..."}
              className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm transition-all"
            />
            {isDropdownOpen && (
              <div className="absolute z-10 w-full mt-1 border border-slate-200 rounded-lg max-h-48 overflow-auto bg-white shadow-lg">
                {filteredStudents.length === 0 ? (
                  <p className="text-xs text-amber-600 px-4 py-3">No students match your search.</p>
                ) : (
                  filteredStudents.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent blur
                        setSelectedStudent(s.id);
                        setStudentSearch('');
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${selectedStudent === s.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="font-medium text-brand-slate">{s.name}</span>
                      <span className="text-xs text-slate-500 ml-1">({s.username})</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedStudentLabel && (
            <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3 py-2 rounded-md">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Selected: <span className="font-semibold">{selectedStudentLabel.name}</span>
            </p>
          )}
        </div>
      )}

      {/* Student Submissions */}
      {isStudentSubmitMode && (
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
                const statusKey = sub?.status || 'NONE';
                const statusCfg = SUBMISSION_STATUS[statusKey] || SUBMISSION_STATUS.NONE;
                return (
                  <div key={student.id} className="flex items-center gap-4 border border-slate-200 rounded-xl p-3">
                    <div className="w-20 h-24 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                      {sub?.imageUrl ? (
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
                      {sub?.createdAt && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          Submitted {new Date(sub.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                        </p>
                      )}
                      <span className={`inline-flex mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    {sub?.id ? (
                      <Link
                        to={`/teacher/review/${sub.id}`}
                        className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 shrink-0"
                      >
                        Review
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium shrink-0">No submission</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Drop Zone */}
      {!isStudentSubmitMode && (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleFileDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-slate-300 rounded-2xl p-10 flex flex-col items-center justify-center bg-white hover:bg-blue-50 hover:border-brand-navy transition-all cursor-pointer">
          <div className="bg-blue-50 p-4 rounded-full mb-4">
            <Camera className="w-8 h-8 text-brand-navy" />
          </div>
          <h3 className="font-bold text-brand-slate text-lg mb-1">Take Photos or Browse Files</h3>
          <p className="text-slate-400 text-sm">Drag & drop handwritten essays here</p>
          <p className="text-xs text-slate-300 mt-1">Auto-rotation & compression applied automatically</p>
          <div className="flex items-center text-brand-navy font-medium text-sm mt-3 bg-blue-50 px-4 py-2 rounded-full">
            <UploadCloud className="w-4 h-4 mr-2" /> Browse Files
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*" capture="environment" className="hidden" onChange={handleFileDrop} />
        </div>
      )}

      {/* Queue Status Grid */}
      {!isStudentSubmitMode && files.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-700 mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
            Scanned Papers ({files.length})
            {isRunning && <Loader2 className="w-4 h-4 animate-spin text-brand-navy" />}
            {hasQueued && <span className="text-amber-600 text-xs font-medium">• {files.filter(f=>f.status==='queued').length} queued offline</span>}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {files.map(item => {
              const cfg = STATUS[item.status];
              const StatusIcon = cfg.icon;
              return (
                <div key={item.id} className="relative group aspect-[3/4] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-100 shadow-sm">
                  <img src={item.preview} alt="essay" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/30" />
                  <div className={cn('absolute bottom-2 left-2 right-2 flex flex-col gap-1')}>  
                    <div className={cn('flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full', cfg.color)}>
                      <StatusIcon className={cn('w-3 h-3', item.status === 'processing' && 'animate-spin')} />
                      {cfg.label}
                      {item.aiScore !== undefined && item.status === 'ready' && <span className="ml-auto">{item.aiScore}/100</span>}
                    </div>
                    {item.statusDetail && (item.status === 'mock' || item.status === 'notext' || item.status === 'error' || item.status === 'privacy') && (
                      <div className="text-[9px] bg-black/70 text-white px-2 py-0.5 rounded-full truncate">{item.statusDetail}</div>
                    )}
                  </div>
                  {item.status === 'waiting' && (
                    <>
                      <button onClick={() => handleRedactFile(item.id)}
                        className="absolute top-2 left-2 bg-slate-900/70 text-white text-[10px] font-bold px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-900 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-red-400" /> Redact Name
                      </button>
                      <button onClick={() => removeFile(item.id)}
                        className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  {item.status === 'privacy' && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
                      <input type="file" id={`retake-${item.id}`} className="hidden" accept="image/*" onChange={(e) => handleRetakeFile(item.id, e)} />
                      <button onClick={() => document.getElementById(`retake-${item.id}`).click()} className="bg-white text-red-600 text-xs font-bold px-3 py-1.5 rounded-full shadow flex items-center gap-1">
                        <Camera className="w-3 h-3" /> Retake Image
                      </button>
                    </div>
                  )}
                  {item.status === 'ready' && item.submissionId && (
                    <button onClick={() => navigate(`/teacher/review/${item.submissionId}`)}
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                      <span className="bg-white text-brand-navy text-xs font-bold px-3 py-1.5 rounded-full shadow">Review →</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
