import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ChevronRight, CloudOff, BookOpen } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import { saveTeacherSnapshot, readTeacherSnapshot } from '../../utils/offlineSnapshot';
import { ONBOARDING, hasSeenOnboarding, markOnboardingSeen, clearOnboardingSeen } from '../../utils/onboarding';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';
import SchoolBadge from '../../components/SchoolBadge';
import FolderCard from '../../components/FolderCard';
import EarlyWarningPanel from '../../components/EarlyWarningPanel';
import SetupChecklist from '../../components/SetupChecklist';
import ExampleFeedback from '../../components/ExampleFeedback';
import { buildSteps } from '../../utils/setupSteps';
import { tintForKey } from '../../constants/folderTints';


export default function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  // Set when the classes on screen came off this device rather than the server.
  const [savedClassesAt, setSavedClassesAt] = useState(null);
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

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    // The sections request that used to sit here went with the class form: it
    // only ever filled that form's block-section picker, and the section list
    // proper has its own screen.
    Promise.all([
      apiFetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()),
      apiFetch(`${API_URL}/api/teacher/${user.id}/setup-status`).then(r => r.json())
    ]).then(([clsData, setupData]) => {
      if (clsData.success) {
        setClasses(clsData.classes);
        saveTeacherSnapshot(user.id, { classes: clsData.classes });
      }
      // Whether the checklist appears is decided by these counts, not by a
      // stored step — see the note in SetupChecklist.
      if (setupData.success) setSetup(setupData.setup);
    })
      // Promise.all rejects if either does, so one dropped request took the
      // whole dashboard load down as an unhandled rejection.
      .catch(() => {
        // Offline, both fail and classes stays empty — so a teacher with twelve
        // classes and no signal saw the "nothing assigned yet" card and could
        // not reach an activity to upload against. Showing the saved list
        // instead keeps the shells they already have.
        const snapshot = readTeacherSnapshot(user.id);
        if (!snapshot) return;
        setClasses(snapshot.classes);
        setSavedClassesAt(snapshot.savedAt);
      })
      .finally(() => setIsLoading(false));
  }, []);

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
          <p className="text-slate-500 text-sm">The subjects and block sections your school has assigned you</p>
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
            View Block Sections
          </Link>
        </div>
      </div>

      {/* Students at risk, surfaced before the class list rather than waiting
          to be found on the Analytics page. */}
      <EarlyWarningPanel />

      {showSetup && (
        <SetupChecklist
          setup={setup}
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
        /* This was a three-step wizard that created a block section and a
           course shell. Both are the admin's now, so the honest empty state is
           not a form — it says what is being waited on and who to ask, rather
           than offering a button that cannot work. "See an example" stays
           reachable through the setup guide above: seeing what checked work
           looks like is the one useful thing to do while waiting. */
        <div className="bg-white border-2 border-dashed border-cream-400 rounded-2xl p-10 text-center max-w-xl mx-auto">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <h2 className="font-bold text-brand-slate">No classes assigned to you yet</h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            Your school admin sets up the block sections and creates the subject classes
            taught in them. Anything assigned to you appears here straight away — you can
            then build activities, upload work and release marks.
          </p>
          <p className="text-sm text-slate-500 mt-3">
            Ask your school admin to assign you a class, or{' '}
            <Link to="/teacher/sections" className="text-brand-navy font-semibold hover:underline">
              look at the block sections
            </Link>{' '}
            your school has already set up.
          </p>
        </div>
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
