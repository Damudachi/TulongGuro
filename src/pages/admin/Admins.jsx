import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Loader2, KeyRound, X, Copy, Check, ArrowUpCircle,
  UserMinus, History, Info
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** Temporary password handed over once, exactly as the teacher screen does it. */
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** How each audit row reads in the feed. Unknown events fall back to the code. */
const EVENT_LABEL = {
  ADMIN_CREATED: 'created an admin account for',
  ADMIN_PROMOTED: 'promoted to admin',
  ADMIN_DEMOTED: 'removed admin access from',
  ADMIN_PASSWORD_RESET: 'reset the password of',
};

export default function AdminAdmins() {
  const me = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [isLoading, setIsLoading] = useState(() => !!me.id);
  const [showForm, setShowForm] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    if (!me.id) return;
    // The teacher list comes from the overview rather than a second endpoint of
    // its own — promotion needs each teacher's class and section counts, and
    // that is exactly what the overview already returns for the Teachers page.
    Promise.all([
      apiFetch(`${API_URL}/api/admin/${me.id}/admins`).then(r => r.json()).catch(() => null),
      apiFetch(`${API_URL}/api/admin/${me.id}/overview`).then(r => r.json()).catch(() => null),
    ])
      .then(([adminsRes, overviewRes]) => {
        if (adminsRes?.success) setData(adminsRes);
        if (overviewRes?.success) setTeachers(overviewRes.teachers || []);
      })
      .finally(() => setIsLoading(false));
  }, [me.id]);

  useEffect(() => { load(); }, [load]);

  const openForm = () => {
    setForm({ name: '', email: '', password: generatePassword() });
    setError('');
    setShowForm(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${me.id}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) {
        setCredentials({ email: form.email, password: form.password });
        setShowForm(false);
        load();
      } else {
        setError(d?.error || 'Could not create the account.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromote = async (teacher) => {
    if (!confirm(
      `Make ${teacher.name} an admin?\n\n`
      + 'They will lose access to the teacher console and be signed out, so they '
      + 'have to sign in again from the Admin tab.'
    )) return;
    setBusyId(teacher.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${me.id}/admins/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: teacher.id }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) { setShowPromote(false); load(); }
      // The server names the classes and sections still holding them — that
      // message is the whole point of the guard, so it must not be swallowed.
      else alert(d?.error || 'Could not promote this teacher. Nothing has been changed.');
    } catch {
      alert('Could not reach the server. Nothing has been changed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDemote = async (admin) => {
    if (!confirm(
      `Remove admin access from ${admin.name}?\n\n`
      + 'Their account becomes a teacher account — nothing is deleted — and they '
      + 'are signed out immediately.'
    )) return;
    setBusyId(admin.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${me.id}/admins/${admin.id}/demote`, { method: 'PUT' });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) load();
      else alert(d?.error || 'Could not change this account. Nothing has been changed.');
    } catch {
      alert('Could not reach the server. Nothing has been changed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (admin) => {
    const password = generatePassword();
    if (!confirm(`Reset ${admin.name}'s password? Their current one stops working immediately.`)) return;
    setBusyId(admin.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${me.id}/admins/${admin.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) setCredentials({ email: admin.email, password });
      else alert(d?.error || 'Reset failed. Their existing password still works.');
    } catch {
      alert('Could not reach the server. Their password has not been changed.');
    } finally {
      setBusyId(null);
    }
  };

  const copyCredentials = () => {
    navigator.clipboard?.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading admins...
      </div>
    );
  }

  const admins = data?.admins || [];
  const history = data?.history || [];
  const maxAdmins = data?.maxAdmins || 5;
  const atCap = admins.length >= maxAdmins;
  // Mirrors the server's promotion guard so the reason is visible before the
  // click, not only after it. The server still decides — this is only the copy.
  const eligible = teachers.filter(t => !(t._count?.taughtClasses || t._count?.ownedSections));
  const blocked = teachers.filter(t => t._count?.taughtClasses || t._count?.ownedSections);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">School admins</h1>
          <p className="text-slate-500 text-sm">Who else can run this school's console</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowPromote(true)} disabled={atCap}
            className="border border-slate-200 bg-white text-brand-slate px-4 py-2.5 rounded-lg text-sm font-bold hover:border-brand-navy disabled:opacity-40 flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4" /> Promote Teacher
          </button>
          <button onClick={openForm} disabled={atCap}
            className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md disabled:opacity-40 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Admin
          </button>
        </div>
      </div>

      {/* What the role actually means. Admin is total authority over the
          school's data, and someone adding a colleague should be told that
          before they do it rather than discover it afterwards. */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 flex gap-3">
        <Info className="w-5 h-5 text-brand-navy shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-bold mb-1">An admin can do everything you can.</p>
          <p className="text-blue-800 text-xs leading-relaxed">
            That includes adding and removing teachers, changing the grading policy, and
            reading every learner's grades. Give it only to people who run the school —
            colleagues who teach need a teacher account instead. A school can have up to{' '}
            {maxAdmins} admins, and must always keep at least one.
          </p>
        </div>
      </div>

      {atCap && (
        <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6">
          This school is at the limit of {maxAdmins} admins. Remove one before adding another.
        </p>
      )}

      {/* Credentials handoff — shown once, exactly as on the Teachers page. */}
      {credentials && (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-green-800 mb-1">Account ready — share these once</p>
              <p className="text-xs text-green-700 mb-3">
                They sign in from the normal login page using the Admin tab. This is the only
                time the password is shown.
              </p>
              <div className="bg-white border border-green-200 rounded-lg p-3 font-mono text-sm space-y-1">
                <p className="text-slate-600 break-all">Email: <span className="font-bold text-brand-slate">{credentials.email}</span></p>
                <p className="text-slate-600">Password: <span className="font-bold text-brand-slate">{credentials.password}</span></p>
              </div>
            </div>
            <button onClick={() => setCredentials(null)} className="text-green-500 hover:text-green-700 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <button onClick={copyCredentials}
            className="mt-3 text-xs font-bold text-green-700 bg-white border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 flex items-center gap-1.5">
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </button>
        </div>
      )}

      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
        Admins ({admins.length} of {maxAdmins})
      </h2>
      <div className="space-y-3 mb-10">
        {admins.map(a => {
          const isMe = a.id === me.id;
          // The last admin cannot be demoted; saying so on the button is
          // friendlier than letting the server refuse after a confirm dialog.
          const isLast = admins.length <= 1;
          return (
            <div key={a.id}
              className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-700 font-bold flex items-center justify-center shrink-0">
                {(a.name || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-brand-slate truncate">
                  {a.name}
                  {isMe && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-brand-navy bg-blue-50 px-2 py-0.5 rounded-full">You</span>}
                </p>
                <p className="text-xs text-slate-500 truncate">{a.email}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => handleResetPassword(a)}
                  disabled={isMe || busyId === a.id}
                  title={isMe ? 'Change your own password from the login screen' : 'Reset password'}
                  className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30">
                  <KeyRound className="w-4 h-4" />
                </button>
                <button onClick={() => handleDemote(a)}
                  disabled={isMe || isLast || busyId === a.id}
                  title={isMe ? 'Another admin has to do this' : isLast ? 'A school must keep at least one admin' : 'Remove admin access'}
                  className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 disabled:opacity-30">
                  {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Access history. The account list only ever shows the current answer;
          "who gave this person the keys" is the question asked afterwards. */}
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <History className="w-4 h-4" /> Recent access changes
      </h2>
      {history.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <p className="text-sm font-medium">Nothing recorded yet</p>
          <p className="text-xs mt-1">Admin accounts added or removed here will be listed.</p>
        </div>
      ) : (
        <ol className="space-y-2">
          {history.map(h => (
            <li key={h.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm">
              <span className="font-semibold text-brand-slate">{h.actorName || 'An admin'}</span>{' '}
              <span className="text-slate-600">{EVENT_LABEL[h.event] || h.event}</span>{' '}
              <span className="font-semibold text-brand-slate">{h.targetName || 'an account'}</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">
                {h.targetEmail ? `${h.targetEmail} · ` : ''}
                {new Date(h.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* Add admin modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Add an admin</h2>
            <p className="text-slate-500 text-sm mb-5">They'll sign in with this email and temporary password.</p>
            <form onSubmit={handleCreate} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full name *</label>
                <input required type="text" value={form.name} autoComplete="off"
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Juan Dela Cruz"
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input required type="email" value={form.email} autoComplete="off"
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="principal@deped.gov.ph"
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Temporary password *</label>
                <div className="flex gap-2">
                  <input required type="text" value={form.password} autoComplete="off"
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="flex-1 min-w-0 border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm font-mono" />
                  <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })}
                    className="px-3 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200">
                    New
                  </button>
                </div>
              </div>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isSaving}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Promote-a-teacher modal */}
      {showPromote && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[85vh] flex flex-col">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Promote a teacher</h2>
            <p className="text-slate-500 text-sm mb-4">
              Their existing account becomes an admin account. They are signed out and sign
              back in from the Admin tab.
            </p>

            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {eligible.length === 0 && blocked.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No teacher accounts yet.</p>
              )}

              {eligible.map(t => (
                <button key={t.id} onClick={() => handlePromote(t)} disabled={busyId === t.id}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 mb-2 flex items-center gap-3 hover:border-brand-navy disabled:opacity-40">
                  <span className="w-9 h-9 rounded-full bg-blue-50 text-brand-navy font-bold grid place-items-center shrink-0">
                    {t.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-brand-slate text-sm truncate">{t.name}</span>
                    <span className="block text-xs text-slate-500 truncate">{t.email}</span>
                  </span>
                  {busyId === t.id
                    ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />
                    : <ArrowUpCircle className="w-4 h-4 text-slate-300 shrink-0" />}
                </button>
              ))}

              {blocked.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">
                    Not available — still teaching
                  </p>
                  {blocked.map(t => (
                    <div key={t.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-2 opacity-70">
                      <p className="font-semibold text-brand-slate text-sm truncate">{t.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {t._count?.taughtClasses || 0} class(es) · {t._count?.ownedSections || 0} section(s) —
                        reassign these before promoting
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>

            <button type="button" onClick={() => setShowPromote(false)}
              className="mt-4 w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 shrink-0">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
