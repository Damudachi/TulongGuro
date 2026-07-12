import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, UploadCloud, FileText, CheckCircle2, Clock, Loader2, Sparkles, ChevronRight, AlertTriangle, ShieldCheck, X, BookOpen, Calendar, Award, RefreshCw, Eye } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_LABEL = {
  PENDING: { label: 'Awaiting Teacher Review', color: 'text-amber-600 bg-amber-50', icon: Clock },
  GRADED:  { label: 'Graded & Released',       color: 'text-green-600 bg-green-50',  icon: CheckCircle2 },
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
  const [isLoading, setIsLoading] = useState(true);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [resubmitMode, setResubmitMode] = useState(false);
  const fileRef = useRef(null);

  // Track whether we arrived via a direct link (so "Back" goes to dashboard)
  const [cameFromLink, setCameFromLink] = useState(false);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/student/${user.id}/activities`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setActivities(d.activities);
          // Auto-select activity from URL param
          const activityIdParam = searchParams.get('activityId');
          if (activityIdParam) {
            const match = d.activities.find(a => a.id === activityIdParam);
            if (match) {
              setCameFromLink(true);
              setSelected(match);
              setShowPrivacyModal(true);
            }
          }
        }
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

  const handleFile = (e) => {
    const selectedFiles = Array.from(e.target.files || e.dataTransfer?.files || []);
    if (selectedFiles.length === 0) return;
    const newFiles = [...files, ...selectedFiles].slice(0, 20);
    setFiles(newFiles);
    const newPreviews = newFiles.map(f => URL.createObjectURL(f));
    setPreviews(newPreviews);
    setResult(null);
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
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const formData = new FormData();
      files.forEach(f => formData.append('images', f));
      formData.append('studentId', user.id);
      formData.append('activityId', selected.id);

      const res = await fetch(`${API_URL}/api/student/submit`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        const activitiesRes = await fetch(`${API_URL}/api/student/${user.id}/activities`);
        const activitiesData = await activitiesRes.json();
        if (activitiesData.success) setActivities(activitiesData.activities);
      } else {
        alert('Submission failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-brand-green" /></div>;

  const pending = activities.filter(a => !a.mySubmission || a.mySubmission.status === 'PENDING');

  // ─── DATA PRIVACY MODAL ────────────────────────────────────────────
  const PrivacyModal = () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in-up">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-center relative">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Data Privacy Notice</h2>
          <p className="text-blue-100 text-sm mt-1">Please read before proceeding</p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm text-blue-900 font-medium leading-relaxed">
              🤖 <strong>AI Processing:</strong> Your submitted work will be analyzed by an AI system (Google Gemini) to assist your teacher in grading. Your teacher will always review and finalize your grade.
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-900 font-medium leading-relaxed">
              🔒 <strong>Privacy Reminder:</strong> Please ensure that your <strong>name and any personally identifiable information (PII) are NOT visible</strong> in the photo of your work. This helps protect your privacy during AI processing.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              By clicking "I Understand & Confirm", you acknowledge that:
            </p>
            <ul className="text-xs text-slate-600 mt-2 space-y-1 ml-1">
              <li>• Your work will be processed by AI for grading assistance</li>
              <li>• Your teacher makes the final grading decision</li>
              <li>• No personal information is visible in your submission photos</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handlePrivacyCancel}
            className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePrivacyConfirm}
            className="flex-1 py-3 bg-brand-green text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" /> I Understand & Confirm
          </button>
        </div>
      </div>
    </div>
  );

  // ─── SUCCESS RESULT SCREEN ─────────────────────────────────────────
  if (result) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-brand-green to-emerald-600 text-white p-8 rounded-2xl text-center shadow-lg">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 opacity-90" />
            <h2 className="text-2xl font-extrabold mb-2">Output Submitted!</h2>
            <p className="text-green-100 text-sm">Your essay has been received and is now awaiting teacher review.</p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setSelected(null); setFiles([]); setPreviews([]); setResult(null); setPrivacyConfirmed(false); }}
              className="flex-1 py-3 border border-slate-200 rounded-xl font-medium text-slate-600 hover:bg-slate-50">
              Submit Another
            </button>
            <button onClick={() => navigate('/student/dashboard')}
              className="flex-1 py-3 bg-brand-green text-white rounded-xl font-medium hover:bg-emerald-600 flex items-center justify-center gap-2">
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
    const isPastDeadline = selected.deadline && new Date(selected.deadline) < new Date();
    const dueDate = selected.deadline ? new Date(selected.deadline) : null;

    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
        {/* Back Button */}
        <button onClick={handleBack} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>

        {/* Assignment Details Header */}
        <div className="bg-gradient-to-br from-brand-navy to-blue-800 text-white p-6 rounded-2xl mb-6 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5"><BookOpen className="w-40 h-40" /></div>
          <div className="relative z-10">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-blue-100 uppercase tracking-wider">
              {selected.type}
            </span>
            <h1 className="text-2xl font-bold mt-3 mb-1">{selected.title}</h1>
            <p className="text-blue-200 text-sm">{selected.className}</p>

            <div className="flex gap-3 mt-5 flex-wrap">
              <div className="bg-white/15 px-4 py-2.5 rounded-xl backdrop-blur-sm">
                <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 text-blue-200">Points</span>
                <span className="text-lg font-bold flex items-center"><Award className="w-4 h-4 mr-1.5" /> {selected.points}</span>
              </div>
              {dueDate && (
                <div className={cn("px-4 py-2.5 rounded-xl backdrop-blur-sm", isPastDeadline ? "bg-red-500/30" : "bg-white/15")}>
                  <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 text-blue-200">Due Date</span>
                  <span className="text-lg font-bold flex items-center">
                    <Calendar className="w-4 h-4 mr-1.5" />
                    {dueDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}
              {sub && (
                <div className="bg-white/15 px-4 py-2.5 rounded-xl backdrop-blur-sm">
                  <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 text-blue-200">Status</span>
                  <span className="text-sm font-bold flex items-center gap-1">
                    {sub.status === 'GRADED' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                    {STATUS_LABEL[sub.status]?.label || sub.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        {selected.instructions && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm">
            <h2 className="text-sm font-bold text-brand-slate mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-navy" /> Instructions
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{selected.instructions}</p>
          </div>
        )}

        {/* Privacy confirmed badge */}
        <div className="mb-4 p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800 font-medium">
            ✅ Data Privacy acknowledged — AI will assist your teacher in grading.
          </p>
        </div>

        {/* Show existing submission OR upload form */}
        {sub && sub.status === 'PENDING' && !resubmitMode ? (
          /* ── EXISTING SUBMISSION VIEW ── */
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-bold text-brand-slate mb-4 flex items-center gap-2">
                <Eye className="w-4 h-4 text-brand-navy" /> Your Submitted Output
              </h2>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold px-3 py-1.5 rounded-full text-amber-600 bg-amber-50 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Awaiting Teacher Review
                </span>
                <span className="text-xs text-slate-400">
                  Submitted {new Date(sub.updatedAt || Date.now()).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              {sub.imageUrl && (
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                  <img src={`${API_URL}${sub.imageUrl}`} alt="Your submitted work" className="w-full object-contain max-h-[600px]" />
                </div>
              )}
            </div>

            <button
              onClick={() => setResubmitMode(true)}
              className="w-full py-4 bg-amber-500 text-white rounded-2xl font-bold text-lg hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-3"
            >
              <RefreshCw className="w-5 h-5" /> Re-submit Work
            </button>
            <p className="text-[11px] text-slate-400 text-center">
              Re-submitting will replace your current submission. Your teacher has not graded it yet.
            </p>
          </div>
        ) : (
          /* ── UPLOAD FORM ── */
          <>
            {/* Handwriting tip */}
            <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-400 leading-relaxed">
                    ⚠️ Important: Please ensure your handwritten essay is written clearly and legibly using dark ink on clean paper. Messy or unclear handwriting may result in inaccurate AI grading.
                  </p>
                  <p className="text-sm text-amber-400/80 mt-2 font-medium">For best results:</p>
                  <ul className="text-sm text-amber-400/80 mt-1 space-y-0.5 ml-1">
                    <li>• Use a ballpoint pen with dark ink</li>
                    <li>• Write on clean, unlined or lightly-lined paper</li>
                    <li>• Avoid smudges and crossing out</li>
                    <li>• Make sure the photo is well-lit and in focus</li>
                  </ul>
                </div>
              </div>
            </div>

            {resubmitMode && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-sm text-amber-800 font-medium">Re-submitting will replace your previous submission.</p>
                  <button onClick={() => setResubmitMode(false)} className="text-xs text-amber-600 underline hover:text-amber-800 mt-0.5">Cancel re-submit</button>
                </div>
              </div>
            )}

            {/* Upload Area */}
            <div className="mb-6">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">{resubmitMode ? 'Upload New Essay' : 'Upload Your Essay'}</h2>
              <div
                onClick={() => files.length === 0 && fileRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); handleFile(e); }}
                onDragOver={e => e.preventDefault()}
                className={cn('border-2 border-dashed rounded-2xl transition-all',
                  previews.length > 0 ? 'border-slate-200 p-4' : 'border-slate-300 hover:border-brand-green/60 hover:bg-green-50/30 cursor-pointer')}
              >
                {previews.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {previews.map((prev, idx) => (
                        <div key={idx} className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-[3/4]">
                          <img src={prev} alt={`page ${idx+1}`} className="w-full h-full object-cover" />
                          <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-md font-bold">
                            Page {idx + 1}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                            className="absolute top-2 right-2 bg-red-500 text-white w-6 h-6 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow-md">
                            <span className="text-xs font-bold font-sans">✕</span>
                            <span className="sr-only">Remove</span>
                          </button>
                        </div>
                      ))}
                      {files.length < 20 && (
                        <div onClick={() => fileRef.current?.click()} className="rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-brand-green/60 hover:bg-green-50/30 cursor-pointer aspect-[3/4] transition-all">
                          <Camera className="w-6 h-6 mb-2 text-slate-300" />
                          <span className="text-xs font-bold text-slate-400">Add Page</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-xl border border-green-200">
                      <span className="text-sm font-bold text-green-800">{files.length} page(s) attached</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-10 flex flex-col items-center justify-center text-slate-400">
                    <div className="bg-green-50 p-4 rounded-full mb-4"><Camera className="w-8 h-8 text-brand-green" /></div>
                    <p className="font-bold text-slate-600 mb-1">Take a photo of your essay</p>
                    <p className="text-sm">or drag & drop an image file</p>
                    <div className="mt-4 flex items-center text-brand-green font-medium text-sm">
                      <UploadCloud className="w-4 h-4 mr-1" /> Browse Files
                    </div>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handleFile} />
              </div>
            </div>

            {/* Submit Button */}
            {files.length > 0 && (
              <>
                <button onClick={handleSubmit} disabled={isSubmitting}
                  className="w-full py-4 bg-brand-green text-white rounded-2xl font-bold text-lg hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-60 flex items-center justify-center gap-3">
                  {isSubmitting ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</>
                  ) : (
                    <><UploadCloud className="w-5 h-5" /> {resubmitMode ? 'Re-submit Work' : 'Submit Work'}</>
                  )}
                </button>
                <p className="text-[11px] text-slate-400 text-center mt-2">⚠️ AI feedback uses daily processing tokens. Submitting many outputs in a day may result in delayed feedback.</p>
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
      {/* Privacy Modal */}
      {showPrivacyModal && <PrivacyModal />}

      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">Submit Your Work</h1>
        <p className="text-slate-500 text-sm">Choose an activity to view details and upload your work</p>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No activities assigned yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(activity => {
            const sub = activity.mySubmission;
            const StatusIcon = sub ? (STATUS_LABEL[sub.status]?.icon || Clock) : null;
            const isPastDeadline = activity.deadline && new Date(activity.deadline) < new Date();
            return (
              <button key={activity.id} onClick={() => handleSelectActivity(activity)}
                className="w-full text-left p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-brand-green/50 hover:shadow-md transition-all group">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg mt-0.5 bg-green-50 text-brand-green group-hover:bg-brand-green group-hover:text-white transition-colors">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-brand-slate group-hover:text-brand-green transition-colors">{activity.title}</p>
                      <p className="text-xs text-slate-500">{activity.className} • {activity.type} • {activity.points} pts</p>
                      {activity.deadline && (
                        <p className={cn("text-xs mt-0.5", isPastDeadline ? "text-red-500 font-semibold" : "text-slate-400")}>
                          {isPastDeadline ? '⏰ Deadline passed' : `Due: ${new Date(activity.deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {sub && StatusIcon && (
                      <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1', STATUS_LABEL[sub.status]?.color)}>
                        <StatusIcon className="w-3 h-3" /> {STATUS_LABEL[sub.status]?.label}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-green transition-colors mt-1" />
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
