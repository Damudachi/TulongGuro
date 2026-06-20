import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, Star, User, LogOut, Settings, Book, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useState, useEffect } from 'react';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StudentLayout() {
  const location = useLocation();
  const [expandedSubjects, setExpandedSubjects] = useState(location.pathname.startsWith('/student/subjects'));

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

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col pb-16 md:pb-0 md:flex-row">
      {/* Desktop Side Nav (left) */}
      <nav className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200">
        <div className="p-4 font-bold text-xl text-brand-green border-b border-slate-200">TulongGuro</div>
        <div className="flex-1 py-4">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex items-center px-4 py-3 text-sm font-medium",
                  isActive ? "bg-green-50 text-brand-green border-l-4 border-brand-green" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <item.icon className={cn("w-5 h-5 mr-3", isActive && "fill-brand-green/20")} />
                {item.name}
              </Link>
            );
          })}

          {/* Subjects with nested items */}
          <div>
            <button
              onClick={() => setExpandedSubjects(!expandedSubjects)}
              className={cn(
                "w-full flex items-center px-4 py-3 text-sm font-medium transition-colors",
                location.pathname.startsWith('/student/subjects')
                  ? "bg-green-50 text-brand-green border-l-4 border-brand-green"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <Book className={cn("w-5 h-5 mr-3")} />
              <span>Subjects</span>
              <ChevronDown className={cn("w-4 h-4 ml-auto transition-transform", expandedSubjects && "rotate-180")} />
            </button>
            {expandedSubjects && (
              <div className="bg-slate-50">
                {subjectsItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={cn(
                        "flex items-center px-8 py-2 text-sm font-medium",
                        isActive ? "text-brand-green border-l-4 border-brand-green bg-green-50" : "text-slate-600 hover:bg-white"
                      )}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="p-4 border-t border-slate-200">
          <Link to="/" className="flex items-center text-sm font-medium text-slate-600 hover:text-red-600">
            <LogOut className="w-5 h-5 mr-3" />
            Sign Out
          </Link>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 md:hidden z-50">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.name}
              to={item.path}
              className={cn(
                "flex flex-col items-center p-2 text-xs font-medium rounded-lg transition-colors",
                isActive ? "text-brand-green" : "text-slate-400 hover:text-brand-slate"
              )}
            >
              <item.icon className={cn("w-6 h-6 mb-1", isActive && "fill-brand-green/20")} />
              {item.name}
            </Link>
          );
        })}
        <Link
          to="/student/subjects"
          className={cn(
            "flex flex-col items-center p-2 text-xs font-medium rounded-lg transition-colors",
            location.pathname.startsWith('/student/subjects') ? "text-brand-green" : "text-slate-400 hover:text-brand-slate"
          )}
        >
          <Book className={cn("w-6 h-6 mb-1")} />
          Subjects
        </Link>
      </nav>

      {/* Desktop Side Nav moved above */}
    </div>
  );
}
