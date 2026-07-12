import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Award, CheckCircle2, Star, Loader2, Lightbulb, ChevronRight, Clock, BookOpen, TrendingUp, Bot, Sparkles, Send } from 'lucide-react';
import { API_URL } from '../../config';

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
  const [analytics, setAnalytics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeStep, setWelcomeStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem('hasSeenStudentWelcome')) {
      setShowWelcome(true);
    }
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/student/${user.id}/dashboard`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));

    fetch(`${API_URL}/api/student/${user.id}/analytics`)
      .then(r => r.json())
      .then(d => { if (d.success) setAnalytics(d); })
      .catch(() => {});
  }, []);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...</div>;

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const firstName = (data?.student?.name || user.name || 'Student').split(' ')[0];
  const submissions = data?.submissions || [];
  const stars = data?.stars || 0;
  const avgGrade = data?.avgGrade || 0;
  const avgSkills = data?.avgSkills || {};
  const upcomingDeadlines = data?.upcomingDeadlines || [];
  const pendingSubmissions = data?.pendingSubmissions || [];
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
                      localStorage.setItem('hasSeenStudentWelcome', 'true');
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

      {/* My Performance Analytics */}
      {analytics && (
        <div className="mb-6 space-y-6 animate-fade-in">
          <h2 className="text-lg font-bold text-brand-slate flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand-amber" /> My Performance
          </h2>

          {/* A. Topic Mastery Chart */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-brand-slate mb-4">Topic Mastery</h3>
            {(!analytics.topicMastery || analytics.topicMastery.length === 0) ? (
              <p className="text-sm text-slate-400 text-center py-6">
                No topic data yet — your mastery will appear as you complete more activities.
              </p>
            ) : (
              <div className="space-y-3">
                {analytics.topicMastery.map((topic, idx) => {
                  const pct = Math.round(topic.percentage ?? 0);
                  const colorClass = pct >= 85 ? 'bg-emerald-400' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400';
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-slate-600 w-28 shrink-0 truncate" title={topic.name}>{topic.name}</span>
                      <div className="bg-gray-700 rounded-full h-3 flex-1">
                        <div className={`h-3 rounded-full transition-all duration-700 ${colorClass}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-slate-700 w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* B. Skill Trend Chart */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-brand-slate mb-4">Skill Trends</h3>
            {(!analytics.skillTrends || analytics.skillTrends.length === 0) ? (
              <p className="text-sm text-slate-400 text-center py-6">
                Submit more activities to see your skill trends.
              </p>
            ) : (() => {
              const TREND_SKILLS = [
                { key: 'vocabulary', label: 'Vocabulary', color: '#8b5cf6' },
                { key: 'punctuation', label: 'Punctuation', color: '#06b6d4' },
                { key: 'thematicFlow', label: 'Thematic Flow', color: '#f59e0b' },
                { key: 'sentenceStructure', label: 'Sentence Structure', color: '#10b981' },
              ];
              const trends = analytics.skillTrends;
              const toPoints = (key) =>
                trends.map((d, i) => {
                  const x = trends.length === 1 ? 215 : 50 + (i * (330 / (trends.length - 1)));
                  const y = 180 - ((d[key] || 0) / 25) * 170;
                  return `${x},${y}`;
                }).join(' ');
              return (
                <>
                  <svg viewBox="0 0 400 200" className="w-full h-48">
                    {/* Grid lines */}
                    <line x1="40" y1="10" x2="40" y2="180" stroke="#374151" strokeWidth="1" />
                    <line x1="40" y1="180" x2="390" y2="180" stroke="#374151" strokeWidth="1" />
                    {/* Horizontal guide lines */}
                    <line x1="40" y1="95" x2="390" y2="95" stroke="#374151" strokeWidth="0.5" strokeDasharray="4" />
                    <line x1="40" y1="10" x2="390" y2="10" stroke="#374151" strokeWidth="0.5" strokeDasharray="4" />
                    {/* Y-axis labels */}
                    <text x="35" y="15" fill="#9ca3af" fontSize="10" textAnchor="end">25</text>
                    <text x="35" y="98" fill="#9ca3af" fontSize="10" textAnchor="end">12</text>
                    <text x="35" y="183" fill="#9ca3af" fontSize="10" textAnchor="end">0</text>
                    {/* X-axis labels */}
                    {trends.map((_, i) => {
                      const x = trends.length === 1 ? 215 : 50 + (i * (330 / (trends.length - 1)));
                      return <text key={i} x={x} y="195" fill="#9ca3af" fontSize="9" textAnchor="middle">{i + 1}</text>;
                    })}
                    {/* Polylines for each skill */}
                    {TREND_SKILLS.map(skill => (
                      <polyline key={skill.key} points={toPoints(skill.key)} fill="none" stroke={skill.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                    {/* Data dots */}
                    {TREND_SKILLS.map(skill =>
                      trends.map((d, i) => {
                        const x = trends.length === 1 ? 215 : 50 + (i * (330 / (trends.length - 1)));
                        const y = 180 - ((d[skill.key] || 0) / 25) * 170;
                        return <circle key={`${skill.key}-${i}`} cx={x} cy={y} r="3" fill={skill.color} />;
                      })
                    )}
                  </svg>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 justify-center">
                    {TREND_SKILLS.map(skill => (
                      <div key={skill.key} className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: skill.color }} />
                        <span className="text-xs text-slate-500">{skill.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          {/* C. Performance Summary Card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
              <span className="text-2xl">🏆</span>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mt-1">Strongest Topic</p>
              <p className="text-sm font-bold text-brand-slate mt-1 truncate" title={analytics.strongestTopic || '—'}>
                {analytics.strongestTopic || '—'}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
              <span className="text-2xl">📈</span>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mt-1">Area to Improve</p>
              <p className="text-sm font-bold text-brand-slate mt-1 truncate" title={analytics.weakestTopic || '—'}>
                {analytics.weakestTopic || '—'}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
              <span className="text-2xl">🔥</span>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mt-1">Submissions</p>
              <p className="text-sm font-bold text-brand-slate mt-1">
                {analytics.totalGraded ?? submissions.length}
              </p>
            </div>
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
                <Link key={item.id} to={`/student/submit?activityId=${item.id}`}
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
                    <p className="text-[10px] font-bold text-brand-green mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Submit Now →</p>
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
              <Link key={sub.id} to={`/student/submit?activityId=${sub.activityId}`}
                className="block bg-white p-4 rounded-xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all group cursor-pointer">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="bg-amber-50 p-2 rounded-lg text-amber-500"><BookOpen className="w-5 h-5" /></div>
                    <div>
                      <h3 className="font-bold text-brand-slate text-sm group-hover:text-amber-600 transition-colors">{sub.activity?.title}</h3>
                      <p className="text-xs text-slate-500">{sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
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
