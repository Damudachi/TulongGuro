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

const WELCOME_STEPS = [
  {
    icon: Award,
    tone: 'bg-aqua-100 text-aqua-700',
    title: 'Welcome to TulongGuro! 🎉',
    body: 'TulongGuro uses AI to help your teacher grade faster, but your teacher always makes the final decision.',
  },
  {
    icon: Send,
    tone: 'bg-royal-100 text-royal-600',
    title: 'Submitting Your Work 📤',
    body: 'Some activities you upload yourself. For others your teacher submits the paper for you — each activity tells you which.',
  },
  {
    icon: Lightbulb,
    tone: 'bg-sun-100 text-sun-700',
    title: 'Reading Strategies 💡',
    body: 'Look out for the yellow cards — these are personalized reading tips just for you, to help you improve.',
  },
];

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
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeStep, setWelcomeStep] = useState(0);

  const dismissWelcome = () => {
    markOnboardingSeen(ONBOARDING.STUDENT_WELCOME);
    setShowWelcome(false);
  };

  useEffect(() => {
    if (!hasSeenOnboarding(ONBOARDING.STUDENT_WELCOME)) {
      setShowWelcome(true);
    }
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    apiFetch(`${API_URL}/api/student/${user.id}/dashboard`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...
    </div>
  );

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const firstName = (data?.student?.name || user.name || 'Student').split(' ')[0];
  const submissions = data?.submissions || [];
  const stars = data?.stars || 0;
  const avgGrade = data?.avgGrade || 0;
  const upcomingDeadlines = data?.upcomingDeadlines || [];
  const pendingSubmissions = data?.pendingSubmissions || [];
  const latestStrategy = data?.latestStrategy || null;

  // Teacher-upload activities have nothing for the student to submit, so they
  // open a read-only detail page instead of the submit form.
  const activityLink = (activityId, submissionMode) =>
    submissionMode === 'STUDENT_SUBMIT'
      ? `/student/submit?activityId=${activityId}`
      : `/student/activity/${activityId}`;

  const WelcomeIcon = WELCOME_STEPS[welcomeStep].icon;

  return (
    <div className="tg-page pt-4 md:pt-8 max-w-4xl mx-auto">
      {/* ── Onboarding welcome modal ── */}
      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-card-lg animate-pop-in">
            <div className="p-8 text-center relative">
              <button onClick={dismissWelcome}
                className="absolute top-5 right-6 text-xs font-bold text-navy-400 hover:text-navy-600 transition-colors">
                Skip
              </button>

              <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 ${WELCOME_STEPS[welcomeStep].tone}`}>
                <WelcomeIcon className="w-10 h-10" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-navy-400 mb-2">
                Step {welcomeStep + 1} of {WELCOME_STEPS.length}
              </p>
              <h2 className="font-display text-2xl font-extrabold text-navy-700 mb-3">{WELCOME_STEPS[welcomeStep].title}</h2>
              <p className="text-navy-600 leading-relaxed">{WELCOME_STEPS[welcomeStep].body}</p>

              <div className="mt-10 flex flex-col gap-4">
                <div className="flex justify-center gap-2 mb-2">
                  {WELCOME_STEPS.map((_, step) => (
                    <div key={step} className={`h-2 rounded-full transition-all ${welcomeStep === step ? 'w-8 bg-royal-500' : 'w-2 bg-cream-300'}`} />
                  ))}
                </div>
                <div className="flex gap-3">
                  {welcomeStep > 0 && (
                    <button onClick={() => setWelcomeStep(s => s - 1)} className="tg-btn-ghost flex-1">
                      Back
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (welcomeStep < WELCOME_STEPS.length - 1) setWelcomeStep(s => s + 1);
                      else dismissWelcome();
                    }}
                    className="flex-1 rounded-full py-3.5 font-bold text-sm text-white bg-royal-600 shadow-pop
                               hover:bg-royal-700 active:translate-y-1 active:shadow-none transition-all"
                  >
                    {welcomeStep < WELCOME_STEPS.length - 1 ? 'Next' : "Let's Go!"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Greeting ── */}
      {/* Brand-coloured, like the teacher greeting — it carries the SchoolBadge,
          so it's the one surface that most needs to match the school's colour. */}
      <div className="bg-royal-600 text-white px-5 py-5 rounded-3xl mb-4">
        <SchoolBadge tone="onColor" size="sm" className="mb-3.5 pb-3.5 border-b-2 border-white/20" />
        <h1 className="font-display text-2xl font-extrabold">Hello, {firstName}! 👋</h1>
        <p className="text-royal-100 text-sm font-semibold">{data?.student?.section?.name || 'Student'}</p>
      </div>

      {/* ── Metrics ── */}
      <div className="tg-stat-row grid-cols-3 mb-6">
        <StatTile label="Stars" value={stars} icon={Star} tone="text-sun-700" className="shrink-0 w-32 md:w-auto" />
        <StatTile label="Graded" value={submissions.length} icon={CheckCircle2} tone="text-royal-600" className="shrink-0 w-32 md:w-auto" />
        <StatTile label="Overall" value={avgGrade > 0 ? `${avgGrade}%` : '—'} icon={Award} tone="text-aqua-700" className="shrink-0 w-32 md:w-auto" />
      </div>

      {/* ── Reading strategy tip ── */}
      {latestStrategy && (
        <div className="bg-sun-100 border-2 border-sun-200 rounded-3xl p-5 mb-6 flex items-start gap-4">
          <div className="bg-sun-400 text-navy-700 p-2.5 rounded-2xl shrink-0 shadow-pop">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div>
            <p className="font-display font-extrabold text-navy-700 mb-1">Your Latest Reading Strategy</p>
            <p className="text-sm text-navy-600 leading-relaxed">"{latestStrategy}"</p>
          </div>
        </div>
      )}

      {/* ── Skill progress ── */}
      <SkillProgressChart studentId={user.id} />

      {/* ── Upcoming deadlines ── */}
      <section className="mb-8">
        <h2 className="tg-section-title mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-navy-400" /> Upcoming Deadlines
        </h2>
        {upcomingDeadlines.length === 0 ? (
          <EmptyState icon={Clock} title="No upcoming deadlines" hint="You're all caught up! 🎉" />
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
                    <p className="text-[10px] font-extrabold text-royal-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
