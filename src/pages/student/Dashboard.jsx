import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Award, CheckCircle2, Star, Loader2, Lightbulb, ChevronRight, Clock, BookOpen, Send } from 'lucide-react';
import { API_URL } from '../../config';
import SkillProgressChart from '../../components/SkillProgressChart';
import { ONBOARDING, hasSeenOnboarding, markOnboardingSeen } from '../../utils/onboarding';
import SchoolBadge from '../../components/SchoolBadge';

const WELCOME_STEPS = [
  {
    icon: Award,
    tone: 'bg-emerald-100 text-brand-green',
    title: 'Welcome to TulongGuro! 🎉',
    body: 'TulongGuro uses AI to help your teacher grade faster, but your teacher always makes the final decision.',
  },
  {
    icon: Send,
    tone: 'bg-blue-100 text-brand-navy',
    title: 'Submitting Your Work 📤',
    body: 'Some activities you upload yourself. For others your teacher submits the paper for you — each activity tells you which.',
  },
  {
    icon: Lightbulb,
    tone: 'bg-amber-100 text-amber-500',
    title: 'Reading Strategies 💡',
    body: 'Look out for the orange cards — these are personalized reading tips just for you, to help you improve.',
  },
];

export default function StudentDashboard() {
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
    fetch(`${API_URL}/api/student/${user.id}/dashboard`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...</div>;

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

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      {/* Student Onboarding Welcome Modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in-up">
            <div className="p-8 text-center relative">
              <button onClick={dismissWelcome}
                className="absolute top-4 right-5 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors">
                Skip
              </button>

              <div className="animate-fade-in">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${WELCOME_STEPS[welcomeStep].tone}`}>
                  {(() => {
                    const Icon = WELCOME_STEPS[welcomeStep].icon;
                    return <Icon className="w-10 h-10" />;
                  })()}
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Step {welcomeStep + 1} of {WELCOME_STEPS.length}
                </p>
                <h2 className="text-2xl font-bold text-brand-slate mb-3">{WELCOME_STEPS[welcomeStep].title}</h2>
                <p className="text-slate-600 leading-relaxed">{WELCOME_STEPS[welcomeStep].body}</p>
              </div>

              <div className="mt-10 flex flex-col gap-4">
                <div className="flex justify-center gap-2 mb-2">
                  {WELCOME_STEPS.map((_, step) => (
                    <div key={step} className={`h-2 rounded-full transition-all ${welcomeStep === step ? 'w-8 bg-brand-green' : 'w-2 bg-slate-200'}`} />
                  ))}
                </div>
                <div className="flex gap-3">
                  {welcomeStep > 0 && (
                    <button onClick={() => setWelcomeStep(s => s - 1)}
                      className="flex-1 border-2 border-slate-200 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-50 transition-colors">
                      Back
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (welcomeStep < WELCOME_STEPS.length - 1) setWelcomeStep(s => s + 1);
                      else dismissWelcome();
                    }}
                    className="flex-1 bg-brand-green text-white font-bold py-3.5 rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-brand-green/20"
                  >
                    {welcomeStep < WELCOME_STEPS.length - 1 ? 'Next' : "Let's Go!"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-green to-emerald-600 text-white p-6 rounded-2xl mb-6 relative overflow-hidden shadow-lg">
        <div className="absolute top-0 right-0 p-4 opacity-10"><Award className="w-40 h-40" /></div>
        <SchoolBadge tone="onColor" size="sm" className="relative z-10 mb-4 pb-4 border-b border-white/20" />
        <h1 className="text-2xl font-bold mb-1 relative z-10">Hello, {firstName}! 👋</h1>
        <p className="text-green-100 text-sm relative z-10">{data?.student?.section?.name || 'Student'}</p>
        <div className="flex gap-3 mt-5 relative z-10 flex-wrap">
          <div className="bg-white/20 px-4 py-2.5 rounded-xl backdrop-blur-sm">
            <span className="block text-xs uppercase tracking-wider font-bold mb-1 text-green-100">Total Stars</span>
            <span className="text-xl font-bold flex items-center"><Star className="w-5 h-5 mr-1 fill-yellow-300 text-yellow-300" /> {stars}</span>
          </div>
          <div className="bg-white/20 px-4 py-2.5 rounded-xl backdrop-blur-sm">
            <span className="block text-xs uppercase tracking-wider font-bold mb-1 text-green-100">Graded</span>
            <span className="text-xl font-bold flex items-center"><CheckCircle2 className="w-5 h-5 mr-1" /> {submissions.length}</span>
          </div>
          <div className="bg-white/20 px-4 py-2.5 rounded-xl backdrop-blur-sm flex-1 min-w-[120px] text-center border border-white/20">
            <span className="block text-xs uppercase tracking-wider font-bold mb-1 text-green-100">Overall Grade</span>
            <span className="text-2xl font-extrabold">{avgGrade > 0 ? `${avgGrade}%` : '—'}</span>
          </div>
        </div>
      </div>

      {/* Reading Strategy Tip */}
      {latestStrategy && (
        <div className="bg-gradient-to-r from-amber-50 to-amber-100 border-2 border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <div className="bg-amber-500 text-white p-2 rounded-lg shrink-0 mt-0.5"><Lightbulb className="w-5 h-5" /></div>
          <div>
            <p className="font-bold text-amber-800 text-sm mb-1">💡 Your Latest Reading Strategy</p>
            <p className="text-sm text-amber-700 leading-relaxed">"{latestStrategy}"</p>
          </div>
        </div>
      )}

      {/* Skill Progress */}
      <SkillProgressChart studentId={user.id} />


      {/* Upcoming Deadlines */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-400" /> Upcoming Deadlines
        </h2>
        {upcomingDeadlines.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
            <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No upcoming deadlines</p>
            <p className="text-xs mt-1">You're all caught up! 🎉</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingDeadlines.map(item => {
              const dueDate = new Date(item.deadline);
              const daysLeft = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
              const urgency = daysLeft <= 1 ? 'border-red-300 bg-red-50' : daysLeft <= 3 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white';
              const urgencyText = daysLeft <= 1 ? 'text-red-600' : daysLeft <= 3 ? 'text-amber-600' : 'text-slate-500';
              return (
                <Link key={item.id} to={activityLink(item.id, item.submissionMode)}
                  className={`block p-4 rounded-xl border ${urgency} flex items-center justify-between hover:shadow-md hover:border-brand-navy transition-all cursor-pointer group`}>
                  <div className="flex items-start gap-3">
                    <div className="bg-blue-50 p-2 rounded-lg text-brand-navy mt-0.5 shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-brand-slate text-sm group-hover:text-brand-navy transition-colors">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.className} • {item.type} • <span className="font-bold text-brand-navy">{item.points} pts</span></p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-bold ${urgencyText}`}>
                      {daysLeft <= 0 ? 'Due today!' : daysLeft === 1 ? 'Due tomorrow' : `${daysLeft} days left`}
                    </p>
                    <p className="text-[10px] text-slate-400">{dueDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                    <p className="text-[10px] font-bold text-brand-green mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {item.submissionMode === 'STUDENT_SUBMIT' ? 'Submit Now →' : 'View Details →'}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Submitted — Awaiting Grading */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center gap-2">
          <Send className="w-5 h-5 text-amber-500" /> Submitted
        </h2>
        {pendingSubmissions.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
            <Send className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No pending submissions</p>
            <p className="text-xs mt-1">Submissions awaiting grading will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingSubmissions.map(sub => (
              <Link key={sub.id} to={activityLink(sub.activityId, sub.activity?.submissionMode)}
                className="block bg-white p-4 rounded-xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all group cursor-pointer">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="bg-amber-50 p-2 rounded-lg text-amber-500"><BookOpen className="w-5 h-5" /></div>
                    <div>
                      <h3 className="font-bold text-brand-slate text-sm group-hover:text-amber-600 transition-colors">{sub.activity?.title}</h3>
                      <p className="text-xs text-slate-500">{sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                        {(sub.activity?.maxAttempts || 1) > 1 && <span className="ml-1 font-bold text-blue-500">• Attempt {sub.attemptCount || 1}/{sub.activity?.maxAttempts}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-3 py-1.5 rounded-full text-amber-600 bg-amber-50 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Awaiting Grading
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Graded Submission */}
      <div>
        <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-brand-green" /> Graded Submission
        </h2>
        {submissions.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
            <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No graded activities yet</p>
            <p className="text-xs mt-1">Your grades will appear here once your teacher grades your work.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.slice(0, 5).map(sub => {
              const percentageScore = sub.hitlScore ?? sub.aiScore ?? 0;
              const maxPoints = sub.activity?.points || 100;
              const score = ((percentageScore / 100) * maxPoints).toFixed(1).replace(/\.0$/, '');
              const color = percentageScore >= 90 ? 'text-green-600 bg-green-50' : percentageScore >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
              return (
                <Link to={`/student/output/${sub.id}`} key={sub.id}
                  className="block bg-white p-4 rounded-xl border border-slate-200 hover:border-brand-green hover:shadow-md transition-all group">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="bg-green-50 p-2 rounded-lg text-brand-green"><BookOpen className="w-5 h-5" /></div>
                      <div>
                        <h3 className="font-bold text-brand-slate text-sm group-hover:text-brand-green transition-colors">{sub.activity?.title}</h3>
                        <p className="text-xs text-slate-500">{sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold px-3 py-1 rounded-full text-sm ${color}`}>{score}/{maxPoints}</span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-green" />
                    </div>
                  </div>
                </Link>
              );
            })}
            {submissions.length > 5 && (
              <Link to="/student/subjects" className="block text-center text-sm text-brand-green font-medium hover:underline py-2">
                View all in Subjects →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
