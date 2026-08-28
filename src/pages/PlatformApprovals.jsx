import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Loader2, Check, X, Building2, Mail, RefreshCw, AlertTriangle,
  BadgeCheck, HelpCircle, FileText, Copy, Globe, Trash2, CheckSquare, Square,
  ChevronDown, KeyRound, UserMinus, Users, Search, ClipboardCheck } from 'lucide-react';
import { API_URL } from '../config';

import { showAlert, showConfirm } from '../utils/dialog';
import { generatePassword } from '../constants/password';
import { passwordProblem } from '../constants/password';
import PasswordStrength from '../components/PasswordStrength';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * The TulongGuro platform console.
 *
 * Not part of the school-facing app: no layout, no nav, and nothing links to
 * it. Three views — approving school registrations, managing admin accounts at
 * any school, and managing the operators themselves.
 *
 * ── It used to be one shared key ──
 * PLATFORM_ADMIN_KEY, typed into this page and sent as a header. That was
 * defensible while the console only approved and rejected registrations. It
 * stopped being defensible when it gained the power to set any school admin's
 * password — which is impersonation, at every school on the platform. A secret
 * four people share cannot say which of them acted, cannot be revoked for one
 * of them, and never expires.
 *
 * So an operator signs in as themselves now. The session is a normal signed
 * token, held in sessionStorage so it dies with the tab, and short-lived: four
 * hours rather than the week a teacher gets. The key survives only to create
 * the first operator from the command line.
 *
 * Every call here goes through opFetch, never the app's apiFetch — see the note
 * on it for why mixing the two credentials is the bug to avoid.
 */
const TOKEN_STORAGE = 'tg_platform_token';

/**
 * The two things an operator does here, as top-level views.
 *
 * They were one screen when approvals were the only job. Admin-account
 * management is not a variation on approving a school — it is opened for a
 * different reason (a school locked out, an admin who left), acts on a
 * different object, and is mostly used on schools that were approved months
 * ago. Sharing one list would mean a status filter that means two things at
 * once, so they get a switch instead.
 */
const VIEWS = [
  { key: 'approvals', label: 'Approvals', Icon: ClipboardCheck },
  { key: 'admins', label: 'Admin accounts', Icon: Users },
  { key: 'operators', label: 'Operators', Icon: ShieldCheck },
];

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
 * NOT_FOUND and NOT CHECKED look similar and mean opposite things â€” one is
 * about the school, the other about this server missing its data file â€” so
 * they are deliberately given different colours and different icons.
 */
const VERIFICATION_STYLES = {
  MATCHED: { label: 'DepEd ID matched', cls: 'bg-emerald-100 text-emerald-800', Icon: BadgeCheck },
  NAME_MISMATCH: { label: 'Name differs', cls: 'bg-amber-100 text-amber-800', Icon: AlertTriangle },
  NOT_FOUND: { label: 'ID not in masterlist', cls: 'bg-red-100 text-red-700', Icon: AlertTriangle },
  NO_MASTERLIST: { label: 'Not checked', cls: 'bg-slate-200 text-slate-600', Icon: HelpCircle },
};

export default function PlatformApprovals() {
  // The operator's session token, held in sessionStorage so it dies with the
  // tab. `key` rather than `token` only because every call site below was
  // written against the old shared key; what it holds now is a signed session.
  const [key, setKey] = useState(() => sessionStorage.getItem(TOKEN_STORAGE) || '');
  const [operator, setOperator] = useState(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loggingIn, setLoggingIn] = useState(false);
  const [schools, setSchools] = useState([]);
  const [masterlistLoaded, setMasterlistLoaded] = useState(true);
  const [status, setStatus] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // Ids ticked for deletion. Only ever populated on the Pending and Rejected
  // tabs â€” see canDelete below for why deletion is not offered anywhere else.
  const [selected, setSelected] = useState(() => new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  // Ids whose details are open. Rows start collapsed on every tab: a queue is
  // read by scanning names first and only opening the one being decided on, and
  // the collapsed row still carries the two facts that identify a school â€”
  // its name and its DepEd ID.
  const [expanded, setExpanded] = useState(() => new Set());

  // ── Admin-accounts view ──
  //
  // Its own school list rather than a filter on the approvals one: this view
  // asks "which school", not "which queue", so it reads every school at once
  // and narrows by typing. `adminsBySchool` is keyed by school id so an action
  // can redraw one school's rows without refetching the platform.
  const [view, setView] = useState('approvals');
  const [adminSchools, setAdminSchools] = useState([]);
  const [adminsBySchool, setAdminsBySchool] = useState({});
  const [adminQuery, setAdminQuery] = useState('');
  const [openSchoolId, setOpenSchoolId] = useState(null);
  const [adminBusyId, setAdminBusyId] = useState(null);
  const [adminsLoading, setAdminsLoading] = useState(false);
  // The set-password dialog: which admin, and the value being handed over.
  // Held here rather than per row so only one can ever be open — two open at
  // once is how the wrong password reaches the right person.
  const [pwFor, setPwFor] = useState(null);          // { school, admin }
  const [pwValue, setPwValue] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwDone, setPwDone] = useState(null);        // { admin, password }
  const [pwCopied, setPwCopied] = useState(false);

  // ── Operators view ──
  const [operators, setOperators] = useState([]);
  const [operatorsLoading, setOperatorsLoading] = useState(false);
  const [showAddOperator, setShowAddOperator] = useState(false);
  const [newOperator, setNewOperator] = useState({ name: '', email: '', password: '' });
  const [opSaving, setOpSaving] = useState(false);
  const [opBusyId, setOpBusyId] = useState(null);
  // A credential handed over once — a new operator's password, or a reset one.
  const [opDone, setOpDone] = useState(null);        // { name, email, password }
  const [opCopied, setOpCopied] = useState(false);
  // Changing your *own* password. Separate from the reset above because it asks
  // for the current one first — the reset route deliberately refuses self, so
  // without this an operator had nowhere to change the password they were
  // handed on a slip of paper.
  const [showMyPassword, setShowMyPassword] = useState(false);
  const [myPassword, setMyPassword] = useState({ currentPassword: '', newPassword: '' });
  const [myPwSaving, setMyPwSaving] = useState(false);
  const [myPwError, setMyPwError] = useState('');

  /**
   * fetch with the operator's session attached.
   *
   * Deliberately not the app's shared apiFetch. That one sets the Authorization
   * header from the *school* session store, overwriting anything the caller
   * passed — so an operator who is also signed in as a school admin in the same
   * browser would send the school's token to the platform routes and be
   * refused, with nothing on screen explaining why. The two credentials live in
   * different places and must not be mixed.
   */
  const opFetch = useCallback((url, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (key) headers.set('Authorization', `Bearer ${key}`);
    // eslint-disable-next-line no-restricted-globals -- deliberate: the rule points at apiFetch, which attaches the *school* session token and would overwrite the operator credential this console signs with
    return fetch(url, { ...init, headers });
  }, [key]);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE);
    setKey('');
    setOperator(null);
    setLoginForm({ email: '', password: '' });
  }, []);

  /**
   * Confirm the stored token still belongs to a live operator.
   *
   * A session that expired while the tab sat open, or was revoked because
   * another operator reset this account's password, otherwise shows a full
   * console whose every request fails. Asking once on load turns that into the
   * sign-in form.
   */
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line no-restricted-globals -- deliberate: the rule points at apiFetch, which attaches the *school* session token and would overwrite the operator credential this console signs with
        const res = await fetch(`${API_URL}/api/platform/me`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (data?.success) setOperator(data.operator);
        else signOut();
      } catch { /* offline: leave the console up rather than signing them out */ }
    })();
    return () => { cancelled = true; };
  }, [key, signOut]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loggingIn) return;
    setLoggingIn(true);
    setError('');
    try {
      // eslint-disable-next-line no-restricted-globals -- deliberate: the rule points at apiFetch, which attaches the *school* session token and would overwrite the operator credential this console signs with
      const res = await fetch(`${API_URL}/api/platform/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) {
        return setError(data?.error || 'Invalid credentials');
      }
      sessionStorage.setItem(TOKEN_STORAGE, data.token);
      setKey(data.token);
      setOperator(data.operator);
      setLoginForm({ email: '', password: '' });
    } catch {
      setError('Network error. Is the API reachable?');
    } finally {
      setLoggingIn(false);
    }
  };

  const load = useCallback(async () => {
    if (!key) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await opFetch(`${API_URL}/api/platform/schools?status=${status}`, {
        
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
          sessionStorage.removeItem(TOKEN_STORAGE);
          setKey('');
        }
      }
    } catch {
      setError('Network error. Is the API reachable?');
    } finally {
      setIsLoading(false);
    }
  }, [key, status, opFetch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
  useEffect(() => { load(); }, [load]);

  // Deletion is offered on Pending and Rejected â€” the two states where nobody
  // has ever been able to sign in, so there is no teaching data to lose.
  //
  // Not on Approved, which would put "delete all" one mis-click from a live
  // school, and not on All, where a single list mixes the two cases and
  // "select all" would mean something different for each row. The tab is the
  // first guard; the server checks the status again regardless.
  const canDelete = status === 'REJECTED' || status === 'PENDING';

  /** "3 pending registrations" / "1 rejected registration", so the dialog names
   *  what is going rather than saying "items". */
  const deletableNoun = (n) =>
    `${status === 'PENDING' ? 'pending' : 'rejected'} registration${n === 1 ? '' : 's'}`;

  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleExpanded = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allExpanded = schools.length > 0 && schools.every(s => expanded.has(s.id));

  /**
   * Delete pending or rejected registrations, one or many.
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
      // Said first, and only on Pending: everything else in this dialog is
      // true of both tabs, but "nobody has looked at this yet" is the fact
      // that makes deleting from Pending a different decision. A real school
      // waiting on approval looks exactly like a junk registration until
      // someone reads it.
      (status === 'PENDING'
        ? `${many ? 'These have' : 'This has'} not been reviewed yet â€” if any of `
          + `${many ? 'them are' : 'it is'} a real school waiting for approval, `
          + `${many ? 'they' : 'it'} will have to register again from scratch.\n\n`
        : '')
      + `This also deletes their admin account${many ? 's' : ''} and the uploaded ID `
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
      const res = await opFetch(`${API_URL}/api/platform/schools/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!data.success) return showAlert(data.error || 'Could not delete.');

      // The server decides per school, so some of a batch can be refused while
      // the rest go through. Saying only "deleted N" would hide that.
      if (data.skipped?.length) {
        showAlert(
          `Deleted ${data.deleted.length}. Kept ${data.skipped.length}:\n\n`
          + data.skipped.map(s => `â€¢ ${s.name || s.id} â€” ${s.reason}`).join('\n'),
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
   * signed and expires in minutes â€” one minted at page load would already be
   * dead by the time an operator worked down the queue to it. It also means the
   * key never sits in the page for schools nobody opened.
   */
  const viewRegistrantId = async (school) => {
    setBusyId(school.id);
    try {
      const res = await opFetch(`${API_URL}/api/platform/schools/${school.id}/registrant-id`, {
        
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
      const res = await opFetch(`${API_URL}/api/platform/schools/${school.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (data.success) {
        setRejectingId(null);
        setRejectReason('');
        load();
        // Approving a school hands it the school code, which refuses every
        // other registration still asking for the same one. Those rows change
        // status as a result of this click, so the operator is told rather than
        // left to notice a queue that shrank by more than the row they acted
        // on. See the approve route for why losing registrations are settled.
        const lost = data.rejectedForCode || [];
        if (lost.length) {
          showAlert(
            `${school.name} now owns the school code ${data.school?.slug || ''}. `
            + `${lost.length === 1 ? 'This registration was' : 'These registrations were'} `
            + `asking for the same code and ${lost.length === 1 ? 'has' : 'have'} been refused: `
            + `${lost.map((s) => s.name).join(', ')}.`
          );
        }
      } else {
        showAlert(data.error || 'That did not work.');
      }
    } catch {
      showAlert('Network error.');
    } finally {
      setBusyId(null);
    }
  };

  // â”€â”€ Key gate â”€â”€
  /**
   * The approved schools, for the admin-accounts view.
   *
   * `status=APPROVED`, and only those. This screen used to ask for every school
   * and show them all with a status chip, on the argument that admin trouble is
   * not confined to approved schools - a pending school's registrant who typed
   * their own password wrong is a real support call. That argument lost to a
   * simpler one: nobody at a PENDING or REJECTED school can sign in at all, so
   * there is no live account to rescue, and both were only ever noise in a list
   * an operator scans under time pressure looking for a school that is running.
   *
   * A registration that has not been approved is the approvals tab's subject,
   * not this one's, and it is still there under Pending and Rejected. A school
   * appears here the moment it is approved, and disappears again if that is
   * reversed - the filter is on status, so nothing has to be cleaned up.
   *
   * Filtered by the server rather than here: the operator cannot act on rows
   * this screen will not show, so sending them at all was only bandwidth and a
   * longer list to search.
   *
   * The list endpoint already embeds each school's admins, so opening a row
   * costs nothing; the per-school route is only used to redraw after an action.
   */
  const loadAdminSchools = useCallback(async () => {
    if (!key) return;
    setAdminsLoading(true);
    setError('');
    try {
      const res = await opFetch(`${API_URL}/api/platform/schools?status=APPROVED`, {
        
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Could not load schools.');
        if (res.status === 401) { sessionStorage.removeItem(TOKEN_STORAGE); setKey(''); }
        return;
      }
      const list = data.schools || [];
      setAdminSchools(list);
      // Seeded from what the list already returned, so a row opens filled in
      // rather than spinning on a request that would return the same thing.
      setAdminsBySchool(Object.fromEntries(list.map(s => [s.id, s.users || []])));
    } catch {
      setError('Network error. Is the API reachable?');
    } finally {
      setAdminsLoading(false);
    }
  }, [key, opFetch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- same shape as the approvals load above: a loading flag ahead of an async read
  useEffect(() => { if (view === 'admins') loadAdminSchools(); }, [view, loadAdminSchools]);

  /** Re-read one school's admins after an action, so the row reflects what the
   *  server now holds rather than what the client assumed it would. */
  const refreshAdmins = async (schoolId) => {
    try {
      const res = await opFetch(`${API_URL}/api/platform/schools/${schoolId}/admins`, {
        
      });
      const data = await res.json();
      if (data.success) setAdminsBySchool(prev => ({ ...prev, [schoolId]: data.admins || [] }));
    } catch { /* the action landed; a stale row is the lesser problem */ }
  };

  const openSetPassword = (school, admin) => {
    setPwFor({ school, admin });
    setPwValue(generatePassword(12));
    setPwDone(null);
    setPwCopied(false);
  };

  /**
   * Set an admin's password.
   *
   * The new password is shown once, afterwards, with a copy button - never
   * mailed, because there is no SMTP and the address it would go to is a
   * synthetic login domain with no mailbox behind it. The operator reads it to
   * the school. That is also why it is generated rather than typed: an operator
   * inventing passwords under time pressure invents weak ones.
   */
  const submitPassword = async (e) => {
    e.preventDefault();
    if (!pwFor || pwSaving) return;
    setPwSaving(true);
    try {
      const { school, admin } = pwFor;
      const res = await opFetch(
        `${API_URL}/api/platform/schools/${school.id}/admins/${admin.id}/password`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwValue }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!data?.success) return showAlert(data?.error || 'The password was not changed.');
      setPwDone({ admin, password: pwValue });
      setPwFor(null);
      await refreshAdmins(school.id);
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setPwSaving(false);
    }
  };

  /**
   * Remove admin access - a demotion to teacher, not a deletion.
   *
   * The dialog says which of those it is. "Remove admin" reads as "delete the
   * person" to anyone who has not read the server code, and an operator who
   * believes they are deleting an account will hesitate over the wrong thing.
   */
  const removeAdmin = async (school, admin) => {
    const ok = await showConfirm(
      `${admin.name} keeps their account and their teaching data - they become a teacher at `
      + `${school.name} and lose the admin console. Any session they have open ends immediately.`,
      { title: `Remove admin access from ${admin.name}?`, confirmLabel: 'Remove admin access', danger: true },
    );
    if (!ok) return;
    setAdminBusyId(admin.id);
    try {
      const res = await opFetch(
        `${API_URL}/api/platform/schools/${school.id}/admins/${admin.id}/demote`,
        { method: 'PUT' },
      );
      const data = await res.json().catch(() => null);
      if (!data?.success) return showAlert(data?.error || 'That did not work.');
      await refreshAdmins(school.id);
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setAdminBusyId(null);
    }
  };

  /**
   * ── Operators ──
   *
   * Peers, exactly like a school's admins: any operator may add, reset or
   * remove any other. There is no tier above this one — that is what being the
   * platform operator means — so the only guards are the two that stop the
   * platform locking itself out: nobody acts on their own account here, and the
   * last operator cannot be removed.
   */
  const loadOperators = useCallback(async () => {
    if (!key) return;
    setOperatorsLoading(true);
    try {
      const res = await opFetch(`${API_URL}/api/platform/operators`);
      const data = await res.json().catch(() => null);
      if (data?.success) setOperators(data.operators || []);
      else setError(data?.error || 'Could not load operators.');
    } catch {
      setError('Network error. Is the API reachable?');
    } finally {
      setOperatorsLoading(false);
    }
  }, [key, opFetch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- same shape as the two loads above
  useEffect(() => { if (view === 'operators') loadOperators(); }, [view, loadOperators]);

  const addOperator = async (e) => {
    e.preventDefault();
    if (opSaving) return;
    setOpSaving(true);
    setError('');
    try {
      const res = await opFetch(`${API_URL}/api/platform/operators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOperator),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) return showAlert(data?.error || 'The operator was not created.');
      // Shown once, like every other password on this screen: nothing stores
      // the plaintext and no mail is sent.
      setOpDone({ name: newOperator.name, email: newOperator.email, password: newOperator.password });
      setShowAddOperator(false);
      setNewOperator({ name: '', email: '', password: '' });
      await loadOperators();
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setOpSaving(false);
    }
  };

  const resetOperatorPassword = async (target) => {
    const password = generatePassword(12);
    const ok = await showConfirm(
      `${target.name} will need this new password to sign in, and any session they have open ends now.`,
      { title: `Reset ${target.name}'s password?`, confirmLabel: 'Reset password' },
    );
    if (!ok) return;
    setOpBusyId(target.id);
    try {
      const res = await opFetch(`${API_URL}/api/platform/operators/${target.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) return showAlert(data?.error || 'The password was not changed.');
      setOpDone({ name: target.name, email: target.email, password });
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setOpBusyId(null);
    }
  };

  /**
   * Change your own password.
   *
   * Goes to /api/auth/change-password, the same route every school account
   * uses — it works off the session's own id and asks for the current password,
   * so it needs no platform-specific handling. The operator reset route refuses
   * to act on yourself precisely so this check cannot be skipped.
   *
   * The session is re-issued rather than kept: the server revokes every session
   * for the account on a password change, which would otherwise sign the
   * operator out of the tab they are standing in.
   */
  const changeMyPassword = async (e) => {
    e.preventDefault();
    if (myPwSaving) return;
    setMyPwSaving(true);
    setMyPwError('');
    try {
      const res = await opFetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(myPassword),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) return setMyPwError(data?.error || 'The password was not changed.');
      if (data.token) {
        sessionStorage.setItem(TOKEN_STORAGE, data.token);
        setKey(data.token);
      } else {
        // No fresh token came back, so the session this tab holds has just been
        // revoked. Signing out is the honest outcome — better than leaving a
        // console whose next request will fail with no explanation.
        signOut();
      }
      setShowMyPassword(false);
      setMyPassword({ currentPassword: '', newPassword: '' });
      showAlert('Your password has been changed.');
    } catch {
      setMyPwError('Network error. Is the API reachable?');
    } finally {
      setMyPwSaving(false);
    }
  };

  const removeOperator = async (target) => {
    const ok = await showConfirm(
      `${target.name} loses access to the platform console immediately. Their account is deleted — `
      + 'operator accounts own no school data, so nothing else goes with it.',
      { title: `Remove operator ${target.name}?`, confirmLabel: 'Remove operator', danger: true },
    );
    if (!ok) return;
    setOpBusyId(target.id);
    try {
      const res = await opFetch(`${API_URL}/api/platform/operators/${target.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!data?.success) return showAlert(data?.error || 'That did not work.');
      await loadOperators();
    } catch {
      showAlert('Network error. Is the API reachable?');
    } finally {
      setOpBusyId(null);
    }
  };

  /** Schools narrowed by the search box - name, school code or DepEd ID, since
   *  an operator is usually reading one of the three off a support message. */
  const adminQ = adminQuery.trim().toLowerCase();
  const filteredAdminSchools = !adminQ ? adminSchools : adminSchools.filter(s =>
    (s.name || '').toLowerCase().includes(adminQ)
    || (s.slug || '').toLowerCase().includes(adminQ)
    || (s.depedSchoolId || '').includes(adminQ));

  if (!key) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        {/* An account, not a shared key. The old form asked for
            PLATFORM_ADMIN_KEY — one secret the whole team typed, which could
            not say who was using it, be revoked for one person, or expire. */}
        <form onSubmit={handleLogin}
          className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="w-11 h-11 rounded-xl bg-ink-900 text-white grid place-items-center mb-4">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">Platform console</h1>
          <p className="text-sm text-slate-500 mb-5">
            TulongGuro operators only. Sign in with your operator account.
          </p>

          <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="op-email">Email</label>
          <input
            id="op-email"
            type="email"
            autoFocus
            autoComplete="username"
            value={loginForm.email}
            onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3"
          />

          <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="op-password">Password</label>
          <input
            id="op-password"
            type="password"
            autoComplete="current-password"
            value={loginForm.password}
            onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3"
          />

          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <button type="submit" disabled={!loginForm.email.trim() || !loginForm.password || loggingIn}
            className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800 disabled:opacity-40">
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </button>

          {/* The bootstrap, named on the screen where it is needed. Without it
              the first person to open this page has no way to find out how an
              operator account comes to exist. */}
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            No operator account yet? Create the first one from the server:
            <code className="block mt-1 font-mono text-slate-500 break-all">
              node scripts/create-platform-operator.js &quot;Your Name&quot; you@example.com
            </code>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* The header names the authority rather than the task, now that there
            is more than one task. An operator holding this key is the platform
            super admin - the only super admin the system has since the per-school
            tier was removed - and the screen should say so, because the powers
            below only make sense in that light. */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 shrink-0" /> Platform console
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              TulongGuro operators. Approve schools, and manage admin accounts across every school.
            </p>
          </div>
          {/* Who is signed in, said plainly. Every action on this screen is now
              recorded under this name, and an operator should be able to see
              which account they are acting as before they act. */}
          <div className="shrink-0 mt-1 text-right">
            {operator && (
              <p className="text-xs font-bold text-slate-700 truncate max-w-[12rem]">{operator.name}</p>
            )}
            <button onClick={signOut}
              className="mt-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50">
              Sign out
            </button>
          </div>
        </div>

        {/* Segmented switch rather than links: there is no router behind this
            page, and the two views share the key, the error banner and the
            school data underneath them. */}
        <div className="inline-flex p-1 rounded-xl bg-white border border-slate-200 mb-5">
          {VIEWS.map(({ key: v, label, Icon }) => (
            <button
              key={v}
              onClick={() => { setView(v); setError(''); }}
              className={cn(
                'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors',
                view === v ? 'bg-ink-900 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {view === 'approvals' && (<>
        <div className="flex items-center gap-2 mb-5">
          {/* Switching tabs drops any ticks: those ids are about to leave the
              screen, and a selection you cannot see is one you cannot check
              before pressing delete. */}
          {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map(s => (
            <button key={s} onClick={() => { setStatus(s); setSelected(new Set()); setExpanded(new Set()); }}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                status === s ? 'bg-ink-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')}>
              {s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
          {/* Opening every row at once is for reading the whole list â€” comparing
              contacts or IPs across schools â€” rather than deciding on one. */}
          {schools.length > 0 && (
            <button onClick={() => setExpanded(allExpanded ? new Set() : new Set(schools.map(s => s.id)))}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50">
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
          <button onClick={load} title="Refresh"
            className={cn('p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50',
              schools.length === 0 && 'ml-auto')}>
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
              <p className="font-bold">No DepEd masterlist installed â€” nothing below was verified automatically.</p>
              <p className="text-xs mt-0.5">
                Import it on the server with{' '}
                <code className="font-mono bg-amber-100 px-1 rounded">node scripts/import-deped-masterlist.js &lt;masterlist.xlsx&gt;</code>{' '}
                and restart, then new registrations get checked against it.
              </p>
            </div>
          </div>
        )}

        {/* â”€â”€ Bulk actions, Rejected tab only â”€â”€
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
                onClick={() => deleteSchools([...selected], deletableNoun(selected.size))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete selected
              </button>

              <button type="button" disabled={isDeleting}
                onClick={() => deleteSchools(schools.map(s => s.id), deletableNoun(schools.length))}
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
              const isOpen = expanded.has(s.id);
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
                      {/* â”€â”€ The row you scan â”€â”€
                          Name, verdict and DepEd ID are what tell two schools
                          apart, so they stay on screen in both states; the whole
                          strip is the toggle, since a 4px chevron is a poor
                          target on a list this long. */}
                      <button type="button" onClick={() => toggleExpanded(s.id)}
                        aria-expanded={isOpen} aria-controls={`school-details-${s.id}`}
                        className="w-full text-left group">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ChevronDown className={cn(
                            'w-4 h-4 shrink-0 text-slate-400 transition-transform group-hover:text-slate-700',
                            !isOpen && '-rotate-90',
                          )} />
                          <p className="font-bold text-slate-900 group-hover:text-slate-700">{s.name}</p>
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_STYLES[s.status])}>
                            {s.status}
                          </span>
                          {verdict && (
                            <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full', verdict.cls)}>
                              <verdict.Icon className="w-3 h-3" /> {verdict.label}
                            </span>
                          )}
                          {/* Collapsed, the ID rides on the name row. Open, it
                              heads the block below with what the lookup found. */}
                          {!isOpen && s.depedSchoolId && (
                            <span className="font-mono text-xs font-bold text-slate-500">
                              DepEd ID {s.depedSchoolId}
                            </span>
                          )}
                        </div>
                        {/* Said on the collapsed row rather than left blank: a
                            registration with no ID at all is the case an
                            operator most needs to notice before opening it. */}
                        {!isOpen && !s.depedSchoolId && (
                          <p className="ml-6 mt-0.5 text-xs text-slate-400 font-semibold">No DepEd ID given</p>
                        )}
                      </button>

                      <div id={`school-details-${s.id}`} hidden={!isOpen} className="ml-6">
                        {/* â”€â”€ What was checked â”€â”€
                            The note is what the lookup found at the moment this
                            school registered, not a re-check now: the masterlist
                            file is replaced whenever DepEd publishes a new one. */}
                        {/* The code this registration is CLAIMING, which is not
                            the same as one it owns: several pending schools may
                            ask for `sjes-sanj` at once and approving one settles
                            it against the others. An operator deciding between
                            two similar names needs to see that they collide
                            before they approve one of them, not after. */}
                        <div className="mt-2 text-xs">
                          {s.slug ? (
                            <p className="text-slate-600">
                              School code <span className="font-mono font-bold text-slate-800">{s.slug}</span>
                              {s.status === 'PENDING' && <span className="text-slate-400"> · claimed, not yet owned</span>}
                            </p>
                          ) : (
                            /* Registered before codes existed. Not a fault, and
                               not something to chase — it falls back to the
                               legacy flat login domains. */
                            <p className="text-slate-400 font-mono">no school code</p>
                          )}
                        </div>
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

                          {/* The logo the registrant uploaded, shown as itself
                              rather than as a link that says "logo". It is the
                              one piece of evidence here an operator can judge at
                              a glance — a school seal against a stock photo —
                              and a thumbnail answers that without a click. A
                              plain <a>, unlike the registrant ID: the logo lives
                              in the public bucket, so there is no signed link to
                              mint and nothing here that expires. */}
                          {s.logoUrl && (
                            <a href={s.logoUrl} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-lg bg-slate-100 text-xs font-bold text-slate-700 hover:bg-slate-200">
                              <img src={s.logoUrl} alt=""
                                className="w-5 h-5 rounded object-cover bg-white shrink-0" />
                              View logo
                              {/* Consent is a separate question from having the
                                  file. Operators review either way; the school
                                  only agreed to have it DISPLAYED if this is
                                  set, so the absence is worth saying out loud
                                  rather than assuming. */}
                              {!s.logoConsentAt && (
                                <span className="font-normal text-amber-700">· no display consent</span>
                              )}
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
                            a prompt to check the division â€” never a reason on its
                            own to refuse. */}
                        {s.similarSchools?.length > 0 && (
                          <div className="flex items-start gap-1.5 mt-2 text-xs text-amber-700">
                            <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <p>
                              Similar to {s.similarSchools.map(d => `"${d.name}"`).join(', ')} â€” check the
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
                          {/* The clock time matters as much as the date here:
                              twenty registrations inside one minute is the
                              flood signature this row exists to surface, and a
                              date alone flattens that into "20 today". */}
                          Registered {new Date(s.createdAt).toLocaleString('en-PH', {
                            day: 'numeric', month: 'short', year: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                          {' Â· '}{s._count?.users ?? 0} account(s)
                          {' Â· '}{s._count?.sections ?? 0} section(s)
                          {' Â· '}{s._count?.curriculums ?? 0} curriculum(s)
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
                        /* Opens the row with it: refusing a school is a decision
                           to make with its details in front of you, not from a
                           name alone. */
                        <button onClick={() => { setRejectingId(s.id); setRejectReason(''); setExpanded(prev => new Set(prev).add(s.id)); }} disabled={busyId === s.id}
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
                        Reason â€” the school sees this when they try to sign in
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
        </>)}

        {view === 'admins' && (<>
          <div className="flex items-center gap-2 mb-5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={adminQuery}
                onChange={e => setAdminQuery(e.target.value)}
                placeholder="Search by school name, school code or DepEd ID"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <button onClick={loadAdminSchools} title="Refresh"
              className="shrink-0 p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
              <RefreshCw className={cn('w-4 h-4', adminsLoading && 'animate-spin')} />
            </button>
          </div>

          {/* Said once, at the top, because it is the thing an operator most
              needs to have straight: these controls reach inside a live school.
              Everything below acts on real people's logins. */}
          <div className="mb-5 flex items-start gap-2 bg-ink-900 text-slate-100 rounded-xl p-3.5 text-sm">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-slate-300" />
            <div>
              <p className="font-bold">You are the super admin for every school here.</p>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                Schools have no super admin of their own - their admins are peers and can remove
                each other. This is the only way back when a school locks itself out. Setting a
                password lets you sign in as that person, so do it on request and tell them what
                you changed.
              </p>
            </div>
          </div>

          {adminsLoading && adminSchools.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : filteredAdminSchools.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <Building2 className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">
                {adminQuery ? 'No school matches that search.' : 'No schools yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAdminSchools.map(s => {
                const rows = adminsBySchool[s.id] || s.users || [];
                const isOpen = openSchoolId === s.id;
                // The last admin cannot be removed, and saying so on the button
                // beats a server refusal after a confirm dialog.
                const isLastAdmin = rows.length <= 1;
                return (
                  <div key={s.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setOpenSchoolId(isOpen ? null : s.id)}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
                    >
                      <ChevronDown className={cn('w-4 h-4 text-slate-400 shrink-0 transition-transform', isOpen && 'rotate-180')} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 truncate">{s.name}</p>
                        <p className="text-xs text-slate-500 truncate font-mono">
                          {s.slug || 'no school code'}
                          {s.depedSchoolId ? ` · DepEd ${s.depedSchoolId}` : ''}
                        </p>
                      </div>
                      <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                        STATUS_STYLES[s.status] || 'bg-slate-200 text-slate-600')}>
                        {s.status}
                      </span>
                      <span className="shrink-0 text-xs font-bold text-slate-500 inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />{rows.length}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-200 divide-y divide-slate-100">
                        {rows.length === 0 ? (
                          /* Reachable, and worth naming rather than showing an
                             empty box: a school in this state cannot add
                             teachers or publish anything and needs a developer
                             to put an admin back. */
                          <p className="p-4 text-sm text-red-600 font-bold">
                            This school has no admin account. Nobody can reach its console.
                          </p>
                        ) : rows.map(a => (
                          <div key={a.id} className="flex items-center gap-3 p-4">
                            <div className="w-9 h-9 rounded-full bg-amber-50 text-amber-700 font-bold flex items-center justify-center shrink-0">
                              {(a.name || 'A').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-900 truncate flex items-center gap-2">
                                <span className="truncate">{a.name}</span>
                                {/* A label, not a power. It says who filled in
                                    the registration form, which helps an
                                    operator decide whose access to restore. */}
                                {a.registeredSchool && (
                                  <span title="Filled in this school's registration"
                                    className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                                    Registered it
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500 truncate font-mono">{a.email || a.username}</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => openSetPassword(s, a)}
                                disabled={adminBusyId === a.id}
                                title="Set a new password"
                                className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30">
                                <KeyRound className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeAdmin(s, a)}
                                disabled={isLastAdmin || adminBusyId === a.id}
                                title={isLastAdmin
                                  ? 'A school must keep at least one admin'
                                  : 'Remove admin access (they stay as a teacher)'}
                                className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 disabled:opacity-30">
                                {adminBusyId === a.id
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : <UserMinus className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Set-password dialog ── */}
          {pwFor && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <form onSubmit={submitPassword} className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg p-6">
                <h2 className="text-base font-bold text-slate-900 mb-1">Set a new password</h2>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  For <strong className="text-slate-700">{pwFor.admin.name}</strong>{' '}
                  ({pwFor.admin.email || pwFor.admin.username}) at {pwFor.school.name}.
                  Their current sessions end immediately.
                </p>
                <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="pw-value">New password</label>
                <div className="flex gap-2 mb-4">
                  <input
                    id="pw-value"
                    value={pwValue}
                    onChange={e => setPwValue(e.target.value)}
                    autoComplete="off"
                    className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <button type="button" onClick={() => setPwValue(generatePassword(12))} title="Generate another"
                    className="shrink-0 px-3 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <PasswordStrength value={pwValue} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPwFor(null)}
                    className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={!!passwordProblem(pwValue.trim()) || pwSaving}
                    className="flex-1 py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800 disabled:opacity-40">
                    {pwSaving ? 'Setting…' : 'Set password'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── The password, once, afterwards ──
              Shown after the change rather than before it, so what is on screen
              is what the account actually has. There is no second chance to
              read it: nothing here stores the plaintext. */}
          {pwDone && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg p-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 grid place-items-center mb-3">
                  <Check className="w-5 h-5" />
                </div>
                <h2 className="text-base font-bold text-slate-900 mb-1">Password set</h2>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Give this to {pwDone.admin.name} now — it is not shown again, and nothing
                  emails it to them.
                </p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-100 mb-4">
                  <code className="flex-1 min-w-0 text-sm font-mono font-bold text-slate-800 break-all">{pwDone.password}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(pwDone.password);
                      setPwCopied(true);
                      setTimeout(() => setPwCopied(false), 1500);
                    }}
                    title="Copy"
                    className="shrink-0 p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
                    {pwCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setPwDone(null)}
                  className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800">
                  Done
                </button>
              </div>
            </div>
          )}
        </>)}

        {view === 'operators' && (<>
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => { setNewOperator({ name: '', email: '', password: generatePassword(12) }); setShowAddOperator(true); }}
              className="px-3.5 py-2 rounded-lg bg-ink-900 text-white text-xs font-bold hover:bg-ink-800">
              Add operator
            </button>
            {/* The other half of the reset control on each row. That one
                refuses your own account on purpose — changing your own password
                has to ask for the current one — so this is where you do it. */}
            <button
              onClick={() => { setMyPassword({ currentPassword: '', newPassword: '' }); setMyPwError(''); setShowMyPassword(true); }}
              className="px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50">
              Change my password
            </button>
            <button onClick={loadOperators} title="Refresh"
              className="ml-auto p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
              <RefreshCw className={cn('w-4 h-4', operatorsLoading && 'animate-spin')} />
            </button>
          </div>

          <div className="mb-5 flex items-start gap-2 bg-ink-900 text-slate-100 rounded-xl p-3.5 text-sm">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-slate-300" />
            <div>
              <p className="font-bold">Everyone here is a peer.</p>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                There is no rank above an operator. Each of you can approve schools, reset any
                school admin&apos;s password, and add or remove each other — so every action is
                recorded under the name of whoever did it. Add only people who should have that
                reach over every school on the platform.
              </p>
            </div>
          </div>

          {operatorsLoading && operators.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {operators.map(o => (
                <div key={o.id} className="flex items-center gap-3 p-4">
                  <div className="w-9 h-9 rounded-full bg-ink-900 text-white font-bold flex items-center justify-center shrink-0">
                    {(o.name || 'O').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate flex items-center gap-2">
                      <span className="truncate">{o.name}</span>
                      {o.isMe && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                          You
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 truncate font-mono">{o.email}</p>
                  </div>
                  {/* Both controls are hidden on your own row rather than
                      disabled: your own password is changed from your account
                      with the current one, and removing yourself is the one way
                      to leave the platform with no operator. */}
                  {!o.isMe && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => resetOperatorPassword(o)} disabled={opBusyId === o.id}
                        title="Reset password"
                        className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30">
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeOperator(o)} disabled={opBusyId === o.id || operators.length <= 1}
                        title={operators.length <= 1 ? 'The last operator cannot be removed' : 'Remove operator'}
                        className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 disabled:opacity-30">
                        {opBusyId === o.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showMyPassword && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <form onSubmit={changeMyPassword} className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg p-6">
                <h2 className="text-base font-bold text-slate-900 mb-1">Change your password</h2>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Signing in as <span className="font-mono">{operator?.email}</span>. Do this
                  as soon as you have been given a generated password — a credential somebody
                  read out to you should not stay in use.
                </p>

                <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="cur-pw">Current password</label>
                <input id="cur-pw" type="password" required autoComplete="current-password"
                  value={myPassword.currentPassword}
                  onChange={e => setMyPassword({ ...myPassword, currentPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3" />

                <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="new-pw">New password</label>
                <input id="new-pw" type="password" required autoComplete="new-password"
                  value={myPassword.newPassword}
                  onChange={e => setMyPassword({ ...myPassword, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3" />

                <PasswordStrength value={myPassword.newPassword} className="mb-3" />

                {myPwError && <p className="text-xs text-red-600 mb-3">{myPwError}</p>}

                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowMyPassword(false)}
                    className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={myPwSaving || !!passwordProblem(myPassword.newPassword)}
                    className="flex-1 py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800 disabled:opacity-40">
                    {myPwSaving ? 'Changing…' : 'Change password'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {showAddOperator && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <form onSubmit={addOperator} className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg p-6">
                <h2 className="text-base font-bold text-slate-900 mb-1">Add an operator</h2>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  They will be able to approve schools and reset any school admin&apos;s password.
                </p>

                <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="new-op-name">Full name</label>
                <input id="new-op-name" required value={newOperator.name}
                  onChange={e => setNewOperator({ ...newOperator, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3" />

                <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="new-op-email">Email</label>
                <input id="new-op-email" type="email" required autoComplete="off" value={newOperator.email}
                  onChange={e => setNewOperator({ ...newOperator, email: e.target.value })}
                  placeholder="name@tulongguro.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3" />

                <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="new-op-pw">Password</label>
                <div className="flex gap-2 mb-4">
                  <input id="new-op-pw" required value={newOperator.password} autoComplete="off"
                    onChange={e => setNewOperator({ ...newOperator, password: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-slate-900" />
                  <button type="button" onClick={() => setNewOperator({ ...newOperator, password: generatePassword(12) })}
                    title="Generate another"
                    className="shrink-0 px-3 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <PasswordStrength value={newOperator.password} />

                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAddOperator(false)}
                    className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={opSaving || !!passwordProblem(newOperator.password.trim())}
                    className="flex-1 py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800 disabled:opacity-40">
                    {opSaving ? 'Adding…' : 'Add operator'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {opDone && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg p-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 grid place-items-center mb-3">
                  <Check className="w-5 h-5" />
                </div>
                <h2 className="text-base font-bold text-slate-900 mb-1">Password for {opDone.name}</h2>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Give this to them now — it is not shown again, and nothing emails it.
                  They sign in at this page with <span className="font-mono">{opDone.email}</span>.
                </p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-100 mb-4">
                  <code className="flex-1 min-w-0 text-sm font-mono font-bold text-slate-800 break-all">{opDone.password}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(opDone.password);
                      setOpCopied(true);
                      setTimeout(() => setOpCopied(false), 1500);
                    }}
                    title="Copy"
                    className="shrink-0 p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
                    {opCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setOpDone(null)}
                  className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800">
                  Done
                </button>
              </div>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}
