import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, FileText, BookOpen, Filter, ChevronRight, Loader2, UploadCloud, X } from 'lucide-react';
import { API_URL } from '../../config';

function WizardEmptyState({ onComplete, sections = [] }) {
  const [step, setStep] = useState(1);
  const [className, setClassName] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(sections.length === 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [curriculumFile, setCurriculumFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState('');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      let finalSectionId = sectionId;

      if (isCreatingNew) {
        const secRes = await fetch(`${API_URL}/api/teacher/sections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherId: user.id, name: sectionName })
        });
        const secData = await secRes.json();
        if (!secData.success) {
          setError(secData.error || 'Failed to create section.');
          setIsSubmitting(false);
          return;
        }
        finalSectionId = secData.section?.id || secData.id;
      }

      // Use FormData to support curriculum file upload
      const fd = new FormData();
      fd.append('name', className || 'English — Grade 6');
      fd.append('teacherId', user.id);
      fd.append('sectionId', finalSectionId);
      fd.append('subject', 'English');
      fd.append('gradeLevel', 'Grade 6');
      fd.append('schoolYear', '2024-2025');
      if (curriculumFile) fd.append('curriculumFile', curriculumFile);

      const clsRes = await fetch(`${API_URL}/api/teacher/classes`, {
        method: 'POST',
        body: fd
      });
      const clsData = await clsRes.json();
      
      if (clsData.success) {
        // If curriculum file was uploaded, trigger parsing
        if (curriculumFile && clsData.class?.id) {
          setIsParsing(true);
          setParseStatus('Scanning curriculum & generating rubrics...');
          try {
            const parseRes = await fetch(`${API_URL}/api/teacher/classes/${clsData.class.id}/parse-curriculum`, {
              method: 'POST'
            });
            const parseData = await parseRes.json();
            if (parseData.success) {
              setParseStatus(`Done! Extracted ${parseData.lessons?.length || 0} lessons.`);
            } else {
              setParseStatus('Could not parse curriculum. You can add lessons manually.');
            }
          } catch {
            setParseStatus('Parsing failed. You can add lessons manually.');
          }
          // Brief delay to show status
          await new Promise(r => setTimeout(r, 1500));
          setIsParsing(false);
        }
        onComplete();
      } else {
        setError(clsData.error || 'Something went wrong.');
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
        <p className="text-blue-200 text-sm">Let's set up your first class in 4 quick steps.</p>
        <div className="flex gap-2 mt-4">
          <div className={`h-1.5 rounded-full flex-1 transition-all ${step >= 1 ? 'bg-white' : 'bg-white/30'}`} />
          <div className={`h-1.5 rounded-full flex-1 transition-all ${step >= 2 ? 'bg-white' : 'bg-white/30'}`} />
          <div className={`h-1.5 rounded-full flex-1 transition-all ${step >= 3 ? 'bg-white' : 'bg-white/30'}`} />
          <div className={`h-1.5 rounded-full flex-1 transition-all ${step >= 4 ? 'bg-white' : 'bg-white/30'}`} />
        </div>
      </div>

      <div className="p-6">
        {step === 1 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 1: Name your Class</label>
            <p className="text-xs text-slate-500 mb-3">Give your class a clear name, e.g. "English Grade 6"</p>
            <input
              type="text"
              value={className}
              onChange={e => setClassName(e.target.value)}
              placeholder="e.g. English Grade 6"
              className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 outline-none transition-all"
              autoFocus
            />
            <button
              onClick={() => { if (className.trim()) setStep(2); }}
              disabled={!className.trim()}
              className="mt-4 w-full bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 2: Choose or Name your Block Section</label>
            <p className="text-xs text-slate-500 mb-3">This is your homeroom group, e.g. "Grade 6 — Sampaguita"</p>
            
            {sections.length > 0 ? (
              <div className="space-y-3">
                <select
                  value={isCreatingNew ? 'new' : sectionId}
                  onChange={e => {
                    if (e.target.value === 'new') {
                      setIsCreatingNew(true);
                      setSectionId('');
                    } else {
                      setIsCreatingNew(false);
                      setSectionId(e.target.value);
                      const selectedSec = sections.find(s => s.id === e.target.value);
                      if (selectedSec) setSectionName(selectedSec.name);
                    }
                  }}
                  className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy outline-none"
                >
                  <option value="" disabled>-- Select existing section --</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="new">+ Create New Section</option>
                </select>

                {isCreatingNew && (
                  <input
                    type="text"
                    value={sectionName}
                    onChange={e => setSectionName(e.target.value)}
                    placeholder="e.g. Grade 6 — Sampaguita"
                    className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 outline-none transition-all animate-fade-in"
                    autoFocus
                  />
                )}
              </div>
            ) : (
              <input
                type="text"
                value={sectionName}
                onChange={e => setSectionName(e.target.value)}
                placeholder="e.g. Grade 6 — Sampaguita"
                className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 outline-none transition-all"
                autoFocus
              />
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Back</button>
              <button
                onClick={() => {
                  if ((isCreatingNew && sectionName.trim()) || (!isCreatingNew && sectionId)) {
                    setStep(3);
                  }
                }}
                disabled={(isCreatingNew && !sectionName.trim()) || (!isCreatingNew && !sectionId)}
                className="flex-1 bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 3: Upload Curriculum / Lesson Plan</label>
            <p className="text-xs text-slate-500 mb-3">Upload your curriculum guide or lesson plan (PDF or DOCX). The AI will extract lessons and generate rubrics.</p>
            
            {!curriculumFile ? (
              <label className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
                <UploadCloud className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                <p className="text-sm font-medium text-slate-600">Click to upload PDF or DOCX</p>
                <p className="text-xs text-slate-400 mt-1">Max 20MB</p>
                <input type="file" accept=".pdf,.docx" className="hidden" onChange={e => {
                  if (e.target.files?.[0]) setCurriculumFile(e.target.files[0]);
                }} />
              </label>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                <FileText className="w-5 h-5 text-green-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-800 truncate">{curriculumFile.name}</p>
                  <p className="text-xs text-green-600">{(curriculumFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button type="button" onClick={() => setCurriculumFile(null)} className="text-red-400 hover:text-red-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            
            <div className="flex gap-2 mt-4">
              <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Back</button>
              <button
                onClick={() => setStep(4)}
                className="flex-1 bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 transition-all flex items-center justify-center gap-2"
              >
                {curriculumFile ? 'Next' : 'Skip for Now'} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 4: Confirm & Create</label>
            <p className="text-xs text-slate-500 mb-4">Your class will be created with these settings:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">Class Name</span>
                <span className="text-sm font-bold text-brand-slate">{className}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">Block Section</span>
                <span className="text-sm font-bold text-brand-slate">{sectionName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">Subject</span>
                <span className="text-sm font-bold text-brand-slate">English (Grade 6)</span>
              </div>
              {curriculumFile && (
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-slate-500">Curriculum File</span>
                  <span className="text-sm font-bold text-brand-slate truncate max-w-[200px]">{curriculumFile.name}</span>
                </div>
              )}
            </div>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(3)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Back</button>
              <button
                onClick={handleCreate}
                disabled={isSubmitting || isParsing}
                className="flex-1 bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting || isParsing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {isParsing ? parseStatus : 'Creating...'}</>
                ) : (
                  <><Plus className="w-4 h-4" /> Create My First Class</>
                )}
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
  const [form, setForm] = useState({ name: '', gradeLevel: 'Grade 6', subject: 'English', schoolYear: '2024-2025', sectionId: '' });
  const [modalCurriculumFile, setModalCurriculumFile] = useState(null);
  const [modalIsParsing, setModalIsParsing] = useState(false);
  const [modalParseStatus, setModalParseStatus] = useState('');
  const [filters, setFilters] = useState({ gradeLevel: '', subject: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [showWalkthrough, setShowWalkthrough] = useState(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.id ? !localStorage.getItem(`hasSeenTeacherWalkthrough_${user.id}`) : false;
  });
  const [walkthroughStep, setWalkthroughStep] = useState(0);

  const [showWelcomeModal, setShowWelcomeModal] = useState(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.id ? !localStorage.getItem(`hasSeenTeacherWelcome_${user.id}`) : false;
  });

  const dismissWelcome = () => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) localStorage.setItem(`hasSeenTeacherWelcome_${user.id}`, 'true');
    setShowWelcomeModal(false);
  };

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    Promise.all([
      fetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()),
      fetch(`${API_URL}/api/teacher/${user.id}/sections`).then(r => r.json())
    ]).then(([clsData, secData]) => {
      if (clsData.success) {
        setClasses(clsData.classes);
        // Remove onboarding for existing accounts
        if (clsData.classes.length > 0) {
          setShowWelcomeModal(false);
          setShowWalkthrough(false);
          localStorage.setItem(`hasSeenTeacherWelcome_${user.id}`, 'true');
          localStorage.setItem(`hasSeenTeacherWalkthrough_${user.id}`, 'true');
        }
      }
      if (secData.success) setSections(secData.sections);
    }).finally(() => setIsLoading(false));
  }, []);

  const handleAddClass = async (e) => {
    e.preventDefault();
    if (!form.sectionId) return alert('Please select a block section.');
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const name = form.name || `${form.subject} ${form.gradeLevel}`.trim();
      
      const fd = new FormData();
      fd.append('name', name);
      fd.append('gradeLevel', form.gradeLevel);
      fd.append('subject', form.subject);
      fd.append('schoolYear', form.schoolYear);
      fd.append('teacherId', user.id);
      fd.append('sectionId', form.sectionId);
      if (modalCurriculumFile) fd.append('curriculumFile', modalCurriculumFile);

      const res = await fetch(`${API_URL}/api/teacher/classes`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        if (modalCurriculumFile && data.class?.id) {
          setModalIsParsing(true);
          setModalParseStatus('Scanning curriculum & generating rubrics...');
          try {
            const parseRes = await fetch(`${API_URL}/api/teacher/classes/${data.class.id}/parse-curriculum`, {
              method: 'POST'
            });
            const parseData = await parseRes.json();
            if (parseData.success) {
              setModalParseStatus(`Done! Extracted ${parseData.lessons?.length || 0} lessons.`);
            }
          } catch {}
          await new Promise(r => setTimeout(r, 1500));
          setModalIsParsing(false);
        }
        setIsModalOpen(false);
        setForm({ name: '', gradeLevel: 'Grade 6', subject: 'English', schoolYear: '2024-2025', sectionId: '' });
        setModalCurriculumFile(null);
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
      title: 'Step 2: Try the Teacher Review Workspace',
      text: 'Click "Review" on any graded essay to see the AI feedback and edit it before the student sees it. You\'ll see the AI\'s suggested score, feedback, and a scanned essay. Adjust anything you want — the AI is your co-pilot, not the final judge.',
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
        <WizardEmptyState onComplete={() => window.location.reload()} sections={sections} />
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

              {/* Grade Level + Subject side by side (Fixed) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level</label>
                  <div className="w-full border border-slate-200 p-2 rounded-lg bg-slate-50 text-slate-600 text-sm font-medium cursor-not-allowed">
                    Grade 6
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                  <div className="w-full border border-slate-200 p-2 rounded-lg bg-slate-50 text-slate-600 text-sm font-medium cursor-not-allowed">
                    English
                  </div>
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

              {/* Curriculum File Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Curriculum / Lesson Plan (Optional)</label>
                {!modalCurriculumFile ? (
                  <label className="block border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
                    <UploadCloud className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                    <p className="text-xs text-slate-500">Upload PDF or DOCX</p>
                    <input type="file" accept=".pdf,.docx" className="hidden" onChange={e => {
                      if (e.target.files?.[0]) setModalCurriculumFile(e.target.files[0]);
                    }} />
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <FileText className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-xs font-medium text-green-800 truncate flex-1">{modalCurriculumFile.name}</span>
                    <button type="button" onClick={() => setModalCurriculumFile(null)} className="text-red-400 hover:text-red-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {modalIsParsing && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-blue-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {modalParseStatus}
                  </div>
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

      {/* Teacher Onboarding Modal */}
      {showWelcomeModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">👋</span>
            </div>
            <h2 className="text-2xl font-bold text-brand-slate mb-2">Welcome to TulongGuro!</h2>
            <p className="text-slate-600 mb-6">
              Your AI teaching assistant is ready! Here is what you can do:
            </p>
            <div className="space-y-4 text-left mb-8">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-50 rounded-lg"><BookOpen className="w-5 h-5 text-brand-navy" /></div>
                <div>
                  <h3 className="font-bold text-brand-slate">Create Activities</h3>
                  <p className="text-xs text-slate-500">Make assignments and rubrics for your classes.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-green-50 rounded-lg"><UploadCloud className="w-5 h-5 text-brand-green" /></div>
                <div>
                  <h3 className="font-bold text-brand-slate">Scan & Grade Papers</h3>
                  <p className="text-xs text-slate-500">Upload photos of student essays for instant grading.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-50 rounded-lg"><Users className="w-5 h-5 text-purple-600" /></div>
                <div>
                  <h3 className="font-bold text-brand-slate">Teacher Review</h3>
                  <p className="text-xs text-slate-500">Check the AI's feedback and refine it before sending it to students.</p>
                </div>
              </div>
            </div>
            <button
              onClick={dismissWelcome}
              className="w-full py-3 bg-brand-navy text-white font-bold rounded-xl hover:bg-blue-900 transition-colors"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
