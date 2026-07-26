import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Users, BookOpen, ClipboardList, LogOut } from 'lucide-react';
import { useEffect } from 'react';
import SchoolBadge from '../components/SchoolBadge';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const NAV = [
  { name: 'Teachers', path: '/admin/teachers', icon: Users },
  { name: 'Curriculum', path: '/admin/curriculum', icon: BookOpen },
  { name: 'Rubrics', path: '/admin/rubrics', icon: ClipboardList },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // Keep non-admins out of the console entirely.
  useEffect(() => {
    if (user.role !== 'ADMIN') navigate('/', { replace: true });
  }, [user.role, navigate]);

  if (user.role !== 'ADMIN') return null;

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col pb-16 md:pb-0 md:flex-row">
      <nav className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <p className="font-bold text-xl text-brand-navy">TulongGuro</p>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">School Admin</p>
        </div>
        <div className="px-4 py-3 border-b border-slate-100">
          <SchoolBadge size="sm" />
        </div>
        <div className="flex-1 py-4">
          {NAV.map(item => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link key={item.name} to={item.path}
                className={cn('flex items-center px-4 py-3 text-sm font-medium',
                  isActive ? 'bg-blue-50 text-brand-navy border-l-4 border-brand-navy' : 'text-slate-600 hover:bg-slate-50')}>
                <item.icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </div>
        <div className="p-4 border-t border-slate-200">
          <p className="text-xs text-slate-400 mb-2 truncate">{user.name}</p>
          <Link to="/" onClick={() => localStorage.removeItem('user')}
            className="flex items-center text-sm font-medium text-slate-600 hover:text-red-600">
            <LogOut className="w-5 h-5 mr-3" /> Sign Out
          </Link>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto"><Outlet /></main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 md:hidden z-50">
        {NAV.map(item => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <Link key={item.name} to={item.path}
              className={cn('flex flex-col items-center p-2 text-xs font-medium rounded-lg transition-colors',
                isActive ? 'text-brand-navy' : 'text-slate-400 hover:text-brand-slate')}>
              <item.icon className="w-6 h-6 mb-1" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
