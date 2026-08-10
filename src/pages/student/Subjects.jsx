import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, ArrowLeft, Loader2, FileText, CheckCircle2, Clock, AlertCircle, MessageSquare } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { gradeTone, gradeChip, DEFAULT_PASSING_GRADE } from '../../utils/grading';
import { submissionWindow, formatDeadline } from '../../utils/deadlines';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_STYLES = {
  GRADED: { label: 'Graded', color: 'bg-aqua-100 text-aqua-800', icon: CheckCircle2 },
  PENDING: { label: 'Pending', color: 'bg-sun-100 text-sun-800', icon: Clock },
  NONE: { label: 'Not Yet', color: 'bg-cream-200 text-navy-500', icon: AlertCircle },
};

// Subject tiles cycle the graphics palette so a class list reads as a set of
// distinct, colour-coded cards rather than a uniform stack.
const SUBJECT_THEMES = [
  { tile: 'bg-royal-500', soft: 'bg-royal-100', ink: 'text-royal-700', header: 'bg-royal-500' },
  { tile: 'bg-magenta-500', soft: 'bg-magenta-100', ink: 'text-magenta-700', header: 'bg-magenta-500' },
  { tile: 'bg-aqua-500', soft: 'bg-aqua-100', ink: 'text-aqua-800', header: 'bg-aqua-600' },
  { tile: 'bg-lilac-400', soft: 'bg-lilac-100', ink: 'text-lilac-700', header: 'bg-lilac-500' },
  { tile: 'bg-sun-400', soft: 'bg-sun-100', ink: 'text-sun-800', header: 'bg-sun-600' },
  { tile: 'bg-lime-500', soft: 'bg-lime-100', ink: 'text-lime-800', header: 'bg-lime-600' },
];

const themeFor = (index) => SUBJECT_THEMES[index % SUBJECT_THEMES.length];

// Grade colouring now comes from utils/grading so it tracks the school's own
// passing grade instead of a hardcoded 75.

export default function Subjects() {
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { subject, themeIndex }
  const [activeTab, setActiveTab] = useState('activities');
  // The school's own threshold, so colours match what the school counts as passing.
  const [passingGrade, setPassingGrade] = useState(DEFAULT_PASSING_GRADE);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    apiFetch(`${API_URL}/api/student/${user.id}/subjects`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setSubjects(d.subjects);
        if (typeof d.passingGrade === 'number') setPassingGrade(d.passingGrade);
      })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading subjects...
    </div>
  );

  // ── Subject detail ──
  if (selected) {
    const sub = selected.subject;
    const theme = themeFor(selected.themeIndex);

    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
        <button onClick={() => { setSelected(null); setActiveTab('activities'); }}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-navy-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Subjects
        </button>

        {/* Subject header */}
        <div className={cn(theme.header, 'text-white px-5 py-5 rounded-3xl mb-5')}>
          <h1 className="font-display text-xl font-extrabold">{sub.name}</h1>
          <p className="text-white/75 text-sm mt-0.5 font-semibold">
            {sub.gradeLevel} • {sub.schoolYear} • {sub.teacherName}
          </p>
          <div className="grid grid-cols-3 gap-2.5 mt-4">
            {[
              { value: sub.overallGrade !== null ? `${sub.overallGrade}%` : '—', label: 'Overall' },
              { value: sub.gradedCount, label: 'Graded' },
              { value: sub.activityCount, label: 'Activities' },
            ].map(stat => (
              <div key={stat.label} className="bg-white/15 px-3 py-2.5 rounded-xl text-center">
                <p className="text-xl font-extrabold">{stat.value}</p>
                <p className="text-[10px] uppercase tracking-wider font-extrabold text-white/70">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-white p-1.5 rounded-2xl border-2 border-cream-200 mb-6 w-fit">
          {['activities', 'gradebook'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={cn('px-5 py-2.5 rounded-xl font-bold text-sm capitalize transition-all',
                activeTab === tab ? cn(theme.tile, 'text-white shadow-pop') : 'text-navy-400 hover:text-navy-600')}>
              {tab === 'activities' ? `Activities (${sub.activityCount})` : 'Gradebook'}
            </button>
          ))}
        </div>

        {/* ── Activities ── */}
        {activeTab === 'activities' && (
          <div className="space-y-3">
            {sub.activities.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-cream-300 rounded-3xl">
                <FileText className="w-10 h-10 mx-auto mb-3 text-navy-300" />
                <p className="text-sm font-bold text-navy-500">No activities yet</p>
              </div>
            ) : sub.activities.map(activity => {
              const statusKey = activity.submission?.status || 'NONE';
              const status = STATUS_STYLES[statusKey] || STATUS_STYLES.NONE;
              const StatusIcon = status.icon;
              const score = activity.submission?.score;
              // Colour by the percentage, never by the raw points. Comparing
              // points against 75/90 meant every mark on an activity worth less
              // than 75 points rendered red — a perfect 30/30 read as failing.
              const percent = activity.submission?.percent;
              const hasFeedback = !!activity.submission?.feedback;
              const subWindow = submissionWindow(activity);

              return (
                <div key={activity.id} className="tg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={cn(theme.soft, theme.ink, 'p-2.5 rounded-2xl shrink-0')}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-navy-700">{activity.title}</h3>
                        <p className="text-xs text-navy-500 mt-0.5">
                          {activity.type} • {activity.points} pts
                          {activity.deadline && (
                            <span className={subWindow.isClosed ? 'text-red-500 font-bold' : subWindow.isLate ? 'text-amber-600 font-bold' : ''}>
                              {' '}• Due {formatDeadline(activity.deadline)}
                              {subWindow.isClosed ? ' (Closed)' : subWindow.isLate ? ' (Late accepted)' : ''}
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                          <span className={cn('tg-pill', status.color)}>
                            <StatusIcon className="w-3 h-3" /> {status.label}
                          </span>
                          {score !== null && score !== undefined && (
                            <span className={cn('tg-pill', gradeChip(percent, passingGrade))}>
                              {score}/{activity.points}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {activity.submission?.id && (
                      <Link to={`/student/output/${activity.submission.id}`}
                        className={cn('shrink-0 inline-flex items-center gap-1 text-xs font-bold text-white px-4 py-2 rounded-full shadow-pop transition-all active:translate-y-0.5 active:shadow-none', theme.tile)}>
                        View <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>

                  {hasFeedback && (
                    <div className="mt-4 pt-4 border-t-2 border-cream-200 flex items-start gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-navy-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-navy-600 leading-relaxed line-clamp-2">
                        {activity.submission.feedback}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Gradebook ── */}
        {activeTab === 'gradebook' && (
          <div>
            <div className="tg-card p-8 mb-6 text-center">
              <p className="text-sm font-bold text-navy-500 mb-2">Overall Grade for {sub.subject || sub.name}</p>
              <p className={cn('font-display text-6xl font-extrabold', gradeTone(sub.overallGrade, passingGrade))}>
                {sub.overallGrade !== null ? `${sub.overallGrade}%` : '—'}
              </p>
              <p className="text-xs font-semibold text-navy-400 mt-3">
                {sub.gradedCount} of {sub.activityCount} activities graded
              </p>
            </div>

            <div className="tg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-cream-100 border-b-2 border-cream-200">
                      <th className="px-4 py-3.5 text-left font-extrabold text-navy-700">Activity</th>
                      <th className="px-4 py-3.5 text-center font-extrabold text-navy-700 w-20">Type</th>
                      <th className="px-4 py-3.5 text-center font-extrabold text-navy-700 w-24">Score</th>
                      <th className="px-4 py-3.5 text-center font-extrabold text-navy-700 w-20">Status</th>
                      <th className="px-4 py-3.5 text-right font-extrabold text-navy-700 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.activities.length === 0 ? (
                      <tr><td colSpan="5" className="py-12 text-center font-bold text-navy-400">No activities</td></tr>
                    ) : sub.activities.map(activity => {
                      const statusKey = activity.submission?.status || 'NONE';
                      const status = STATUS_STYLES[statusKey] || STATUS_STYLES.NONE;
                      const score = activity.submission?.score;
                      const percent = activity.submission?.percent;

                      return (
                        <tr key={activity.id} className="border-b border-cream-200 last:border-0 hover:bg-cream-50">
                          <td className="px-4 py-3.5">
                            <p className="font-bold text-navy-700">{activity.title}</p>
                            {activity.submission?.feedback && (
                              <p className="text-[11px] text-navy-400 mt-0.5 truncate max-w-[200px]">
                                💬 {activity.submission.feedback}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className="text-xs bg-cream-200 text-navy-600 px-2.5 py-1 rounded-full font-bold">{activity.type}</span>
                          </td>
                          <td className={cn('px-4 py-3.5 text-center font-extrabold', gradeTone(percent, passingGrade))}>
                            {score !== null && score !== undefined ? `${score}/${activity.points}` : '—'}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={cn('tg-pill !text-[10px]', status.color)}>{status.label}</span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            {activity.submission?.id && (
                              <Link to={`/student/output/${activity.submission.id}`} className={theme.ink}>
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

  // ── Subject list ──
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-7">
        <h1 className="font-display text-3xl font-extrabold text-navy-700">My Subjects</h1>
        <p className="text-navy-500 text-sm font-semibold mt-1">View your classes, activities, and grades</p>
      </div>

      {subjects.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-cream-300 rounded-[2rem]">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-navy-300" />
          <p className="font-bold text-navy-600">No subjects yet</p>
          <p className="text-sm mt-1 text-navy-400">Your teacher hasn't assigned any classes to your section.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {subjects.map((subject, idx) => {
            const theme = themeFor(idx);
            return (
              <button key={subject.id} onClick={() => setSelected({ subject, themeIndex: idx })}
                className="tg-tile bg-white border-2 border-cream-200 p-6 text-left group">
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className={cn(theme.tile, 'w-11 h-11 rounded-2xl grid place-items-center text-white shrink-0')}>
                      <BookOpen className="w-5 h-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display font-extrabold text-navy-700 truncate">{subject.name}</h3>
                      <p className="text-xs text-navy-500 font-semibold truncate">{subject.gradeLevel} • {subject.teacherName}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-navy-300 shrink-0 transition-colors group-hover:text-navy-600" />
                </div>

                <div className="flex items-end justify-between">
                  <div className="flex gap-5">
                    <div>
                      <p className="text-[10px] uppercase text-navy-400 font-extrabold tracking-wider">Activities</p>
                      <p className="text-lg font-extrabold text-navy-700">{subject.activityCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-navy-400 font-extrabold tracking-wider">Graded</p>
                      <p className="text-lg font-extrabold text-navy-700">{subject.gradedCount}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-navy-400 font-extrabold tracking-wider">Grade</p>
                    <p className={cn('font-display text-3xl font-extrabold', gradeTone(subject.overallGrade, passingGrade))}>
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
