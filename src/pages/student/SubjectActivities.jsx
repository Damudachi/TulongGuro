import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, AlertCircle, Loader2, FileText, ChevronRight, BookOpen, UserCheck } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { submissionWindow, formatDeadline } from '../../utils/deadlines';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_STYLES = {
  GRADED: { label: 'Graded', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  PENDING: { label: 'Awaiting Grading', color: 'bg-amber-100 text-amber-700', icon: Clock },
  NONE: { label: 'Not Submitted', color: 'bg-slate-100 text-slate-500', icon: AlertCircle },
};

/**
 * All activities across every subject the student is enrolled in, with an
 * optional subject filter. Driven entirely by /api/student/:id/subjects.
 */
export default function SubjectActivities() {
  const [searchParams, setSearchParams] = useSearchParams();
  const subjectFilter = searchParams.get('subject') || '';
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    apiFetch(`${API_URL}/api/student/${user.id}/subjects`)
      .then(r => r.json())
      .then(d => { if (d.success) setSubjects(d.subjects || []); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading activities...</div>;
  }

  const visibleSubjects = subjectFilter ? subjects.filter(s => s.id === subjectFilter) : subjects;
  const totalActivities = visibleSubjects.reduce((n, s) => n + s.activities.length, 0);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">Activities</h1>
        <p className="text-slate-500 text-sm">Every activity assigned to you, across all your subjects</p>
      </div>

      {/* Subject filter */}
      {subjects.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-6">
          <button
            onClick={() => setSearchParams({})}
            className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
              !subjectFilter ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-green')}>
            All subjects
          </button>
          {subjects.map(s => (
            <button key={s.id}
              onClick={() => setSearchParams({ subject: s.id })}
              className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                subjectFilter === s.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-green')}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {totalActivities === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No activities yet</p>
          <p className="text-sm mt-1">Activities your teacher assigns will show up here.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {visibleSubjects.filter(s => s.activities.length > 0).map(subject => (
            <div key={subject.id}>
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4" /> {subject.name}
                <span className="text-slate-300 font-normal normal-case">· {subject.activities.length} activit{subject.activities.length === 1 ? 'y' : 'ies'}</span>
              </h2>
              <div className="space-y-3">
                {subject.activities.map(activity => {
                  const statusKey = activity.submission?.status || 'NONE';
                  const status = STATUS_STYLES[statusKey] || STATUS_STYLES.NONE;
                  const StatusIcon = status.icon;
                  const subWindow = submissionWindow(activity);
                  const isTeacherUpload = activity.submissionMode !== 'STUDENT_SUBMIT';
                  // Graded work opens the feedback page; otherwise go to the
                  // right activity page for this submission mode.
                  const to = activity.submission?.status === 'GRADED'
                    ? `/student/output/${activity.submission.id}`
                    : isTeacherUpload
                      ? `/student/activity/${activity.id}`
                      : `/student/submit?activityId=${activity.id}`;

                  return (
                    <Link key={activity.id} to={to}
                      className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-brand-green hover:shadow-md transition-all group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="bg-blue-50 p-2 rounded-lg text-brand-navy mt-0.5 shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-brand-slate group-hover:text-brand-green transition-colors">{activity.title}</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {activity.type} • {activity.points} pts
                              {activity.deadline && (
                                <span className={subWindow.isClosed ? 'text-red-500 font-semibold' : subWindow.isLate ? 'text-amber-600 font-semibold' : ''}>
                                  {' '}• Due {formatDeadline(activity.deadline)}
                                  {subWindow.isClosed ? ' (Closed)' : subWindow.isLate ? ' (Late accepted)' : ''}
                                </span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1', status.color)}>
                                <StatusIcon className="w-3 h-3" /> {status.label}
                              </span>
                              {isTeacherUpload && (
                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
                                  <UserCheck className="w-3 h-3" /> Teacher submits
                                </span>
                              )}
                            </div>
                            {activity.submission?.feedback && (
                              <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                                💬 {activity.submission.feedback}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {activity.submission?.score !== null && activity.submission?.score !== undefined && (
                            <span className="font-bold text-sm text-brand-green">
                              {activity.submission.score}/{activity.points}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-green transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
