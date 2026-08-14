import { Link, Outlet, useLocation } from 'react-router-dom';
import { useSchoolTheme } from '../utils/useSchool';
import { Home, Users, Settings, LogOut, BarChart2, TrendingUp, AlertTriangle, ClipboardList } from 'lucide-react';
import Logo from '../components/Logo';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useState, useEffect } from 'react';
import { initOfflineQueueListener, getQueue } from '../utils/offlineQueue';
import { API_URL, apiFetch, logout } from '../config';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function TeacherLayout() {
  // Paints the school's brand colour across every page in this role.
  useSchoolTheme();
  const location = useLocation();
  const [warningCount, setWarningCount] = useState(0);
  // Seeded from the queue rather than from 0-then-corrected on mount, so the
  // badge is right on the first paint after a reload with work still queued.
  const [queueCount, setQueueCount] = useState(() => getQueue().length);
  const [onlineStatus, setOnlineStatus] = useState(navigator.onLine);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    // Fetch warning count for the Analytics badge
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    if (stored.id) {
      apiFetch(`${API_URL}/api/teacher/${stored.id}/analytics`)
        .then(r => r.json())
        .then(d => {
          if (d.success) setWarningCount(d.warningCount || 0);
        })
        .catch(() => {});
    }
    // Online/offline listeners
    const goOnline = () => { setOnlineStatus(true); setQueueCount(getQueue().length); };
    const goOffline = () => setOnlineStatus(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const unsubscribeOfflineQueue = initOfflineQueueListener(({ succeeded, dropped, droppedReasons }) => {
      if (succeeded > 0 || dropped > 0) setQueueCount(getQueue().length);
      // Dropped jobs are removed from the queue same as succeeded ones, so
      // without this a fully-dropped auto-flush (e.g. a submission released
      // elsewhere while this device was offline) vanishes silently — the
      // queue badge just goes down with no explanation of what happened.
      if (dropped > 0) {
        const reasons = [...new Set((droppedReasons || []).map(d => d.reason))];
        alert(`${dropped} queued upload${dropped > 1 ? 's' : ''} could not be saved:\n${reasons.map(r => `• ${r}`).join('\n')}`);
      }
    });
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      unsubscribeOfflineQueue();
    };
  }, []);

  const navItems = [
    { name: 'Dashboard', path: '/teacher/dashboard', icon: Home },
    { name: 'Sections', path: '/teacher/sections', icon: Users },
    { name: 'Gradebook', path: '/teacher/gradebook', icon: BarChart2 },
    { name: 'Analytics', path: '/teacher/analytics', icon: TrendingUp },
    { name: 'Rubrics', path: '/teacher/rubrics', icon: ClipboardList },
    { name: 'Settings', path: '/teacher/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col pb-24 md:pb-0 md:flex-row">
      {/* ── Desktop sidebar ── */}
      <nav className="hidden md:flex flex-col w-64 bg-royal-900 shrink-0 order-first rounded-r-[2rem] overflow-hidden">
        <Link to="/teacher/dashboard" className="flex items-center gap-3 px-5 py-6">
          <Logo size="lg" />
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-display text-lg font-extrabold text-white truncate">TulongGuro</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-royal-200 mt-1">Teacher</span>
          </span>
        </Link>

        <div className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const badge = item.name === 'Analytics' ? warningCount : 0;
            return (
              <Link key={item.name} to={item.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-bold transition-all',
                  isActive
                    ? 'bg-royal-500 tg-on-brand shadow-pop'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                )}>
                <span className={cn('w-8 h-8 rounded-xl grid place-items-center shrink-0',
                  isActive ? 'bg-white/20' : 'bg-white/5')}>
                  <item.icon className="w-4 h-4" />
                </span>
                {item.name}
                {badge > 0 && (
                  <span className={cn(
                    'ml-auto text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1',
                    isActive ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                  )}>
                    <AlertTriangle className="w-2.5 h-2.5" /> {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Account block */}
        <div className="p-3 mt-2 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2.5 mb-1">
            <span className="w-9 h-9 rounded-xl bg-royal-500 tg-on-brand grid place-items-center font-extrabold text-sm shrink-0">
              {(user.name || 'T').charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.name || 'Teacher'}</p>
              <p className="text-[11px] font-semibold text-white/50 truncate">{user.email || user.username || 'Teacher'}</p>
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
        {/* Offline / Queue Banner */}
        {(!onlineStatus || queueCount > 0) && (
          <div className={cn(
            'px-5 py-2.5 text-xs font-bold flex items-center gap-2 text-white',
            !onlineStatus ? 'bg-sun-600' : 'bg-royal-500'
          )}>
            {!onlineStatus
              ? '📵 You are offline. Uploads will be queued automatically.'
              : `☁️ Back online! ${queueCount} upload${queueCount > 1 ? 's' : ''} pending in queue...`}
          </div>
        )}
        <Outlet />
      </main>

      {/* ── Mobile floating dock ──
          Icon-only, equal-width cells. Labelling the active item used to widen
          it and squeeze the other five into the remaining space, which got
          visibly cramped once sign-out joined the row; the active cell is now
          marked by its brand fill instead, and every destination keeps the same
          tap area. */}
      <nav className="tg-bottom-nav fixed bottom-0 left-0 right-0 px-3 pt-2 md:hidden z-40 pointer-events-none">
        <div className="pointer-events-auto flex items-stretch gap-0.5 bg-royal-900 rounded-[1.5rem] p-1.5 shadow-card-lg">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const badge = item.name === 'Analytics' ? warningCount : 0;
            return (
              <Link key={item.name} to={item.path}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex-1 min-w-0 grid place-items-center rounded-2xl min-h-12 transition-colors',
                  isActive
                    ? 'bg-royal-500 tg-on-brand shadow-pop'
                    : 'text-white/55 active:bg-white/10'
                )}>
                <item.icon className="w-5 h-5 shrink-0" />
                {badge > 0 && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
          {/* The sidebar's account block is desktop-only, so sign-out needs its
              own place in the dock or there's no way out on a phone. The rule
              keeps it from reading as a seventh destination. */}
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
