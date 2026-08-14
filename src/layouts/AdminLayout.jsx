import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Users, BookOpen, ClipboardList, Scale, TrendingUp, LogOut } from 'lucide-react';
import { useEffect } from 'react';
import SchoolBadge from '../components/SchoolBadge';
import Logo from '../components/Logo';
import { useSchoolTheme } from '../utils/useSchool';
import { logout } from '../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const NAV = [
  { name: 'Teachers', path: '/admin/teachers', icon: Users },
  { name: 'Curriculum', path: '/admin/curriculum', icon: BookOpen },
  { name: 'Rubrics', path: '/admin/rubrics', icon: ClipboardList },
  { name: 'Grading', path: '/admin/grading', icon: Scale },
  { name: 'Analytics', path: '/admin/analytics', icon: TrendingUp },
];

export default function AdminLayout() {
  // Paints the school's brand colour across every page in this role.
  useSchoolTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // Keep non-admins out of the console entirely.
  useEffect(() => {
    if (user.role !== 'ADMIN') navigate('/login', { replace: true });
  }, [user.role, navigate]);

  if (user.role !== 'ADMIN') return null;

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col pb-24 md:pb-0 md:flex-row">
      {/* ── Desktop sidebar ──
          Admin takes gold accents on the shared navy panel, so the console is
          distinguishable at a glance from the teacher and student apps. */}
      {/* Pinned to the viewport, not stretched to the content — see the note in
          TeacherLayout for why this is sticky rather than fixed. */}
      <nav className="hidden md:flex flex-col w-64 bg-royal-900 shrink-0 rounded-r-[2rem] overflow-hidden sticky top-0 h-screen">
        <Link to="/admin/teachers" className="flex items-center gap-3 px-5 py-6">
          <Logo size="lg" />
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-display text-lg font-extrabold text-white truncate">TulongGuro</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-sun-300 mt-1">School Admin</span>
          </span>
        </Link>

        <div className="px-4 pb-4">
          <div className="bg-white/5 rounded-2xl p-3">
            <SchoolBadge size="sm" tone="onColor" />
          </div>
        </div>

        <div className="flex-1 px-3 space-y-1 overflow-y-auto">
          {NAV.map(item => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link key={item.name} to={item.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-bold transition-all',
                  isActive
                    ? 'bg-sun-400 text-navy-800 shadow-pop'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                )}>
                <span className={cn('w-8 h-8 rounded-xl grid place-items-center shrink-0',
                  isActive ? 'bg-navy-800/15' : 'bg-white/5')}>
                  <item.icon className="w-4 h-4" />
                </span>
                {item.name}
              </Link>
            );
          })}
        </div>

        {/* Account block */}
        <div className="p-3 mt-2 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2.5 mb-1">
            <span className="w-9 h-9 rounded-xl bg-sun-400 text-navy-800 grid place-items-center font-extrabold text-sm shrink-0">
              {(user.name || 'A').charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.name || 'Admin'}</p>
              <p className="text-[11px] font-semibold text-white/50 truncate">{user.email || 'Administrator'}</p>
            </div>
          </div>
          <Link to="/login" onClick={() => logout()}
            className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-bold text-white/60 hover:bg-red-500 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" /> Sign Out
          </Link>
        </div>
      </nav>

      <main className="flex-1 min-w-0 overflow-y-auto"><Outlet /></main>

      {/* ── Mobile floating dock ──
          Icon-only, equal-width cells — see the note in TeacherLayout. */}
      <nav className="tg-bottom-nav fixed bottom-0 left-0 right-0 px-3 pt-2 md:hidden z-50 pointer-events-none">
        <div className="pointer-events-auto flex items-stretch gap-1 bg-royal-900 rounded-[1.5rem] p-1.5 shadow-card-lg">
          {NAV.map(item => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link key={item.name} to={item.path}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex-1 min-w-0 grid place-items-center rounded-2xl min-h-12 transition-colors',
                  isActive
                    ? 'bg-sun-400 text-navy-800 shadow-pop'
                    : 'text-white/55 active:bg-white/10'
                )}>
                <item.icon className="w-5 h-5 shrink-0" />
              </Link>
            );
          })}
          {/* The sidebar's account block is desktop-only, so sign-out needs its
              own place in the dock or there's no way out on a phone. The rule
              keeps it from reading as another destination. */}
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
