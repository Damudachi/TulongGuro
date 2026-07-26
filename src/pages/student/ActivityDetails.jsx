import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Award, Calendar, FileText, Loader2, Clock, CheckCircle2, UserCheck, ChevronRight } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Read-only activity view for TEACHER_UPLOAD activities.
 *
 * The student has nothing to upload here — the teacher photographs and submits
 * the paper — so this page explains the flow and shows progress instead of the
 * submit form on /student/submit.
 */
export default function ActivityDetails() {
  const navigate = useNavigate();
  const { activityId } = useParams();
  const [activity, setActivity] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id || !activityId) return setIsLoading(false);
    fetch(`${API_URL}/api/student/${user.id}/activities/${activityId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setActivity(d.activity); })
      .finally(() => setIsLoading(false));
  }, [activityId]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...</div>;
  }

  if (!activity) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center">
        <p className="text-slate-500 mb-4">This activity could not be found.</p>
        <button onClick={() => navigate('/student/dashboard')} className="text-brand-green font-semibold hover:underline">
          Back to Dashboard
        </button>
      </div>
    );
  }

  // A student-submit activity shouldn't land here — send it to the submit flow.
  if (activity.submissionMode === 'STUDENT_SUBMIT') {
    navigate(`/student/submit?activityId=${activity.id}`, { replace: true });
    return null;
  }

  const sub = activity.mySubmission;
  const dueDate = activity.deadline ? new Date(activity.deadline) : null;
  const isPastDeadline = dueDate && dueDate < new Date();
  const isGraded = sub?.status === 'GRADED';

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <button onClick={() => navigate('/student/dashboard')} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      {/* Header */}
      <div className="bg-gradient-to-br from-brand-navy to-blue-800 text-white p-6 rounded-2xl mb-6 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5"><BookOpen className="w-40 h-40" /></div>
        <div className="relative z-10">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-blue-100 uppercase tracking-wider">
            {activity.type}
          </span>
          <h1 className="text-2xl font-bold mt-3 mb-1">{activity.title}</h1>
          <p className="text-blue-200 text-sm">{activity.className}</p>

          <div className="flex gap-3 mt-5 flex-wrap">
            <div className="bg-white/15 px-4 py-2.5 rounded-xl backdrop-blur-sm">
              <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 text-blue-200">Points</span>
              <span className="text-lg font-bold flex items-center"><Award className="w-4 h-4 mr-1.5" /> {activity.points}</span>
            </div>
            {dueDate && (
              <div className={cn('px-4 py-2.5 rounded-xl backdrop-blur-sm', isPastDeadline ? 'bg-red-500/30' : 'bg-white/15')}>
                <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 text-blue-200">Due Date</span>
                <span className="text-lg font-bold flex items-center">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  {dueDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How this activity works */}
      <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
        <div className="bg-blue-500 text-white p-2 rounded-lg shrink-0"><UserCheck className="w-5 h-5" /></div>
        <div>
          <p className="font-bold text-blue-900 text-sm mb-1">Your teacher submits this one for you</p>
          <p className="text-sm text-blue-800 leading-relaxed">
            Pass your output to your teacher on paper. They will photograph it and upload it for
            checking, so there is nothing for you to upload here. Your grade and feedback will
            appear on your dashboard once your teacher releases them.
          </p>
        </div>
      </div>

      {/* Instructions */}
      {activity.instructions && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-bold text-brand-slate mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-navy" /> Instructions
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{activity.instructions}</p>
        </div>
      )}

      {/* Progress */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-brand-slate mb-4">Status</h2>
        {!sub ? (
          <div className="flex items-center gap-3 text-slate-500">
            <div className="bg-slate-100 p-2 rounded-lg"><Clock className="w-5 h-5 text-slate-400" /></div>
            <div>
              <p className="text-sm font-semibold text-brand-slate">Not uploaded yet</p>
              <p className="text-xs text-slate-400">Your teacher hasn't uploaded your output for this activity.</p>
            </div>
          </div>
        ) : isGraded ? (
          <Link to={`/student/output/${sub.id}`}
            className="flex items-center justify-between gap-3 group hover:bg-green-50/50 -m-2 p-2 rounded-xl transition-colors">
            <div className="flex items-center gap-3">
              <div className="bg-green-50 p-2 rounded-lg"><CheckCircle2 className="w-5 h-5 text-brand-green" /></div>
              <div>
                <p className="text-sm font-semibold text-brand-slate">Graded &amp; released</p>
                <p className="text-xs text-slate-400">Tap to see your score and feedback.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-brand-green text-sm">
                {(((sub.hitlScore ?? sub.aiScore ?? 0) / 100) * (activity.points || 100)).toFixed(1).replace(/\.0$/, '')}/{activity.points}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-green transition-colors" />
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            <div className="bg-amber-50 p-2 rounded-lg"><Clock className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-sm font-semibold text-brand-slate">Uploaded — awaiting grading</p>
              <p className="text-xs text-slate-400">
                Your teacher uploaded your output on{' '}
                {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
