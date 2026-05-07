import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, UploadCloud, FileText, CheckCircle2, Clock, Loader2, Sparkles, ChevronRight } from 'lucide-react';
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
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
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
    const f = e.target.files?.[0] || e.dataTransfer?.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!file || !selected) return;
    setIsSubmitting(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const formData = new FormData();
      formData.append('image', file);
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
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Step 2 — Upload Your Essay</h2>
              <div
                onClick={() => fileRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); handleFile(e); }}
                onDragOver={e => e.preventDefault()}
                className={cn('border-2 border-dashed rounded-2xl transition-all cursor-pointer',
                  preview ? 'border-brand-green' : 'border-slate-300 hover:border-brand-green/60 hover:bg-green-50/30')}>
                {preview ? (
                  <div className="relative">
                    <img src={preview} alt="preview" className="w-full max-h-80 object-contain rounded-2xl p-2" />
                    <div className="absolute bottom-4 right-4 bg-brand-green text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Photo selected
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
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />

              {preview && (
                <button onClick={() => { setFile(null); setPreview(null); }}
                  className="mt-2 text-xs text-slate-500 hover:text-red-500 transition-colors">
                  ✕ Remove and choose another
                </button>
              )}
            </div>
          )}

          {/* Submit Button */}
          {selected && file && (
            <button onClick={handleSubmit} disabled={isSubmitting}
              className="w-full py-4 bg-brand-green text-white rounded-2xl font-bold text-lg hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-60 flex items-center justify-center gap-3">
              {isSubmitting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</>
              ) : (
                <><UploadCloud className="w-5 h-5" /> Submit Work</>
              )}
            </button>
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
