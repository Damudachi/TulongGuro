import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Award, CheckCircle2, Star, Loader2, Lightbulb, ChevronRight, Clock, BookOpen, TrendingUp, Bot, Sparkles } from 'lucide-react';
import { API_URL } from '../../config';
import { hasSeenFlag, markFlagSeen, FLAGS } from '../../utils/onboardingState';

const SKILL_LABELS = { vocabulary: 'Vocabulary', punctuation: 'Punctuation', thematicFlow: 'Thematic Flow', sentenceStructure: 'Sentence Structure' };

function SkillBar({ label, value, max = 25 }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 70 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className="font-bold text-slate-700">{value}/{max}</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeStep, setWelcomeStep] = useState(0);

  useEffect(() => {
    if (!hasSeenFlag(FLAGS.STUDENT_WELCOME)) {
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
  const avgSkills = data?.avgSkills || {};
  const upcomingDeadlines = data?.upcomingDeadlines || [];
  const latestStrategy = data?.latestStrategy || null;
  const hasSkills = Object.values(avgSkills).some(v => v > 0);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      {/* Student Onboarding Welcome Modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in-up">
            <div className="p-8 text-center relative">
              {welcomeStep === 0 && (
                <div className="animate-fade-in">
                  <div className="w-20 h-20 bg-emerald-100 text-brand-green rounded-full flex items-center justify-center mx-auto mb-6">
                    <Award className="w-10 h-10" />
                  </div>
                  <h2 className="text-2xl font-bold text-brand-slate mb-3">Welcome to TulongGuro! 🎉</h2>
                  <p className="text-slate-600 leading-relaxed">
                    TulongGuro uses AI to help your teacher grade faster, but <span className="font-bold text-brand-slate">your teacher always makes the final decision.</span>
                  </p>
                </div>
              )}
              {welcomeStep === 1 && (
                <div className="animate-fade-in">
                  <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Bot className="w-10 h-10" />
                  </div>
                  <h2 className="text-2xl font-bold text-brand-slate mb-3">Meet your Study Buddy 🤖</h2>
                  <p className="text-slate-600 leading-relaxed">
                    It won't do your homework, but it <span className="font-bold text-brand-slate">will help you understand your mistakes.</span> Just tap the floating chat icon!
                  </p>
                </div>
              )}
              {welcomeStep === 2 && (
                <div className="animate-fade-in">
                  <div className="w-20 h-20 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Lightbulb className="w-10 h-10" />
                  </div>
                  <h2 className="text-2xl font-bold text-brand-slate mb-3">Reading Strategies 💡</h2>
                  <p className="text-slate-600 leading-relaxed">
                    Look out for the <span className="font-bold text-amber-600">orange cards</span>—these are personalized reading tips just for you to help you improve!
                  </p>
                </div>
              )}

              <div className="mt-10 flex flex-col gap-4">
                <div className="flex justify-center gap-2 mb-2">
                  {[0, 1, 2].map(step => (
                    <div key={step} className={`h-2 rounded-full transition-all ${welcomeStep === step ? 'w-8 bg-brand-green' : 'w-2 bg-slate-200'}`} />
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (welcomeStep < 2) setWelcomeStep(prev => prev + 1);
                    else {
                      setShowWelcome(false);
                      markFlagSeen(FLAGS.STUDENT_WELCOME);
                    }
                  }}
                  className="w-full bg-brand-green text-white font-bold py-3.5 rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-brand-green/20"
                >
                  {welcomeStep < 2 ? 'Next' : "Let's Go!"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-green to-emerald-600 text-white p-6 rounded-2xl mb-6 relative overflow-hidden shadow-lg">
        <div className="absolute top-0 right-0 p-4 opacity-10"><Award className="w-40 h-40" /></div>
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
      {hasSkills && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-bold text-brand-slate mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-green" /> Your Skill Progress
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.entries(SKILL_LABELS).map(([key, label]) => (
              <SkillBar key={key} label={label} value={avgSkills[key] || 0} max={25} />
            ))}
          </div>
        </div>
      )}

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
                <div key={item.id} className={`p-4 rounded-xl border ${urgency} flex items-center justify-between`}>
                  <div className="flex items-start gap-3">
                    <div className="bg-blue-50 p-2 rounded-lg text-brand-navy mt-0.5 shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-brand-slate text-sm">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.className} • {item.type} • {item.points} pts</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-bold ${urgencyText}`}>
                      {daysLeft <= 0 ? 'Due today!' : daysLeft === 1 ? 'Due tomorrow' : `${daysLeft} days left`}
                    </p>
                    <p className="text-[10px] text-slate-400">{dueDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Grades */}
      <div>
        <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-brand-green" /> Recent Grades
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
              const score = sub.hitlScore ?? sub.aiScore ?? 0;
              const color = score >= 90 ? 'text-green-600 bg-green-50' : score >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
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
                      <span className={`font-bold px-3 py-1 rounded-full text-sm ${color}`}>{score}/100</span>
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
