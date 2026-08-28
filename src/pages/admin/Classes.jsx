import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, Plus, Loader2, X, Search, Filter, Sparkles, AlertTriangle, ChevronRight,
  Pencil, Check, Trash2,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { showAlert, showConfirm } from '../../utils/dialog';
import { GRADE_LEVELS, SUBJECTS, SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR, courseShellName } from '../../constants/school';
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
 * Renaming and reassigning are here, on the card, because they are corrections
 * to the thing you are looking at — sending an admin to the teacher page to fix
 * a shell's name meant leaving the list of shells to correct one of them.
 * Deleting still lives on the teacher page: it is the one action that needs the
 * surrounding "what else would this person be left with" context.
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

  // The shell being edited, and the fields it is being edited into. Held as one
  // object so closing the dialog cannot leave a half-populated form behind for
  // the next shell to inherit.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', teacherId: '' });
  const [editError, setEditError] = useState('');

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

  /**
   * Delete a course shell from the list it is listed in.
   *
   * Only ever offered on a shell nobody has submitted to. Once there is student
   * work in it the shell is the only thing holding that work together, and the
   * server refuses the delete outright — so the control says so on itself
   * rather than letting an admin press a bin and read a refusal.
   *
   * The activities and copied lessons go with it, which is worth saying before
   * the fact: a shell with forty curriculum lessons in it does not look empty
   * to the person about to remove it, even when no learner has touched it.
   */
  const deleteShell = async (c) => {
    if (isSaving) return;
    // A backstop, not the usual path: the button itself is disabled once there
    // is work in the shell. Kept because "refuses silently" is the one way this
    // could fail that nobody would be able to report.
    if (c.submissionCount > 0) {
      return showAlert(
        `"${c.name}" has ${c.submissionCount} student submission${c.submissionCount === 1 ? '' : 's'} in it, `
        + 'so it cannot be deleted — the submissions, their scores and their released feedback all hang off it.\n\n'
        + 'To take it off this teacher, open their page and move it to another teacher instead. '
        + 'Nothing has been changed.'
      );
    }
    const carries = [
      c.activityCount > 0 && `${c.activityCount} activit${c.activityCount === 1 ? 'y' : 'ies'}`,
      c.lessonCount > 0 && `${c.lessonCount} lesson${c.lessonCount === 1 ? '' : 's'}`,
    ].filter(Boolean);
    if (!(await showConfirm(
      `Delete the course shell "${c.name}"?`
      + (carries.length ? ` Its ${carries.join(' and ')} go with it.` : '')
      + ' No learner has submitted to it. This cannot be undone.',
      { confirmLabel: 'Delete course shell', danger: true }
    ))) return;
    setIsSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/classes/${c.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        // Banner rather than a dialog: the shell is still on screen, and the
        // usual refusal is work that arrived between the page loading and the
        // bin being pressed — which the reload below then shows.
        setError(d?.error || 'That course shell could not be deleted.');
        load();
        return;
      }
      setNotice(`Course shell "${c.name}" was deleted.`);
      load();
    } catch {
      setError('Network error. Nothing was deleted.');
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (c) => {
    setEditing(c);
    setEditForm({ name: c.name || '', teacherId: c.teacher?.id || '' });
    setEditError('');
  };

  const saveEdit = async () => {
    if (isSaving || !editing) return;
    const name = editForm.name.trim();
    if (!name) return setEditError('A course shell needs a name.');
    // Sending only what changed. The route refuses a body with nothing in it,
    // and reassigning to the teacher who already holds the shell would put it
    // through the clash check against itself for no reason.
    const body = {};
    if (name !== editing.name) body.name = name;
    if (editForm.teacherId && editForm.teacherId !== editing.teacher?.id) body.teacherId = editForm.teacherId;
    if (Object.keys(body).length === 0) { setEditing(null); return; }

    setEditError('');
    setIsSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/classes/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) {
        // Kept in the dialog: the usual refusal is "that teacher already has an
        // identical shell", which is only actionable while the teacher field is
        // still on screen.
        setEditError(d?.error || 'That course shell could not be updated.');
        return;
      }
      setEditing(null);
      // Says what carried over. A shell handed to someone else takes its
      // activities and its students' work with it, and an admin who has just
      // moved a colleague's teaching load needs to see that nothing was lost.
      setNotice(
        d.previousTeacher
          ? `"${d.class.name}" moved from ${d.previousTeacher.name} to ${d.class.teacher?.name}. `
            + `${d.retained.activities} activit${d.retained.activities === 1 ? 'y' : 'ies'} and `
            + `${d.retained.submissions} submission${d.retained.submissions === 1 ? '' : 's'} `
            + `(${d.retained.graded} graded) went with it.`
          : `"${d.class.name}" was renamed.`
      );
      load();
    } catch {
      setEditError('Network error. Nothing was changed.');
    } finally {
      setIsSaving(false);
    }
  };

  const createClass = async () => {
    if (isSaving) return;                     // guards an impatient second click
    if (!form.teacherId) return setError('Choose the teacher who will teach this class.');
    if (!form.sectionId) return setError('Choose the block section this class is taught to.');
    if (!form.subject || !form.gradeLevel) return setError('Choose a subject and grade level.');
    setError('');
    setIsSaving(true);
    const curriculum = curriculumFor(data?.curriculums, form.subject, form.gradeLevel);
    // Rebuilt from the fields rather than read off the render, so the name that
    // is sent is the one the hint under the box promised.
    const resolvedName = courseShellName(
      form.subject, form.gradeLevel, form.name, sections.find(s => s.id === form.sectionId)?.name,
    );
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: resolvedName,
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
  // What the shell will be called: "English Grade 6 - Tesla". The name field
  // below holds the block and only the block; the subject and grade level are
  // their own fields on this form and courseShellName puts them in front.
  const defaultShellName = courseShellName(
    form.subject, form.gradeLevel, form.name, sections.find(s => s.id === form.sectionId)?.name,
  );

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
          {sectionKeys.map(sectionName => {
            const sectionOf = bySection[sectionName][0]?.section;
            return (
            <div key={sectionName}>
              {/* ── The section this group belongs to ──
                  The whole strip is the way into the section, not a small
                  "open section →" at the end of it: the strip already names one
                  section, and that section is what you want when you click it.
                  Built with the stretched-link pattern — an absolutely
                  positioned <Link> filling the strip — so the target is a real
                  link (middle-click, open-in-new-tab, screen readers) while the
                  visible button beside it stays a normal focus stop. */}
              <div className={cn('relative flex items-center gap-2 mb-2 flex-wrap rounded-xl -mx-2 px-2 py-1.5',
                sectionOf?.id && 'hover:bg-blue-50/60 transition-colors group')}>
                <span className="text-xs font-bold text-brand-navy bg-blue-50 px-2.5 py-1 rounded-full">{sectionName}</span>
                {sectionOf?.gradeLevel && (
                  <span className="text-xs text-slate-400">{sectionOf.gradeLevel}</span>
                )}
                <span className="text-xs text-slate-400">
                  · {bySection[sectionName].length} course shell{bySection[sectionName].length === 1 ? '' : 's'}
                </span>
                {sectionOf?.id && (
                  <>
                    <Link to={`/admin/sections/${sectionOf.id}`}
                      aria-label={`Open the ${sectionName} section`}
                      className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy" />
                    <span aria-hidden="true"
                      className="ml-auto shrink-0 text-xs font-bold text-brand-navy bg-white border border-blue-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1 group-hover:bg-brand-navy group-hover:text-white group-hover:border-brand-navy transition-colors">
                      Open section <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </>
                )}
              </div>
              <div className="space-y-2">
                {bySection[sectionName].map(c => (
                  /* The card opens this shell's analytics. Same stretched-link
                     pattern, which is what lets the teacher chip and the edit
                     button keep working as their own controls — a link cannot
                     legally contain another link or a button, and all three
                     jobs belong on this card. */
                  <div key={c.id}
                    className="relative bg-white border border-slate-200 rounded-xl p-4 hover:border-brand-navy hover:shadow-sm transition-all">
                    <Link to={`/admin/analytics/shell/${c.id}`}
                      aria-label={`Analytics for ${c.name}`}
                      className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy" />
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
                      <div className="relative shrink-0 flex items-center gap-1.5 max-w-[55%]">
                        {/* Renaming and reassigning used to be reachable only
                            from the teacher page, which meant leaving the list
                            of shells to correct one of them. */}
                        <button type="button" onClick={() => openEdit(c)}
                          title="Rename this course shell or hand it to another teacher"
                          aria-label={`Edit ${c.name}`}
                          className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-brand-navy hover:text-white transition-colors shrink-0">
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* Enabled only while the shell is still empty of
                            student work. Shown either way rather than hidden
                            once work arrives: a control that disappears looks
                            like a page that lost it, where one that is there
                            and says why it is closed answers the question the
                            admin actually has.

                            Faded and inert once there is work in it, exactly
                            as the same bin behaves on the teacher page — same
                            classes, so the two cannot drift. It does not light
                            up under the cursor: a control that answers a hover
                            is offering to do something, and this one is not
                            going to. The title says why, and the confirm path
                            below stays as the backstop. */}
                        <button type="button" onClick={() => deleteShell(c)}
                          disabled={isSaving || c.submissionCount > 0}
                          title={c.submissionCount > 0
                            ? `Has ${c.submissionCount} student submission${c.submissionCount === 1 ? '' : 's'} — cannot be deleted`
                            : 'Delete this course shell'}
                          aria-label={`Delete ${c.name}`}
                          className="p-2 rounded-lg shrink-0 bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-slate-100 disabled:hover:text-slate-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <Link to={`/admin/teachers/${c.teacher?.id}`}
                          className="min-w-0 text-xs font-semibold text-brand-navy bg-blue-50 border border-blue-100 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 flex items-center gap-1">
                          <span className="truncate">{c.teacher?.name || 'Unassigned'}</span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Edit course shell modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Edit course shell</h2>
            <p className="text-slate-500 text-sm mb-5">
              {editing.section?.name ? <>{editing.subject} taught to <span className="font-semibold">{editing.section.name}</span>. </> : null}
              The section, subject and school year are fixed — a shell taught to a different block is a different shell.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); saveEdit(); }} className="space-y-4" autoComplete="off">
              <div>
                <label htmlFor="edit-shell-name" className="block text-sm font-medium text-slate-700 mb-1">Class name *</label>
                <input id="edit-shell-name" type="text" value={editForm.name} autoComplete="off" autoFocus
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
              </div>

              <div>
                <label htmlFor="edit-shell-teacher" className="block text-sm font-medium text-slate-700 mb-1">Teacher *</label>
                <select id="edit-shell-teacher" value={editForm.teacherId}
                  onChange={e => setEditForm({ ...editForm, teacherId: e.target.value })}
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  {!editForm.teacherId && <option value="">-- Choose a teacher --</option>}
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                </select>
                {editForm.teacherId !== editing.teacher?.id && editForm.teacherId && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-2 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    The shell moves with everything in it — {editing.activityCount} activit{editing.activityCount === 1 ? 'y' : 'ies'}
                    {' '}and {editing.submissionCount} submission{editing.submissionCount === 1 ? '' : 's'}. Nothing is deleted.
                  </p>
                )}
              </div>

              {editError && (
                <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {editError}
                </p>
              )}

              {/* Deleting is deliberately absent. It needs the surrounding "what
                  else would this teacher be left with" context, which is the
                  teacher page — reachable from the chip on the card. */}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditing(null)} disabled={isSaving}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">Cancel</button>
                <button type="submit" disabled={isSaving}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Check className="w-4 h-4" /> Save changes</>}
                </button>
              </div>
            </form>
          </div>
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
                  {/* The block's own name only: "Newton", "Ruby", "Tesla". */}
                  <label className="block text-sm font-medium text-slate-700 mb-1">Section name</label>
                  <input type="text" value={form.name} autoComplete="off"
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Newton"
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">
                Just the block &mdash; Newton, Ruby, Tesla. Leave it blank to use the section chosen above
                {defaultShellName && <> &mdash; this one saves as <span className="font-semibold text-brand-navy">{defaultShellName}</span></>}.
                The subject and grade level come from the fields above, so they are not typed here.
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
