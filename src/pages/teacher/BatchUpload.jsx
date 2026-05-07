import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, UploadCloud, X, Play, CheckCircle2, Clock, Loader2, User, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { getQueue, buildJob, enqueue, flushQueue } from '../../utils/offlineQueue';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS = {
  waiting:    { label: 'Waiting',    color: 'bg-slate-100 text-slate-500',   icon: Clock },
  processing: { label: 'Processing', color: 'bg-blue-100 text-blue-600',     icon: Loader2 },
  ready:      { label: 'AI Graded',  color: 'bg-green-100 text-green-600',   icon: CheckCircle2 },
  mock:       { label: 'AI Failed',  color: 'bg-red-100 text-red-600',       icon: X },
  notext:     { label: 'No Text',    color: 'bg-amber-100 text-amber-700',   icon: Clock },
  queued:     { label: 'Queued',     color: 'bg-amber-100 text-amber-700',   icon: Clock },
  error:      { label: 'Error',      color: 'bg-red-100 text-red-600',       icon: X },
};

export default function BatchUpload() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activityId = searchParams.get('activityId');
  const classId = searchParams.get('classId');

  const [files, setFiles] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(getQueue().length);
  const [isFlushing, setIsFlushing] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (classId) {
      fetch(`http://localhost:3000/api/classes/${classId}`)
        .then(r => r.json())
        .then(d => { if (d.success) setStudents(d.classData?.section?.students || []); });
    }
    const goOnline = () => { setIsOnline(true); setQueuedCount(getQueue().length); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [classId]);

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

  const handleGrade = async () => {
    if (!files.length) return;
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
        const job = buildJob('http://localhost:3000/api/teacher/upload', {
          studentId: selectedStudent || students[0]?.id || 'mock-student-id',
          activityId: activityId || 'mock-activity-id'
        }, fileItem.file);
        enqueue(job);
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'queued' } : f));
        setQueuedCount(getQueue().length);
        continue;
      }

      try {
        const res = await fetch('http://localhost:3000/api/teacher/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
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
          setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'error', statusDetail: data.error || 'Upload failed' } : f));
        }
      } catch {
        // Network error — queue it
        const job = buildJob('http://localhost:3000/api/teacher/upload', {
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

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto flex flex-col gap-6">

      {/* Offline Banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span><strong>You're offline.</strong> Essays will be queued locally and uploaded automatically when you're back online.</span>
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
        <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>
        {hasWaiting && !isRunning && (
          <button onClick={handleGrade}
            className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center hover:bg-blue-900 shadow-md">
            <Play className="w-4 h-4 mr-2" />
            {isOnline ? `Start AI Grading (${files.filter(f => f.status === 'waiting').length})` : `Queue for Upload (${files.filter(f => f.status === 'waiting').length})`}
          </button>
        )}
        {isRunning && (
          <span className="flex items-center text-brand-navy text-sm font-semibold">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isOnline ? 'Analyzing with Gemini...' : 'Saving to queue...'}
          </span>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold text-brand-slate">Scan Essays</h1>
        <p className="text-slate-500 text-sm">Upload handwritten essay photos for AI grading • Works offline</p>
      </div>

      {/* Student Selector */}
      {students.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
            <User className="w-4 h-4" /> Assign to Student
          </label>
          <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
            className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
            <option value="">-- Select student --</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.username})</option>)}
          </select>
        </div>
      )}

      {/* Drop Zone */}
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

      {/* Queue Status Grid */}
      {files.length > 0 && (
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
                    {item.statusDetail && (item.status === 'mock' || item.status === 'notext' || item.status === 'error') && (
                      <div className="text-[9px] bg-black/70 text-white px-2 py-0.5 rounded-full truncate">{item.statusDetail}</div>
                    )}
                  </div>
                  {item.status === 'waiting' && (
                    <button onClick={() => removeFile(item.id)}
                      className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
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
