import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Loader2, Check, X, Building2, Mail, RefreshCw, AlertTriangle } from 'lucide-react';
import { API_URL, apiFetch } from '../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Platform-operator screen for approving new school registrations.
 *
 * Not part of the school-facing app: it has no layout, no nav and no user
 * account behind it. The only credential is the PLATFORM_ADMIN_KEY set on the
 * server, typed in here and held in sessionStorage so it dies with the tab
 * rather than sitting in localStorage on a shared machine.
 *
 * The key is bearer authority — anyone holding it can approve any school — so
 * treat it like a password, not like a URL.
 */
const KEY_STORAGE = 'tg_platform_key';

const STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function PlatformApprovals() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) || '');
  const [keyInput, setKeyInput] = useState('');
  const [schools, setSchools] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!key) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/platform/schools?status=${status}`, {
        headers: { 'x-platform-key': key },
      });
      const data = await res.json();
      if (data.success) {
        setSchools(data.schools || []);
      } else {
        setError(data.error || 'Could not load schools.');
        // A bad key is worth forgetting immediately, so the form comes back
        // instead of leaving a dead screen that fails on every refresh.
        if (res.status === 401) {
          sessionStorage.removeItem(KEY_STORAGE);
          setKey('');
        }
      }
    } catch {
      setError('Network error. Is the API reachable?');
    } finally {
      setIsLoading(false);
    }
  }, [key, status]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
  useEffect(() => { load(); }, [load]);

  const act = async (school, action, body) => {
    setBusyId(school.id);
    try {
      const res = await apiFetch(`${API_URL}/api/platform/schools/${school.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-platform-key': key },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (data.success) {
        setRejectingId(null);
        setRejectReason('');
        load();
      } else {
        alert(data.error || 'That did not work.');
      }
    } catch {
      alert('Network error.');
    } finally {
      setBusyId(null);
    }
  };

  // ── Key gate ──
  if (!key) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <form
          onSubmit={e => {
            e.preventDefault();
            const trimmed = keyInput.trim();
            if (!trimmed) return;
            sessionStorage.setItem(KEY_STORAGE, trimmed);
            setKey(trimmed);
          }}
          className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
        >
          <div className="w-11 h-11 rounded-xl bg-ink-900 text-white grid place-items-center mb-4">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">School approvals</h1>
          <p className="text-sm text-slate-500 mb-5">
            TulongGuro operators only. Enter the platform key from the server environment.
          </p>
          <input
            type="password"
            autoFocus
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="PLATFORM_ADMIN_KEY"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3"
          />
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <button type="submit" disabled={!keyInput.trim()}
            className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800 disabled:opacity-40">
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6" /> School approvals
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Nobody at a school can sign in until it is approved.
            </p>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem(KEY_STORAGE); setKey(''); setKeyInput(''); }}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 underline shrink-0 mt-1">
            Lock
          </button>
        </div>

        <div className="flex items-center gap-2 mb-5">
          {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                status === s ? 'bg-ink-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')}>
              {s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
          <button onClick={load} title="Refresh"
            className="ml-auto p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {isLoading && schools.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
          </div>
        ) : schools.length === 0 ? (
          <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nothing {status === 'ALL' ? 'registered' : status.toLowerCase()}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {schools.map(s => {
              const admin = s.users?.[0];
              return (
                <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-900">{s.name}</p>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_STYLES[s.status])}>
                          {s.status}
                        </span>
                      </div>
                      {/* The contact to verify the school against before approving. */}
                      {admin && (
                        <p className="text-sm text-slate-600 mt-1">
                          {admin.name}
                          {admin.email && (
                            <a href={`mailto:${admin.email}`} className="inline-flex items-center gap-1 ml-2 text-slate-500 hover:text-slate-900 underline">
                              <Mail className="w-3 h-3" /> {admin.email}
                            </a>
                          )}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        Registered {new Date(s.createdAt).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}{s._count?.users ?? 0} account(s)
                        {' · '}{s._count?.sections ?? 0} section(s)
                        {' · '}{s._count?.curriculums ?? 0} curriculum(s)
                      </p>
                      {s.status === 'REJECTED' && s.rejectedReason && (
                        <p className="text-xs text-red-600 mt-1.5">Reason: {s.rejectedReason}</p>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {s.status !== 'APPROVED' && (
                        <button onClick={() => act(s, 'approve')} disabled={busyId === s.id}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
                          {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Approve
                        </button>
                      )}
                      {s.status !== 'REJECTED' && (
                        <button onClick={() => { setRejectingId(s.id); setRejectReason(''); }} disabled={busyId === s.id}
                          className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 disabled:opacity-40 flex items-center gap-1">
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      )}
                    </div>
                  </div>

                  {rejectingId === s.id && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      {/* Shown to the school at login, so it has to say something
                          they can act on rather than just "denied". */}
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        Reason — the school sees this when they try to sign in
                      </label>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="e.g. We could not verify this school with DepEd records."
                          className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400"
                        />
                        <button onClick={() => act(s, 'reject', { reason: rejectReason })}
                          disabled={!rejectReason.trim() || busyId === s.id}
                          className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40">
                          Confirm
                        </button>
                        <button onClick={() => setRejectingId(null)}
                          className="px-3 py-2 rounded-lg text-slate-500 text-xs font-bold hover:bg-slate-100">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
