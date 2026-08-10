import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { API_URL, apiFetch } from '../config';

/**
 * BP-1: grades, deadlines, and releases were entirely silent outside the app
 * before this — a student had no way to know a grade was released except by
 * happening to open the activity. This is the minimal starting surface: a
 * bell with an unread count, backed by the Notification table.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // "now" for the relative timestamps, pinned to the last poll rather than read
  // off the clock while rendering. The poll below runs every minute, which is
  // exactly the resolution these labels are shown in, so nothing goes stale.
  const [polledAt, setPolledAt] = useState(0);
  const panelRef = useRef(null);

  const load = () => {
    apiFetch(`${API_URL}/api/notifications`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setNotifications(d.notifications || []);
          setUnreadCount(d.unreadCount || 0);
          setPolledAt(Date.now());
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    // Polled rather than pushed — this app has no websocket/SSE channel, and
    // a released grade isn't urgent enough to justify adding one just for this.
    const timer = setInterval(load, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  const openNotification = (n) => {
    setIsOpen(false);
    if (!n.readAt) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x));
      setUnreadCount(prev => Math.max(0, prev - 1));
      apiFetch(`${API_URL}/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
    apiFetch(`${API_URL}/api/notifications/read-all`, { method: 'POST' }).catch(() => {});
  };

  const formatWhen = (iso) => {
    const diffMs = polledAt - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="fixed top-4 right-4 z-40" ref={panelRef}>
      <button
        onClick={() => setIsOpen(v => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        className="relative w-11 h-11 rounded-2xl bg-white shadow-card grid place-items-center text-royal-900 hover:bg-cream-50 transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold grid place-items-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-card-lg border border-cream-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-cream-100">
            <p className="font-display font-extrabold text-royal-900 text-sm">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-bold text-royal-500 hover:text-royal-700">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-navy-300">Nothing yet.</p>
          ) : (
            <ul>
              {notifications.map(n => (
                <li key={n.id}>
                  <button
                    onClick={() => openNotification(n)}
                    className={`w-full text-left px-4 py-3 border-b border-cream-100 last:border-0 hover:bg-cream-50 transition-colors ${!n.readAt ? 'bg-royal-50/60' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="w-2 h-2 mt-1.5 rounded-full bg-royal-500 shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-royal-900 truncate">{n.title}</p>
                        {n.body && <p className="text-xs text-navy-400 mt-0.5 line-clamp-2">{n.body}</p>}
                        <p className="text-[11px] text-navy-300 mt-1">{formatWhen(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
