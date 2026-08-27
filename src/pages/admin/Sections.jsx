import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Plus, Loader2, X, Search, ChevronRight, Users } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR, formatSectionName } from '../../constants/school';
import RosterEditor from '../../components/RosterEditor';
import SectionMoveConfirm from '../../components/SectionMoveConfirm';
import StudentCredentials from '../../components/StudentCredentials';
import {
  rowsFromExtraction, isFilledRow, rosterPayload, emptyRoster, withBlankRow, foldForSearch,
} from '../../utils/roster';

import { showAlert } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Every block section in the school, on its own screen.
 *
 * This list and its create form used to sit at the bottom of the Teachers
 * page, below the staff accounts — which put the school's whole roster
 * structure behind a heading about something else, and made "where are my
 * sections" a question with no answer in the navigation. Sections are not a
 * property of the teacher list; they are one of the two things this console
 * provisions, so they get a destination.
 *
 * Only the list and the create form live here. Everything about one section —
 * its roster, its adviser, transfers, deletion — is the section page, which
 * every card links to.
 */
export default function AdminSections() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [query, setQuery] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR, teacherId: '' });
  const [rows, setRows] = useState(emptyRoster);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const rosterFileRef = useRef(null);
  // Sign-in details for the accounts just created. Shown once or never — a
  // generated password cannot be recovered.
  const [newAccounts, setNewAccounts] = useState([]);
  const [notice, setNotice] = useState('');
  // Set when the server left names alone because they are enrolled elsewhere.
  // Holds the new section's id: the replay goes to the roster endpoint rather
  // than back through create — see the note on the section route.
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
    setForm({
      name: '', gradeLevel: '', schoolYear: DEFAULT_SCHOOL_YEAR,
      // Pre-selected when there is exactly one teacher, since there is no
      // choice to make — but never guessed at when there is.
      teacherId: (data?.teachers || []).length === 1 ? data.teachers[0].id : '',
    });
    setRows(emptyRoster());
    setError('');
    setShowForm(true);
  };

  /**
   * Create the section, and enrol the names typed with it.
   *
   * The roster used to be optional. It is not: a block with no learners in it
   * is not yet a section, it is a name — nothing can be taught into it, no
   * gradebook opens, and the empty ones simply accumulated in this list. The
   * adviser is required for the same reason, and the server refuses without
   * one either way.
   *
   * The name is normalised against the grade level rather than taken as typed,
   * so every section in the school reads the same way — see formatSectionName.
   */
  const createSection = async () => {
    if (isSaving) return;                     // guards an impatient second click
    const name = formatSectionName(form.name, form.gradeLevel);
    if (!name) return setError('Please give this section a name — for example "Sampaguita".');
    if (!form.teacherId) return setError('Choose the teacher who will advise this section.');
    if (!rows.some(isFilledRow)) {
      return setError('Add at least one learner. A section is created with the class list that is in it.');
    }
    // Returns null once the admin has been asked to fix an unreadable birthday.
    const studentsList = rosterPayload(rows, showAlert);
    if (!studentsList) return;

    setIsSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name, studentsList }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        // Kept in the form rather than raised as a page banner: the usual
        // refusal is "that name is already taken", which is only actionable
        // while looking at the field you would change.
        setError(d?.error || 'That section could not be created.');
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
        setShowForm(false);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  /** The admin confirmed the moves — replay the same roster against the new section. */
  const confirmMoves = async () => {
    const req = moveRequest;
    if (!req) return;
    setIsSaving(true);
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
      setIsSaving(false);
      setMoveRequest(null);
      setShowForm(false);
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
        setRows(prev => withBlankRow([...prev.filter(isFilledRow), ...extracted]));
      } else {
        setError(d?.error || 'No learners were found in that file.');
      }
    } catch {
      setError('Network error while reading the file.');
    } finally {
      setIsExtracting(false);
      e.target.value = '';   // so picking the same file again still fires
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading sections...</div>;
  }

  const teachers = data?.teachers || [];
  const allSections = data?.sections || [];

  // Folded the same way every other roster search in the app folds, so a query
  // means one thing across the product: accents dropped, punctuation reduced to
  // spaces. Matches the adviser's name too — "whose blocks are these" is the
  // other question this list is asked.
  const q = foldForSearch(query);
  const sections = q
    ? allSections.filter(s =>
        foldForSearch(s.name).includes(q) || foldForSearch(s.teacher?.name || '').includes(q))
    : allSections;

  const byGrade = sections.reduce((acc, s) => {
    const key = s.gradeLevel || 'Unassigned grade level';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});
  // Ordered by the canonical grade list — a plain sort puts "Grade 10" between
  // "Grade 1" and "Grade 2".
  const gradeOrder = [...GRADE_LEVELS, 'Unassigned grade level'];
  const gradeKeys = Object.keys(byGrade).sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));
  const totalStudents = allSections.reduce((n, s) => n + (s._count?.students || 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Block Sections</h1>
          <p className="text-slate-500 text-sm">
            {allSections.length} section{allSections.length === 1 ? '' : 's'} · {totalStudents} learner
            {totalStudents === 1 ? '' : 's'} across {data?.school?.name || 'your school'}
          </p>
        </div>
        <button onClick={openForm} disabled={teachers.length === 0}
          title={teachers.length === 0 ? 'Add a teacher first — every section needs an adviser' : 'Create a block section'}
          className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2 shrink-0 disabled:opacity-40 disabled:hover:bg-brand-navy">
          <Plus className="w-4 h-4" /> Add Section
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

      <StudentCredentials students={newAccounts} onClose={() => setNewAccounts([])} />

      <SectionMoveConfirm
        moves={moveRequest?.moves}
        targetSection={moveRequest?.section?.name}
        busy={isSaving}
        onConfirm={confirmMoves}
        onCancel={() => { setMoveRequest(null); setShowForm(false); }}
      />

      {allSections.length > 6 && (
        <div className="relative mb-5">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by section name or adviser..."
            aria-label="Search sections"
            className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-navy bg-white shadow-sm"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {allSections.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-500">No sections yet</p>
          <p className="text-sm mt-1">
            {teachers.length === 0
              ? <>Add a teacher first — every section needs an adviser. <Link to="/admin/teachers" className="text-brand-navy font-semibold hover:underline">Go to Teachers</Link>.</>
              : 'Use "Add Section" above to create one and name its adviser.'}
          </p>
        </div>
      ) : sections.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No section matches &ldquo;{query}&rdquo;</p>
          <p className="text-sm mt-1">Try a section name or an adviser&rsquo;s name.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {gradeKeys.map(grade => (
            <div key={grade}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-brand-navy bg-blue-50 px-2.5 py-1 rounded-full">{grade}</span>
                <span className="text-xs text-slate-400">
                  {byGrade[grade].length} section{byGrade[grade].length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {byGrade[grade].map(s => (
                  <Link key={s.id} to={`/admin/sections/${s.id}`}
                    className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-2 hover:border-brand-navy hover:shadow-sm transition-all group">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-slate text-sm truncate group-hover:text-brand-navy">{s.name}</p>
                      <p className="text-xs text-slate-400 truncate">Adviser: {s.teacher?.name || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full flex items-center gap-1">
                        <Users className="w-3 h-3" /> {s._count?.students || 0}
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

      {/* Add section modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          {/* max-w-4xl, not 2xl: at two columns the roster editor was getting
              about half of 42rem, which left the learner's name box narrower
              than the names going into it. */}
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl shadow-xl my-8">
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
                    <input required type="text" value={form.name} autoComplete="off"
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Sampaguita"
                      className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                    {/* The grade level below is prepended on save, so the name
                        that will actually exist is shown while it is being
                        typed rather than discovered afterwards in the list. */}
                    {form.name.trim() && (
                      <p className="text-xs text-slate-500 mt-1.5">
                        {form.gradeLevel
                          ? <>Saved as <span className="font-semibold text-brand-navy">{formatSectionName(form.name, form.gradeLevel)}</span> — the grade level is added for you.</>
                          : <>Saved as <span className="font-semibold text-brand-navy">{formatSectionName(form.name, '')}</span>. Choose a grade level below and it is added to the front.</>}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Adviser *</label>
                    <select required value={form.teacherId}
                      onChange={e => setForm({ ...form, teacherId: e.target.value })}
                      className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                      <option value="">-- Choose a teacher --</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">
                      The homeroom teacher responsible for this block. You can change it later from the section page.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Grade level</label>
                      <select value={form.gradeLevel}
                        onChange={e => setForm({ ...form, gradeLevel: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                        <option value="">-- Select --</option>
                        {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">School year *</label>
                      <select required value={form.schoolYear}
                        onChange={e => setForm({ ...form, schoolYear: e.target.value })}
                        className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                        {SCHOOL_YEARS.map(sy => <option key={sy} value={sy}>{sy}</option>)}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Section names have to be unique within a school year, so next June&rsquo;s intake gets its own
                    roster rather than joining this year&rsquo;s.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-brand-navy">
                    Step 2 · Who is in it <span className="text-red-500">*</span>
                  </p>
                  <RosterEditor
                    rows={rows}
                    onChange={setRows}
                    onPickFile={() => rosterFileRef.current?.click()}
                    isExtracting={isExtracting}
                    fileRef={rosterFileRef}
                    onFileChange={handleRosterFile}
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}

              <div className="flex gap-2">
                <button type="button" onClick={() => setShowForm(false)} disabled={isSaving}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-40">Cancel</button>
                <button type="submit" disabled={isSaving}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Section'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
