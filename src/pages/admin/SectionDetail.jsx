import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Pencil, Trash2, Check, X, UserPlus,
  BookOpen, Users, GraduationCap, AlertTriangle, KeyRound,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS } from '../../constants/school';
import StudentCredentials from '../../components/StudentCredentials';
import SectionMoveConfirm from '../../components/SectionMoveConfirm';
import RosterEditor from '../../components/RosterEditor';
import { parseRosterLines, isFilledRow, rosterPayload, emptyRoster, withBlankRow, normalizeRosterName } from '../../utils/roster';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Admin view of one section: adviser, roster and the classes using it.
 * Supports renaming, re-grading, reassigning the adviser, and adding or
 * removing students.
 */
export default function AdminSectionDetail() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const admin = JSON.parse(localStorage.getItem('user') || '{}');

  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', gradeLevel: '', teacherId: '' });
  const [addOpen, setAddOpen] = useState(false);
  // The same roster editor the teacher uses, for the same reason: this screen
  // was a textarea of bare names, so every account an admin created here got a
  // random password — while the help text under it described the birthday one.
  const [studentRows, setStudentRows] = useState(emptyRoster);
  const [isExtracting, setIsExtracting] = useState(false);
  const rosterFileRef = useRef(null);
  const [newAccounts, setNewAccounts] = useState([]);
  const [moveRequest, setMoveRequest] = useState(null);

  // Both banners sit above a roster that can run to forty rows, so a message
  // raised by a control near the bottom needs bringing into view — otherwise
  // the action reads as having done nothing at all.
  const bannerRef = useRef(null);
  useEffect(() => {
    if (error || notice) bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [error, notice]);

  const load = useCallback(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/sections/${sectionId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d);
        else setError(d.error || 'Could not load this section.');
      })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [admin.id, sectionId]);

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

  const save = () => call(
    `${API_URL}/api/admin/${admin.id}/sections/${sectionId}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) },
    () => { setEditing(false); setNotice('Section updated.'); }
  );

  /**
   * Enrols names into this section. `allowMove` stays off on the first attempt
   * so the server reports anyone already on another roster instead of quietly
   * moving them; confirming replays the same request with it on.
   */
  const addStudents = async ({ allowMove = false, studentsList } = {}) => {
    // On a replay the list is handed back verbatim; otherwise it is read off
    // the editor, which returns null when a typed birthday is unreadable.
    const list = studentsList || rosterPayload(studentRows, alert);
    if (!list || list.length === 0) return;
    const d = await call(
      `${API_URL}/api/admin/${admin.id}/sections/${sectionId}/students`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentsList: list, allowMove }) },
    );
    if (!d?.success) return;
    // Appended rather than replaced — the confirm-and-replay path runs this
    // twice, and a generated password is shown once or never.
    setNewAccounts(prev => [...prev, ...(d.createdStudents || [])]);
    setNotice(d.message);
    if (d.pendingMoves?.length) {
      setMoveRequest({ studentsList: list, moves: d.pendingMoves });
    } else {
      setStudentRows(emptyRoster());
      setAddOpen(false);
      setMoveRequest(null);
    }
  };

  /** Auto-fill from a roster spreadsheet, same as the teacher's editor. */
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
      if (d?.success && d.names) {
        // Appended to whatever is already typed, and re-parsed so an extracted
        // "Name, 03/15/2014" still lands in two columns.
        const extracted = parseRosterLines(d.names.join('\n'));
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

  const resetStudentPassword = (student) => {
    if (!confirm(`Reset ${student.name}'s password to their birthdate? Their current password stops working immediately.`)) return;
    call(
      `${API_URL}/api/admin/${admin.id}/sections/${sectionId}/students/${student.id}/password`,
      { method: 'PUT' },
      (d) => setNotice(
        `${student.name}'s new password is ${d.password}` +
        (d.source === 'default' ? ' (no birthday on file, so the shared default was used).' : '.') +
        ' Share it with them now.'
      )
    );
  };

  /**
   * Fix a misspelt name. The student ID is their login, so it is deliberately
   * left as it is — see the route's comment.
   */
  const renameStudent = (student) => {
    const name = prompt(
      `Correct the spelling of this learner's name.\n\nTheir Student ID (${student.username}) will not change, so they sign in exactly as before.`,
      student.name
    );
    if (name === null) return;
    // Match the roster editor — a typed surname comma is kept, since it is
    // what first-name extraction (the student greeting) reads.
    const trimmed = normalizeRosterName(name).trim();
    if (!trimmed || trimmed === student.name) return;
    call(
      `${API_URL}/api/admin/${admin.id}/sections/${sectionId}/students/${student.id}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmed }) },
      () => setNotice(`Renamed to ${trimmed}.`)
    );
  };

  const removeStudent = (student) => {
    if (!confirm(`Remove ${student.name} from ${data.section.name}?`)) return;
    call(
      `${API_URL}/api/admin/${admin.id}/sections/${sectionId}/students/${student.id}`,
      { method: 'DELETE' },
      (d) => setNotice(d.message)
    );
  };

  /**
   * A section can only go once nothing depends on it — its students are real
   * accounts and its classes hold submitted work, so the server refuses
   * otherwise. Name what is in the way and how to clear it before making the
   * call, rather than letting the refusal land in a banner the admin has
   * already scrolled past.
   */
  const deleteSection = async () => {
    const students = data.section.students.length;
    const classes = data.section.classes.length;
    if (students > 0 || classes > 0) {
      const blockers = [
        students > 0 && `${students} student${students === 1 ? '' : 's'} on its roster`,
        classes > 0 && `${classes} course shell${classes === 1 ? '' : 's'} using it`,
      ].filter(Boolean);
      return alert(
        `"${data.section.name}" cannot be deleted yet — it still has ${blockers.join(' and ')}.\n\n` +
        (students > 0
          ? 'Remove the students first, using the bin beside each name in the roster below. Anyone who has ' +
            'submitted work keeps their account and is only unassigned from this section.\n'
          : '') +
        (classes > 0
          ? 'Move or delete the course shells listed above first — a shell can be reassigned to another ' +
            'teacher from their teacher page without losing any student work.\n'
          : '') +
        '\nNothing has been changed.'
      );
    }
    if (!confirm(`Delete the empty section "${data.section.name}"? This cannot be undone.`)) return;
    const d = await call(`${API_URL}/api/admin/${admin.id}/sections/${sectionId}`, { method: 'DELETE' });
    if (d?.success) navigate('/admin/teachers');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading section...</div>;
  }
  if (!data?.section) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center">
        <p className="text-slate-500 mb-4">{error || 'Section not found.'}</p>
        <button onClick={() => navigate('/admin/teachers')} className="text-brand-navy font-semibold hover:underline">Back</button>
      </div>
    );
  }

  const { section, teachers } = data;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      <div ref={bannerRef} className="scroll-mt-4" />

      <SectionMoveConfirm
        moves={moveRequest?.moves}
        targetSection={section.name}
        busy={busy}
        onConfirm={() => {
          const req = moveRequest;
          setMoveRequest(null);
          addStudents({ allowMove: true, studentsList: req.studentsList });
        }}
        onCancel={() => { setMoveRequest(null); setStudentRows(emptyRoster()); setAddOpen(false); }}
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

      <StudentCredentials students={newAccounts} onClose={() => setNewAccounts([])} />

      {/* Header / edit */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Section name</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Grade level</label>
                <select value={form.gradeLevel} onChange={e => setForm({ ...form, gradeLevel: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                  <option value="">No grade level</option>
                  {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Adviser</label>
              <select value={form.teacherId} onChange={e => setForm({ ...form, teacherId: e.target.value })}
                className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                Changing the adviser does not move the classes taught in this section — those keep their own teacher.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={busy}
                className="text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900 flex items-center gap-1.5 disabled:opacity-40">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
              </button>
              <button onClick={() => setEditing(false)}
                className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-xl font-bold text-brand-slate">{section.name}</h1>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-brand-navy">
                  {section.gradeLevel || 'No grade level'}
                </span>
              </div>
              <p className="text-sm text-slate-500">
                Adviser: <Link to={`/admin/teachers/${section.teacher?.id}`} className="font-medium text-brand-navy hover:underline">
                  {section.teacher?.name || '—'}
                </Link>
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => { setAddOpen(o => !o); setStudentRows(emptyRoster()); }} title="Add students"
                className={cn('p-2 rounded-lg', addOpen ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                <UserPlus className="w-4 h-4" />
              </button>
              <button onClick={() => { setForm({ name: section.name, gradeLevel: section.gradeLevel || '', teacherId: section.teacherId }); setEditing(true); }}
                title="Edit section" className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                <Pencil className="w-4 h-4" />
              </button>
              {/* Amber rather than neutral while anything still depends on the
                  section: the delete will be refused, and saying so on the
                  control beats saying it after the click. */}
              <button onClick={deleteSection} disabled={busy}
                title={section.students.length > 0 || section.classes.length > 0
                  ? `Still in use — ${section.students.length} student(s) and ${section.classes.length} class(es). Click to see what to clear first.`
                  : 'Delete section'}
                className={cn('p-2 rounded-lg disabled:opacity-40',
                  section.students.length > 0 || section.classes.length > 0
                    ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                    : 'bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600')}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-slate-100">
          {[
            { label: 'Students', value: section.students.length, icon: Users },
            { label: 'Classes', value: section.classes.length, icon: BookOpen },
          ].map(t => (
            <div key={t.label} className="text-center">
              <t.icon className="w-4 h-4 text-slate-300 mx-auto mb-1" />
              <p className="text-xl font-extrabold text-brand-slate">{t.value}</p>
              <p className="text-[11px] text-slate-500 font-medium">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Add students */}
      {addOpen && (
        <div className="bg-blue-50/60 border border-blue-200 rounded-2xl p-4 mb-6">
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
            <button onClick={() => addStudents({})} disabled={busy || !studentRows.some(isFilledRow)}
              className="text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900 flex items-center gap-1.5 disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Add Students
            </button>
            <button onClick={() => setAddOpen(false)}
              className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Classes using this section */}
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Classes in this section</h2>
      {section.classes.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No classes use this section yet</p>
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {section.classes.map(c => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-brand-slate text-sm truncate">{c.name}</p>
                <p className="text-xs text-slate-500">
                  {c.gradeLevel} · {c.subject} · {c.schoolYear} · {c._count.activities} activit{c._count.activities === 1 ? 'y' : 'ies'}
                </p>
              </div>
              <Link to={`/admin/teachers/${c.teacher?.id}`}
                className="text-xs font-medium text-brand-navy hover:underline shrink-0">
                {c.teacher?.name}
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Roster */}
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
        Students ({section.students.length})
      </h2>
      {section.students.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <GraduationCap className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No students in this section</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-50 overflow-hidden">
          {section.students.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 group">
              <span className="text-xs text-slate-400 w-5 text-right font-mono shrink-0">{i + 1}</span>
              <div className="w-8 h-8 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center text-xs font-bold shrink-0">
                {s.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-slate truncate">{s.name}</p>
                <p className="text-[11px] text-slate-400 font-mono">{s.username}</p>
              </div>
              {s._count.submissions > 0 && (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1"
                  title="Has submitted work — removing keeps the account and only unassigns them">
                  <AlertTriangle className="w-3 h-3" /> {s._count.submissions} submitted
                </span>
              )}
              <button onClick={() => renameStudent(s)} disabled={busy} title="Correct the spelling of this name"
                className="p-1.5 rounded-md text-slate-300 hover:text-brand-navy hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 disabled:opacity-30">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => resetStudentPassword(s)} disabled={busy} title="Reset password to birthdate"
                className="p-1.5 rounded-md text-slate-300 hover:text-brand-navy hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 disabled:opacity-30">
                <KeyRound className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => removeStudent(s)} disabled={busy} title="Remove from section"
                className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 disabled:opacity-30">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
