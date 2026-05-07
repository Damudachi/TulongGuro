import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Award, CheckCircle2, Star, Loader2, Lightbulb, ChevronRight, Bell, Upload } from 'lucide-react';

export default function StudentDashboard() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`http://localhost:3000/api/student/${user.id}/dashboard`)
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

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
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
        
        {/* Quick Action */}
        <Link to="/student/submit"
          className="mt-4 flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 transition-colors border border-white/30 rounded-xl py-2.5 px-4 text-sm font-bold relative z-10">
          <Upload className="w-4 h-4" /> Submit New Work
        </Link>
      </div>

      {submissions.some(s => s.status === 'GRADED') && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="bg-brand-navy text-white p-2 rounded-lg"><Bell className="w-4 h-4" /></div>
          <div>
            <p className="font-semibold text-brand-slate text-sm">New feedback available!</p>
            <p className="text-xs text-slate-500">Your teacher has graded and released your work.</p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-brand-slate mb-4">Graded Outputs</h2>
        {submissions.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No graded outputs yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map(sub => {
              const score = sub.hitlScore ?? sub.aiScore ?? 0;
              const color = score >= 90 ? 'text-green-600 bg-green-50' : score >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
              return (
                <Link to={`/student/output/${sub.id}`} key={sub.id}
                  className="block bg-white p-4 rounded-xl border border-slate-200 hover:border-brand-green hover:shadow-md transition-all group">
                  <div className="flex justify-between items-start">
                    <div className="flex items-start gap-3">
                      <div className="bg-green-50 p-2 rounded-lg text-brand-green mt-0.5"><BookOpen className="w-5 h-5" /></div>
                      <div>
                        <h3 className="font-bold text-brand-slate group-hover:text-brand-green transition-colors">{sub.activity?.title}</h3>
                        <p className="text-xs text-slate-500">{sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                        {sub.readingStrategy && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-brand-amber font-medium">
                            <Lightbulb className="w-3 h-3" /> Reading strategy available
                          </div>
                        )}
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
          </div>
        )}
      </div>
    </div>
  );
}
