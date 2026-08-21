import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Loader2, Check, X, Building2, Mail, RefreshCw, AlertTriangle,
  BadgeCheck, HelpCircle, FileText, Copy, Globe, Trash2, CheckSquare, Square } from 'lucide-react';
import { API_URL, apiFetch } from '../config';

import { showAlert, showConfirm } from '../utils/dialog';
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

/**
 * How each DepEd-masterlist verdict is shown. The wording is doing real work
 * here: none of these approve or refuse anything by itself, so each label has
 * to say what was checked rather than deliver a judgement an operator might
 * mistake for a decision already made.
 *
 * NOT_FOUND and NOT CHECKED look similar and mean opposite things — one is
 * about the school, the other about this server missing its data file — so
 * they are deliberately given different colours and different icons.
 */
const VERIFICATION_STYLES = {
  MATCHED: { label: 'DepEd ID matched', cls: 'bg-emerald-100 text-emerald-800', Icon: BadgeCheck },
  NAME_MISMATCH: { label: 'Name differs', cls: 'bg-amber-100 text-amber-800', Icon: AlertTriangle },
  NOT_FOUND: { label: 'ID not in masterlist', cls: 'bg-red-100 text-red-700', Icon: AlertTriangle },
  NO_MASTERLIST: { label: 'Not checked', cls: 'bg-slate-200 text-slate-600', Icon: HelpCircle },
};

export default function PlatformApprovals() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) || '');
  const [keyInput, setKeyInput] = useState('');
  const [schools, setSchools] = useState([]);
  const [masterlistLoaded, setMasterlistLoaded] = useState(true);
  const [status, setStatus] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // Ids ticked for deletion. Only ever populated on the Rejected tab — see the
  // toolbar below for why deletion is not offered anywhere else.
  const [selected, setSelected] = useState(() => new Set());
  const [isDeleting, setIsDeleting] = useState(false);

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
        setMasterlistLoaded(data.masterlistLoaded !== false);
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

  // Deletion is offered only where it is safe to offer: a rejected
  // registration has no sections, no curriculums and nobody who can sign in.
  // Showing the same controls on Approved would put "delete all" one mis-click
  // from a live school, so the tab itself is the first guard.
  const canDelete = status === 'REJECTED';

  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /**
   * Delete rejected registrations, one or many.
   *
   * The confirmation names what is about to happen rather than asking "are you
   * sure": the count, the fact that the admin accounts go with it, and that the
   * stored ID photo is destroyed. None of that is recoverable, so it belongs in
   * front of the operator before the click, not in a toast afterwards.
   */
  const deleteSchools = async (ids, label) => {
    if (!ids.length) return;
    const many = ids.length !== 1;
    const ok = await showConfirm(
      `This also deletes their admin account${many ? 's' : ''} and the uploaded ID `
      + `photo${many ? 's' : ''}. It cannot be undone.`,
      {
        title: `Permanently delete ${ids.length} ${label}?`,
        confirmLabel: `Delete ${ids.length}`,
        danger: true,
      },
    );
    if (!ok) return;

    setIsDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/api/platform/schools/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-platform-key': key },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!data.success) return showAlert(data.error || 'Could not delete.');

      // The server decides per school, so some of a batch can be refused while
      // the rest go through. Saying only "deleted N" would hide that.
      if (data.skipped?.length) {
        showAlert(
          `Deleted ${data.deleted.length}. Kept ${data.skipped.length}:\n\n`
          + data.skipped.map(s => `• ${s.name || s.id} — ${s.reason}`).join('\n'),
        );
      }
      setSelected(new Set());
      await load();
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Open a registrant's ID photo.
   *
   * The link is fetched on click rather than sent with the list, because it is
   * signed and expires in minutes — one minted at page load would already be
   * dead by the time an operator worked down the queue to it. It also means the
   * key never sits in the page for schools nobody opened.
   */
  const viewRegistrantId = async (school) => {
    setBusyId(school.id);
    try {
      const res = await apiFetch(`${API_URL}/api/platform/schools/${school.id}/registrant-id`, {
        headers: { 'x-platform-key': key },
      });
      const data = await res.json();
      if (!data.success) return showAlert(data.error || 'Could not open the ID.');
      // noopener, because the signed URL is in this tab's referrer otherwise.
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setBusyId(null);
    }
  };

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
        showAlert(data.error || 'That did not work.');
      }
    } catch {
      showAlert('Network error.');
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
          {/* Switching tabs drops any ticks: those ids are about to leave the
              screen, and a selection you cannot see is one you cannot check
              before pressing delete. */}
          {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map(s => (
            <button key={s} onClick={() => { setStatus(s); setSelected(new Set()); }}
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

        {/* Without this, every row reading "Not checked" looks like a finding
            about the schools rather than about the server. */}
        {!masterlistLoaded && (
          <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">
            <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">No DepEd masterlist installed — nothing below was verified automatically.</p>
              <p className="text-xs mt-0.5">
                Import it on the server with{' '}
                <code className="font-mono bg-amber-100 px-1 rounded">node scripts/import-deped-masterlist.js &lt;masterlist.xlsx&gt;</code>{' '}
                and restart, then new registrations get checked against it.
              </p>
            </div>
          </div>
        )}

        {/* ── Bulk actions, Rejected tab only ──
            "Delete all" is deliberately the last thing here and labelled with
            its count rather than the word "all", because "all" hides how much
            is about to go and a number does not. */}
        {canDelete && schools.length > 0 && (
          <div className="mb-4 flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-xl px-3 py-2">
            <button type="button" disabled={isDeleting}
              onClick={() => setSelected(prev =>
                prev.size === schools.length ? new Set() : new Set(schools.map(s => s.id)))}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 disabled:opacity-50">
              {selected.size === schools.length
                ? <CheckSquare className="w-4 h-4" />
                : <Square className="w-4 h-4" />}
              {selected.size === schools.length ? 'Clear selection' : 'Select all'}
            </button>

            <span className="text-xs text-slate-400 font-semibold">
              {selected.size > 0 && `${selected.size} selected`}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button type="button"
                disabled={isDeleting || selected.size === 0}
                onClick={() => deleteSchools([...selected],
                  selected.size === 1 ? 'rejected registration' : 'rejected registrations')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete selected
              </button>

              <button type="button" disabled={isDeleting}
                onClick={() => deleteSchools(schools.map(s => s.id),
                  schools.length === 1 ? 'rejected registration' : 'rejected registrations')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" /> Delete all {schools.length}
              </button>
            </div>
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
              const verdict = VERIFICATION_STYLES[s.verification];
              return (
                <div key={s.id} className={cn(
                  'bg-white border rounded-2xl p-4 transition-colors',
                  selected.has(s.id) ? 'border-red-300 bg-red-50/40' : 'border-slate-200',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    {canDelete && (
                      <button type="button" onClick={() => toggleSelected(s.id)}
                        title={selected.has(s.id) ? 'Deselect' : 'Select for deletion'}
                        className="shrink-0 mt-0.5 text-slate-400 hover:text-red-600">
                        {selected.has(s.id)
                          ? <CheckSquare className="w-4 h-4 text-red-600" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-900">{s.name}</p>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_STYLES[s.status])}>
                          {s.status}
                        </span>
                        {verdict && (
                          <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full', verdict.cls)}>
                            <verdict.Icon className="w-3 h-3" /> {verdict.label}
                          </span>
                        )}
                      </div>

                      {/* ── What was checked ──
                          The note is what the lookup found at the moment this
                          school registered, not a re-check now: the masterlist
                          file is replaced whenever DepEd publishes a new one. */}
                      {s.depedSchoolId && (
                        <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                          <p className="font-mono font-bold text-slate-800">
                            DepEd ID {s.depedSchoolId}
                          </p>
                          {/* Shown whenever it differs, which is exactly when an
                              operator needs to compare the two spellings. */}
                          {s.officialName && s.officialName !== s.name && (
                            <p>Masterlist says: <span className="font-bold text-slate-800">{s.officialName}</span></p>
                          )}
                          {s.verificationNote && <p className="text-slate-500">{s.verificationNote}</p>}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {s.proofUrl && (
                          <a href={s.proofUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs font-bold text-slate-700 hover:bg-slate-200">
                            <FileText className="w-3.5 h-3.5" /> Proof document
                          </a>
                        )}

                        {/* The half of the evidence that is about the person
                            rather than the school. A button, not a link: the
                            URL does not exist until it is asked for, and the
                            one minted expires in minutes. */}
                        {s.hasRegistrantId ? (
                          <button type="button" onClick={() => viewRegistrantId(s)}
                            disabled={busyId === s.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-100 text-xs font-bold text-indigo-700 hover:bg-indigo-200 disabled:opacity-50">
                            <BadgeCheck className="w-3.5 h-3.5" /> View registrant's ID
                          </button>
                        ) : (
                          /* Registrations from before the ID was required have
                             none. Said plainly so its absence reads as an older
                             registration rather than as something to chase. */
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-xs font-bold text-amber-700">
                            <AlertTriangle className="w-3.5 h-3.5" /> No registrant ID on file
                          </span>
                        )}
                      </div>

                      {/* Names repeat legitimately across divisions, so this is
                          a prompt to check the division — never a reason on its
                          own to refuse. */}
                      {s.similarSchools?.length > 0 && (
                        <div className="flex items-start gap-1.5 mt-2 text-xs text-amber-700">
                          <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <p>
                            Similar to {s.similarSchools.map(d => `"${d.name}"`).join(', ')} — check the
                            division before approving, or this may be a duplicate.
                          </p>
                        </div>
                      )}

                      {/* The two contacts, doing different jobs: the mailbox to
                          reach out on, and the login it will sign in with. */}
                      {(admin || s.contactEmail) && (
                        <div className="text-sm text-slate-600 mt-2">
                          {s.contactEmail && (
                            <a href={`mailto:${s.contactEmail}`} className="inline-flex items-center gap-1 text-slate-700 font-semibold hover:text-slate-900 underline">
                              <Mail className="w-3 h-3" /> {s.contactEmail}
                            </a>
                          )}
                          {admin && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {admin.name}
                              {admin.email && <span className="ml-1.5 text-slate-400">signs in as {admin.email}</span>}
                            </p>
                          )}
                        </div>
                      )}

                      <p className="text-xs text-slate-400 mt-1.5">
                        Registered {new Date(s.createdAt).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}{s._count?.users ?? 0} account(s)
                        {' · '}{s._count?.sections ?? 0} section(s)
                        {' · '}{s._count?.curriculums ?? 0} curriculum(s)
                        {/* One address submitting many schools is the signature
                            this whole screen exists to make visible. */}
                        {s.registeredIp && (
                          <span className="inline-flex items-center gap-1 ml-1.5 font-mono">
                            <Globe className="w-3 h-3" />{s.registeredIp}
                          </span>
                        )}
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
                      {/* Icon-only and last: Approve is the action this screen
                          exists for, and a delete button of equal weight beside
                          it would be a mis-click with no undo. */}
                      {canDelete && (
                        <button onClick={() => deleteSchools([s.id], `"${s.name}"`)}
                          disabled={isDeleting || busyId === s.id} title={`Delete "${s.name}"`}
                          className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-40">
                          <Trash2 className="w-3.5 h-3.5" />
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
