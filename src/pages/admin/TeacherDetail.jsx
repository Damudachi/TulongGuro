import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Pencil, Trash2, Check, X, KeyRound, UserPlus,
  BookOpen, Users, GraduationCap, AlertTriangle, Copy,
} from 'lucide-react';
import { API_URL } from '../../config';
import { GRADE_LEVELS } from '../../constants/school';

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

  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionForm, setSectionForm] = useState({ name: '', gradeLevel: '' });
  const [addingToSectionId, setAddingToSectionId] = useState(null);
  const [studentsText, setStudentsText] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    if (!admin.id) return setIsLoading(false);
    fetch(`${API_URL}/api/admin/${admin.id}/teachers/${teacherId}`)
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
      const res = await fetch(url, options);
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

  const saveSection = (section) => call(
    `${API_URL}/api/admin/${admin.id}/sections/${section.id}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sectionForm) },
    () => setEditingSectionId(null)
  );

  const deleteSection = (section) => {
    if (!confirm(`Delete the section "${section.name}"?`)) return;
    call(`${API_URL}/api/admin/${admin.id}/sections/${section.id}`, { method: 'DELETE' });
  };

  const addStudents = (section) => {
    const studentsList = studentsText.split('\n').map(s => s.trim()).filter(Boolean);
    if (studentsList.length === 0) return;
    call(
      `${API_URL}/api/admin/${admin.id}/sections/${section.id}/students`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentsList }) },
      (d) => { setStudentsText(''); setAddingToSectionId(null); setNotice(d.message); }
    );
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

  const { teacher, classes, sections } = data;
  const totalStudents = sections.reduce((n, s) => n + s.students.length, 0);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <button onClick={() => navigate('/admin/teachers')} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-6">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Teachers
      </button>

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
                <button onClick={() => deleteClass(cls)} disabled={busy || cls.submissionCount > 0}
                  title={cls.submissionCount > 0 ? 'Has student submissions — cannot be deleted' : 'Delete course shell'}
                  className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 shrink-0 disabled:opacity-30 disabled:hover:bg-slate-100 disabled:hover:text-slate-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {cls.submissionCount > 0 && (
                <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Locked — students have submitted work to this class.
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
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-brand-slate">{section.name}</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-brand-navy">
                          {section.gradeLevel || 'No grade level'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {section.students.length} student{section.students.length === 1 ? '' : 's'} ·{' '}
                        {section._count.classes} class{section._count.classes === 1 ? '' : 'es'}
                      </p>
                    </div>
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
                      <button onClick={() => deleteSection(section)} disabled={busy}
                        title="Delete section" className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-40">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {addingToSectionId === section.id && (
                <div className="p-4 bg-blue-50/50 border-b border-blue-100">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Student names (one per line)</label>
                  <textarea rows={4} value={studentsText} onChange={e => setStudentsText(e.target.value)}
                    placeholder={'Juan Dela Cruz\nMaria Clara'}
                    className="w-full border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy resize-none" />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Existing students in this school are moved here instead of duplicated. Default password: <code>password123</code>.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => addStudents(section)} disabled={busy || !studentsText.trim()}
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
