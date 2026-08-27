import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, Plus, Loader2, X, Search, Filter, Sparkles, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS, SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR } from '../../constants/school';
import { foldForSearch } from '../../utils/roster';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * The school curriculum published for a subject and grade level, if there is one.
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
 * Every course shell in the school, on its own screen.
 *
 * Shells could only be reached one teacher at a time, through
 * /admin/teachers/:teacherId — which answers "what does this person carry" and
 * never the question an admin actually arrives with: which subjects are
 * running, in which blocks, taught by whom. Assembling that meant opening every
 * teacher in turn and holding the result in your head.
 *
 * The per-teacher form stays where it is — creating a shell while looking at
 * one teacher's timetable is the right context for it. This one adds the
 * teacher as a field, because here nothing else says who it is for.
 *
 * Editing a shell — rename, reassign, delete — deliberately stays on the
 * teacher page. Those controls need the surrounding "what else would this
 * person be left with" context, and duplicating them here would make two
 * places to look for one answer.
 */
export default function AdminClasses() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ gradeLevel: '', subject: '', teacherId: '', schoolYear: '' });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', subject: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR,
    sectionId: '', teacherId: '', useCurriculum: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/classes`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [admin.id]);

  useEffect(() => { load(); }, [load]);

  const openForm = () => {
    setForm({
      name: '', subject: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR,
      sectionId: '',
      // Pre-selected only when there is no choice to make.
      teacherId: (data?.teachers || []).length === 1 ? data.teachers[0].id : '',
      useCurriculum: true,
    });
    setError('');
    setShowForm(true);
  };

  const createClass = async () => {
    if (isSaving) return;                     // guards an impatient second click
    if (!form.teacherId) return setError('Choose the teacher who will teach this class.');
    if (!form.sectionId) return setError('Choose the block section this class is taught to.');
    if (!form.subject || !form.gradeLevel) return setError('Choose a subject and grade level.');
    setError('');
    setIsSaving(true);
    const curriculum = curriculumFor(data?.curriculums, form.subject, form.gradeLevel);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          subject: form.subject,
          gradeLevel: form.gradeLevel,
          schoolYear: form.schoolYear,
          sectionId: form.sectionId,
          teacherId: form.teacherId,
          ...(curriculum && form.useCurriculum ? { curriculumId: curriculum.id } : {}),
        }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        // Kept in the form: the usual refusal is "this teacher already has that
        // shell", which is only actionable while looking at the fields that
        // would change it.
        setError(d?.error || 'That course shell could not be created.');
        return;
      }
      setShowForm(false);
      setNotice(
        `"${d.class.name}" is now assigned to ${d.class.teacher?.name} for ${d.class.section?.name}. `
        + (d.appliedLessons
          ? `${d.appliedLessons} lesson${d.appliedLessons === 1 ? '' : 's'} from the school curriculum were applied. `
          : '')
        + 'It appears on their dashboard straight away.'
      );
      load();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading course shells...</div>;
  }

  const allClasses = data?.classes || [];
  const teachers = data?.teachers || [];
  const sections = data?.sections || [];
  const matchedCurriculum = curriculumFor(data?.curriculums, form.subject, form.gradeLevel);

  // Matches the shell's own name, its section and its teacher — the three ways
  // an admin refers to a class out loud. Folded the same way every other search
  // in the app folds, so a query means one thing across the product.
  const q = foldForSearch(query);
  const classes = allClasses.filter(c => {
    if (filters.gradeLevel && c.gradeLevel !== filters.gradeLevel) return false;
    if (filters.subject && c.subject !== filters.subject) return false;
    if (filters.teacherId && c.teacher?.id !== filters.teacherId) return false;
    if (filters.schoolYear && c.schoolYear !== filters.schoolYear) return false;
    if (!q) return true;
    return foldForSearch(c.name).includes(q)
      || foldForSearch(c.section?.name || '').includes(q)
      || foldForSearch(c.teacher?.name || '').includes(q);
  });

  // Grouped by section rather than by teacher: this page exists to answer "what
  // is running in Sampaguita", and the teacher page already groups the other
  // way. Ordered by grade level, then section name.
  const bySection = classes.reduce((acc, c) => {
    const key = c.section?.name || 'No section';
    (acc[key] = acc[key] || []).push(c);
    return acc;
  }, {});
  const gradeOrder = [...GRADE_LEVELS, 'Unassigned grade level'];
  const sectionKeys = Object.keys(bySection).sort((a, b) => {
    const ga = bySection[a][0]?.section?.gradeLevel || 'Unassigned grade level';
    const gb = bySection[b][0]?.section?.gradeLevel || 'Unassigned grade level';
    const byGrade = gradeOrder.indexOf(ga) - gradeOrder.indexOf(gb);
    return byGrade !== 0 ? byGrade : a.localeCompare(b);
  });

  const isFiltered = !!q || Object.values(filters).some(Boolean);
  const yearsInUse = [...new Set(allClasses.map(c => c.schoolYear).filter(Boolean))].sort().reverse();

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Course Shells</h1>
          <p className="text-slate-500 text-sm">
            {allClasses.length} course shell{allClasses.length === 1 ? '' : 's'} running across{' '}
            {sections.length} section{sections.length === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={openForm} disabled={sections.length === 0 || teachers.length === 0}
          title={sections.length === 0
            ? 'Create a block section first — a course shell is taught to one'
            : teachers.length === 0 ? 'Add a teacher first — a course shell needs one' : 'Create a course shell'}
          className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2 shrink-0 disabled:opacity-40 disabled:hover:bg-brand-navy">
          <Plus className="w-4 h-4" /> Add Course Shell
        </button>
      </div>

      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-xl p-3 mb-4 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss" className="text-blue-400 hover:text-blue-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {allClasses.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by class, section or teacher..."
              aria-label="Search course shells"
              className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <Filter className="w-3.5 h-3.5" /> Narrow down
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <select value={filters.gradeLevel} onChange={e => setFilters({ ...filters, gradeLevel: e.target.value })}
              aria-label="Filter by grade level"
              className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-brand-navy">
              <option value="">All grades</option>
              {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={filters.subject} onChange={e => setFilters({ ...filters, subject: e.target.value })}
              aria-label="Filter by subject"
              className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-brand-navy">
              <option value="">All subjects</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filters.teacherId} onChange={e => setFilters({ ...filters, teacherId: e.target.value })}
              aria-label="Filter by teacher"
              className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-brand-navy">
              <option value="">All teachers</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={filters.schoolYear} onChange={e => setFilters({ ...filters, schoolYear: e.target.value })}
              aria-label="Filter by school year"
              className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-brand-navy">
              <option value="">All years</option>
              {yearsInUse.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      )}

      {allClasses.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-500">No course shells yet</p>
          <p className="text-sm mt-1">
            {sections.length === 0
              ? <>A course shell is taught to a block section. <Link to="/admin/sections" className="text-brand-navy font-semibold hover:underline">Create one first</Link>.</>
              : teachers.length === 0
                ? <>A course shell needs a teacher. <Link to="/admin/teachers" className="text-brand-navy font-semibold hover:underline">Add one first</Link>.</>
                : 'Use "Add Course Shell" above to assign a teacher their first course shell.'}
          </p>
        </div>
      ) : classes.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">Nothing matches those filters</p>
          <button type="button"
            onClick={() => { setQuery(''); setFilters({ gradeLevel: '', subject: '', teacherId: '', schoolYear: '' }); }}
            className="text-sm mt-2 text-brand-navy font-semibold hover:underline">
            Clear them
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {isFiltered && (
            <p className="text-xs text-slate-400">
              Showing {classes.length} of {allClasses.length} course shell{allClasses.length === 1 ? '' : 's'}.
            </p>
          )}
          {sectionKeys.map(sectionName => (
            <div key={sectionName}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-bold text-brand-navy bg-blue-50 px-2.5 py-1 rounded-full">{sectionName}</span>
                {bySection[sectionName][0]?.section?.gradeLevel && (
                  <span className="text-xs text-slate-400">{bySection[sectionName][0].section.gradeLevel}</span>
                )}
                <span className="text-xs text-slate-400">
                  · {bySection[sectionName].length} course shell{bySection[sectionName].length === 1 ? '' : 's'}
                </span>
                {bySection[sectionName][0]?.section?.id && (
                  <Link to={`/admin/sections/${bySection[sectionName][0].section.id}`}
                    className="text-xs text-brand-navy font-medium hover:underline">
                    open section →
                  </Link>
                )}
              </div>
              <div className="space-y-2">
                {bySection[sectionName].map(c => (
                  <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex gap-2 mb-1.5 flex-wrap">
                          {c.gradeLevel && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{c.gradeLevel}</span>}
                          {c.subject && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">{c.subject}</span>}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">{c.schoolYear}</span>
                        </div>
                        <p className="font-bold text-brand-slate truncate">{c.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {c.activityCount} activit{c.activityCount === 1 ? 'y' : 'ies'} ·{' '}
                          {c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'} ·{' '}
                          {c.submissionCount} submission{c.submissionCount === 1 ? '' : 's'} ·{' '}
                          {c.section?._count?.students ?? 0} learner{(c.section?._count?.students ?? 0) === 1 ? '' : 's'}
                        </p>
                      </div>
                      {/* Renaming, reassigning and deleting live on the teacher
                          page, where the consequences for that person are on
                          screen. This is the way there. */}
                      <Link to={`/admin/teachers/${c.teacher?.id}`}
                        className="shrink-0 text-xs font-semibold text-brand-navy bg-blue-50 border border-blue-100 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 flex items-center gap-1 max-w-[45%]">
                        <span className="truncate">{c.teacher?.name || 'Unassigned'}</span>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add course shell modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Create a course shell</h2>
            <p className="text-slate-500 text-sm mb-5">
              One subject taught to one block section. It appears on the teacher&rsquo;s dashboard straight
              away, and they build the activities in it themselves.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); createClass(); }} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Teacher *</label>
                <select required value={form.teacherId}
                  onChange={e => setForm({ ...form, teacherId: e.target.value })}
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  <option value="">-- Choose a teacher --</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject *</label>
                  <select required value={form.subject}
                    onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Select --</option>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade level *</label>
                  <select required value={form.gradeLevel}
                    onChange={e => setForm({ ...form, gradeLevel: e.target.value })}
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Select --</option>
                    {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Block section *</label>
                <select required value={form.sectionId}
                  onChange={e => setForm({ ...form, sectionId: e.target.value })}
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  <option value="">-- Choose a section --</option>
                  {sections.map(s => (
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">School year *</label>
                  <select required value={form.schoolYear}
                    onChange={e => setForm({ ...form, schoolYear: e.target.value })}
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    {SCHOOL_YEARS.map(sy => <option key={sy} value={sy}>{sy}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Class name</label>
                  <input type="text" value={form.name} autoComplete="off"
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder={form.subject && form.gradeLevel ? `${form.subject} — ${form.gradeLevel}` : 'e.g. Filipino — Grade 6'}
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">
                Leave the name blank to use &ldquo;Subject — Grade Level&rdquo;.
              </p>

              {matchedCurriculum && (
                <label className="flex items-start gap-3 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-xl cursor-pointer">
                  <input type="checkbox" checked={form.useCurriculum}
                    onChange={e => setForm({ ...form, useCurriculum: e.target.checked })}
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

              {error && (
                <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)} disabled={isSaving}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">Cancel</button>
                <button type="submit" disabled={isSaving}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create Course Shell</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
