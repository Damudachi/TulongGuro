import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, UploadCloud, FileText, CheckCircle2, Clock, Loader2, Sparkles, ChevronRight, AlertTriangle } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_LABEL = {
  PENDING: { label: 'Awaiting Teacher Review', color: 'text-amber-600 bg-amber-50', icon: Clock },
  GRADED:  { label: 'Graded & Released',       color: 'text-green-600 bg-green-50',  icon: CheckCircle2 },
};

export default function SubmitWork() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [piiConfirmed, setPiiConfirmed] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/student/${user.id}/activities`)
      .then(r => r.json())
      .then(d => { if (d.success) setActivities(d.activities); })
      .finally(() => setIsLoading(false));
  }, []);

  const handleFile = (e) => {
    const selectedFiles = Array.from(e.target.files || e.dataTransfer?.files || []);
    if (selectedFiles.length === 0) return;
    
    // Allow up to 20 files
    const newFiles = [...files, ...selectedFiles].slice(0, 20);
    setFiles(newFiles);
    
    // Create preview URLs
    const newPreviews = newFiles.map(f => URL.createObjectURL(f));
    setPreviews(newPreviews);
    setResult(null);
  };

  const removeFile = (index) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
    
    const newPreviews = [...previews];
    URL.revokeObjectURL(newPreviews[index]); // Free memory
    newPreviews.splice(index, 1);
    setPreviews(newPreviews);
  };

  const handleSubmit = async () => {
    if (!piiConfirmed) {
      alert('⚠️ Please confirm that your name is not visible in the photo before submitting.');
      return;
    }
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
        // Refresh activity list
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
  const submitted = activities.filter(a => a.mySubmission);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">Submit Your Work</h1>
        <p className="text-slate-500 text-sm">Upload a photo of your handwritten output for teacher review</p>
      </div>

      {!result ? (
        <>
          {/* Step 1: Pick Activity */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Step 1 — Choose Activity</h2>
            {activities.length === 0 ? (
              <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">No activities assigned yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activities.map(activity => {
                  const isSelected = selected?.id === activity.id;
                  const sub = activity.mySubmission;
                  const StatusIcon = sub ? (STATUS_LABEL[sub.status]?.icon || Clock) : null;
                  return (
                    <button key={activity.id} onClick={() => setSelected(activity)}
                      className={cn('w-full text-left p-4 rounded-xl border-2 transition-all',
                        isSelected ? 'border-brand-green bg-green-50 shadow-sm' : 'border-slate-200 bg-white hover:border-brand-green/50')}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={cn('p-2 rounded-lg mt-0.5', isSelected ? 'bg-brand-green text-white' : 'bg-slate-100 text-slate-500')}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-brand-slate">{activity.title}</p>
                            <p className="text-xs text-slate-500">{activity.className} • {activity.type} • {activity.points} pts</p>
                            {activity.deadline && (
                              <p className="text-xs text-slate-400 mt-0.5">Due: {new Date(activity.deadline).toLocaleDateString('en-PH')}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {sub && StatusIcon && (
                            <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1', STATUS_LABEL[sub.status]?.color)}>
                              <StatusIcon className="w-3 h-3" /> {STATUS_LABEL[sub.status]?.label}
                            </span>
                          )}
                          {isSelected && <CheckCircle2 className="w-5 h-5 text-brand-green mt-1" />}
                        </div>
                      </div>
                      {activity.instructions && isSelected && (
                        <div className="mt-3 pt-3 border-t border-green-200 text-sm text-slate-600 bg-white/60 rounded-lg p-2">
                          <span className="font-semibold text-brand-slate">Instructions: </span>{activity.instructions}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 2: Upload Photo */}
          {selected && (
            <div className="mb-6">
              <div className={`mb-4 p-4 rounded-xl border ${piiConfirmed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={piiConfirmed}
                    onChange={(e) => setPiiConfirmed(e.target.checked)}
                    className="mt-0.5 w-5 h-5 accent-green-600 shrink-0"
                  />
                  <div>
                    <p className={`font-bold text-sm ${piiConfirmed ? 'text-green-800' : 'text-amber-800'}`}>
                      {piiConfirmed ? '✅ Privacy Confirmed' : '⚠ Privacy Act Confirmation Required'}
                    </p>
                    <p className={`text-xs mt-0.5 ${piiConfirmed ? 'text-green-600' : 'text-amber-600'}`}>
                      I confirm that my name is NOT written on the paper. No personally identifiable information is visible in the photo.
                    </p>
                  </div>
                </label>
              </div>
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
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Step 2 — Upload Your Essay</h2>
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
          )}

          {/* Submit Button */}
          {selected && files.length > 0 && (
            <>
              <button onClick={handleSubmit} disabled={isSubmitting || !piiConfirmed}
                className="w-full py-4 bg-brand-green text-white rounded-2xl font-bold text-lg hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-60 flex items-center justify-center gap-3">
                {isSubmitting ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</>
                ) : (
                  <><UploadCloud className="w-5 h-5" /> Submit Work</>
                )}
              </button>
              <p className="text-[11px] text-slate-400 text-center mt-2">⚠️ AI feedback uses daily processing tokens. Submitting many outputs in a day may result in delayed feedback.</p>
            </>
          )}
        </>
      ) : (
        /* Success Result Card */
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-brand-green to-emerald-600 text-white p-8 rounded-2xl text-center shadow-lg">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 opacity-90" />
            <h2 className="text-2xl font-extrabold mb-2">Output Submitted!</h2>
            <p className="text-green-100 text-sm">Your essay has been received successfully.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold text-slate-700 mb-1">What happens next?</h3>
            <ol className="space-y-3 mt-3">
              {[
                { step: '1', text: 'Your teacher will review your submission in the grading queue.' },
                { step: '2', text: 'Gemini AI will analyze your handwritten essay alongside the rubric.' },
                { step: '3', text: 'Your teacher will validate the score and write personalized feedback.' },
                { step: '4', text: 'Once approved, your grade and reading strategy will appear on your dashboard.' },
              ].map(s => (
                <li key={s.step} className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-brand-navy text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">{s.step}</span>
                  <p className="text-slate-600 text-sm">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setSelected(null); setFile(null); setPreview(null); setResult(null); }}
              className="flex-1 py-3 border border-slate-200 rounded-xl font-medium text-slate-600 hover:bg-slate-50">
              Submit Another
            </button>
            <button onClick={() => navigate('/student/dashboard')}
              className="flex-1 py-3 bg-brand-green text-white rounded-xl font-medium hover:bg-emerald-600 flex items-center justify-center gap-2">
              Go to Dashboard <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
