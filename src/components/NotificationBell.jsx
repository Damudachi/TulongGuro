import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { API_URL, apiFetch } from '../config';
import { pushSupported, permissionState, fetchPushConfig, isPushEnabled, enablePush, disablePush } from '../utils/push';

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
  /**
   * Whether the first load has come back yet — win or lose.
   *
   * "Nothing yet." is a claim about the server's answer, and before the first
   * response there is no answer to report. A teacher who opens the bell on a
   * slow connection was told they had no notifications and then watched a list
   * appear underneath the words.
   *
   * Deliberately not an `isLoading` that every poll re-raises: load() runs on a
   * 60-second timer, and a panel left open would blink back to a spinner each
   * time it fired. Only the first round trip is unknown; after that the list on
   * screen is the last thing the server actually said.
   */
  const [hasLoaded, setHasLoaded] = useState(false);
  const panelRef = useRef(null);

  // null while we do not yet know whether this deployment can push at all —
  // the row stays hidden rather than flashing a switch that then disappears.
  const [pushOffered, setPushOffered] = useState(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');

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
      .catch(() => {})
      // Set on failure too: an offline bell should show the empty state the
      // panel already handles, not spin forever.
      .finally(() => setHasLoaded(true));
  };

  useEffect(() => {
    load();
    // Polled rather than pushed — this app has no websocket/SSE channel, and
    // a released grade isn't urgent enough to justify adding one just for this.
    const timer = setInterval(load, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Whether to offer the switch at all. Three things have to be true and they
  // fail independently: the browser has the APIs, the backend has VAPID keys
  // set, and (on iOS) the app has been added to the Home Screen. Asking the
  // server is a single cheap call and it is the only one of the three this
  // code cannot answer locally.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) { if (!cancelled) setPushOffered(false); return; }
      const key = await fetchPushConfig();
      if (cancelled) return;
      if (!key) { setPushOffered(false); return; }
      setPushOffered(true);
      setPushOn(await isPushEnabled());
    })();
    return () => { cancelled = true; };
  }, []);

  // The service worker asks the page to move when a notification is opened and
  // the app is already running. Handled here rather than by the worker
  // navigating the client itself, so React Router does the move and the screen
  // the teacher was on — including anything queued for upload — survives it.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event) => {
      if (event.data?.type === 'NAVIGATE' && typeof event.data.link === 'string') {
        navigate(event.data.link);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  const togglePush = async () => {
    setPushBusy(true);
    setPushNote('');
    if (pushOn) {
      await disablePush();
      setPushOn(false);
    } else {
      const { ok, reason } = await enablePush();
      setPushOn(ok);
      if (!ok) {
        setPushNote(
          reason === 'denied'
            ? 'Blocked in your browser settings. Allow notifications for this site, then try again.'
            : reason === 'unavailable'
              ? 'Not switched on for this server yet.'
              : reason === 'dismissed'
                ? 'Permission was dismissed. Tap again to retry.'
                : 'Could not turn these on. Please try again.'
        );
      }
    }
    setPushBusy(false);
  };

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
          {!hasLoaded ? (
            <p className="px-4 py-8 flex items-center justify-center gap-2 text-sm text-navy-300">
              <Loader2 className="w-4 h-4 animate-spin" />Loading…
            </p>
          ) : notifications.length === 0 ? (
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

          {/* Sits under the list, not above it: what someone opens this panel
              for is the notifications themselves, and a settings row competing
              with them at the top would push the newest one off the first
              screenful on a phone. */}
          {pushOffered && (
            <div className="px-4 py-3 border-t border-cream-100 bg-cream-50/60">
              <button
                onClick={togglePush}
                disabled={pushBusy}
                aria-pressed={pushOn}
                className="w-full min-h-[2.75rem] flex items-center gap-3 text-left disabled:opacity-60"
              >
                {pushOn
                  ? <Bell className="w-4 h-4 text-royal-500 shrink-0" />
                  : <BellOff className="w-4 h-4 text-navy-300 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-royal-900">
                    {pushOn ? 'Phone notifications are on' : 'Get notified on this device'}
                  </span>
                  <span className="block text-[11px] text-navy-300 mt-0.5">
                    {pushBusy
                      ? 'Working…'
                      : pushOn
                        ? 'Tap to turn off for this device.'
                        : 'Know when a grade is released, even with TulongGuro closed.'}
                  </span>
                </span>
                <span
                  className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${pushOn ? 'bg-royal-500' : 'bg-cream-200'}`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-card transition-all ${pushOn ? 'left-[1.15rem]' : 'left-0.5'}`}
                  />
                </span>
              </button>
              {pushNote && <p className="text-[11px] text-red-500 mt-2 leading-snug">{pushNote}</p>}
            </div>
          )}

          {/* The permission is per-device, so this is worth saying even when the
              switch is on: a student who turned it on in the computer lab has
              not turned it on for their own phone. */}
          {pushOffered && pushOn && permissionState() === 'granted' && (
            <p className="px-4 pb-3 text-[11px] text-navy-300 leading-snug">
              This covers this device only. Turn it on again on your phone to get them there.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
