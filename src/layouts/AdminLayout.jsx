import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, GraduationCap, Layers, BookOpen, ClipboardList, Scale, TrendingUp, ShieldCheck, Settings, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import SchoolBadge from '../components/SchoolBadge';
import Logo from '../components/Logo';
import { useSchoolTheme } from '../utils/useSchool';
import { logout } from '../config';
import { getStoredUser, USER_UPDATED_EVENT } from '../utils/session';
import ThemeToggle from '../components/ThemeToggle';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Ordered by what a school is built out of, not alphabetically: the people,
 * then the blocks they are grouped into, then the classes taught to those
 * blocks — which is also the order they have to be created in. Sections and
 * Course Shells were reachable only through a teacher's page before, so the
 * two things this console provisions had no entry in its own navigation.
 *
 * Dashboard leads because the console now opens on it. It used to open on
 * Teachers purely because that was first in this list, which made a staff
 * directory the answer to "how is my school doing".
 */
const NAV = [
  { name: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
  { name: 'Teachers', path: '/admin/teachers', icon: Users },
  { name: 'Sections', path: '/admin/sections', icon: GraduationCap },
  { name: 'Course Shells', path: '/admin/classes', icon: Layers },
  { name: 'Curriculum', path: '/admin/curriculum', icon: BookOpen },
  { name: 'Rubrics', path: '/admin/rubrics', icon: ClipboardList },
  { name: 'Grading', path: '/admin/grading', icon: Scale },
  { name: 'Analytics', path: '/admin/analytics', icon: TrendingUp },
  { name: 'Admins', path: '/admin/admins', icon: ShieldCheck },
  // Last, and separate from Admins on purpose: that page is the school's other
  // admins, this one is your own account — including the only place an admin
  // can change their own password.
  { name: 'Settings', path: '/admin/settings', icon: Settings },
];

export default function AdminLayout() {
  // Paints the school's brand colour across every page in this role.
  useSchoolTheme();
  const location = useLocation();
  const navigate = useNavigate();
  // Held in state, not read inline, because the account block below shows the
  // admin's own name and they can now change it from /admin/admins. A plain
  // read would keep showing the name they signed in with until the next full
  // page load.
  const [user, setUser] = useState(getStoredUser);
  useEffect(() => {
    const sync = () => setUser(getStoredUser());
    window.addEventListener(USER_UPDATED_EVENT, sync);
    return () => window.removeEventListener(USER_UPDATED_EVENT, sync);
  }, []);

  // Keep non-admins out of the console entirely.
  useEffect(() => {
    if (user.role !== 'ADMIN') navigate('/login', { replace: true });
  }, [user.role, navigate]);

  // The mobile dock scrolls now (see the note on it), so the cell for the page
  // you just opened can start off-screen. `nearest` keeps the dock still when
  // it is already visible, which is the usual case.
  const activeDockRef = useRef(null);
  useEffect(() => {
    activeDockRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [location.pathname]);

  if (user.role !== 'ADMIN') return null;

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col pb-24 md:pb-0 md:flex-row">
      {/* ── Desktop sidebar ──
          Admin takes gold accents on the shared navy panel, so the console is
          distinguishable at a glance from the teacher and student apps. */}
      {/* Pinned to the viewport, not stretched to the content — see the note in
          TeacherLayout for why this is sticky rather than fixed. */}
      <nav className="hidden md:flex flex-col w-64 bg-brand-chrome shrink-0 rounded-r-[2rem] overflow-hidden sticky top-0 h-screen">
        <Link to="/admin/dashboard" className="flex items-center gap-3 px-5 py-6">
          <Logo size="lg" />
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-display text-lg font-extrabold text-white truncate">TulongGuro</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-sun-300 mt-1">School Admin</span>
          </span>
        </Link>

        <div className="px-4 pb-4">
          <div className="bg-sheen/5 rounded-2xl p-3">
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
                    ? 'bg-sun-400 text-ink-900 shadow-pop'
                    : 'text-white/60 hover:bg-sheen/10 hover:text-white'
                )}>
                <span className={cn('w-8 h-8 rounded-xl grid place-items-center shrink-0',
                  isActive ? 'bg-ink-900/15' : 'bg-sheen/5')}>
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
            <span className="w-9 h-9 rounded-xl bg-sun-400 text-ink-900 grid place-items-center font-extrabold text-sm shrink-0">
              {(user.name || 'A').charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.name || 'Admin'}</p>
              <p className="text-[11px] font-semibold text-white/50 truncate">{user.email || 'Administrator'}</p>
            </div>
          </div>
          {/* A shortcut, not the only copy: the same control is on
              /admin/settings, which is where a phone reaches it — this sidebar
              is desktop-only. */}
          <div className="px-1 pb-2">
            <ThemeToggle compact />
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
        {/* gap-0.5, not gap-1: Sections and Course Shells brought the dock to
            nine cells including sign-out, and the teacher dock already runs at
            this spacing for the same reason.

            Dashboard made it ten, which is where dividing the width evenly
            stops working — ten equal cells on a 375px phone are about 32px
            each, well under the 44px a finger needs. So each cell holds a
            floor of 44px and the dock scrolls sideways instead of shrinking
            past it. The active cell is scrolled into view on arrival, so the
            page you are on is never the one off-screen. */}
        <div className="tg-dock-scroll pointer-events-auto flex items-stretch gap-0.5 bg-brand-chrome rounded-[1.5rem] p-1.5 shadow-card-lg overflow-x-auto">
          {NAV.map(item => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link key={item.name} to={item.path}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                ref={isActive ? activeDockRef : undefined}
                className={cn(
                  'flex-1 min-w-11 grid place-items-center rounded-2xl min-h-12 transition-colors',
                  isActive
                    ? 'bg-sun-400 text-ink-900 shadow-pop'
                    : 'text-white/55 active:bg-sheen/10'
                )}>
                <item.icon className="w-5 h-5 shrink-0" />
              </Link>
            );
          })}
          {/* The sidebar's account block is desktop-only, so sign-out needs its
              own place in the dock or there's no way out on a phone. The rule
              keeps it from reading as another destination. */}
          <span aria-hidden="true" className="w-px my-2.5 bg-sheen/15 shrink-0" />
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
