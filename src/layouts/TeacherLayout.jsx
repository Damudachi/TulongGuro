import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, Users, Settings, LogOut, BarChart2, TrendingUp, AlertTriangle, ClipboardList, BookOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useState, useEffect } from 'react';
import { initOfflineQueueListener, getQueue } from '../utils/offlineQueue';
import { API_URL } from '../config';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function TeacherLayout() {
  const location = useLocation();
  const [warningCount, setWarningCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [onlineStatus, setOnlineStatus] = useState(navigator.onLine);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    // Fetch warning count for the Analytics badge
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    if (stored.id) {
      fetch(`${API_URL}/api/teacher/${stored.id}/analytics`)
        .then(r => r.json())
        .then(d => {
          if (d.success) setWarningCount(d.warningCount || 0);
        })
        .catch(() => {});
    }
    // Offline queue badge
    setQueueCount(getQueue().length);
    // Online/offline listeners
    const goOnline = () => { setOnlineStatus(true); setQueueCount(getQueue().length); };
    const goOffline = () => setOnlineStatus(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    initOfflineQueueListener(({ succeeded }) => {
      if (succeeded > 0) setQueueCount(getQueue().length);
    });
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
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
      <nav className="hidden md:flex flex-col w-64 bg-navy-700 shrink-0 order-first rounded-r-[2rem] overflow-hidden">
        <Link to="/teacher/dashboard" className="flex items-center gap-3 px-5 py-6">
          <span className="w-11 h-11 rounded-2xl bg-royal-500 text-white grid place-items-center shadow-pop shrink-0">
            <BookOpen className="w-5 h-5" />
          </span>
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-display text-lg font-extrabold text-white truncate">TulongGuro</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-royal-300 mt-1">Teacher</span>
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
                    ? 'bg-royal-500 text-white shadow-pop'
                    : 'text-sky-200/70 hover:bg-white/10 hover:text-white'
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
            <span className="w-9 h-9 rounded-xl bg-royal-500 text-white grid place-items-center font-extrabold text-sm shrink-0">
              {(user.name || 'T').charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.name || 'Teacher'}</p>
              <p className="text-[11px] font-semibold text-sky-200/60 truncate">{user.email || user.username || 'Teacher'}</p>
            </div>
          </div>
          <Link
            to="/login"
            onClick={() => localStorage.removeItem('user')}
            className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-bold text-sky-200/70 hover:bg-red-500 hover:text-white transition-colors"
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
          Six destinations is too many for icon+label on a phone, so only the
          active item shows its label. */}
      <nav className="tg-bottom-nav fixed bottom-0 left-0 right-0 px-3 pt-2 md:hidden z-40 pointer-events-none">
        <div className="pointer-events-auto flex items-center justify-between gap-0.5 bg-navy-700 rounded-[1.5rem] p-2 shadow-card-lg">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const badge = item.name === 'Analytics' ? warningCount : 0;
            return (
              <Link key={item.name} to={item.path}
                aria-label={item.name}
                className={cn(
                  'relative flex items-center justify-center gap-1.5 rounded-2xl transition-all min-h-11',
                  isActive
                    ? 'bg-royal-500 text-white px-3 py-2.5 font-extrabold text-xs'
                    : 'text-sky-200/60 px-2.5 py-2.5 active:bg-white/10'
                )}>
                <item.icon className="w-5 h-5 shrink-0" />
                {isActive && <span className="whitespace-nowrap">{item.name}</span>}
                {badge > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
