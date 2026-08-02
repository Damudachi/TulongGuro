import { Link, Outlet, useLocation } from 'react-router-dom';
import useSchool from '../utils/useSchool';
import { Home, Star, User, LogOut, Settings, Book, ChevronDown, BookOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useState, useEffect } from 'react';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StudentLayout() {
  // Paints the school's brand colour across every page in this role.
  useSchool();
  const location = useLocation();
  const [expandedSubjects, setExpandedSubjects] = useState(location.pathname.startsWith('/student/subjects'));
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    if (location.pathname.startsWith('/student/subjects')) {
      setExpandedSubjects(true);
    }
  }, [location.pathname]);

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
            ? 'bg-aqua-500 text-white shadow-pop'
            : 'text-sky-200/70 hover:bg-white/10 hover:text-white'
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

  // Mobile dock: the active item expands to show its label, the rest stay as
  // icons. Keeps five destinations on a narrow phone without crowding.
  // Subjects sits second — it's the day-to-day destination after Home.
  const dockItems = [
    navItems[0],
    { name: 'Subjects', path: '/student/subjects', icon: Book },
    ...navItems.slice(1),
  ];

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col pb-24 md:pb-0 md:flex-row">
      {/* ── Desktop sidebar ── */}
      <nav className="hidden md:flex flex-col w-64 bg-navy-700 shrink-0 rounded-r-[2rem] overflow-hidden">
        <Link to="/student/dashboard" className="flex items-center gap-3 px-5 py-6">
          <span className="w-11 h-11 rounded-2xl bg-aqua-500 text-white grid place-items-center shadow-pop shrink-0">
            <BookOpen className="w-5 h-5" />
          </span>
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-display text-lg font-extrabold text-white truncate">TulongGuro</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-aqua-300 mt-1">Student</span>
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
                  ? 'bg-aqua-500 text-white shadow-pop'
                  : 'text-sky-200/70 hover:bg-white/10 hover:text-white'
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
                        isActive ? 'text-white bg-white/10' : 'text-sky-200/60 hover:text-white hover:bg-white/5'
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
            <span className="w-9 h-9 rounded-xl bg-aqua-500 text-white grid place-items-center font-extrabold text-sm shrink-0">
              {(user.name || 'S').charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.name || 'Student'}</p>
              <p className="text-[11px] font-semibold text-sky-200/60 truncate">{user.username || 'Student'}</p>
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
        <Outlet />
      </main>

      {/* ── Mobile floating dock ── */}
      <nav className="tg-bottom-nav fixed bottom-0 left-0 right-0 px-3 pt-2 md:hidden z-50 pointer-events-none">
        <div className="pointer-events-auto flex items-center justify-between gap-1 bg-navy-700 rounded-[1.5rem] p-2 shadow-card-lg">
          {dockItems.map((item) => {
            const isActive = item.path === '/student/subjects'
              ? subjectsActive
              : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                aria-label={item.name}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-2xl transition-all min-h-11',
                  isActive
                    ? 'bg-aqua-500 text-white px-3.5 py-2.5 font-extrabold text-xs'
                    : 'text-sky-200/60 px-3 py-2.5 active:bg-white/10'
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {isActive && <span className="whitespace-nowrap">{item.name}</span>}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
