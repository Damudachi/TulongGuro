import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lightbulb, Trophy, Image as ImageIcon, Loader2 } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

export default function OutputDetails() {
  const navigate = useNavigate();
  const { outputId } = useParams();
  const [sub, setSub] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showImage, setShowImage] = useState(false);

  useEffect(() => {
    if (!outputId || outputId === 'test123') {
      setSub({
        activity: { title: 'Noli Me Tangere Reflection', class: { name: 'Filipino 10' } },
        hitlScore: 88, aiScore: 85,
        hitlFeedback: "Your reflection was deep and insightful. Keep developing your paragraph transitions.",
        aiFeedback: "Good effort on the topic.",
        readingStrategy: "Focus on 'Signpost Words' (however, therefore, consequently) in your next reading.",
        rubricData: JSON.stringify({ content: { score: 35, max: 40 }, organization: { score: 25, max: 30 }, grammar: { score: 28, max: 30 } }),
        student: { name: 'Juan Dela Cruz' }, updatedAt: new Date().toISOString()
      });
      setIsLoading(false);
      return;
    }
    fetch(`${API_URL}/api/submissions/${outputId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSub(d.submission); })
      .finally(() => setIsLoading(false));
  }, [outputId]);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-brand-green" /></div>;
  if (!sub) return <div className="p-8 text-center text-slate-500">Submission not found.</div>;

  const score = sub.hitlScore ?? sub.aiScore ?? 0;
  const feedback = sub.hitlFeedback || sub.aiFeedback || '';
  const rubric = sub.rubricData ? JSON.parse(sub.rubricData) : {
    content: { score: 35, max: 40 }, organization: { score: 25, max: 30 }, grammar: { score: 28, max: 30 }
  };
  const rubricItems = [
    { name: 'Content & Ideas', ...rubric.content, color: 'bg-brand-green' },
    { name: 'Organization', ...rubric.organization, color: 'bg-amber-400' },
    { name: 'Grammar', ...rubric.grammar, color: 'bg-blue-400' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
      </button>

      {/* Score Card */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6 shadow-sm">
        <div className="bg-gradient-to-br from-brand-green to-emerald-600 p-6 text-center text-white relative">
          <div className="absolute top-4 right-4 opacity-20"><Trophy className="w-16 h-16" /></div>
          <h1 className="text-xl font-bold mb-1 relative z-10">{sub.activity?.title}</h1>
          <p className="text-green-100 text-sm relative z-10">
            {sub.activity?.class?.name} • {new Date(sub.updatedAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
          <div className="mt-6 relative z-10">
            <span className="text-6xl font-extrabold tracking-tight">{score}</span>
            <span className="text-2xl text-green-200">/100</span>
          </div>
        </div>

        <div className="p-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Rubric Breakdown</h3>
          <div className="space-y-5">
            {rubricItems.map((item, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-medium text-slate-700">{item.name}</span>
                  <span className="font-bold text-slate-900">{item.score}/{item.max}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div className={cn('h-3 rounded-full transition-all duration-700', item.color)}
                    style={{ width: `${(item.score / item.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reading Strategy */}
      {sub.readingStrategy && (
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border-2 border-brand-amber p-6 mb-6 relative overflow-hidden shadow-sm">
          <div className="absolute -right-4 -top-4 opacity-10"><Lightbulb className="w-32 h-32 text-brand-amber" /></div>
          <div className="flex items-center mb-4 relative z-10">
            <div className="bg-brand-amber text-white p-2 rounded-lg mr-3 shadow-inner"><Lightbulb className="w-6 h-6" /></div>
            <h2 className="text-xl font-bold text-slate-800">Your Reading Strategy</h2>
          </div>
          <p className="text-slate-800 leading-relaxed font-medium relative z-10 text-[15px]">"{sub.readingStrategy}"</p>
        </div>
      )}

      {/* Teacher Feedback */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Teacher's Feedback</h3>
        <p className="text-slate-700 leading-relaxed text-[15px]">{feedback}</p>
      </div>

      {/* Original Submission */}
      {sub.imageUrl && (
        <div>
          <button onClick={() => setShowImage(!showImage)}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-4 px-6 rounded-2xl flex items-center justify-center transition-colors shadow-md">
            <ImageIcon className="w-5 h-5 mr-2" /> {showImage ? 'Hide' : 'View'} Original Submission
          </button>
          {showImage && (
            <div className="mt-4 rounded-2xl overflow-hidden border border-slate-200 shadow">
              <img src={sub.imageUrl?.startsWith('http') ? sub.imageUrl : `${API_URL}${sub.imageUrl}`} alt="Original essay" className="w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
