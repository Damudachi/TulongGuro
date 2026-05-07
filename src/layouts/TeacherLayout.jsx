import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, Users, Settings, LogOut, BarChart2, TrendingUp, AlertTriangle } from 'lucide-react';
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

  useEffect(() => {
    // Fetch warning count for badge
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) {
      fetch(`${API_URL}/api/teacher/${user.id}/analytics`)
        .then(r => r.json())
        .then(d => { if (d.success) setWarningCount(d.warningCount || 0); })
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
    { name: 'Analytics', path: '/teacher/analytics', icon: TrendingUp, badge: warningCount },
    { name: 'Settings', path: '/teacher/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col pb-16 md:pb-0 md:flex-row">
      <main className="flex-1 overflow-y-auto">
        {/* Offline / Queue Banner */}
        {(!onlineStatus || queueCount > 0) && (
          <div className={`px-4 py-2 text-xs font-bold flex items-center gap-2 ${!onlineStatus ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'}`}>
            {!onlineStatus
              ? '📵 You are offline. Uploads will be queued automatically.'
              : `☁️ Back online! ${queueCount} upload${queueCount > 1 ? 's' : ''} pending in queue...`}
          </div>
        )}
        <Outlet />
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 md:hidden z-40">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <Link key={item.name} to={item.path}
              className={cn("flex flex-col items-center p-2 text-xs font-medium rounded-lg relative",
                isActive ? "text-brand-navy" : "text-slate-400 hover:text-brand-slate")}>
              <item.icon className="w-6 h-6 mb-1" />
              {item.name}
              {item.badge > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Desktop Side Nav */}
      <nav className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 order-first">
        <div className="p-4 font-bold text-xl text-brand-navy border-b border-slate-200 flex items-center gap-2">
          TulongGuro
          <span className="text-xs font-medium bg-blue-100 text-brand-navy px-2 py-0.5 rounded-full">Teacher</span>
        </div>
        <div className="flex-1 py-4">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link key={item.name} to={item.path}
                className={cn("flex items-center px-4 py-3 text-sm font-medium relative",
                  isActive ? "bg-blue-50 text-brand-navy border-r-4 border-brand-navy" : "text-slate-600 hover:bg-slate-50")}>
                <item.icon className="w-5 h-5 mr-3" />
                {item.name}
                {item.badge > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <AlertTriangle className="w-2.5 h-2.5" /> {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="p-4 border-t border-slate-200">
          <Link to="/" className="flex items-center text-sm font-medium text-slate-600 hover:text-red-600">
            <LogOut className="w-5 h-5 mr-3" /> Sign Out
          </Link>
        </div>
      </nav>
    </div>
  );
}
