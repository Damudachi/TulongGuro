import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRightLeft, Loader2, Pencil, Trash2, Check, X, KeyRound, UserPlus,
  BookOpen, Users, GraduationCap, AlertTriangle, Copy, Plus, Sparkles, ChevronDown,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS, SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR, formatSectionName } from '../../constants/school';
import StudentCredentials from '../../components/StudentCredentials';
import SectionMoveConfirm from '../../components/SectionMoveConfirm';
import RosterSearch from '../../components/RosterSearch';
import RosterEditor from '../../components/RosterEditor';
import {
  rowsFromExtraction, isFilledRow, rosterPayload, emptyRoster, withBlankRow,
  matchesRosterQuery, sortRosterByName,
} from '../../utils/roster';

import { showAlert, showConfirm } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Hand a course shell to a colleague.
 *
 * This was a lone cog, which is what a settings control looks like — nobody
 * reads "gear beside a person" as "give this class to someone else", and the
 * only way to find out was to press it. People plus the same left-right arrows
 * the roster already uses for moving a learner between sections: one mark for
 * transfer, used in both places it means transfer.
 */
function HandoverIcon() {
  return (
    <span className="relative inline-grid place-items-center w-4 h-4" aria-hidden="true">
      <Users className="w-4 h-4" />
      <ArrowRightLeft className="absolute -bottom-1.5 -right-1.5 w-2.5 h-2.5" strokeWidth={3.5} />
    </span>
  );
}

/**
 * The school curriculum published for a subject and grade level, if there is
 * one.
 *
 * A plain function rather than a value computed in the component body, because
 * both the form that offers it and the submit that sends its id need the same
 * answer — and the submit runs from a closure that must not depend on where in
 * the render a `const` happened to be declared.
 */
function curriculumFor(curriculums, subject, gradeLevel) {
  if (!subject || !gradeLevel) return null;
  return (curriculums || []).find(c => c.subject === subject && c.gradeLevel === gradeLevel) || null;
}

/**
 * Admin view of one teacher: their course shells and sections, with the
 * editing the admin needs — rename, add/remove students, delete a shell.
 */
export default function AdminTeacherDetail() {
  const { teacherId } = useParams();
  const navigate = useNavigate();
  const admin = JSON.parse(localStorage.getItem('user') || '{}');

  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '' });
  const [newCredentials, setNewCredentials] = useState(null);

  // ── Creating a course shell for this teacher ──
  // A class used to be something a teacher opened for themselves. Which
  // subject is taught to which block, by whom, is a timetable decision made
  // against the whole school — so it is made here, on the page that already
  // shows everything this teacher carries, and the shell appears on their own
  // dashboard the moment it exists.
  const [showClassForm, setShowClassForm] = useState(false);
  const [classForm, setClassForm] = useState({
    name: '', subject: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR, sectionId: '', useCurriculum: true,
  });
  const [classFormError, setClassFormError] = useState('');

  const [reassignClassId, setReassignClassId] = useState(null);
  const [reassignTo, setReassignTo] = useState('');
  const [editingClassId, setEditingClassId] = useState(null);
  const [classNameForm, setClassNameForm] = useState('');
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionForm, setSectionForm] = useState({ name: '', gradeLevel: '' });
  const [addingToSectionId, setAddingToSectionId] = useState(null);
  // The same roster editor the teacher's own screen uses. This was a textarea
  // of bare names, so every account created from here got a random password —
  // under help text describing the birthday one it could not produce. Held for
  // one section at a time, which is how the form opens.
  const [studentRows, setStudentRows] = useState(emptyRoster);
  const [isExtracting, setIsExtracting] = useState(false);
  const rosterFileRef = useRef(null);
  const [notice, setNotice] = useState('');
  const [newAccounts, setNewAccounts] = useState([]);
  const [moveRequest, setMoveRequest] = useState(null);
  /**
   * One box for every roster on the page, not one per section card.
   *
   * The question an admin actually arrives with here is "which of this
   * teacher's sections is Sophia in" — a search per card answers a question
   * they would have to already know the answer to, and puts four identical
   * inputs on screen to do it.
   */
  const [rosterQuery, setRosterQuery] = useState('');
  /**
   * Which section cards have their roster open.
   *
   * Closed by default. A teacher with four sections of forty put a hundred and
   * sixty names on this page before the admin had said which section they came
   * for, and the section controls — edit, add, delete — were separated from
   * each other by a screenful of roster each time. The cards are the index;
   * the roster is what one of them opens.
   */
  const [openSectionIds, setOpenSectionIds] = useState(() => new Set());
  const toggleSection = (id) => setOpenSectionIds(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  // Reassignment failures (the target teacher already has this shell) are shown
  // where the control is, not only in the page banner far above it.
  const [reassignError, setReassignError] = useState('');

  // The banners live at the top of a page that scrolls well past a screenful,
  // so an error raised by a control near the bottom used to land out of sight —
  // pressing Delete or Move looked like it had simply done nothing.
  const bannerRef = useRef(null);
  useEffect(() => {
    if (error || notice) bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [error, notice]);

  const load = useCallback(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/teachers/${teacherId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d);
        else setError(d.error || 'Could not load this teacher.');
      })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [admin.id, teacherId]);

  useEffect(() => { load(); }, [load]);

  const call = async (url, options, onOk) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(url, options);
      const d = await res.json();
      if (d.success) { onOk?.(d); load(); }
      else setError(d.error || 'That did not work.');
      return d;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = () => call(
    `${API_URL}/api/admin/${admin.id}/teachers/${teacherId}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileForm) },
    () => setEditingProfile(false)
  );

  const resetPassword = async () => {
    const password = generatePassword();
    if (!(await showConfirm(`Reset ${data.teacher.name}'s password? Their current one stops working immediately.`,
      { confirmLabel: 'Reset password', danger: true }))) return;
    await call(
      `${API_URL}/api/admin/${admin.id}/teachers/${teacherId}/password`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) },
      () => setNewCredentials({ email: data.teacher.email, password })
    );
  };

  /**
   * Open the shell form, with the fields that can be inferred filled in.
   *
   * Nothing here is a guess about what should be taught — only about what is
   * tedious to retype. The section, subject and grade level are always the
   * admin's to choose.
   */
  const openClassForm = () => {
    setClassForm({
      name: '', subject: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR, sectionId: '', useCurriculum: true,
    });
    setClassFormError('');
    setShowClassForm(true);
  };

  const createClass = async () => {
    if (busy) return;                       // guards an impatient second click
    if (!classForm.sectionId) return setClassFormError('Choose the block section this class is taught to.');
    if (!classForm.subject || !classForm.gradeLevel) return setClassFormError('Choose a subject and grade level.');
    setClassFormError('');
    setBusy(true);
    const curriculum = curriculumFor(data?.curriculums, classForm.subject, classForm.gradeLevel);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: classForm.name,
          subject: classForm.subject,
          gradeLevel: classForm.gradeLevel,
          schoolYear: classForm.schoolYear,
          sectionId: classForm.sectionId,
          teacherId,
          ...(curriculum && classForm.useCurriculum ? { curriculumId: curriculum.id } : {}),
        }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        // Kept in the form: the usual refusal is "this teacher already has
        // that shell", which is only actionable while looking at the fields
        // that would change it.
        setClassFormError(d?.error || 'That course shell could not be created.');
        return;
      }
      setShowClassForm(false);
      setNotice(
        `"${d.class.name}" is now assigned to ${data.teacher.name} for ${d.class.section?.name || 'the chosen section'}. `
        + (d.appliedLessons
          ? `${d.appliedLessons} lesson${d.appliedLessons === 1 ? '' : 's'} from the school curriculum were applied. `
          : '')
        + 'It appears on their dashboard straight away.'
      );
      load();
    } catch {
      setClassFormError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const deleteClass = async (cls) => {
    if (!(await showConfirm(`Delete the course shell "${cls.name}"? This cannot be undone.`,
      { confirmLabel: 'Delete course shell', danger: true }))) return;
    call(`${API_URL}/api/admin/${admin.id}/classes/${cls.id}`, { method: 'DELETE' });
  };

  const saveClassName = (cls) => call(
    `${API_URL}/api/admin/${admin.id}/classes/${cls.id}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: classNameForm }) },
    () => setEditingClassId(null)
  );

  const reassignClass = async (cls) => {
    if (!reassignTo) return setReassignError('Choose a teacher to move this course shell to.');
    setReassignError('');
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/classes/${cls.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: reassignTo }),
      });
      const d = await res.json();
      if (!d.success) {
        // Kept next to the dropdown: the reason a move was refused is almost
        // always "they already have this shell", which is only actionable while
        // looking at the picker you would change.
        setReassignError(d.error || 'That course shell could not be moved.');
        return;
      }
      setReassignClassId(null);
      setReassignTo('');
      const r = d.retained;
      setNotice(
        `"${d.class.name}" moved to ${d.class.teacher.name}. ` +
        (r ? `${r.activities} activit${r.activities === 1 ? 'y' : 'ies'} and ${r.submissions} submission(s) ` +
             `(${r.graded} already graded) came with it — nothing was reset.` : '')
      );
      load();
    } catch {
      setReassignError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Same grade-level formatting as the create form, so a rename here cannot
  // walk a section back out of the house style — see formatSectionName.
  const saveSection = (section) => call(
    `${API_URL}/api/admin/${admin.id}/sections/${section.id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sectionForm, name: formatSectionName(sectionForm.name, sectionForm.gradeLevel) }),
    },
    () => setEditingSectionId(null)
  );

  /**
   * A section can only be deleted once nothing hangs off it — the server
   * refuses otherwise, and rightly so: the students are real accounts and the
   * classes carry submitted work.
   *
   * That refusal used to arrive as a banner at the very top of a page the
   * admin had scrolled well past, so pressing the bin on a section with
   * thirty learners in it looked like nothing happened at all. Say what is in
   * the way, and what to do about it, before making the call.
   */
  const deleteSection = async (section) => {
    const students = section.students.length;
    const classes = section._count.classes;
    if (students > 0 || classes > 0) {
      const blockers = [
        students > 0 && `${students} student${students === 1 ? '' : 's'} on its roster`,
        classes > 0 && `${classes} course shell${classes === 1 ? '' : 's'} using it`,
      ].filter(Boolean);
      return showAlert(
        `"${section.name}" cannot be deleted yet — it still has ${blockers.join(' and ')}.\n\n` +
        (students > 0
          ? 'Remove the students first (open the section and use the bin beside each name). ' +
            'Anyone who has submitted work keeps their account and is only unassigned.\n'
          : '') +
        (classes > 0
          ? 'Move or delete the course shells that use this section first — they are listed on the teacher pages.\n'
          : '') +
        '\nNothing has been changed.'
      );
    }
    if (!(await showConfirm(`Delete the empty section "${section.name}"? This cannot be undone.`,
      { confirmLabel: 'Delete section', danger: true }))) return;
    call(`${API_URL}/api/admin/${admin.id}/sections/${section.id}`, { method: 'DELETE' },
      () => setNotice(`Section "${section.name}" was deleted.`));
  };

  /**
   * Enrols names into a section. `allowMove` is off first time round so the
   * server reports anyone already on another roster rather than moving them
   * silently; confirming replays the identical request with it on.
   */
  const addStudents = async (section, { allowMove = false, studentsList } = {}) => {
    // Handed back verbatim on a replay; otherwise read off the editor, which
    // returns null when a typed birthday cannot be read.
    const list = studentsList || rosterPayload(studentRows, showAlert);
    if (!list || list.length === 0) return;
    const d = await call(
      `${API_URL}/api/admin/${admin.id}/sections/${section.id}/students`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentsList: list, allowMove }) },
    );
    if (!d?.success) return;
    // Appended: the confirm-and-replay path runs this twice and the second pass
    // reports only the moves, so replacing would discard passwords that cannot
    // be recovered.
    setNewAccounts(prev => [...prev, ...(d.createdStudents || [])]);
    setNotice(d.message);
    if (d.pendingMoves?.length) {
      setMoveRequest({ section, studentsList: list, moves: d.pendingMoves });
    } else {
      setStudentRows(emptyRoster());
      setAddingToSectionId(null);
      setMoveRequest(null);
    }
  };

  /** Auto-fill from a roster spreadsheet or a photo of one, same as the teacher's editor. */
  const handleRosterFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtracting(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/extract-students`, {
        method: 'POST',
        body: formData,
      });
      const d = await res.json().catch(() => null);
      const extracted = d?.success ? rowsFromExtraction(d) : [];
      if (extracted.length) {
        setStudentRows(prev => withBlankRow([...prev.filter(isFilledRow), ...extracted]));
      } else {
        setError(d?.error || 'Could not read that file.');
      }
    } catch {
      setError('Network error while reading the file.');
    } finally {
      setIsExtracting(false);
      e.target.value = '';   // so picking the same file again still fires
    }
  };

  const removeStudent = async (section, student) => {
    if (!(await showConfirm(`Remove ${student.name} from ${section.name}?`,
      { confirmLabel: 'Remove from section', danger: true }))) return;
    call(
      `${API_URL}/api/admin/${admin.id}/sections/${section.id}/students/${student.id}`,
      { method: 'DELETE' },
      (d) => setNotice(d.message)
    );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading teacher...</div>;
  }
  if (!data) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center">
        <p className="text-slate-500 mb-4">{error || 'Teacher not found.'}</p>
        <button onClick={() => navigate('/admin/teachers')} className="text-brand-navy font-semibold hover:underline">Back to Teachers</button>
      </div>
    );
  }

  const { teacher, classes, sections, teachers = [], schoolSections = [], curriculums = [] } = data;
  const otherTeachers = teachers.filter(t => t.id !== teacher.id);
  const totalStudents = sections.reduce((n, s) => n + s.students.length, 0);

  // Offered rather than applied silently: copying a curriculum's lessons in is
  // what lets grading mark against what the school actually published instead
  // of a one-line description, but it is also forty rows the admin should know
  // they are creating.
  const matchedCurriculum = curriculumFor(curriculums, classForm.subject, classForm.gradeLevel);

  /**
   * Each section's roster alphabetised and numbered once, then filtered.
   *
   * Numbered before the filter so the column keeps meaning "position on this
   * section's list" whatever is typed — see the same note on the section page.
   * `rosterTotal` is kept beside the filtered rows because the card header
   * still reports the real size of the section: a search must never look like
   * students have gone missing.
   */
  const searchedSections = sections.map(section => {
    const roster = sortRosterByName(section.students).map((s, i) => ({ ...s, rosterNo: i + 1 }));
    return {
      ...section,
      roster: roster.filter(s => matchesRosterQuery(s, rosterQuery)),
      rosterTotal: roster.length,
    };
  });
  const matchCount = searchedSections.reduce((n, s) => n + s.roster.length, 0);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <button onClick={() => navigate('/admin/teachers')} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Teachers
      </button>

      <div ref={bannerRef} className="scroll-mt-4" />

      <SectionMoveConfirm
        moves={moveRequest?.moves}
        targetSection={moveRequest?.section?.name}
        busy={busy}
        onConfirm={() => {
          const req = moveRequest;
          setMoveRequest(null);
          addStudents(req.section, { allowMove: true, studentsList: req.studentsList });
        }}
        onCancel={() => { setMoveRequest(null); setStudentRows(emptyRoster()); setAddingToSectionId(null); }}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4 flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}
      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-xl p-3 mb-4 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}
      {newCredentials && (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-green-800 mb-2">New password — share it once</p>
              <div className="bg-white border border-green-200 rounded-lg p-3 font-mono text-sm space-y-1">
                <p className="text-slate-600 break-all">Email: <span className="font-bold text-brand-slate">{newCredentials.email}</span></p>
                <p className="text-slate-600">Password: <span className="font-bold text-brand-slate">{newCredentials.password}</span></p>
              </div>
            </div>
            <button onClick={() => setNewCredentials(null)} className="text-green-500 hover:text-green-700 shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(`Email: ${newCredentials.email}\nPassword: ${newCredentials.password}`)}
            className="mt-3 text-xs font-bold text-green-700 bg-white border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
      )}

      {newAccounts.length > 0 && (
        <StudentCredentials students={newAccounts} onClose={() => setNewAccounts([])} />
      )}

      {/* Profile */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-brand-navy font-extrabold text-xl flex items-center justify-center shrink-0">
            {teacher.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {editingProfile ? (
              <div className="space-y-2">
                <input type="text" value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" placeholder="Full name" />
                <input type="email" value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" placeholder="Email" />
                <div className="flex gap-2">
                  <button onClick={saveProfile} disabled={busy}
                    className="text-xs font-bold text-white bg-brand-navy px-3 py-1.5 rounded-lg hover:bg-blue-900 flex items-center gap-1 disabled:opacity-40">
                    <Check className="w-3.5 h-3.5" /> Save
                  </button>
                  <button onClick={() => setEditingProfile(false)}
                    className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold text-brand-slate truncate">{teacher.name}</h1>
                <p className="text-sm text-slate-500 truncate">{teacher.email}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Joined {new Date(teacher.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </>
            )}
          </div>
          {!editingProfile && (
            <div className="flex gap-1 shrink-0">
              <button onClick={() => { setProfileForm({ name: teacher.name, email: teacher.email || '' }); setEditingProfile(true); }}
                title="Edit details" className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={resetPassword} disabled={busy} title="Reset password"
                className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40">
                <KeyRound className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-100">
          {[
            { label: 'Course Shells', value: classes.length, icon: BookOpen },
            { label: 'Sections', value: sections.length, icon: GraduationCap },
            { label: 'Students', value: totalStudents, icon: Users },
          ].map(t => (
            <div key={t.label} className="text-center">
              <t.icon className="w-4 h-4 text-slate-300 mx-auto mb-1" />
              <p className="text-xl font-extrabold text-brand-slate">{t.value}</p>
              <p className="text-[11px] text-slate-500 font-medium">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Course shells */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Course Shells</h2>
        <button
          onClick={() => (showClassForm ? setShowClassForm(false) : openClassForm())}
          disabled={schoolSections.length === 0}
          title={schoolSections.length === 0
            ? 'Create a block section first — a course shell is taught to one'
            : `Assign a new course shell to ${teacher.name}`}
          className={cn('self-start sm:self-auto px-3 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 disabled:opacity-40',
            showClassForm ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-brand-navy text-white hover:bg-blue-900')}>
          {showClassForm ? <><X className="w-3.5 h-3.5" /> Close</> : <><Plus className="w-3.5 h-3.5" /> Add Course Shell</>}
        </button>
      </div>

      {showClassForm && (
        <div className="bg-white border-2 border-blue-200 rounded-2xl p-5 mb-4">
          <p className="text-sm font-bold text-brand-slate mb-1">New course shell for {teacher.name}</p>
          <p className="text-xs text-slate-500 mb-4">
            One subject taught to one block section. It appears on their dashboard straight away, and they
            build the activities in it themselves.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); createClass(); }} className="space-y-4" autoComplete="off">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Subject *</label>
                <select required value={classForm.subject}
                  onChange={e => setClassForm({ ...classForm, subject: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                  <option value="">-- Select --</option>
                  {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Grade level *</label>
                <select required value={classForm.gradeLevel}
                  onChange={e => setClassForm({ ...classForm, gradeLevel: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                  <option value="">-- Select --</option>
                  {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Block section *</label>
              <select required value={classForm.sectionId}
                onChange={e => setClassForm({ ...classForm, sectionId: e.target.value })}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                <option value="">-- Choose a section --</option>
                {schoolSections.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.gradeLevel ? ` · ${s.gradeLevel}` : ''} · {s._count?.students ?? 0} students
                    {s.teacher?.name ? ` · adviser ${s.teacher.name}` : ''}
                  </option>
                ))}
              </select>
              {/* Every section in the school, not only the ones this teacher
                  advises: teaching a subject into a colleague's block is the
                  ordinary shape of a subject teacher's week. */}
              <p className="text-[11px] text-slate-400 mt-1">
                Any section in your school — the adviser stays whoever it already is.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">School year *</label>
                <select required value={classForm.schoolYear}
                  onChange={e => setClassForm({ ...classForm, schoolYear: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                  {SCHOOL_YEARS.map(sy => <option key={sy} value={sy}>{sy}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Class name</label>
                <input type="text" value={classForm.name} autoComplete="off"
                  onChange={e => setClassForm({ ...classForm, name: e.target.value })}
                  placeholder={classForm.subject && classForm.gradeLevel ? `${classForm.subject} — ${classForm.gradeLevel}` : 'e.g. Filipino — Grade 6'}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
                <p className="text-[11px] text-slate-400 mt-1">Leave blank to use "Subject — Grade Level".</p>
              </div>
            </div>

            {matchedCurriculum && (
              <label className="flex items-start gap-3 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-xl cursor-pointer">
                <input type="checkbox" checked={classForm.useCurriculum}
                  onChange={e => setClassForm({ ...classForm, useCurriculum: e.target.checked })}
                  className="mt-0.5 w-4 h-4 accent-brand-green shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> Apply your school curriculum
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                    <span className="font-semibold">{matchedCurriculum.title}</span> is published for{' '}
                    {matchedCurriculum.subject} · {matchedCurriculum.gradeLevel}. Applying it copies{' '}
                    <span className="font-semibold">{matchedCurriculum._count?.lessons ?? 0} lesson(s)</span> and
                    their competencies and rubrics into this class, so grading marks against what the school published.
                  </p>
                </div>
              </label>
            )}

            {classFormError && (
              <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {classFormError}
              </p>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setShowClassForm(false)} disabled={busy}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">Cancel</button>
              <button type="submit" disabled={busy}
                className={cn('flex-1 py-2 rounded-lg text-white text-sm font-bold flex items-center justify-center gap-2',
                  busy ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create Course Shell</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {classes.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No course shells yet</p>
          <p className="text-xs mt-1">
            {schoolSections.length === 0
              ? 'Create a block section first — a course shell is taught to one.'
              : `Use "Add Course Shell" above to assign ${teacher.name} a course shell.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {classes.map(cls => (
            <div key={cls.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex gap-2 mb-1.5 flex-wrap">
                    {cls.gradeLevel && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{cls.gradeLevel}</span>}
                    {cls.subject && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">{cls.subject}</span>}
                  </div>
                  {editingClassId === cls.id ? (
                    <div className="space-y-2">
                      <input type="text" value={classNameForm} onChange={e => setClassNameForm(e.target.value)}
                        className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy font-bold" placeholder="Course shell name"
                        onKeyDown={e => { if (e.key === 'Enter') saveClassName(cls); if (e.key === 'Escape') setEditingClassId(null); }}
                        autoFocus />
                      <div className="flex gap-2">
                        <button onClick={() => saveClassName(cls)} disabled={busy || !classNameForm.trim()}
                          className="text-xs font-bold text-white bg-brand-navy px-3 py-1.5 rounded-lg hover:bg-blue-900 flex items-center gap-1 disabled:opacity-40">
                          <Check className="w-3.5 h-3.5" /> Save
                        </button>
                        <button onClick={() => setEditingClassId(null)}
                          className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="font-bold text-brand-slate truncate">{cls.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {cls.schoolYear} · {cls.section?.name || 'No section'} · {cls.section?._count?.students ?? 0} students
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {cls.activityCount} activit{cls.activityCount === 1 ? 'y' : 'ies'} ·{' '}
                        {cls.lessonCount} lesson{cls.lessonCount === 1 ? '' : 's'} ·{' '}
                        {cls.submissionCount} submission{cls.submissionCount === 1 ? '' : 's'}
                      </p>
                    </>
                  )}
                </div>
                {editingClassId !== cls.id && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setClassNameForm(cls.name); setEditingClassId(cls.id); }}
                      title="Rename course shell" className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setReassignClassId(reassignClassId === cls.id ? null : cls.id);
                        setReassignTo(otherTeachers[0]?.id || '');
                        setReassignError('');
                      }}
                      disabled={otherTeachers.length === 0}
                      title={otherTeachers.length === 0 ? 'No other teacher in this school to move it to' : 'Move to another teacher'}
                      aria-label={otherTeachers.length === 0 ? 'No other teacher in this school to move it to' : 'Move to another teacher'}
                      className={cn('p-2 rounded-lg disabled:opacity-30',
                        reassignClassId === cls.id ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                      <HandoverIcon />
                    </button>
                    <button onClick={() => deleteClass(cls)} disabled={busy || cls.submissionCount > 0}
                      title={cls.submissionCount > 0 ? 'Has student submissions — cannot be deleted' : 'Delete course shell'}
                      className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-slate-100 disabled:hover:text-slate-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {reassignClassId === cls.id && (
                <div className="mt-3 p-3 bg-blue-50/70 border border-blue-200 rounded-xl">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Move this course shell to</label>
                  <div className="flex flex-wrap gap-2">
                    <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                      className="flex-1 min-w-[200px] border border-slate-200 bg-white p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                      {otherTeachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                    </select>
                    <button onClick={() => reassignClass(cls)} disabled={busy || !reassignTo}
                      className="text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900 flex items-center gap-1.5 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Move
                    </button>
                    <button onClick={() => { setReassignClassId(null); setReassignError(''); }}
                      className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-white">Cancel</button>
                  </div>
                  {reassignError && (
                    <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 mt-2 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {reassignError}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    All {cls.activityCount} activit{cls.activityCount === 1 ? 'y' : 'ies'} and{' '}
                    {cls.submissionCount} submission(s) move with it — student progress, scores and released
                    feedback are kept exactly as they are. The new teacher picks up where this one left off.
                  </p>
                </div>
              )}

              {cls.submissionCount > 0 && reassignClassId !== cls.id && (
                <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Has student work — can be moved to another teacher, but not deleted.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sections + rosters */}
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Sections &amp; Students</h2>
      {sections.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <GraduationCap className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No sections yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {totalStudents > 8 && (
            <RosterSearch
              value={rosterQuery}
              onChange={setRosterQuery}
              count={matchCount}
              total={totalStudents}
              placeholder={`Search ${totalStudents} students across ${sections.length} section${sections.length === 1 ? '' : 's'}…`}
            />
          )}
          {searchedSections.map(section => {
            // A search is a reason to open the card without being asked: the
            // whole point of typing a name is to see the row it matched, and a
            // count with nothing under it reads as a broken search.
            const rosterOpen = openSectionIds.has(section.id)
              || (!!rosterQuery.trim() && section.roster.length > 0)
              || addingToSectionId === section.id;
            return (
            <div key={section.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-3 border-b border-slate-100">
                {editingSectionId === section.id ? (
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <input type="text" value={sectionForm.name} onChange={e => setSectionForm({ ...sectionForm, name: e.target.value })}
                        className="flex-1 min-w-0 border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
                      <select value={sectionForm.gradeLevel} onChange={e => setSectionForm({ ...sectionForm, gradeLevel: e.target.value })}
                        className="border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                        <option value="">No grade</option>
                        {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveSection(section)} disabled={busy}
                        className="text-xs font-bold text-white bg-brand-navy px-3 py-1.5 rounded-lg hover:bg-blue-900 flex items-center gap-1 disabled:opacity-40">
                        <Check className="w-3.5 h-3.5" /> Save
                      </button>
                      <button onClick={() => setEditingSectionId(null)}
                        className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* The card itself opens the roster; the arrow beside the
                        name is the way to the section's own page. A button
                        rather than a wrapping link because a link cannot
                        contain another link, and both jobs belong here. */}
                    <button type="button"
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={rosterOpen}
                      aria-controls={`roster-${section.id}`}
                      className="flex items-start gap-2 min-w-0 flex-1 text-left group">
                      <ChevronDown className={cn('w-4 h-4 mt-0.5 shrink-0 text-slate-400 transition-transform group-hover:text-brand-navy',
                        rosterOpen && 'rotate-180')} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-brand-slate group-hover:text-brand-navy">{section.name}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-brand-navy">
                            {section.gradeLevel || 'No grade level'}
                          </span>
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {section.students.length} student{section.students.length === 1 ? '' : 's'} ·{' '}
                          {section._count.classes} course shell{section._count.classes === 1 ? '' : 's'} ·{' '}
                          {rosterOpen ? 'hide the class list' : 'show the class list'}
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <Link to={`/admin/sections/${section.id}`}
                        title="Open the section page"
                        className="text-xs font-semibold text-brand-navy hover:underline px-1.5 hidden sm:inline">
                        open →
                      </Link>
                      {/* Edit, then add, then delete — the order they are
                          reached for, and the destructive one last rather than
                          between the two everyday controls. */}
                      <button onClick={() => { setSectionForm({ name: section.name, gradeLevel: section.gradeLevel || '' }); setEditingSectionId(section.id); }}
                        title="Edit section" className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => { setAddingToSectionId(addingToSectionId === section.id ? null : section.id); setStudentRows(emptyRoster()); }}
                        title="Add students"
                        className={cn('p-2 rounded-lg', addingToSectionId === section.id ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                        <UserPlus className="w-4 h-4" />
                      </button>
                      {(() => {
                        // Signalled on the control itself, not only when it is
                        // pressed: a section with a roster or a class attached
                        // cannot be deleted, and finding that out by clicking a
                        // bin is the wrong way round.
                        const blocked = section.students.length > 0 || section._count.classes > 0;
                        return (
                          <button onClick={() => deleteSection(section)} disabled={busy}
                            title={blocked
                              ? `Still in use — ${section.students.length} student(s) and ${section._count.classes} course shell(s). Click to see what to clear first.`
                              : 'Delete section'}
                            className={cn('p-2 rounded-lg disabled:opacity-40',
                              blocked
                                ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                                : 'bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>

              {addingToSectionId === section.id && (
                <div className="p-4 bg-blue-50/50 border-b border-blue-100">
                  <RosterEditor
                    rows={studentRows}
                    onChange={setStudentRows}
                    onPickFile={() => rosterFileRef.current?.click()}
                    isExtracting={isExtracting}
                    fileRef={rosterFileRef}
                    onFileChange={handleRosterFile}
                  />
                  <p className="text-[11px] text-slate-400 mt-2">
                    Enter names <span className="font-bold text-slate-500">last name first</span> — e.g. <span className="font-mono">Dela Cruz, Juan Miguel</span>. Rosters and gradebooks sort by this, and the optional comma after the surname is what lets us greet the learner by their real first name.
                    Anyone already enrolled in another section is listed for you to confirm before being moved.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => addStudents(section, {})} disabled={busy || !studentRows.some(isFilledRow)}
                      className="text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900 flex items-center gap-1.5 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Add Students
                    </button>
                    <button onClick={() => setAddingToSectionId(null)}
                      className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-white">Cancel</button>
                  </div>
                </div>
              )}

              <div id={`roster-${section.id}`} hidden={!rosterOpen}>
              {section.students.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-400 text-center">No students in this section.</p>
              ) : section.roster.length === 0 ? (
                /* The card is kept rather than hidden. A section that vanished
                   while the admin typed reads as a section that was deleted,
                   and it also takes its Add Students and Edit controls with
                   it — which are exactly what someone whose search found
                   nothing may want next. */
                <p className="px-4 py-6 text-sm text-slate-400 text-center">
                  No match here — all {section.rosterTotal} student{section.rosterTotal === 1 ? '' : 's'} still on this roster.
                </p>
              ) : (
                <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                  {section.roster.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 group">
                      <span className="text-xs text-slate-400 w-5 text-right font-mono shrink-0">{s.rosterNo}</span>
                      <div className="w-7 h-7 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center text-xs font-bold shrink-0">
                        {s.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-slate truncate">{s.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{s.username}</p>
                      </div>
                      <button onClick={() => removeStudent(section, s)} disabled={busy}
                        title="Remove student"
                        className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 reveal-on-hover shrink-0 disabled:opacity-30">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-8 text-center">
        Need to remove this teacher entirely? Use the delete button on the{' '}
        <Link to="/admin/teachers" className="underline hover:text-slate-600">Teachers list</Link>.
      </p>
    </div>
  );
}
