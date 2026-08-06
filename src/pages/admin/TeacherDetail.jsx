import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Pencil, Trash2, Check, X, KeyRound, UserPlus, UserCog,
  BookOpen, Users, GraduationCap, AlertTriangle, Copy,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS } from '../../constants/school';
import StudentCredentials from '../../components/StudentCredentials';
import SectionMoveConfirm from '../../components/SectionMoveConfirm';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '' });
  const [newCredentials, setNewCredentials] = useState(null);

  const [reassignClassId, setReassignClassId] = useState(null);
  const [reassignTo, setReassignTo] = useState('');
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionForm, setSectionForm] = useState({ name: '', gradeLevel: '' });
  const [addingToSectionId, setAddingToSectionId] = useState(null);
  const [studentsText, setStudentsText] = useState('');
  const [notice, setNotice] = useState('');
  const [newAccounts, setNewAccounts] = useState([]);
  const [moveRequest, setMoveRequest] = useState(null);
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
    if (!admin.id) return setIsLoading(false);
    apiFetch(`${API_URL}/api/admin/${admin.id}/teachers/${teacherId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d);
        else setError(d.error || 'Could not load this teacher.');
      })
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
    if (!confirm(`Reset ${data.teacher.name}'s password? Their current one stops working immediately.`)) return;
    await call(
      `${API_URL}/api/admin/${admin.id}/teachers/${teacherId}/password`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) },
      () => setNewCredentials({ email: data.teacher.email, password })
    );
  };

  const deleteClass = (cls) => {
    if (!confirm(`Delete the course shell "${cls.name}"? This cannot be undone.`)) return;
    call(`${API_URL}/api/admin/${admin.id}/classes/${cls.id}`, { method: 'DELETE' });
  };

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

  const saveSection = (section) => call(
    `${API_URL}/api/admin/${admin.id}/sections/${section.id}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sectionForm) },
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
  const deleteSection = (section) => {
    const students = section.students.length;
    const classes = section._count.classes;
    if (students > 0 || classes > 0) {
      const blockers = [
        students > 0 && `${students} student${students === 1 ? '' : 's'} on its roster`,
        classes > 0 && `${classes} course shell${classes === 1 ? '' : 's'} using it`,
      ].filter(Boolean);
      return alert(
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
    if (!confirm(`Delete the empty section "${section.name}"? This cannot be undone.`)) return;
    call(`${API_URL}/api/admin/${admin.id}/sections/${section.id}`, { method: 'DELETE' },
      () => setNotice(`Section "${section.name}" was deleted.`));
  };

  /**
   * Enrols names into a section. `allowMove` is off first time round so the
   * server reports anyone already on another roster rather than moving them
   * silently; confirming replays the identical request with it on.
   */
  const addStudents = async (section, { allowMove = false, studentsList } = {}) => {
    const list = studentsList || studentsText.split('\n').map(s => s.trim()).filter(Boolean);
    if (list.length === 0) return;
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
      setStudentsText('');
      setAddingToSectionId(null);
      setMoveRequest(null);
    }
  };

  const removeStudent = (section, student) => {
    if (!confirm(`Remove ${student.name} from ${section.name}?`)) return;
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

  const { teacher, classes, sections, teachers = [] } = data;
  const otherTeachers = teachers.filter(t => t.id !== teacher.id);
  const totalStudents = sections.reduce((n, s) => n + s.students.length, 0);

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
        onCancel={() => { setMoveRequest(null); setStudentsText(''); setAddingToSectionId(null); }}
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
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Course Shells</h2>
      {classes.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No classes yet</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {classes.map(cls => (
            <div key={cls.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex gap-2 mb-1.5 flex-wrap">
                    {cls.gradeLevel && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{cls.gradeLevel}</span>}
                    {cls.subject && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">{cls.subject}</span>}
                  </div>
                  <p className="font-bold text-brand-slate truncate">{cls.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {cls.schoolYear} · {cls.section?.name || 'No section'} · {cls.section?._count?.students ?? 0} students
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {cls.activityCount} activit{cls.activityCount === 1 ? 'y' : 'ies'} ·{' '}
                    {cls.lessonCount} lesson{cls.lessonCount === 1 ? '' : 's'} ·{' '}
                    {cls.submissionCount} submission{cls.submissionCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setReassignClassId(reassignClassId === cls.id ? null : cls.id);
                      setReassignTo(otherTeachers[0]?.id || '');
                      setReassignError('');
                    }}
                    disabled={otherTeachers.length === 0}
                    title={otherTeachers.length === 0 ? 'No other teacher in this school to move it to' : 'Move to another teacher'}
                    className={cn('p-2 rounded-lg disabled:opacity-30',
                      reassignClassId === cls.id ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                    <UserCog className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteClass(cls)} disabled={busy || cls.submissionCount > 0}
                    title={cls.submissionCount > 0 ? 'Has student submissions — cannot be deleted' : 'Delete course shell'}
                    className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-slate-100 disabled:hover:text-slate-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
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
          {sections.map(section => (
            <div key={section.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-3 border-b border-slate-100">
                {editingSectionId === section.id ? (
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <input type="text" value={sectionForm.name} onChange={e => setSectionForm({ ...sectionForm, name: e.target.value })}
                        className="flex-1 border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
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
                    <Link to={`/admin/sections/${section.id}`} className="min-w-0 group">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-brand-slate group-hover:text-brand-navy">{section.name}</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-brand-navy">
                          {section.gradeLevel || 'No grade level'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {section.students.length} student{section.students.length === 1 ? '' : 's'} ·{' '}
                        {section._count.classes} class{section._count.classes === 1 ? '' : 'es'} ·{' '}
                        <span className="text-brand-navy font-medium group-hover:underline">open section →</span>
                      </p>
                    </Link>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setAddingToSectionId(addingToSectionId === section.id ? null : section.id); setStudentsText(''); }}
                        title="Add students"
                        className={cn('p-2 rounded-lg', addingToSectionId === section.id ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                        <UserPlus className="w-4 h-4" />
                      </button>
                      <button onClick={() => { setSectionForm({ name: section.name, gradeLevel: section.gradeLevel || '' }); setEditingSectionId(section.id); }}
                        title="Edit section" className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                        <Pencil className="w-4 h-4" />
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
                              ? `Still in use — ${section.students.length} student(s) and ${section._count.classes} class(es). Click to see what to clear first.`
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
                  <label className="block text-xs font-medium text-slate-600 mb-1">Student names — last name first, one per line</label>
                  <textarea rows={4} value={studentsText} onChange={e => setStudentsText(e.target.value)}
                    placeholder={'Dela Cruz, Juan\nSantos, Maria Clara'}
                    className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy resize-none" />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Enter names <span className="font-bold text-slate-500">last name first</span> — rosters and gradebooks sort by this.
                    Anyone already enrolled in another section is listed for you to confirm before being moved.
                    Password: their birthday as MMDDYYYY, or a random code shown once after adding if there is no birthday on file.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => addStudents(section, {})} disabled={busy || !studentsText.trim()}
                      className="text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900 flex items-center gap-1.5 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Add Students
                    </button>
                    <button onClick={() => setAddingToSectionId(null)}
                      className="text-xs font-bold text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-white">Cancel</button>
                  </div>
                </div>
              )}

              {section.students.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-400 text-center">No students in this section.</p>
              ) : (
                <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                  {section.students.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 group">
                      <span className="text-xs text-slate-400 w-5 text-right font-mono shrink-0">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center text-xs font-bold shrink-0">
                        {s.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-slate truncate">{s.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{s.username}</p>
                      </div>
                      <button onClick={() => removeStudent(section, s)} disabled={busy}
                        title="Remove student"
                        className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 disabled:opacity-30">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-8 text-center">
        Need to remove this teacher entirely? Use the delete button on the{' '}
        <Link to="/admin/teachers" className="underline hover:text-slate-600">Teachers list</Link>.
      </p>
    </div>
  );
}
