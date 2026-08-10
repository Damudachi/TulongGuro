import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, BarChart2, ChevronRight, TrendingUp } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { gradeTone } from '../../utils/grading';
import { usePassingGrade } from '../../utils/useSchool';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Grade colouring lives in utils/grading and follows the school's passing grade.

/**
 * The student's own gradebook: an overall average per subject plus a
 * per-activity breakdown. Only teacher-released (GRADED) scores appear.
 */
export default function SubjectGradebook() {
  const passingGrade = usePassingGrade();
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
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading gradebook...</div>;
  }

  const visibleSubjects = subjectFilter ? subjects.filter(s => s.id === subjectFilter) : subjects;
  const allGraded = subjects.flatMap(s => s.activities.map(a => a.submission?.percent)).filter(p => p !== null && p !== undefined);

  /**
   * The general average, averaged from each subject's own figure.
   *
   * This used to be a flat mean of every activity's raw percent — the method
   * grading.js keeps only as the "before" side of its fairness regression test
   * and describes as no longer live anywhere in the app. It was live here, on a
   * screen a learner reads as their report card.
   *
   * Two things made it disagree with the number on their dashboard. It ignored
   * the DepEd component weights (a Quarterly Assessment counted the same as one
   * quiz), and it ignored points (a 20-point seatwork counted the same as a
   * 100-point exam). The server has already applied both to produce each
   * subject's overallGrade, so averaging those reproduces exactly what
   * workingAverageAcrossSubjects computes for the dashboard.
   */
  const subjectAverages = subjects.map(s => s.overallGrade).filter(v => typeof v === 'number');
  const overall = subjectAverages.length
    ? Math.round(subjectAverages.reduce((a, b) => a + b, 0) / subjectAverages.length)
    : null;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-brand-green" /> My Gradebook
        </h1>
        <p className="text-slate-500 text-sm">Your released scores and feedback across all subjects</p>
      </div>

      {subjects.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No grades yet</p>
          <p className="text-sm mt-1">Your grades will appear once your teacher releases them.</p>
        </div>
      ) : (
        <>
          {/* Overall across all subjects */}
          <div className="bg-gradient-to-br from-brand-green to-emerald-600 text-white rounded-2xl p-6 mb-6 shadow-lg flex items-center justify-between">
            <div>
              <p className="text-green-100 text-xs uppercase tracking-wider font-bold mb-1">General Average</p>
              <p className="text-4xl font-extrabold">{overall !== null ? `${overall}%` : '—'}</p>
              {/* Names the subjects the average actually covers, not the total
                  the learner is enrolled in — a subject with no released work
                  yet is not in the figure and must not be implied to be. */}
              <p className="text-green-100 text-xs mt-1">
                Across {allGraded.length} graded activit{allGraded.length === 1 ? 'y' : 'ies'} in{' '}
                {subjectAverages.length} subject{subjectAverages.length === 1 ? '' : 's'}
                {subjectAverages.length < subjects.length && ` of ${subjects.length}`}
              </p>
            </div>
            <TrendingUp className="w-14 h-14 opacity-30" />
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

          <div className="space-y-6">
            {visibleSubjects.map(subject => (
              <div key={subject.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/60">
                  <div>
                    <h2 className="font-bold text-brand-slate">{subject.name}</h2>
                    <p className="text-xs text-slate-500">
                      {subject.teacherName && `${subject.teacherName} • `}
                      {subject.gradedCount} of {subject.activityCount} graded
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Average</p>
                    {/* gradeColor() never existed in this file — this threw a
                        ReferenceError as soon as a subject card rendered. The
                        table below already uses the shared helper. */}
                    <p className={cn('text-2xl font-extrabold', gradeTone(subject.overallGrade, passingGrade, 'text-slate-300'))}>
                      {subject.overallGrade !== null ? `${subject.overallGrade}%` : '—'}
                    </p>
                  </div>
                </div>

                {subject.activities.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-slate-400">No activities in this subject yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500">
                          <th className="px-5 py-2.5 text-left font-semibold">Activity</th>
                          <th className="px-4 py-2.5 text-center font-semibold w-32">Type</th>
                          <th className="px-4 py-2.5 text-center font-semibold w-24">Score</th>
                          <th className="px-4 py-2.5 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {subject.activities.map((activity, idx) => {
                          const sub = activity.submission;
                          const isGraded = sub?.status === 'GRADED';
                          return (
                            <tr key={activity.id} className={cn('border-b border-slate-50 last:border-0', idx % 2 === 1 && 'bg-slate-50/40')}>
                              <td className="px-5 py-3">
                                <p className="font-semibold text-brand-slate">{activity.title}</p>
                                {sub?.feedback && (
                                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">💬 {sub.feedback}</p>
                                )}
                                {!isGraded && (
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    {sub ? "Awaiting your teacher's review" : 'Not submitted yet'}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{activity.type}</span>
                              </td>
                              <td className={cn('px-4 py-3 text-center font-bold', gradeTone(sub?.percent, passingGrade, 'text-slate-300'))}>
                                {isGraded ? `${sub.score}/${activity.points}` : '—'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {isGraded && (
                                  <Link to={`/student/output/${sub.id}`} className="text-brand-green hover:text-emerald-600 inline-block">
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
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
