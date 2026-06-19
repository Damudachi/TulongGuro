import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, ArrowLeft, Loader2, FileText, CheckCircle2, Clock, AlertCircle, BarChart2, MessageSquare } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_STYLES = {
  GRADED: { label: 'Graded', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  PENDING: { label: 'Pending', color: 'bg-amber-100 text-amber-700', icon: Clock },
  NONE: { label: 'Not Yet', color: 'bg-slate-100 text-slate-500', icon: AlertCircle },
};

export default function Subjects() {
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [activeTab, setActiveTab] = useState('activities');

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/student/${user.id}/subjects`)
      .then(r => r.json())
      .then(d => { if (d.success) setSubjects(d.subjects); })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading subjects...
    </div>
  );

  // Subject Detail View
  if (selectedSubject) {
    const sub = selectedSubject;
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
        <button onClick={() => { setSelectedSubject(null); setActiveTab('activities'); }}
          className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Subjects
        </button>

        {/* Subject Header */}
        <div className="bg-gradient-to-r from-brand-navy to-blue-800 text-white p-5 rounded-2xl mb-6 shadow-lg">
          <h1 className="text-xl font-bold">{sub.name}</h1>
          <p className="text-blue-200 text-sm mt-1">{sub.gradeLevel} • {sub.schoolYear} • {sub.teacherName}</p>
          <div className="flex gap-3 mt-4 flex-wrap">
            <div className="bg-white/20 px-3 py-2 rounded-lg backdrop-blur-sm text-center">
              <p className="text-2xl font-extrabold">{sub.overallGrade !== null ? `${sub.overallGrade}%` : '—'}</p>
              <p className="text-[10px] uppercase tracking-wider text-blue-200">Overall</p>
            </div>
            <div className="bg-white/20 px-3 py-2 rounded-lg backdrop-blur-sm text-center">
              <p className="text-2xl font-extrabold">{sub.gradedCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-blue-200">Graded</p>
            </div>
            <div className="bg-white/20 px-3 py-2 rounded-lg backdrop-blur-sm text-center">
              <p className="text-2xl font-extrabold">{sub.activityCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-blue-200">Activities</p>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 mb-6">
          {['activities', 'gradebook'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={cn('pb-3 px-4 font-medium text-sm border-b-2 capitalize transition-colors',
                activeTab === tab ? 'border-brand-green text-brand-green' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {tab === 'activities' ? `Activities (${sub.activityCount})` : 'Gradebook'}
            </button>
          ))}
        </div>

        {/* Activities Tab */}
        {activeTab === 'activities' && (
          <div className="space-y-3">
            {sub.activities.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">No activities yet</p>
              </div>
            ) : sub.activities.map(activity => {
              const statusKey = activity.submission?.status || 'NONE';
              const status = STATUS_STYLES[statusKey] || STATUS_STYLES.NONE;
              const StatusIcon = status.icon;
              const score = activity.submission?.score;
              const hasFeedback = !!activity.submission?.feedback;
              const isPastDeadline = activity.deadline && new Date(activity.deadline) < new Date();

              return (
                <div key={activity.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="bg-blue-50 p-2 rounded-lg text-brand-navy mt-0.5 shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-brand-slate">{activity.title}</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {activity.type} • {activity.points} pts
                            {activity.deadline && (
                              <span className={isPastDeadline ? 'text-red-500 font-semibold' : ''}>
                                {' '}• Due {new Date(activity.deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                                {isPastDeadline && ' (Closed)'}
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1', status.color)}>
                              <StatusIcon className="w-3 h-3" /> {status.label}
                            </span>
                            {score !== null && score !== undefined && (
                              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full',
                                score >= 90 ? 'bg-green-100 text-green-700' : score >= 75 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                                {score}/{activity.points}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {activity.submission?.id && (
                        <Link to={`/student/output/${activity.submission.id}`}
                          className="shrink-0 text-xs bg-brand-green text-white px-3 py-1.5 rounded-md font-medium hover:bg-emerald-600 flex items-center gap-1">
                          View <ChevronRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>

                    {/* Feedback Preview */}
                    {hasFeedback && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="flex items-start gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                            {activity.submission.feedback}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Gradebook Tab */}
        {activeTab === 'gradebook' && (
          <div>
            {/* Overall Grade Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6 text-center shadow-sm">
              <p className="text-sm text-slate-500 font-medium mb-2">Overall Grade for {sub.subject || sub.name}</p>
              <p className={cn('text-5xl font-extrabold',
                sub.overallGrade === null ? 'text-slate-300' :
                sub.overallGrade >= 90 ? 'text-green-600' : sub.overallGrade >= 75 ? 'text-amber-600' : 'text-red-600')}>
                {sub.overallGrade !== null ? `${sub.overallGrade}%` : '—'}
              </p>
              <p className="text-xs text-slate-400 mt-2">{sub.gradedCount} of {sub.activityCount} activities graded</p>
            </div>

            {/* Grades Table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left font-bold text-slate-700">Activity</th>
                      <th className="px-4 py-3 text-center font-bold text-slate-700 w-20">Type</th>
                      <th className="px-4 py-3 text-center font-bold text-slate-700 w-24">Score</th>
                      <th className="px-4 py-3 text-center font-bold text-slate-700 w-20">Status</th>
                      <th className="px-4 py-3 text-right font-bold text-slate-700 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.activities.length === 0 ? (
                      <tr><td colSpan="5" className="py-12 text-center text-slate-400">No activities</td></tr>
                    ) : sub.activities.map((activity, idx) => {
                      const statusKey = activity.submission?.status || 'NONE';
                      const status = STATUS_STYLES[statusKey] || STATUS_STYLES.NONE;
                      const score = activity.submission?.score;
                      const scoreColor = score === null || score === undefined ? 'text-slate-300'
                        : score >= 90 ? 'text-green-600' : score >= 75 ? 'text-amber-600' : 'text-red-600';

                      return (
                        <tr key={activity.id} className={cn('border-b border-slate-100 hover:bg-blue-50/30', idx % 2 === 1 && 'bg-slate-50/30')}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-brand-slate">{activity.title}</p>
                            {activity.submission?.feedback && (
                              <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[200px]">
                                💬 {activity.submission.feedback}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{activity.type}</span>
                          </td>
                          <td className={cn('px-4 py-3 text-center font-bold', scoreColor)}>
                            {score !== null && score !== undefined ? `${score}/${activity.points}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', status.color)}>{status.label}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {activity.submission?.id && (
                              <Link to={`/student/output/${activity.submission.id}`} className="text-brand-green hover:text-emerald-600">
                                <ChevronRight className="w-4 h-4" />
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main View — Subject List
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">My Subjects</h1>
        <p className="text-slate-500 text-sm">View your classes, activities, and grades</p>
      </div>

      {subjects.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No subjects yet</p>
          <p className="text-sm mt-1">Your teacher hasn't assigned any classes to your section.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {subjects.map(subject => {
            const gradeColor = subject.overallGrade === null ? 'text-slate-300'
              : subject.overallGrade >= 90 ? 'text-green-600' : subject.overallGrade >= 75 ? 'text-amber-600' : 'text-red-600';
            return (
              <button key={subject.id} onClick={() => setSelectedSubject(subject)}
                className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:border-brand-green hover:shadow-md transition-all group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-brand-green opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-brand-slate group-hover:text-brand-green transition-colors">{subject.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{subject.gradeLevel} • {subject.teacherName}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-brand-green mt-1 transition-colors" />
                </div>
                <div className="flex items-end justify-between">
                  <div className="flex gap-4">
                    <div>
                      <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Activities</p>
                      <p className="text-lg font-extrabold text-brand-navy">{subject.activityCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Graded</p>
                      <p className="text-lg font-extrabold text-brand-slate">{subject.gradedCount}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Grade</p>
                    <p className={cn('text-2xl font-extrabold', gradeColor)}>
                      {subject.overallGrade !== null ? `${subject.overallGrade}%` : '—'}
                    </p>
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
