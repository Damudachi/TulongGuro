import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Award, CheckCircle2, Star, Loader2, Lightbulb, ChevronRight, Clock, BookOpen, Send } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { gradeChip } from '../../utils/grading';
import { usePassingGrade } from '../../utils/useSchool';
import SkillProgressChart from '../../components/SkillProgressChart';
import { ONBOARDING, hasSeenOnboarding, markOnboardingSeen } from '../../utils/onboarding';
import SchoolBadge from '../../components/SchoolBadge';
import { StatTile } from '../../components/PageHeader';
import { firstNameFromRoster } from '../../utils/roster';
import { getStoredUser } from '../../utils/session';
import { mergeActivitySnapshot, readActivitySnapshot } from '../../utils/offlineSnapshot';
import { isPastDeadline } from '../../utils/deadlines';
import BadgeCelebration from '../../components/BadgeCelebration';

/**
 * Shown once, the first time a learner has a grade to actually look at.
 *
 * This was three modal steps fired on first sign-in — in front of an empty
 * dashboard, before the child had submitted anything. "Look out for the yellow
 * cards" means nothing when there are no cards, and a nine-year-old facing a
 * three-step carousel on a screen they have just fought their way into taps
 * through it to make it go away. Held back until `submissions` is non-empty
 * (the dashboard only ever receives *released* work) so every sentence below
 * describes something visible behind the modal, and cut to one screen.
 */
const WELCOME = {
  icon: Award,
  tone: 'bg-aqua-100 text-aqua-700',
  title: 'Your first grade is ready! 🎉',
  points: [
    { icon: CheckCircle2, text: 'A computer helps your teacher mark faster — but your teacher checks everything and decides your grade.' },
    { icon: Lightbulb, text: 'The yellow cards are reading tips written just for you. They tell you what to practise next.' },
    { icon: Star, text: 'You earn stars for good work. Tap any activity to see what you did well.' },
  ],
};

/** Empty-state block shared by the three feed sections. */
function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="text-center py-12 border-2 border-dashed border-cream-300 rounded-3xl bg-white/50">
      <Icon className="w-10 h-10 mx-auto mb-3 text-navy-300" />
      <p className="text-sm font-bold text-navy-500">{title}</p>
      <p className="text-xs mt-1 text-navy-400">{hint}</p>
    </div>
  );
}

export default function StudentDashboard() {
  const passingGrade = usePassingGrade();
  const [data, setData] = useState(null);
  // Starts false when there is nobody signed in: with no id there is nothing
  // to fetch, so the spinner would only ever be taken away again on the first
  // commit. See getStoredUser.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [showWelcome, setShowWelcome] = useState(false);
  // What the deadlines section falls back to when the read fails. Kept apart
  // from `data` so nothing else on the page mistakes a saved list for a live
  // dashboard — grades, stars and badges stay absent offline, as they should.
  const [savedUpcoming, setSavedUpcoming] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const dismissWelcome = () => {
    markOnboardingSeen(ONBOARDING.STUDENT_WELCOME);
    setShowWelcome(false);
  };

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    apiFetch(`${API_URL}/api/student/${user.id}/dashboard`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setData(d);
        // Keep the offline submit list topped up from the home screen too, so a
        // student who never happens to open Submit Work while connected still
        // has something to submit against when the signal goes. Partial and
        // thinner than the submit page's own list — upcoming only, no
        // lateUntil or instructions — hence a merge rather than a save.
        // TEACHER_UPLOAD activities are dropped: the student cannot submit to
        // them at all, and offering one offline would be a dead end.
        mergeActivitySnapshot(user.id, (d.upcomingDeadlines || [])
          .filter(a => a.submissionMode === 'STUDENT_SUBMIT'));
        // Only once there is released work to point at — see WELCOME.
        if (d.submissions?.length > 0 && !hasSeenOnboarding(ONBOARDING.STUDENT_WELCOME)) {
          setShowWelcome(true);
        }
      })
      .catch(() => {
        // "No upcoming deadlines — you're all caught up! 🎉" was being shown to
        // a student who had work due and merely had no signal. Congratulating
        // someone for being finished when they are not is the one wrong answer
        // this screen can give, so it falls back to the saved list and applies
        // the same not-yet-past rule the server applies.
        const snapshot = readActivitySnapshot(user.id);
        if (!snapshot) return;
        setSavedUpcoming(snapshot.activities
          .filter(a => a.deadline && !isPastDeadline(a.deadline))
          .sort((a, b) => new Date(a.deadline) - new Date(b.deadline)));
        setSavedAt(snapshot.savedAt);
      })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...
    </div>
  );

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const firstName = firstNameFromRoster(data?.student?.name || user.name) || 'Student';
  const submissions = data?.submissions || [];
  const stars = data?.stars || 0;
  const avgGrade = data?.avgGrade || 0;
  // Flags when the average above only reflects some of the student's subjects
  // (the rest have no graded work yet) — without this, that average renders
  // identically to a genuine across-all-subjects one.
  const avgGradePartial = data?.avgGradePartial || false;
  const avgGradeSubjectsIncluded = data?.avgGradeSubjectsIncluded || 0;
  const avgGradeSubjectsTotal = data?.avgGradeSubjectsTotal || 0;
  const upcomingDeadlines = data?.upcomingDeadlines || savedUpcoming || [];
  const pendingSubmissions = data?.pendingSubmissions || [];
  const latestStrategy = data?.latestStrategy || null;

  // Teacher-upload activities have nothing for the student to submit, so they
  // open a read-only detail page instead of the submit form.
  const activityLink = (activityId, submissionMode) =>
    submissionMode === 'STUDENT_SUBMIT'
      ? `/student/submit?activityId=${activityId}`
      : `/student/activity/${activityId}`;

  const WelcomeIcon = WELCOME.icon;

  return (
    <div className="tg-page pt-4 md:pt-8 max-w-4xl mx-auto">
      {/* ── Onboarding welcome — one screen, once, after the first grade ── */}
      {/* Held back while the welcome modal is up. A learner's very first
          released grade can earn several badges on the same load that first
          opens that modal, and confetti stacked on top of "here is how this app
          works" is two things competing for the same nine-year-old. */}
      <BadgeCelebration badges={data?.justEarnedBadges} paused={showWelcome} />

      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-card-lg animate-pop-in">
            <div className="p-8 text-center">
              <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 ${WELCOME.tone}`}>
                <WelcomeIcon className="w-10 h-10" />
              </div>
              <h2 className="font-display text-2xl font-extrabold text-navy-700 mb-5">{WELCOME.title}</h2>

              <ul className="space-y-4 text-left">
                {WELCOME.points.map((point) => (
                  <li key={point.text} className="flex items-start gap-3">
                    <point.icon className="w-5 h-5 text-royal-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="text-navy-600 leading-relaxed text-sm">{point.text}</span>
                  </li>
                ))}
              </ul>

              {/* One button, no "Skip" competing with it: there is nothing to
                  skip past on a single screen, and two dismissals is one more
                  decision than this needs. */}
              <button
                onClick={dismissWelcome}
                className="mt-8 w-full rounded-full py-3.5 font-bold text-sm text-white bg-royal-500 shadow-pop
                           hover:bg-royal-700 active:translate-y-1 active:shadow-none transition-all"
              >
                See my grade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Greeting ── */}
      {/* Brand-coloured, like the teacher greeting — it carries the SchoolBadge,
          so it's the one surface that most needs to match the school's colour. */}
      <div className="bg-royal-500 text-white px-5 py-5 rounded-3xl mb-4">
        <SchoolBadge tone="onColor" size="sm" className="mb-3.5 pb-3.5 border-b-2 border-white/20" />
        <h1 className="font-display text-2xl font-extrabold">Hello, {firstName}! 👋</h1>
        <p className="text-royal-100 text-sm font-semibold">{data?.student?.section?.name || 'Student'}</p>
      </div>

      {/* ── Metrics ── */}
      <div className="tg-stat-row grid-cols-3 mb-6">
        <StatTile label="Stars" value={stars} icon={Star} tone="text-sun-700" className="shrink-0 w-32 md:w-auto" />
        <StatTile label="Graded" value={submissions.length} icon={CheckCircle2} tone="text-royal-600" className="shrink-0 w-32 md:w-auto" />
        <StatTile label="Overall" value={avgGrade > 0 ? `${avgGrade}%` : '—'} icon={Award} tone="text-aqua-700" className="shrink-0 w-32 md:w-auto"
          hint={avgGradePartial ? `${avgGradeSubjectsIncluded} of ${avgGradeSubjectsTotal} subjects` : undefined} />
      </div>

      {/* ── Reading strategy tip ── */}
      {latestStrategy && (
        <div className="bg-sun-100 border-2 border-sun-200 rounded-3xl p-5 mb-6 flex items-start gap-4">
          <div className="bg-sun-400 text-ink-900 p-2.5 rounded-2xl shrink-0 shadow-pop">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div>
            <p className="font-display font-extrabold text-navy-700 mb-1">Your Latest Reading Strategy</p>
            <p className="text-sm text-navy-600 leading-relaxed">"{latestStrategy}"</p>
          </div>
        </div>
      )}

      {/* ── Skill progress ── */}
      {/* The list under the chart is capped at the latest few; the gradebook
          is where a whole term is meant to be read. */}
      <SkillProgressChart studentId={user.id} moreTo="/student/subjects/gradebook" moreLabel="See all my activities" />

      {/* ── Upcoming deadlines ── */}
      <section className="mb-8">
        <h2 className="tg-section-title mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-navy-400" /> Upcoming Deadlines
        </h2>
        {savedAt && (
          <p className="text-xs font-semibold text-navy-400 mb-3 -mt-1">
            You're offline — saved {new Date(savedAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
            Anything set since then won't be here yet.
          </p>
        )}
        {upcomingDeadlines.length === 0 ? (
          savedAt
            ? <EmptyState icon={Clock} title="Nothing saved to show" hint="Open this page with a connection once and your deadlines will be here next time." />
            : <EmptyState icon={Clock} title="No upcoming deadlines" hint="You're all caught up! 🎉" />
        ) : (
          <div className="space-y-3">
            {upcomingDeadlines.map(item => {
              const dueDate = new Date(item.deadline);
              const daysLeft = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
              const urgent = daysLeft <= 1;
              const soon = daysLeft <= 3;
              const shell = urgent ? 'bg-red-50 border-red-200' : soon ? 'bg-sun-100 border-sun-200' : 'bg-white border-slate-200';
              const urgencyText = urgent ? 'text-red-600' : soon ? 'text-sun-800' : 'text-navy-500';

              return (
                <Link key={item.id} to={activityLink(item.id, item.submissionMode)}
                  className={`flex items-center justify-between gap-3 p-4 rounded-3xl border-2 ${shell}
                              hover:-translate-y-0.5 hover:shadow-card transition-all group`}>
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="bg-royal-100 p-2.5 rounded-2xl text-royal-600 shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-navy-700 text-sm truncate">{item.title}</p>
                      <p className="text-xs text-navy-500 truncate">
                        {item.className} • {item.type} • <span className="font-extrabold text-royal-600">{item.points} pts</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-extrabold ${urgencyText}`}>
                      {daysLeft <= 0 ? 'Due today!' : daysLeft === 1 ? 'Due tomorrow' : `${daysLeft} days left`}
                    </p>
                    <p className="text-[10px] font-semibold text-navy-400">
                      {dueDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                    </p>
                    {/* The whole card is a Link, so tapping always worked —
                        but this was the only thing saying so, and on a phone
                        it never appeared. Now it is simply always there. */}
                    <p className="text-[10px] font-extrabold text-royal-600 mt-1 reveal-on-hover">
                      {item.submissionMode === 'STUDENT_SUBMIT' ? 'Submit Now →' : 'View Details →'}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Submitted, awaiting grading ── */}
      <section className="mb-8">
        <h2 className="tg-section-title mb-4 flex items-center gap-2">
          <Send className="w-5 h-5 text-sun-600" /> Submitted
        </h2>
        {pendingSubmissions.length === 0 ? (
          <EmptyState icon={Send} title="No pending submissions" hint="Submissions awaiting grading will appear here." />
        ) : (
          <div className="space-y-3">
            {pendingSubmissions.map(sub => (
              <Link key={sub.id} to={activityLink(sub.activityId, sub.activity?.submissionMode)}
                className="flex justify-between items-center gap-3 bg-white p-4 rounded-3xl border-2 border-slate-200
                           hover:border-sun-300 hover:-translate-y-0.5 hover:shadow-card transition-all group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="bg-sun-100 p-2.5 rounded-2xl text-sun-700 shrink-0"><BookOpen className="w-5 h-5" /></div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-navy-700 text-sm truncate">{sub.activity?.title}</h3>
                    <p className="text-xs text-navy-500 truncate">
                      {sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                      {(sub.activity?.maxAttempts || 1) > 1 && (
                        <span className="ml-1 font-extrabold text-royal-500">• Attempt {sub.attemptCount || 1}/{sub.activity?.maxAttempts}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="tg-pill bg-sun-100 text-sun-800 whitespace-nowrap">
                    <Clock className="w-3 h-3" /> Awaiting Grading
                  </span>
                  <ChevronRight className="w-4 h-4 text-navy-300 group-hover:text-sun-600 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Graded ── */}
      <section>
        <h2 className="tg-section-title mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-aqua-600" /> Graded Submission
        </h2>
        {submissions.length === 0 ? (
          <EmptyState icon={BookOpen} title="No graded activities yet" hint="Your grades will appear here once your teacher grades your work." />
        ) : (
          <div className="space-y-3">
            {submissions.slice(0, 5).map(sub => {
              const percentageScore = sub.hitlScore ?? sub.aiScore ?? 0;
              const maxPoints = sub.activity?.points || 100;
              const score = ((percentageScore / 100) * maxPoints).toFixed(1).replace(/\.0$/, '');
              const color = gradeChip(percentageScore, passingGrade);

              return (
                <Link to={`/student/output/${sub.id}`} key={sub.id}
                  className="flex justify-between items-center gap-3 bg-white p-4 rounded-3xl border-2 border-slate-200
                             hover:border-royal-400 hover:-translate-y-0.5 hover:shadow-card transition-all group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-royal-100 p-2.5 rounded-2xl text-royal-700 shrink-0"><BookOpen className="w-5 h-5" /></div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-navy-700 text-sm truncate">{sub.activity?.title}</h3>
                      <p className="text-xs text-navy-500 truncate">
                        {sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-extrabold px-3.5 py-1.5 rounded-full text-sm ${color}`}>{score}/{maxPoints}</span>
                    <ChevronRight className="w-4 h-4 text-navy-300 group-hover:text-royal-600" />
                  </div>
                </Link>
              );
            })}
            {submissions.length > 5 && (
              <Link to="/student/subjects" className="block text-center text-sm font-extrabold text-royal-600 hover:text-royal-700 py-3">
                View all in Subjects →
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
