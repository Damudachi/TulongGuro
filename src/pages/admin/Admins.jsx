import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Loader2, X, Copy, Check, ArrowUpCircle,
  History, Info, Pencil
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser, updateStoredUser } from '../../utils/session';
import { accountDomain, buildAccountEmail, validateAccountEmail } from '../../constants/accountEmails';
import DomainEmailField from '../../components/DomainEmailField';

import { showConfirm } from '../../utils/dialog';
import { generatePassword } from '../../constants/password';
import PasswordStrength from '../../components/PasswordStrength';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * How far back the access feed reaches.
 *
 * "Who gave this person the keys" is usually asked about something that
 * happened today, and the feed answered it by showing every change ever
 * recorded — so the row being looked for sat under a year of noise. The
 * default is a week: long enough to cover "since I was last in here", short
 * enough to be one screen. `days: null` is the whole feed.
 */
const HISTORY_RANGES = [
  { key: 'day', label: 'Last 24 hours', days: 1, empty: 'in the last 24 hours' },
  { key: 'week', label: 'Last week', days: 7, empty: 'in the last week' },
  { key: 'month', label: 'Last month', days: 30, empty: 'in the last month' },
  { key: 'all', label: 'All', days: null, empty: 'yet' },
];

/** How each audit row reads in the feed. Unknown events fall back to the code. */
const EVENT_LABEL = {
  ADMIN_CREATED: 'created an admin account for',
  ADMIN_PROMOTED: 'promoted to admin',
  ADMIN_DEMOTED: 'removed admin access from',
  ADMIN_PASSWORD_RESET: 'reset the password of',
};

/**
 * What to tell the admin when a call fails.
 *
 * The naive `d?.error || 'Could not save'` is wrong in the one case that
 * actually happens during a deploy: a route the running server does not have
 * yet answers 404 with Express's HTML page, `res.json()` throws, and `d` is
 * null — so the admin was told their *name* was rejected when the request had
 * simply not reached a handler. That cost real debugging time. A response with
 * no JSON body is a broken request, not a rejected value, and says so.
 */
function failureMessage(res, body, fallback) {
  if (body?.error) return body.error;
  if (res.status === 404) {
    return 'The server did not recognise this request. It is probably running an '
      + 'older build — restart or redeploy the API, then try again.';
  }
  if (!body) {
    return `The server returned an unreadable response (HTTP ${res.status}). ${fallback}`;
  }
  return fallback;
}

export default function AdminAdmins() {
  const me = getStoredUser();
  const [data, setData] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [school, setSchool] = useState(null);
  const [isLoading, setIsLoading] = useState(() => !!me.id);
  const [showForm, setShowForm] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // A failed load is not an empty school. Without this the page rendered
  // "0 of 5 admins" to an admin who was looking at their own account.
  const [loadFailed, setLoadFailed] = useState(false);
  // Renaming is self-only — there is no route that takes a target id — so this
  // is a single draft, never keyed by which row is being edited.
  const [nameDraft, setNameDraft] = useState(null);
  const [nameError, setNameError] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  // Promotion moves the account onto the admin domain, so the teacher being
  // promoted is picked first and their new address chosen second — hence a
  // selected teacher rather than a click that acts immediately.
  const [promoting, setPromoting] = useState(null);   // { teacher, email }
  const [promoteError, setPromoteError] = useState('');
  // How far back the access feed reaches — see HISTORY_RANGES.
  const [historyRange, setHistoryRange] = useState('week');
  // When the feed was read, as the fixed point the age filter measures from.
  const [fetchedAt, setFetchedAt] = useState(0);

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
        setLoadFailed(!adminsRes?.success);
        if (adminsRes?.success) setData(adminsRes);
        if (overviewRes?.success) {
          setTeachers(overviewRes.teachers || []);
          // Kept for its `slug`: every admin address on this screen is built on
          // the school's code, so the domain shown beside the name box and the
          // one the server will accept both come from here. Null for a school
          // that has not been given a code yet, which falls back to the legacy
          // flat domain on both sides.
          setSchool(overviewRes.school || null);
        }
        // The clock the age filter measures against. Read here rather than
        // during render: "last 24 hours" has to mean the same twenty-four
        // hours for every row on screen, and re-reading it each render makes
        // the boundary move under a feed nobody has refreshed.
        setFetchedAt(Date.now());
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
      // form.email holds the part before the @ only; the domain is fixed.
      const email = buildAccountEmail(form.email, 'ADMIN', school?.slug);
      const res = await apiFetch(`${API_URL}/api/admin/${me.id}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, email }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) {
        setCredentials({ email, password: form.password });
        setShowForm(false);
        load();
      } else {
        setError(failureMessage(res, d, 'The account was not created.'));
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Step one of promoting: choose the address the account will move to.
   *
   * A teacher signs in on this school's @teacher.<code>.edu.ph and an admin on
   * its @admin.<code>.edu.ph, so a promotion is also a change of login. Seeding
   * the new local part from their existing one means the usual case is a
   * confirmation rather than a decision — and only the local part moves, since
   * both domains are the same school's.
   */
  const startPromote = (teacher) => {
    setPromoteError('');
    setPromoting({
      teacher,
      email: String(teacher.email || '').split('@')[0] || '',
    });
  };

  const handlePromote = async (e) => {
    e.preventDefault();
    if (!promoting || busyId) return;
    const { teacher } = promoting;
    const email = buildAccountEmail(promoting.email, 'ADMIN', school?.slug);

    const check = validateAccountEmail(email, 'ADMIN', school?.slug);
    if (!check.ok) { setPromoteError(check.error); return; }

    const goAhead = await showConfirm(
      `They will sign in as ${email} from now on — their old address stops working — `
      + 'and they lose access to the teacher console. They are signed out immediately.',
      { title: `Make ${teacher.name} an admin?`, confirmLabel: 'Make them an admin' }
    );
    if (!goAhead) return;

    setBusyId(teacher.id);
    setPromoteError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${me.id}/admins/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: teacher.id, adminEmail: email }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) {
        setPromoting(null);
        setShowPromote(false);
        load();
      } else {
        // The server names the classes and sections still holding them — that
        // message is the whole point of the guard, so it must not be swallowed.
        setPromoteError(failureMessage(res, d, 'Nothing has been changed.'));
      }
    } catch {
      setPromoteError('Could not reach the server. Nothing has been changed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (e) => {
    e.preventDefault();
    if (isRenaming) return;
    const name = nameDraft.trim();
    if (!name) { setNameError('Name cannot be empty.'); return; }
    setIsRenaming(true);
    setNameError('');
    try {
      // No id in the body. The server keys the write to the session, so this
      // can only ever move the caller's own row.
      const res = await apiFetch(`${API_URL}/api/users/${me.id}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) {
        // The sidebar, the account block and every other screen read the stored
        // blob, so the new name has to land there too or it reverts on the next
        // navigation until the admin signs in again.
        updateStoredUser({ name: d.name });
        setNameDraft(null);
        load();
      } else {
        setNameError(failureMessage(res, d, 'Your name has not been changed.'));
      }
    } catch {
      setNameError('Could not reach the server. Your name has not been changed.');
    } finally {
      setIsRenaming(false);
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
  const allHistory = data?.history || [];
  const range = HISTORY_RANGES.find(r => r.key === historyRange) || HISTORY_RANGES[1];
  const history = range.days === null
    ? allHistory
    : allHistory.filter(h => {
        const at = new Date(h.createdAt).getTime();
        return Number.isFinite(at) && at >= fetchedAt - range.days * 86400000;
      });
  const maxAdmins = data?.maxAdmins || 5;
  const atCap = admins.length >= maxAdmins;
  // Every admin of a school may now change the set of admins — the super-admin
  // tier inside a school is gone, and School.ownerId is a record of who
  // registered rather than a permission. The only thing that still withholds
  // these controls is a failed load: offering buttons while the page does not
  // know the state of the school is worse than showing none, and the
  // load-failure banner below already says so.
  const canManage = !loadFailed;
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
        {/* Hidden outright rather than shown disabled for anyone but the super
            admin. A greyed-out button reads as "not right now"; this is "not
            you, ever", and the notice below says who instead. */}
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => { setShowPromote(true); setPromoting(null); setPromoteError(''); }} disabled={atCap}
              className="border border-slate-200 bg-white text-brand-slate px-4 py-2.5 rounded-lg text-sm font-bold hover:border-brand-navy disabled:opacity-40 flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4" /> Promote Teacher
            </button>
            <button onClick={openForm} disabled={atCap}
              className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md disabled:opacity-40 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Admin
            </button>
          </div>
        )}
      </div>

      {/* What the role actually means. Admin is total authority over the
          school's data, and someone adding a colleague should be told that
          before they do it rather than discover it afterwards. */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 flex gap-3">
        <Info className="w-5 h-5 text-brand-navy shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-bold mb-1">Everyone on this list can add to this list.</p>
          <p className="text-blue-800 text-xs leading-relaxed">
            An admin adds and removes teachers, changes the grading policy, and reads every
            learner's grades. Give it only to people who run the school — colleagues who teach
            need a teacher account instead. Any admin can add another, so add people you would
            trust with the whole school. Nobody here can change a colleague's password or take
            their admin access away — that is a TulongGuro operator's to do. A school can have
            up to {maxAdmins} admins and must always keep at
            least one. Admin accounts sign in on @{accountDomain('ADMIN', school?.slug)}.
          </p>
          {/* The only way an admin leaves this list, now that admins cannot
              remove each other. Said here because a school that does not know
              there is a way back will treat a departure as permanent. */}
          <p className="text-blue-800 text-xs leading-relaxed mt-2">
            Someone left, locked out, or need an admin restored? Contact TulongGuro support — a platform
            operator can reset any admin's password or remove admin access from outside the school.
          </p>
        </div>
      </div>

      {loadFailed && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6">
          <p className="font-bold text-red-800 text-sm mb-1">Could not load the admin list</p>
          <p className="text-xs text-red-700">
            The list below is not the state of your school — the server could not be read.
            Reload the page, and if it keeps happening tell whoever runs the deployment.
          </p>
          <button onClick={() => { setIsLoading(true); load(); }}
            className="mt-3 text-xs font-bold text-red-700 bg-white border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100">
            Try again
          </button>
        </div>
      )}

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
          return (
            <div key={a.id}
              className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-700 font-bold flex items-center justify-center shrink-0">
                {(a.name || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                {isMe && nameDraft !== null ? (
                  <form onSubmit={handleRename} className="flex items-center gap-2">
                    <input autoFocus type="text" value={nameDraft} maxLength={80}
                      onChange={e => setNameDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setNameDraft(null); setNameError(''); } }}
                      aria-label="Your name"
                      className="flex-1 min-w-0 border border-slate-200 px-2.5 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
                    <button type="submit" disabled={isRenaming}
                      className="px-3 py-1.5 rounded-lg bg-brand-navy text-white text-xs font-bold disabled:opacity-40 shrink-0">
                      {isRenaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setNameDraft(null); setNameError(''); }}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium shrink-0">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <p className="font-semibold text-brand-slate truncate flex items-center gap-2">
                    <span className="truncate">{a.name}</span>
                    {isMe && (
                      <>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-brand-navy bg-blue-50 px-2 py-0.5 rounded-full shrink-0">You</span>
                        {/* Only ever on your own row. Another admin's name is
                            theirs to change, and the server has no route that
                            would accept the attempt. */}
                        <button type="button" onClick={() => { setNameDraft(a.name); setNameError(''); }}
                          title="Change your name" aria-label="Change your name"
                          className="text-slate-400 hover:text-brand-navy shrink-0">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </p>
                )}
                {isMe && nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
                <p className="text-xs text-slate-500 truncate">{a.email}</p>
              </div>
              {/* Removed: the reset-password and remove-admin buttons.
                  Both are now a platform operator's, because either one lets
                  the person clicking it reach inside a colleague's account —
                  setting a password is how you sign in as someone else. The
                  server refuses both regardless of what is on screen; see
                  coAdminInSchool in server.js. The banner above says who to
                  ask instead, so nothing here is a dead end. */}
            </div>
          );
        })}
      </div>

      {/* Access history. The account list only ever shows the current answer;
          "who gave this person the keys" is the question asked afterwards. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <History className="w-4 h-4" /> Recent access changes
        </h2>
        {/* Segmented rather than a dropdown: four options, and which one is in
            force has to be readable without opening anything — the feed under
            it is evidence, and evidence that quietly hides rows is worse than
            no feed. */}
        <div role="group" aria-label="How far back to show access changes"
          className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-0.5 self-start">
          {HISTORY_RANGES.map(r => (
            <button key={r.key} type="button" onClick={() => setHistoryRange(r.key)}
              aria-pressed={historyRange === r.key}
              className={cn('px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors',
                historyRange === r.key
                  ? 'bg-white text-brand-navy shadow-sm'
                  : 'text-slate-500 hover:text-brand-slate')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {history.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          {data?.historyUnavailable ? (
            <>
              <p className="text-sm font-medium">History unavailable</p>
              <p className="text-xs mt-1">Access changes are still being recorded — this feed could not be read.</p>
            </>
          ) : allHistory.length > 0 ? (
            // The distinction matters: nothing in this window is not the same
            // claim as nothing ever, and only one of them is worth widening
            // the range for.
            <>
              <p className="text-sm font-medium">No access changes {range.empty}</p>
              <button type="button" onClick={() => setHistoryRange('all')}
                className="text-xs mt-1 text-brand-navy font-semibold hover:underline">
                Show all {allHistory.length} recorded change{allHistory.length === 1 ? '' : 's'}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Nothing recorded yet</p>
              <p className="text-xs mt-1">Admin accounts added or removed here will be listed.</p>
            </>
          )}
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
      {/* Says outright that rows are being withheld, so the feed is never read
          as the complete record when it is not. */}
      {history.length > 0 && history.length < allHistory.length && (
        <p className="text-xs text-slate-400 mt-2">
          Showing {history.length} of {allHistory.length} recorded changes.{' '}
          <button type="button" onClick={() => setHistoryRange('all')} className="text-brand-navy font-semibold hover:underline">
            Show all
          </button>
        </p>
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
              <DomainEmailField
                id="new-admin-email"
                role="ADMIN"
                schoolSlug={school?.slug}
                value={form.email}
                onChange={email => setForm({ ...form, email })}
                hint={`Admin accounts at this school sign in on @${accountDomain('ADMIN', school?.slug)} — you only choose the name.`}
              />
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
                <PasswordStrength value={form.password} />
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
            <h2 className="text-xl font-bold text-brand-slate mb-1">
              {promoting ? `Promote ${promoting.teacher.name}` : 'Promote a teacher'}
            </h2>
            <p className="text-slate-500 text-sm mb-4">
              {promoting
                ? 'Their account keeps its history and becomes an admin account. Choose the admin address they will sign in with.'
                : 'Their existing account becomes an admin account. They are signed out and sign back in from the Admin tab.'}
            </p>

            {/* ── Step 2: the new address ──
                Split out rather than done with a prompt() because it is a real
                decision with a real consequence: the address they sign in with
                changes, and the old one stops working the moment this is
                confirmed. That is worth showing before and after in full. */}
            {promoting ? (
              <form onSubmit={handlePromote} className="flex-1 overflow-y-auto -mx-1 px-1 space-y-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
                  <p className="text-slate-500 font-bold uppercase tracking-wider text-[10px] mb-1">Signs in today as</p>
                  <p className="font-mono text-slate-700 break-all">{promoting.teacher.email}</p>
                </div>

                <DomainEmailField
                  id="promote-admin-email"
                  role="ADMIN"
                  schoolSlug={school?.slug}
                  autoFocus
                  value={promoting.email}
                  onChange={email => setPromoting(prev => ({ ...prev, email }))}
                  label="New admin email"
                  hint={`Their teacher address stops working. From then on they sign in as ${buildAccountEmail(promoting.email, 'ADMIN', school?.slug) || `name@${accountDomain('ADMIN', school?.slug)}`}.`}
                />

                {promoteError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{promoteError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setPromoting(null); setPromoteError(''); }}
                    className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
                    Back
                  </button>
                  <button type="submit" disabled={!!busyId || !promoting.email.trim()}
                    className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                      busyId ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                    {busyId ? <><Loader2 className="w-4 h-4 animate-spin" /> Promoting...</> : 'Promote to admin'}
                  </button>
                </div>
              </form>
            ) : (
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {eligible.length === 0 && blocked.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No teacher accounts yet.</p>
              )}

              {eligible.map(t => (
                <button key={t.id} onClick={() => startPromote(t)} disabled={busyId === t.id}
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
                        {t._count?.taughtClasses || 0} course shell(s) · {t._count?.ownedSections || 0} section(s) —
                        reassign these before promoting
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
            )}

            {!promoting && (
              <button type="button" onClick={() => setShowPromote(false)}
                className="mt-4 w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 shrink-0">
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
