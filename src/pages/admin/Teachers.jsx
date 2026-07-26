import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Loader2, Trash2, KeyRound, X, Copy, Check, GraduationCap, BookOpen, ClipboardList, ChevronRight } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** Temporary password the admin hands to the teacher on first login. */
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function AdminTeachers() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busyTeacherId, setBusyTeacherId] = useState(null);

  const load = useCallback(() => {
    if (!admin.id) return setIsLoading(false);
    fetch(`${API_URL}/api/admin/${admin.id}/overview`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
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
    try {
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const d = await res.json();
      if (d.success) {
        setCreatedCredentials({ email: form.email, password: form.password });
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

  const handleResetPassword = async (teacher) => {
    const password = generatePassword();
    if (!confirm(`Reset ${teacher.name}'s password? Their current one stops working immediately.`)) return;
    setBusyTeacherId(teacher.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/teachers/${teacher.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const d = await res.json();
      if (d.success) setCreatedCredentials({ email: teacher.email, password });
      else alert(d.error || 'Reset failed.');
    } finally {
      setBusyTeacherId(null);
    }
  };

  const handleDelete = async (teacher) => {
    if (!confirm(`Remove ${teacher.name} from ${data?.school?.name}? This cannot be undone.`)) return;
    setBusyTeacherId(teacher.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/teachers/${teacher.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load();
      else alert(d.error || 'Could not remove this teacher.');
    } finally {
      setBusyTeacherId(null);
    }
  };

  const copyCredentials = () => {
    navigator.clipboard?.writeText(`Email: ${createdCredentials.email}\nTemporary password: ${createdCredentials.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading school...</div>;
  }

  const teachers = data?.teachers || [];
  const sections = data?.sections || [];

  // Sections are segmented by grade level across the whole school.
  const sectionsByGrade = sections.reduce((acc, s) => {
    const key = s.gradeLevel || 'Unassigned grade level';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});
  const gradeKeys = Object.keys(sectionsByGrade).sort();

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
          { label: 'Teachers', value: teachers.length, icon: Users },
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
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Teachers</h2>
      {teachers.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No teacher accounts yet</p>
          <p className="text-sm mt-1">Add one to get your school started.</p>
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
      <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Sections by grade level</h2>
      {sections.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <p className="text-sm font-medium">No sections yet</p>
          <p className="text-xs mt-1">Teachers create these from Manage Block Sections.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {gradeKeys.map(grade => (
            <div key={grade}>
              <p className="text-xs font-bold text-brand-navy bg-blue-50 inline-block px-2.5 py-1 rounded-full mb-2">{grade}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sectionsByGrade[grade].map(s => (
                  <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-slate text-sm truncate">{s.name}</p>
                      <p className="text-xs text-slate-400 truncate">Adviser: {s.teacher?.name || '—'}</p>
                    </div>
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full shrink-0">
                      {s._count?.students || 0} students
                    </span>
                  </div>
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
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input required type="email" value={form.email} autoComplete="off"
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="teacher@deped.gov.ph"
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Temporary password *</label>
                <div className="flex gap-2">
                  <input required type="text" value={form.password} autoComplete="off"
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="flex-1 border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm font-mono" />
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
    </div>
  );
}
