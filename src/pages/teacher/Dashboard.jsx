import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Filter, ChevronRight, Loader2, Sparkles, CloudOff } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import { saveTeacherSnapshot, readTeacherSnapshot } from '../../utils/offlineSnapshot';
import { ONBOARDING, hasSeenOnboarding, markOnboardingSeen, clearOnboardingSeen } from '../../utils/onboarding';
import { GRADE_LEVELS, SUBJECTS, SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR } from '../../constants/school';
import SchoolBadge from '../../components/SchoolBadge';
import FolderCard from '../../components/FolderCard';
import EarlyWarningPanel from '../../components/EarlyWarningPanel';
import SetupChecklist from '../../components/SetupChecklist';
import ExampleFeedback from '../../components/ExampleFeedback';
import { buildSteps } from '../../utils/setupSteps';
import { tintForKey } from '../../constants/folderTints';

import { showAlert } from '../../utils/dialog';
// No curriculum step: the admin publishes the school's curriculum, and the
// matching one is applied for the teacher in step 1 (see CurriculumSuggestion).
// Asking a teacher to upload their own guide on their very first screen invited
// a second, divergent source of lessons for a class the school had already
// defined.
const WIZARD_STEPS = ['Class', 'Section', 'Confirm'];

/**
 * Looks up the school curriculum the admin published for this grade + subject.
 * Returns null while incomplete or when the school has nothing for that pair.
 */
function useCurriculumSuggestion(gradeLevel, subject) {
  const [suggestion, setSuggestion] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id || !gradeLevel || !subject) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drops a stale async result once its inputs go away
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    setIsChecking(true);
    apiFetch(`${API_URL}/api/teacher/${user.id}/curriculum-suggestion?gradeLevel=${encodeURIComponent(gradeLevel)}&subject=${encodeURIComponent(subject)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSuggestion(d.success ? d.curriculum : null); })
      .catch(() => { if (!cancelled) setSuggestion(null); })
      .finally(() => { if (!cancelled) setIsChecking(false); });
    return () => { cancelled = true; };
  }, [gradeLevel, subject]);

  return { suggestion, isChecking };
}

/** Shared banner shown once a matching school curriculum is found. */
function CurriculumSuggestion({ suggestion, isChecking, useIt, onToggle }) {
  if (isChecking) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking your school's curriculum...
      </div>
    );
  }
  if (!suggestion) return null;
  return (
    <label className="flex items-start gap-3 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-xl cursor-pointer">
      <input type="checkbox" checked={useIt} onChange={e => onToggle(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-brand-green shrink-0" />
      <div>
        <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Curriculum found for this class
        </p>
        <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
          Your school published <span className="font-semibold">{suggestion.title}</span> for{' '}
          {suggestion.subject} · {suggestion.gradeLevel}. Applying it copies{' '}
          <span className="font-semibold">{suggestion.lessons?.length || 0} lesson(s)</span> and their
          default rubrics into this class.
        </p>
      </div>
    </label>
  );
}

function WizardEmptyState({ onComplete, sections = [] }) {
  const [step, setStep] = useState(1);
  const [className, setClassName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [schoolYear, setSchoolYear] = useState(DEFAULT_SCHOOL_YEAR);
  const [sectionName, setSectionName] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(sections.length === 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [useCurriculum, setUseCurriculum] = useState(true);
  const { suggestion, isChecking } = useCurriculumSuggestion(gradeLevel, subject);

  // Class name is optional — fall back to "Subject — Grade Level" like the
  // Add Class modal does, rather than to a hardcoded subject.
  const resolvedName = className.trim() || [subject, gradeLevel].filter(Boolean).join(' — ');
  const canLeaveStep1 = !!resolvedName && !!subject && !!gradeLevel;

  const handleCreate = async () => {
    if (isSubmitting) return;   // guard against a double click
    setError('');
    setIsSubmitting(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      let finalSectionId = sectionId;

      if (isCreatingNew) {
        const secRes = await apiFetch(`${API_URL}/api/teacher/sections`, {
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

      // Still FormData: the endpoint parses multipart, and this is the same
      // shape the Add Class modal sends.
      const fd = new FormData();
      fd.append('name', resolvedName);
      fd.append('teacherId', user.id);
      fd.append('sectionId', finalSectionId);
      fd.append('subject', subject);
      fd.append('gradeLevel', gradeLevel);
      fd.append('schoolYear', schoolYear);
      if (suggestion && useCurriculum) fd.append('curriculumId', suggestion.id);

      const clsRes = await apiFetch(`${API_URL}/api/teacher/classes`, {
        method: 'POST',
        body: fd
      });
      const clsData = await clsRes.json();

      if (clsData.success) {
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
        <p className="text-blue-200 text-sm">Let's set up your first class in {WIZARD_STEPS.length} quick steps.</p>
        <div className="flex gap-2 mt-4">
          {WIZARD_STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all ${step >= i + 1 ? 'bg-white' : 'bg-sheen/30'}`} />
              <p className={`text-[10px] mt-1.5 font-bold uppercase tracking-wider transition-colors ${step >= i + 1 ? 'text-white' : 'text-blue-200/50'}`}>
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-6">
        {step === 1 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 1 of {WIZARD_STEPS.length}: Class details</label>
            <p className="text-xs text-slate-500 mb-3">Tell us what you teach — nothing is filled in for you.</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Subject *</label>
                <select
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-xl text-sm focus:border-brand-navy outline-none transition-all"
                >
                  <option value="">-- Select --</option>
                  {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Grade Level *</label>
                <select
                  value={gradeLevel}
                  onChange={e => setGradeLevel(e.target.value)}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-xl text-sm focus:border-brand-navy outline-none transition-all"
                >
                  <option value="">-- Select --</option>
                  {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-500 mb-1">School Year *</label>
              <select
                value={schoolYear}
                onChange={e => setSchoolYear(e.target.value)}
                className="w-full border-2 border-slate-200 p-2.5 rounded-xl text-sm focus:border-brand-navy outline-none transition-all"
              >
                {SCHOOL_YEARS.map(sy => <option key={sy} value={sy}>{sy}</option>)}
              </select>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Class Name</label>
              <input
                type="text"
                value={className}
                onChange={e => setClassName(e.target.value)}
                placeholder={resolvedName || 'e.g. Filipino — Grade 10'}
                className="w-full border-2 border-slate-200 p-3 rounded-xl text-sm focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 outline-none transition-all"
              />
              <p className="text-xs text-slate-400 mt-1">Leave blank to use "Subject — Grade Level" automatically</p>
            </div>

            <div className="mt-3">
              <CurriculumSuggestion suggestion={suggestion} isChecking={isChecking}
                useIt={useCurriculum} onToggle={setUseCurriculum} />
            </div>

            <button
              onClick={() => { if (canLeaveStep1) setStep(2); }}
              disabled={!canLeaveStep1}
              className="mt-4 w-full bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in">
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 2 of {WIZARD_STEPS.length}: Choose or name your block section</label>
            <p className="text-xs text-slate-500 mb-3">This is your homeroom group, e.g. "Grade 6 — Sampaguita"</p>

            {sections.length > 0 ? (
              <div className="space-y-3">
                <select
                  value={isCreatingNew ? 'new' : sectionId}
                  onChange={e => {
                    if (e.target.value === 'new') {
                      setIsCreatingNew(true);
                      setSectionId('');
                      // Cleared, not carried over. Picking an existing section
                      // fills sectionName with its name; switching to "create
                      // new" then offered that same name as the new section's,
                      // one Enter away from a near-duplicate roster.
                      setSectionName('');
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
            <label className="block text-sm font-bold text-brand-slate mb-1">Step 3 of {WIZARD_STEPS.length}: Confirm &amp; create</label>
            <p className="text-xs text-slate-500 mb-4">Your class will be created with these settings:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">Class Name</span>
                <span className="text-sm font-bold text-brand-slate">{resolvedName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">Block Section</span>
                <span className="text-sm font-bold text-brand-slate">{sectionName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">Subject</span>
                <span className="text-sm font-bold text-brand-slate">{subject} ({gradeLevel})</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-slate-500">School Year</span>
                <span className="text-sm font-bold text-brand-slate">{schoolYear}</span>
              </div>
              {suggestion && useCurriculum && (
                <div className="flex justify-between items-center gap-3">
                  <span className="text-xs font-medium text-slate-500 shrink-0">School Curriculum</span>
                  <span className="text-sm font-bold text-emerald-700 text-right">
                    {suggestion.title} ({suggestion.lessons?.length || 0} lessons)
                  </span>
                </div>
              )}
            </div>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Back</button>
              <button
                onClick={handleCreate}
                disabled={isSubmitting}
                className="flex-1 bg-brand-navy text-white py-3 rounded-xl font-bold hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
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


export default function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  // Set when the classes on screen came off this device rather than the server.
  const [savedClassesAt, setSavedClassesAt] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState({ name: '', gradeLevel: '', subject: '', schoolYear: DEFAULT_SCHOOL_YEAR, sectionId: '' });
  const [isCreatingClass, setIsCreatingClass] = useState(false);
  const [useModalCurriculum, setUseModalCurriculum] = useState(true);
  const [filters, setFilters] = useState({ gradeLevel: '', subject: '' });
  // Nobody signed in means there is nothing to fetch, so this must not open on
  // a spinner that only the first commit would take away again.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [setup, setSetup] = useState(null);
  const [setupHidden, setSetupHidden] = useState(() => hasSeenOnboarding(ONBOARDING.TEACHER_SETUP_HIDDEN));
  // Set when the teacher asks for the guide back, so it reappears even once
  // every step is ticked — otherwise "Setup guide" would do nothing visible.
  const [setupForced, setSetupForced] = useState(false);
  const [showExample, setShowExample] = useState(false);

  const hideSetup = () => {
    markOnboardingSeen(ONBOARDING.TEACHER_SETUP_HIDDEN);
    setSetupHidden(true);
    setSetupForced(false);
  };

  const reopenSetup = () => {
    clearOnboardingSeen(ONBOARDING.TEACHER_SETUP_HIDDEN);
    setSetupHidden(false);
    setSetupForced(true);
  };

  // Suggest the school curriculum as soon as grade level + subject are chosen.
  const { suggestion: modalSuggestion, isChecking: isCheckingModalCurriculum } =
    useCurriculumSuggestion(form.gradeLevel, form.subject);

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    Promise.all([
      apiFetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()),
      apiFetch(`${API_URL}/api/teacher/${user.id}/sections`).then(r => r.json()),
      apiFetch(`${API_URL}/api/teacher/${user.id}/setup-status`).then(r => r.json())
    ]).then(([clsData, secData, setupData]) => {
      if (clsData.success) {
        setClasses(clsData.classes);
        saveTeacherSnapshot(user.id, { classes: clsData.classes });
      }
      if (secData.success) setSections(secData.sections);
      // Whether the checklist appears is decided by these counts, not by a
      // stored step — see the note in SetupChecklist.
      if (setupData.success) setSetup(setupData.setup);
    })
      // Promise.all rejects if any of the three does, so one dropped request
      // took the whole dashboard load down as an unhandled rejection.
      .catch(() => {
        // Offline, every one of the three fails, classes stays empty, and the
        // empty state below is the first-run setup wizard — so a teacher with
        // twelve classes and no signal was told to create their first one, and
        // could not reach an activity to upload against. Showing the saved
        // list instead keeps the shell they already have.
        const snapshot = readTeacherSnapshot(user.id);
        if (!snapshot) return;
        setClasses(snapshot.classes);
        setSavedClassesAt(snapshot.savedAt);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleAddClass = async (e) => {
    e.preventDefault();
    // Without this guard a second click (or an impatient double-submit on a
    // slow connection) fires the request twice and creates two course shells.
    if (isCreatingClass) return;
    if (!form.subject || !form.gradeLevel) return showAlert('Please choose a subject and grade level.');
    if (!form.sectionId) return showAlert('Please select a block section.');
    setIsCreatingClass(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const name = form.name.trim() || `${form.subject} — ${form.gradeLevel}`;

      const fd = new FormData();
      fd.append('name', name);
      fd.append('gradeLevel', form.gradeLevel);
      fd.append('subject', form.subject);
      fd.append('schoolYear', form.schoolYear);
      fd.append('teacherId', user.id);
      fd.append('sectionId', form.sectionId);
      if (modalSuggestion && useModalCurriculum) fd.append('curriculumId', modalSuggestion.id);

      const res = await apiFetch(`${API_URL}/api/teacher/classes`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        // Awaited for the same reason as the HITL workspace's: the reload
        // below destroys the dialog, and alert() used to block until it was
        // dismissed.
        if (data.duplicate) {
          await showAlert('You already have a class for this section, subject and school year. Opening the existing one instead.');
        }
        setIsModalOpen(false);
        setForm({ name: '', gradeLevel: '', subject: '', schoolYear: DEFAULT_SCHOOL_YEAR, sectionId: '' });
        window.location.reload();
      } else {
        showAlert('Failed: ' + data.error);
        setIsCreatingClass(false);
      }
    } catch {
      showAlert('Network error');
      setIsCreatingClass(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading...</div>;

  const filteredClasses = classes.filter((cls) => {
    if (filters.gradeLevel && cls.gradeLevel !== filters.gradeLevel) return false;
    if (filters.subject && cls.subject !== filters.subject) return false;
    return true;
  });

  // Finished setup takes the checklist away on its own — there is nothing left
  // for it to ask. It stays reachable from the header either way, so a teacher
  // who hid it, or who comes back next term to set up a new section, can open
  // it again. The old walkthrough had no way back once dismissed.
  const setupSteps = setup ? buildSteps(setup) : [];
  const setupComplete = setupSteps.length > 0 && setupSteps.every((s) => s.done);
  const showSetup = !!setup && (setupForced || (!setupHidden && !setupComplete));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <SchoolBadge subtitle="Teacher Dashboard" className="mb-3" />
          <h1 className="text-2xl font-bold text-brand-slate">Assigned Classes</h1>
          <p className="text-slate-500 text-sm">Manage your subjects and block sections</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Always available, so hiding the checklist is never a one-way door
              and a teacher setting up a new section next term can get the
              guidance back. */}
          {setup && !showSetup && (
            <button
              onClick={reopenSetup}
              className="text-sm font-medium text-brand-navy bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50"
            >
              Setup guide
            </button>
          )}
          <Link to="/teacher/sections" className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 shadow-md">
            Manage Block Sections
          </Link>
        </div>
      </div>

      {/* Students at risk, surfaced before the class list rather than waiting
          to be found on the Analytics page. */}
      <EarlyWarningPanel />

      {showSetup && (
        <SetupChecklist
          setup={setup}
          onCreateClass={() => setIsModalOpen(true)}
          onSeeExample={() => setShowExample(true)}
          onDismiss={hideSetup}
        />
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

      {savedClassesAt && (
        <div className="mb-5 bg-sun-100 border-2 border-sun-200 rounded-3xl p-5 flex items-start gap-3">
          <CloudOff className="w-5 h-5 text-sun-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-extrabold text-navy-700">You're offline — showing your saved classes</p>
            <p className="text-sm text-navy-600 mt-0.5 leading-relaxed">
              Last updated {new Date(savedClassesAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
              You can open a class and queue uploads; anything new since then won't appear until you're back online.
            </p>
          </div>
        </div>
      )}

      {classes.length === 0 && !isLoading ? (
        <WizardEmptyState onComplete={() => window.location.reload()} sections={sections} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClasses.map((cls) => {
            const isDemo = cls.name.includes('[DEMO]');
            // Demo classes keep a fixed sun tint so they stay recognisable
            // wherever they land in the stack.
            const tint = isDemo ? { fill: 'bg-sun-200', chip: 'bg-sun-100/70' } : tintForKey(cls.id);
            const activityCount = cls._count?.activities || 0;

            return (
              <FolderCard
                key={cls.id}
                as={Link}
                to={`/teacher/class/${cls.id}`}
                fill={tint.fill}
                bodyClassName={`flex flex-col ${isDemo ? 'ring-2 ring-sun-500' : ''}`}
              >
                {/* Meta row — counts up top, mirroring the folder-tab reference */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <span className="text-[11px] font-extrabold text-navy-700/60">
                    {activityCount > 0 ? `${activityCount} activities` : 'No activities'}
                  </span>
                  {isDemo && (
                    <span className="bg-sun-600 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shrink-0">
                      🧪 Try Me!
                    </span>
                  )}
                </div>

                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-display text-xl font-extrabold text-navy-800 leading-tight">
                      {cls.name}
                    </h3>
                    <p className="text-xs font-semibold text-navy-700/60 mt-1 truncate">
                      {cls.schoolYear} • {cls.section?.name}
                    </p>
                  </div>

                  <div className="text-center shrink-0">
                    <p className="font-display text-2xl font-extrabold text-navy-800 leading-none">
                      {String(cls.section?._count?.students || 0).padStart(2, '0')}
                    </p>
                    <p className="text-[10px] font-extrabold text-navy-700/60 mt-1">Students</p>
                  </div>
                </div>

                {(cls.gradeLevel || cls.subject) && (
                  <div className="flex gap-1.5 mt-4 flex-wrap">
                    {cls.gradeLevel && (
                      <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full text-navy-700 ${tint.chip}`}>
                        {cls.gradeLevel}
                      </span>
                    )}
                    {cls.subject && (
                      <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full text-navy-700 ${tint.chip}`}>
                        {cls.subject}
                      </span>
                    )}
                  </div>
                )}

                <span className="flex items-center gap-1 text-xs font-extrabold text-navy-800 mt-auto pt-4 border-t-2 border-navy-700/10">
                  Open Class Hub <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </FolderCard>
            );
          })}

          {/* Matching dashed folder for the add action */}
          <FolderCard
            as="button"
            type="button"
            onClick={() => setIsModalOpen(true)}
            fill="bg-transparent"
            showTab={false}
            bodyClassName="border-2 border-dashed border-cream-400 min-h-[190px] flex flex-col items-center justify-center text-navy-500 hover:border-royal-400 hover:text-royal-600 hover:bg-royal-50/50"
            className="w-full"
          >
            <Plus className="w-8 h-8 mb-2" />
            <span className="font-bold">Add Subject Class</span>
          </FolderCard>
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
                    <option value="">-- Select --</option>
                    {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject *</label>
                  <select required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Select --</option>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* School curriculum matched to the grade + subject just chosen */}
              <CurriculumSuggestion suggestion={modalSuggestion} isChecking={isCheckingModalCurriculum}
                useIt={useModalCurriculum} onToggle={setUseModalCurriculum} />

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

              {/* No curriculum upload here. A teacher's own lesson plan was a
                  second, divergent source of lessons for a class the school had
                  already defined — the school's published curriculum is matched
                  and offered above instead, which is the same reason the
                  first-run wizard never asked for one. */}

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} disabled={isCreatingClass}
                  className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">Cancel</button>
                <button type="submit" disabled={isCreatingClass}
                  className={`flex-1 py-2 rounded-lg text-white font-medium flex items-center justify-center gap-2 ${
                    isCreatingClass ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900'}`}>
                  {isCreatingClass ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* The welcome modal that used to sit here is gone. It listed three
          things the product does, in front of a teacher who had not yet asked
          — and it was the second onboarding flow competing with the tour
          behind it. The checklist above says the same things at the point each
          one becomes the next thing to do. */}

      {showExample && <ExampleFeedback onClose={() => setShowExample(false)} />}
    </div>
  );
}
