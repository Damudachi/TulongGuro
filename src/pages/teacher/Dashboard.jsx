import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, FileText, BookOpen, Filter, ChevronRight, Loader2 } from 'lucide-react';
import { API_URL } from '../../config';

function WizardEmptyState({ onComplete }) {
  const [step, setStep] = useState(1);
  const [sectionName, setSectionName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const res = await fetch(`${API_URL}/api/teacher/quick-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: user.id, sectionName, subject, gradeLevel, schoolYear: '2024-2025' })
      });
      const data = await res.json();
      if (data.success) {
        onComplete();
      } else {
        setError(data.error || 'Something went wrong.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden max-w-lg mx-auto">
      {/* Progress Header */}
      <div className="bg-gradient-to-r from-brand-navy to-blue-700 p-6 text-white">
        <h2 className="text-xl font-bold mb-1">Welcome to TulongGuro! 👋</h2>
        <p className="text-blue-200 text-sm">Let's set up your first class in 2 quick steps.</p>
        <div className="flex gap-2 mt-4">
          <div className={`h-1.5 rounded-full flex-1 transition-all ${step >= 1 ? 'bg-white' : 'bg-white/30'}`} />
          <div className={`h-1.5 rounded-full flex-1 transition-all ${step >= 2 ? 'bg-white' : 'bg-white/30'}`} />
        </div>
      </div>

      <div className="p-6">
        {step === 1 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 1: Name your Block Section</label>
            <p className="text-xs text-slate-500 mb-3">This is your homeroom group, e.g. "Grade 6 — Sampaguita"</p>
            <input
              type="text"
              value={sectionName}
              onChange={e => setSectionName(e.target.value)}
              placeholder="e.g. Grade 6 — Sampaguita"
              className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 outline-none transition-all"
              autoFocus
            />
            <button
              onClick={() => { if (sectionName.trim()) setStep(2); }}
              disabled={!sectionName.trim()}
              className="mt-4 w-full bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 2: Choose your Subject & Grade</label>
            <p className="text-xs text-slate-500 mb-3">For section "{sectionName}"</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Grade Level</label>
                <select
                  value={gradeLevel}
                  onChange={e => setGradeLevel(e.target.value)}
                  className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy outline-none"
                >
                  <option value="">-- Grade --</option>
                  {['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'].map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Subject</label>
                <select
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy outline-none"
                >
                  <option value="">-- Subject --</option>
                  {['Filipino','English','Mathematics','Science','Araling Panlipunan','MAPEH','TLE','ESP'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Back</button>
              <button
                onClick={handleCreate}
                disabled={!subject || !gradeLevel || isSubmitting}
                className="flex-1 bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create My First Class</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const GRADE_LEVELS = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
const SUBJECTS = ['Filipino','English','Mathematics','Science','Araling Panlipunan','MAPEH','TLE','ESP','Pagsasaling-wika','Reading & Literacy'];
const SCHOOL_YEARS = ['2024-2025','2025-2026','2026-2027'];

export default function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState({ name: '', gradeLevel: '', subject: '', schoolYear: '2024-2025', sectionId: '' });
  const [filters, setFilters] = useState({ gradeLevel: '', subject: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [showWalkthrough, setShowWalkthrough] = useState(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.id ? !localStorage.getItem(`hasSeenTeacherWalkthrough_${user.id}`) : false;
  });
  const [walkthroughStep, setWalkthroughStep] = useState(0);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    Promise.all([
      fetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()),
      fetch(`${API_URL}/api/teacher/${user.id}/sections`).then(r => r.json())
    ]).then(([clsData, secData]) => {
      if (clsData.success) setClasses(clsData.classes);
      if (secData.success) setSections(secData.sections);
    }).finally(() => setIsLoading(false));
  }, []);

  const handleAddClass = async (e) => {
    e.preventDefault();
    if (!form.sectionId) return alert('Please select a block section.');
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      // Auto-generate class name if not manually set
      const name = form.name || `${form.subject} ${form.gradeLevel}`.trim();
      const res = await fetch(`${API_URL}/api/teacher/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, gradeLevel: form.gradeLevel, subject: form.subject, schoolYear: form.schoolYear, teacherId: user.id, sectionId: form.sectionId })
      });
      const data = await res.json();
      if (data.success) {
        setIsModalOpen(false);
        setForm({ name: '', gradeLevel: '', subject: '', schoolYear: '2024-2025', sectionId: '' });
        window.location.reload();
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Network error');
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading...</div>;

  const hasDemo = classes.some(c => c.name.includes('[DEMO]'));

  const filteredClasses = classes.filter((cls) => {
    if (filters.gradeLevel && cls.gradeLevel !== filters.gradeLevel) return false;
    if (filters.subject && cls.subject !== filters.subject) return false;
    return true;
  });

  const walkthroughSteps = [
    {
      emoji: '👋',
      title: 'Welcome, Teacher!',
      text: 'We\'ve set up a Demo Class for you so you can experience TulongGuro\'s AI grading right away — no setup needed.',
    },
    {
      emoji: '📝',
      title: 'Step 1: Open the Demo Class',
      text: 'Click on the "[DEMO] Sandbox Demo Class" card below. Inside, you\'ll find a pre-loaded essay from a "Demo Student" waiting for your review.',
    },
    {
      emoji: '🤖',
      title: 'Step 2: Try the HITL Workspace',
      text: 'Click on the pending submission to open the grading workspace. You\'ll see the AI\'s suggested score, feedback, and a scanned essay. Adjust anything you want — the AI is your co-pilot, not the final judge.',
    },
    {
      emoji: '✅',
      title: 'Step 3: You\'re Ready!',
      text: 'Once you\'re comfortable, delete the Demo Class and create your own using the quick setup wizard. Add your real students and start grading!',
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Assigned Classes</h1>
          <p className="text-slate-500 text-sm">Manage your subjects and block sections</p>
        </div>
        <Link to="/teacher/sections" className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 shadow-md">
          Manage Block Sections
        </Link>
      </div>

      {/* Interactive Walkthrough Banner */}
      {hasDemo && showWalkthrough && (
        <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-brand-navy/10 rounded-xl flex items-center justify-center text-2xl shrink-0">
                {walkthroughSteps[walkthroughStep].emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-brand-slate text-base mb-1">{walkthroughSteps[walkthroughStep].title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{walkthroughSteps[walkthroughStep].text}</p>
              </div>
              <button
                onClick={() => {
                  const user = JSON.parse(localStorage.getItem('user') || '{}');
                  setShowWalkthrough(false);
                  if (user.id) localStorage.setItem(`hasSeenTeacherWalkthrough_${user.id}`, 'true');
                }}
                className="text-slate-400 hover:text-slate-600 text-xs font-medium shrink-0"
              >
                Dismiss
              </button>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-blue-200/50">
              <div className="flex gap-1.5">
                {walkthroughSteps.map((_, i) => (
                  <div key={i} className={`h-1.5 rounded-full transition-all ${walkthroughStep === i ? 'w-6 bg-brand-navy' : 'w-1.5 bg-slate-300'}`} />
                ))}
              </div>
              <div className="flex gap-2">
                {walkthroughStep > 0 && (
                  <button onClick={() => setWalkthroughStep(s => s - 1)} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-white transition-colors">Back</button>
                )}
                {walkthroughStep < walkthroughSteps.length - 1 ? (
                  <button onClick={() => setWalkthroughStep(s => s + 1)} className="text-xs font-bold text-white bg-brand-navy px-4 py-1.5 rounded-lg hover:bg-blue-900 transition-colors flex items-center gap-1">
                    Next <ChevronRight className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const user = JSON.parse(localStorage.getItem('user') || '{}');
                      setShowWalkthrough(false);
                      if (user.id) localStorage.setItem(`hasSeenTeacherWalkthrough_${user.id}`, 'true');
                    }}
                    className="text-xs font-bold text-white bg-brand-green px-4 py-1.5 rounded-lg hover:bg-emerald-600 transition-colors"
                  >
                    Got it! Let's go 🚀
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {classes.length > 4 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-brand-slate mb-3">
            <Filter className="w-4 h-4" /> Filter
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Grade Level</label>
              <select
                value={filters.gradeLevel}
                onChange={(e) => setFilters((prev) => ({ ...prev, gradeLevel: e.target.value }))}
                className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg focus:border-brand-navy focus:ring-1 focus:ring-brand-navy outline-none"
              >
                <option value="">All Grades</option>
                {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Subject</label>
              <select
                value={filters.subject}
                onChange={(e) => setFilters((prev) => ({ ...prev, subject: e.target.value }))}
                className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg focus:border-brand-navy focus:ring-1 focus:ring-brand-navy outline-none"
              >
                <option value="">All Subjects</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {classes.length === 0 && !isLoading ? (
        <WizardEmptyState onComplete={() => window.location.reload()} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClasses.map((cls) => {
            const isDemo = cls.name.includes('[DEMO]');
            return (
            <Link key={cls.id} to={`/teacher/class/${cls.id}`}
              className={`block rounded-xl p-6 hover:shadow-md transition-shadow relative overflow-hidden group ${isDemo ? 'bg-amber-50 border-2 border-amber-300 ring-2 ring-amber-200/50' : 'bg-white border border-slate-200'}`}>
              <div className={`absolute top-0 left-0 w-1 h-full ${isDemo ? 'bg-amber-500 group-hover:w-2' : 'bg-brand-navy group-hover:w-2'} transition-all`} />
              {isDemo && (
                <span className="absolute top-3 right-3 bg-amber-500 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full animate-pulse">🧪 Try Me!</span>
              )}
              <div className="mb-2">
                {(cls.gradeLevel || cls.subject) && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {cls.gradeLevel && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{cls.gradeLevel}</span>}
                    {cls.subject && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">{cls.subject}</span>}
                  </div>
                )}
                <h3 className="font-bold text-lg text-brand-slate">{cls.name}</h3>
                <span className="text-xs text-slate-500">{cls.schoolYear} • {cls.section?.name}</span>
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                <div className="text-sm text-slate-600 flex items-center gap-1">
                  <Users className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-brand-slate">{cls.section?._count?.students || 0}</span> Students
                </div>
                {cls._count?.activities > 0 ? (
                  <span className="bg-amber-100 text-brand-amber text-xs font-bold px-2 py-1 rounded-full">
                    {cls._count.activities} activities
                  </span>
                ) : (
                  <span className="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded-full">No activities</span>
                )}
              </div>
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-brand-navy group-hover:text-blue-700">Open Class Hub →</span>
              </div>
            </Link>
          )})}

          <button onClick={() => setIsModalOpen(true)}
            className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-slate-500 hover:text-brand-navy hover:border-brand-navy hover:bg-blue-50 transition-colors min-h-[160px]">
            <Plus className="w-8 h-8 mb-2" />
            <span className="font-medium">Add Subject Class</span>
          </button>
        </div>
      )}

      {/* Add Class Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Create Subject Class</h2>
            <p className="text-slate-500 text-sm mb-5">Set up a new subject for a block section.</p>
            <form onSubmit={handleAddClass} className="space-y-4">

              {/* Grade Level + Subject side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level *</label>
                  <select required value={form.gradeLevel} onChange={e => setForm({ ...form, gradeLevel: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Grade --</option>
                    {GRADE_LEVELS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject *</label>
                  <select required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Subject --</option>
                    {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Class Name (auto-generated preview, editable) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Class Name</label>
                <input type="text" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder={form.subject && form.gradeLevel ? `${form.subject} — ${form.gradeLevel}` : 'e.g. Filipino — Grade 10'}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                <p className="text-xs text-slate-400 mt-1">Leave blank to use "Subject — Grade Level" automatically</p>
              </div>

              {/* School Year */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">School Year *</label>
                <select required value={form.schoolYear} onChange={e => setForm({ ...form, schoolYear: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  {SCHOOL_YEARS.map(sy => <option key={sy}>{sy}</option>)}
                </select>
              </div>

              {/* Block Section */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Block Section *</label>
                <select required value={form.sectionId} onChange={e => setForm({ ...form, sectionId: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  <option value="">-- Choose a section --</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name} ({s._count?.students} students)</option>)}
                </select>
                {sections.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">⚠ No sections yet. <Link to="/teacher/sections" className="underline">Create a Block Section first.</Link></p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2 rounded-lg bg-brand-navy text-white font-medium hover:bg-blue-900">Create Class</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
