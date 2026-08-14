import { Link, Outlet, useLocation } from 'react-router-dom';
import { useSchoolTheme } from '../utils/useSchool';
import { Home, Star, User, LogOut, Settings, Book, ChevronDown } from 'lucide-react';
import Logo from '../components/Logo';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useState, useEffect } from 'react';
import { logout } from '../config';
import NotificationBell from '../components/NotificationBell';
import { initOfflineQueueListener, getQueue, QUEUE_CHANGED } from '../utils/offlineQueue';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StudentLayout() {
  // Paints the school's brand colour across every page in this role.
  useSchoolTheme();
  const location = useLocation();
  const [expandedSubjects, setExpandedSubjects] = useState(location.pathname.startsWith('/student/subjects'));
  // Navigating into a subject re-opens the group, but only on the navigation
  // itself — a learner who collapses it while already inside stays collapsed.
  // Done here rather than in an effect so the sidebar is never painted closed
  // and then immediately re-rendered open.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    if (location.pathname.startsWith('/student/subjects')) setExpandedSubjects(true);
  }
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [online, setOnline] = useState(navigator.onLine);
  // Seeded from the queue rather than 0-then-corrected, so a student who
  // reopens the app with work still waiting sees it on the first paint.
  const [pendingCount, setPendingCount] = useState(() => getQueue().length);

  // OQ-4: a submission queued offline (SubmitWork.jsx) only ever drains if
  // something calls flushQueue() on reconnect — this is that something, the
  // student-side counterpart to TeacherLayout's listener.
  useEffect(() => {
    const goOnline = () => { setOnline(true); setPendingCount(getQueue().length); };
    const goOffline = () => { setOnline(false); setPendingCount(getQueue().length); };
    const onQueued = () => setPendingCount(getQueue().length);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener(QUEUE_CHANGED, onQueued);

    const unsubscribe = initOfflineQueueListener(({ succeeded, dropped, droppedReasons }) => {
      if (succeeded > 0 || dropped > 0) setPendingCount(getQueue().length);
      // Dropped (not just failed) means the server permanently rejected it —
      // e.g. the deadline passed while offline. Silence here would mean the
      // work is simply gone with no explanation, the exact failure OQ-2 fixed
      // for teachers.
      if (dropped > 0) {
        const reasons = [...new Set((droppedReasons || []).map(d => d.reason))];
        alert(`${dropped} saved submission${dropped > 1 ? 's' : ''} could not be uploaded:\n${reasons.map(r => `• ${r}`).join('\n')}`);
      }
    });
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(QUEUE_CHANGED, onQueued);
      unsubscribe();
    };
  }, []);

  const navItems = [
    { name: 'Home', path: '/student/dashboard', icon: Home },
    { name: 'Awards', path: '/student/awards', icon: Star },
    { name: 'Profile', path: '/student/profile', icon: User },
    { name: 'Settings', path: '/student/settings', icon: Settings },
  ];

  const subjectsItems = [
    { name: 'Activities', path: '/student/subjects/activities' },
    { name: 'Gradebook', path: '/student/subjects/gradebook' },
  ];

  const subjectsActive = location.pathname.startsWith('/student/subjects');

  const renderNavLink = (item) => {
    const isActive = location.pathname.startsWith(item.path);
    return (
      <Link
        key={item.name}
        to={item.path}
        className={cn(
          'flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-bold transition-all',
          isActive
            ? 'bg-royal-500 tg-on-brand shadow-pop'
            : 'text-white/60 hover:bg-white/10 hover:text-white'
        )}
      >
        <span className={cn('w-8 h-8 rounded-xl grid place-items-center shrink-0',
          isActive ? 'bg-white/20' : 'bg-white/5')}>
          <item.icon className="w-4 h-4" />
        </span>
        {item.name}
      </Link>
    );
  };

  // Subjects sits second in the dock — it's the day-to-day destination after Home.
  const dockItems = [
    navItems[0],
    { name: 'Subjects', path: '/student/subjects', icon: Book },
    ...navItems.slice(1),
  ];

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col pb-24 md:pb-0 md:flex-row">
      <NotificationBell />
      {/* ── Desktop sidebar ── */}
      {/* Pinned to the viewport, not stretched to the content — see the note in
          TeacherLayout for why this is sticky rather than fixed. */}
      <nav className="hidden md:flex flex-col w-64 bg-royal-900 shrink-0 rounded-r-[2rem] overflow-hidden sticky top-0 h-screen">
        <Link to="/student/dashboard" className="flex items-center gap-3 px-5 py-6">
          <Logo size="lg" />
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-display text-lg font-extrabold text-white truncate">TulongGuro</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-royal-200 mt-1">Student</span>
          </span>
        </Link>

        <div className="flex-1 px-3 space-y-1 overflow-y-auto">
          {renderNavLink(navItems[0])}

          {/* Subjects sits second — it's where students spend most of their time */}
          <div>
            <button
              onClick={() => setExpandedSubjects(!expandedSubjects)}
              aria-expanded={expandedSubjects}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-bold transition-all',
                subjectsActive
                  ? 'bg-royal-500 tg-on-brand shadow-pop'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              )}
            >
              <span className={cn('w-8 h-8 rounded-xl grid place-items-center shrink-0',
                subjectsActive ? 'bg-white/20' : 'bg-white/5')}>
                <Book className="w-4 h-4" />
              </span>
              <span>Subjects</span>
              <ChevronDown className={cn('w-4 h-4 ml-auto transition-transform', expandedSubjects && 'rotate-180')} />
            </button>

            {expandedSubjects && (
              <div className="mt-1 ml-7 pl-4 border-l-2 border-white/10 space-y-0.5">
                {subjectsItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={cn(
                        'block px-3 py-2 rounded-xl text-sm font-bold transition-colors',
                        isActive ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/5'
                      )}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {navItems.slice(1).map(renderNavLink)}
        </div>

        {/* Account block */}
        <div className="p-3 mt-2 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2.5 mb-1">
            <span className="w-9 h-9 rounded-xl bg-royal-500 tg-on-brand grid place-items-center font-extrabold text-sm shrink-0">
              {(user.name || 'S').charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.name || 'Student'}</p>
              <p className="text-[11px] font-semibold text-white/50 truncate">{user.username || 'Student'}</p>
            </div>
          </div>
          <Link
            to="/login"
            onClick={() => logout()}
            className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-bold text-white/60 hover:bg-red-500 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </Link>
        </div>
      </nav>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* The teacher has had this since the queue shipped; the student had
            nothing, so losing signal looked exactly like the app breaking.
            Worded for a learner holding a photo of their essay: say what will
            happen to it, and never call it submitted before the server has it. */}
        {(!online || pendingCount > 0) && (
          <div className={cn(
            'px-5 py-2.5 text-xs font-bold flex items-center gap-2 text-white',
            !online ? 'bg-sun-600' : 'bg-royal-500'
          )}>
            {!online
              ? (pendingCount > 0
                ? `📵 You're offline. ${pendingCount} piece${pendingCount > 1 ? 's' : ''} of work saved here — we'll send ${pendingCount > 1 ? 'them' : 'it'} when you're back.`
                : "📵 You're offline. Your work will be saved and sent when you're back.")
              : `☁️ Back online — sending ${pendingCount} saved piece${pendingCount > 1 ? 's' : ''} of work...`}
          </div>
        )}
        <Outlet />
      </main>

      {/* ── Mobile floating dock ──
          Icon-only, equal-width cells. Labelling the active item used to widen
          it and squeeze the rest into the remaining space, which got visibly
          cramped once sign-out joined the row; the active cell is now marked by
          its brand fill instead, and every destination keeps the same tap area. */}
      <nav className="tg-bottom-nav fixed bottom-0 left-0 right-0 px-3 pt-2 md:hidden z-50 pointer-events-none">
        <div className="pointer-events-auto flex items-stretch gap-1 bg-royal-900 rounded-[1.5rem] p-1.5 shadow-card-lg">
          {dockItems.map((item) => {
            const isActive = item.path === '/student/subjects'
              ? subjectsActive
              : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex-1 min-w-0 grid place-items-center rounded-2xl min-h-12 transition-colors',
                  isActive
                    ? 'bg-royal-500 tg-on-brand shadow-pop'
                    : 'text-white/55 active:bg-white/10'
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
              </Link>
            );
          })}
          {/* The sidebar's account block is desktop-only, so sign-out needs its
              own place in the dock or there's no way out on a phone. The rule
              keeps it from reading as a sixth destination. */}
          <span aria-hidden="true" className="w-px my-2.5 bg-white/15 shrink-0" />
          <Link to="/login" onClick={() => logout()}
            aria-label="Sign out"
            className="flex-1 min-w-0 grid place-items-center rounded-2xl min-h-12 text-white/55 active:bg-red-500 active:text-white transition-colors">
            <LogOut className="w-5 h-5 shrink-0" />
          </Link>
        </div>
      </nav>
    </div>
  );
}
