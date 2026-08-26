import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Loader2, Trash2, KeyRound, X, Copy, Check, GraduationCap, BookOpen, ClipboardList, ChevronRight, Search } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR } from '../../constants/school';
import { TEACHER_EMAIL_DOMAIN, buildAccountEmail } from '../../constants/accountEmails';
import DomainEmailField from '../../components/DomainEmailField';
import TeacherHandover from '../../components/TeacherHandover';
import RosterEditor from '../../components/RosterEditor';
import SectionMoveConfirm from '../../components/SectionMoveConfirm';
import StudentCredentials from '../../components/StudentCredentials';
import {
  rowsFromExtraction, isFilledRow, rosterPayload, emptyRoster, withBlankRow,
} from '../../utils/roster';

import { showAlert, showConfirm } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** Temporary password the admin hands to the teacher on first login. */
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function AdminTeachers() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busyTeacherId, setBusyTeacherId] = useState(null);
  const [teacherQuery, setTeacherQuery] = useState('');
  // The teacher being removed, once it is clear their work has to go somewhere:
  // { teacher, reason }. `reason` is the server's own refusal text when it was
  // the server that raised the question, and null when the roster counts on
  // screen were enough to know in advance.
  const [handover, setHandover] = useState(null);

  // ── Creating a block section ──
  // This used to be a teacher screen. It sits here because a section is a
  // school-wide fact — one adviser, one roster, shared by every colleague who
  // teaches that block — and because the adviser has to be *chosen* rather
  // than inferred from whoever happened to type the names in.
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [sectionForm, setSectionForm] = useState({ name: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR, teacherId: '' });
  const [sectionRows, setSectionRows] = useState(emptyRoster);
  const [isSavingSection, setIsSavingSection] = useState(false);
  const [sectionError, setSectionError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const rosterFileRef = useRef(null);
  // Sign-in details for the accounts just created, and the plain summary line.
  // Shown once or never — a generated password cannot be recovered.
  const [newAccounts, setNewAccounts] = useState([]);
  const [notice, setNotice] = useState('');
  // Set when the server left names alone because they are enrolled elsewhere.
  // Holds the new section's id, because the replay goes to the roster endpoint
  // rather than back through create — see the note on the section route.
  const [moveRequest, setMoveRequest] = useState(null);

  const load = useCallback(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/overview`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [admin.id]);

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
    // form.email holds only the part before the @; the domain is fixed by the
    // role and added here, which is also what gets handed over as the login.
    const teacherEmail = buildAccountEmail(form.email, 'TEACHER');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, email: teacherEmail })
      });
      const d = await res.json();
      if (d.success) {
        setCreatedCredentials({ email: teacherEmail, password: form.password });
        setShowForm(false);
        load();
      } else {
        setError(d.error || 'Could not create the account.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const openSectionForm = () => {
    setSectionForm({
      name: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR,
      // Pre-selected when there is exactly one teacher, since there is no
      // choice to make — but never guessed at when there is.
      teacherId: (data?.teachers || []).length === 1 ? data.teachers[0].id : '',
    });
    setSectionRows(emptyRoster());
    setSectionError('');
    setShowSectionForm(true);
  };

  /**
   * Create the section, and enrol whatever names were typed with it.
   *
   * The roster is optional: naming the block and typing forty learners are
   * different jobs and an admin may well do them a week apart. What is not
   * optional is the adviser — the server refuses without one, and the form
   * marks it required so that refusal never has to be seen.
   */
  const createSection = async () => {
    if (isSavingSection) return;              // guards an impatient second click
    const name = sectionForm.name.trim();
    if (!name) return setSectionError('Please give this section a name — for example "Grade 6 - Sampaguita".');
    if (!sectionForm.teacherId) return setSectionError('Choose the teacher who will advise this section.');
    // Returns null once the admin has been asked to fix an unreadable birthday.
    const studentsList = rosterPayload(sectionRows, showAlert);
    if (!studentsList) return;

    setIsSavingSection(true);
    setSectionError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sectionForm, name, studentsList }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        // Kept in the form rather than raised as a page banner: the usual
        // refusal is "that name is already taken", which is only actionable
        // while looking at the field you would change.
        setSectionError(d?.error || 'That section could not be created.');
        return;
      }
      setNewAccounts(d.createdStudents || []);
      setNotice(d.message);
      load();
      if (d.pendingMoves?.length) {
        // The section exists now, so the confirm-and-replay goes to its roster
        // by id. Sending the same create request again would hit the
        // name-already-exists refusal, not retry the enrolment.
        setMoveRequest({ section: d.section, studentsList, moves: d.pendingMoves });
      } else {
        setShowSectionForm(false);
      }
    } catch {
      setSectionError('Network error. Please try again.');
    } finally {
      setIsSavingSection(false);
    }
  };

  /** The admin confirmed the moves — replay the same roster against the new section. */
  const confirmMoves = async () => {
    const req = moveRequest;
    if (!req) return;
    setIsSavingSection(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/sections/${req.section.id}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentsList: req.studentsList, allowMove: true }),
      });
      const d = await res.json().catch(() => null);
      if (d?.success) {
        // Appended, not replaced: the first pass generated passwords that
        // cannot be recovered, and this pass reports only the moves.
        setNewAccounts(prev => [...prev, ...(d.createdStudents || [])]);
        setNotice(d.message);
        load();
      } else {
        showAlert(d?.error || 'Those learners could not be moved.', { variant: 'error' });
      }
    } catch {
      showAlert('Could not reach the server. Nothing was moved.', { variant: 'error' });
    } finally {
      setIsSavingSection(false);
      setMoveRequest(null);
      setShowSectionForm(false);
    }
  };

  /** Auto-fill the roster from a spreadsheet or a photo of one. */
  const handleRosterFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtracting(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/extract-students`, { method: 'POST', body: formData });
      const d = await res.json().catch(() => null);
      const extracted = d?.success ? rowsFromExtraction(d) : [];
      if (extracted.length) {
        // Appended to whatever is already typed, so an upload adds to the list
        // rather than replacing work already done.
        setSectionRows(prev => withBlankRow([...prev.filter(isFilledRow), ...extracted]));
      } else {
        setSectionError(d?.error || 'No learners were found in that file.');
      }
    } catch {
      setSectionError('Network error while reading the file.');
    } finally {
      setIsExtracting(false);
      e.target.value = '';   // so picking the same file again still fires
    }
  };

  const handleResetPassword = async (teacher) => {
    const password = generatePassword();
    if (!(await showConfirm(`Reset ${teacher.name}'s password? Their current one stops working immediately.`,
      { confirmLabel: 'Reset password', danger: true }))) return;
    setBusyTeacherId(teacher.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/teachers/${teacher.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const d = await res.json().catch(() => null);
      // Checked against the status too: a 500 that returns an HTML error page
      // parses to null, which `d.success` alone would read as a plain failure
      // with no message.
      if (res.ok && d?.success) setCreatedCredentials({ email: teacher.email, password });
      else showAlert(d?.error || 'Reset failed. Their existing password still works.');
    } catch {
      // Without this the promise rejected unhandled: the spinner cleared and
      // the admin was told nothing at all, having just been asked to confirm
      // something destructive.
      showAlert('Could not reach the server. Their password has not been changed.');
    } finally {
      setBusyTeacherId(null);
    }
  };

  /**
   * The removal request itself, with or without a successor.
   *
   * Shared by both entry points below so there is exactly one place that knows
   * what a refusal means and what a hand-over reports back.
   */
  const removeTeacher = async (teacher, successorId = null) => {
    setBusyTeacherId(teacher.id);
    try {
      const url = `${API_URL}/api/admin/${admin.id}/teachers/${teacher.id}`
        + (successorId ? `?reassignTo=${encodeURIComponent(successorId)}` : '');
      const res = await apiFetch(url, { method: 'DELETE' });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) {
        setHandover(null);
        load();
        const moved = d.handedOver;
        if (moved) {
          // Named counts rather than "done": the admin has just agreed to move
          // a year's work between two people and is entitled to see it arrive.
          showAlert(
            `${teacher.name} has been removed. ${moved.to.name} now has `
            + `${moved.classes} class${moved.classes === 1 ? '' : 'es'}, `
            + `${moved.sections} block section${moved.sections === 1 ? '' : 's'} and `
            + `${moved.students} learner account${moved.students === 1 ? '' : 's'} from them. `
            + 'Every activity, score and comment moved with the classes.',
            { variant: 'success' }
          );
        }
        return;
      }
      // The server refuses rather than destroy student work, and says what is in
      // the way — that message is the whole point of the guard, so it must not
      // be swallowed. When the work could be handed over instead, the refusal
      // opens the picker rather than ending the attempt.
      if (d?.code === 'HANDOVER_REQUIRED') {
        setHandover({ teacher, reason: d.error });
        return;
      }
      showAlert(d?.error || 'Could not remove this teacher. Nothing has been changed.', { variant: 'error' });
    } catch {
      showAlert('Could not reach the server. This teacher has not been removed.', { variant: 'error' });
    } finally {
      setBusyTeacherId(null);
    }
  };

  const handleDelete = async (teacher) => {
    // Asked here rather than after a round trip whenever the counts already on
    // screen say the account owns something. The server checks again — these
    // counts can be minutes stale, and a plain delete is refused on its own
    // merits — but a teacher with a full timetable should not have to be told
    // "no" once before being offered the thing they actually wanted.
    if ((teacher._count?.taughtClasses || 0) > 0 || (teacher._count?.ownedSections || 0) > 0) {
      setHandover({ teacher, reason: null });
      return;
    }
    if (!(await showConfirm(`Remove ${teacher.name} from ${data?.school?.name}? This cannot be undone.`,
      { confirmLabel: 'Remove teacher', danger: true }))) return;
    await removeTeacher(teacher);
  };

  const copyCredentials = () => {
    navigator.clipboard?.writeText(`Email: ${createdCredentials.email}\nTemporary password: ${createdCredentials.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading school...</div>;
  }

  const allTeachers = data?.teachers || [];
  const sections = data?.sections || [];

  // Name/email search — a school with many staff is unusable without it.
  const q = teacherQuery.trim().toLowerCase();
  const teachers = q
    ? allTeachers.filter(t =>
        t.name.toLowerCase().includes(q) || (t.email || '').toLowerCase().includes(q))
    : allTeachers;

  // Sections are segmented by grade level across the whole school.
  const sectionsByGrade = sections.reduce((acc, s) => {
    const key = s.gradeLevel || 'Unassigned grade level';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});
  // Ordered by the canonical grade list, the same way the teacher-side Block Sections list
  // does it — a plain sort puts "Grade 10" between "Grade 1" and "Grade 2".
  const gradeOrder = [...GRADE_LEVELS, 'Unassigned grade level'];
  const gradeKeys = Object.keys(sectionsByGrade)
    .sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">{data?.school?.name || 'Your School'}</h1>
          <p className="text-slate-500 text-sm">Manage the teacher accounts for your school</p>
        </div>
        <button onClick={openForm}
          className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Add Teacher
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Teachers', value: allTeachers.length, icon: Users },
          { label: 'Sections', value: sections.length, icon: GraduationCap },
          { label: 'Curriculums', value: (data?.curriculums || []).length, icon: BookOpen },
          { label: 'School Rubrics', value: data?.rubricCount || 0, icon: ClipboardList },
        ].map(tile => (
          <div key={tile.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <tile.icon className="w-5 h-5 text-slate-300 mb-2" />
            <p className="text-2xl font-extrabold text-brand-slate">{tile.value}</p>
            <p className="text-xs text-slate-500 font-medium">{tile.label}</p>
          </div>
        ))}
      </div>

      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-xl p-3 mb-4 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss" className="text-blue-400 hover:text-blue-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Student sign-in details for accounts just created, shown once. */}
      <StudentCredentials students={newAccounts} onClose={() => setNewAccounts([])} />

      <SectionMoveConfirm
        moves={moveRequest?.moves}
        targetSection={moveRequest?.section?.name}
        busy={isSavingSection}
        onConfirm={confirmMoves}
        onCancel={() => { setMoveRequest(null); setShowSectionForm(false); }}
      />

      {/* Credentials handoff */}
      {createdCredentials && (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-green-800 mb-1">Account ready — share these once</p>
              <p className="text-xs text-green-700 mb-3">
                The teacher signs in from the normal login page using the Teacher tab. This is the only time
                the password is shown.
              </p>
              <div className="bg-white border border-green-200 rounded-lg p-3 font-mono text-sm space-y-1">
                <p className="text-slate-600 break-all">Email: <span className="font-bold text-brand-slate">{createdCredentials.email}</span></p>
                <p className="text-slate-600">Password: <span className="font-bold text-brand-slate">{createdCredentials.password}</span></p>
              </div>
            </div>
            <button onClick={() => setCreatedCredentials(null)} className="text-green-500 hover:text-green-700 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <button onClick={copyCredentials}
            className="mt-3 text-xs font-bold text-green-700 bg-white border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 flex items-center gap-1.5">
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </button>
        </div>
      )}

      {/* Teacher list */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Teachers</h2>
        {allTeachers.length > 0 && (
          <div className="relative sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={teacherQuery}
              onChange={e => setTeacherQuery(e.target.value)}
              placeholder="Search by name or email..."
              aria-label="Search teachers"
              className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy bg-white"
            />
            {teacherQuery && (
              <button type="button" onClick={() => setTeacherQuery('')} aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
      {allTeachers.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No teacher accounts yet</p>
          <p className="text-sm mt-1">Add one to get your school started.</p>
        </div>
      ) : teachers.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No teacher matches &ldquo;{teacherQuery}&rdquo;</p>
          <p className="text-sm mt-1">Try a different name or email.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {teachers.map(t => (
            <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 hover:border-brand-navy hover:shadow-sm transition-all">
              <Link to={`/admin/teachers/${t.id}`} className="flex items-center gap-4 flex-1 min-w-0 group">
                <div className="w-10 h-10 rounded-full bg-blue-50 text-brand-navy font-bold flex items-center justify-center shrink-0">
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-slate truncate group-hover:text-brand-navy">{t.name}</p>
                  <p className="text-xs text-slate-500 truncate">{t.email}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {t._count?.taughtClasses || 0} class(es) · {t._count?.ownedSections || 0} section(s)
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-navy transition-colors shrink-0" />
              </Link>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => handleResetPassword(t)} disabled={busyTeacherId === t.id}
                  title="Reset password"
                  className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40">
                  <KeyRound className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(t)} disabled={busyTeacherId === t.id}
                  title="Remove teacher"
                  className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 disabled:opacity-40">
                  {busyTeacherId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* School sections, segmented by grade level */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Sections by grade level</h2>
        <button
          onClick={openSectionForm}
          disabled={allTeachers.length === 0}
          title={allTeachers.length === 0 ? 'Add a teacher first — every section needs an adviser' : 'Create a block section'}
          className="self-start sm:self-auto bg-brand-navy text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-blue-900 shadow-sm flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-brand-navy"
        >
          <Plus className="w-3.5 h-3.5" /> Add Section
        </button>
      </div>
      {sections.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <p className="text-sm font-medium">No sections yet</p>
          <p className="text-xs mt-1">
            {allTeachers.length === 0
              ? 'Add a teacher first — every section needs an adviser.'
              : 'Use "Add Section" above to create one and name its adviser.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {gradeKeys.map(grade => (
            <div key={grade}>
              <p className="text-xs font-bold text-brand-navy bg-blue-50 inline-block px-2.5 py-1 rounded-full mb-2">{grade}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sectionsByGrade[grade].map(s => (
                  <Link key={s.id} to={`/admin/sections/${s.id}`}
                    className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2 hover:border-brand-navy hover:shadow-sm transition-all group">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-slate text-sm truncate group-hover:text-brand-navy">{s.name}</p>
                      <p className="text-xs text-slate-400 truncate">Adviser: {s.teacher?.name || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                        {s._count?.students || 0} students
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-navy transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add teacher modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Add a teacher</h2>
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
                id="new-teacher-email"
                role="TEACHER"
                value={form.email}
                onChange={email => setForm({ ...form, email })}
                hint={`Teacher accounts always sign in on @${TEACHER_EMAIL_DOMAIN} — you only choose the name.`}
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

      {/* Add section modal */}
      {showSectionForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Create a block section</h2>
            <p className="text-slate-500 text-sm mb-5">
              A homeroom group with one adviser. Every teacher in the school can teach a subject into it.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); createSection(); }} className="space-y-5" autoComplete="off">
              {/* Two columns, separated and numbered: naming the section and
                  listing forty learners are different jobs, and running them
                  together down one page made the roster box look like one more
                  field on the same form. Stacks on a narrow screen, where a
                  divider would be meaningless. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4 lg:border-r lg:border-slate-200 lg:pr-6">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-brand-navy">
                    Step 1 · About the section
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Section name *</label>
                    <input required type="text" value={sectionForm.name} autoComplete="off"
                      onChange={e => setSectionForm({ ...sectionForm, name: e.target.value })}
                      placeholder="e.g. Grade 6 - Sampaguita"
                      className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Adviser *</label>
                    <select required value={sectionForm.teacherId}
                      onChange={e => setSectionForm({ ...sectionForm, teacherId: e.target.value })}
                      className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                      <option value="">-- Choose a teacher --</option>
                      {allTeachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">
                      The homeroom teacher responsible for this block. You can change it later from the section page.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Grade level</label>
                      <select value={sectionForm.gradeLevel}
                        onChange={e => setSectionForm({ ...sectionForm, gradeLevel: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                        <option value="">-- Select --</option>
                        {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">School year *</label>
                      <select required value={sectionForm.schoolYear}
                        onChange={e => setSectionForm({ ...sectionForm, schoolYear: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                        {SCHOOL_YEARS.map(sy => <option key={sy} value={sy}>{sy}</option>)}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Section names have to be unique within a school year, so next June's intake gets its own
                    roster rather than joining this year's.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-brand-navy">
                    Step 2 · Who is in it <span className="font-semibold normal-case tracking-normal text-slate-400">(optional)</span>
                  </p>
                  <RosterEditor
                    rows={sectionRows}
                    onChange={setSectionRows}
                    onPickFile={() => rosterFileRef.current?.click()}
                    isExtracting={isExtracting}
                    fileRef={rosterFileRef}
                    onFileChange={handleRosterFile}
                  />
                  <p className="text-[11px] text-slate-400">
                    Leave this empty to create the section on its own — you can add learners from the section
                    page at any time. Anyone already enrolled elsewhere is listed for you to confirm before
                    being moved.
                  </p>
                </div>
              </div>

              {sectionError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{sectionError}</p>}

              <div className="flex gap-2">
                <button type="button" onClick={() => setShowSectionForm(false)} disabled={isSavingSection}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">Cancel</button>
                <button type="submit" disabled={isSavingSection}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSavingSection ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSavingSection ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Section'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asked instead of refusing. See TeacherHandover for why the refusal
          became a question. Colleagues exclude the account being removed —
          handing a teacher their own work is the one answer that cannot help. */}
      {handover && (
        <TeacherHandover
          teacher={handover.teacher}
          reason={handover.reason}
          colleagues={(data?.teachers || []).filter(t => t.id !== handover.teacher.id)}
          busy={busyTeacherId === handover.teacher.id}
          onCancel={() => setHandover(null)}
          onConfirm={(successorId) => removeTeacher(handover.teacher, successorId)}
        />
      )}
    </div>
  );
}
