import { useState, useEffect, useRef } from 'react';
import { Users, Plus, ChevronDown, X, Pencil, UserPlus, Loader2, Search, KeyRound } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS } from '../../constants/school';
import StudentCredentials from '../../components/StudentCredentials';
import SectionMoveConfirm from '../../components/SectionMoveConfirm';
import RosterEditor from '../../components/RosterEditor';
import { parseRosterLines, isFilledRow, rosterPayload, emptyRoster, withBlankRow } from '../../utils/roster';

export default function ManageSections() {
  const [sections, setSections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [studentRows, setStudentRows] = useState(emptyRoster);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const fileInputRef = useRef(null);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [addStudentRows, setAddStudentRows] = useState(emptyRoster);
  const [isAddingStudents, setIsAddingStudents] = useState(false);
  const [isExtractingEdit, setIsExtractingEdit] = useState(false);
  const editFileRef = useRef(null);
  // Sign-in details for the accounts just created, and the plain summary line.
  const [newAccounts, setNewAccounts] = useState([]);
  const [notice, setNotice] = useState('');
  // Set when the server refused to re-home names already enrolled elsewhere.
  // Holds everything needed to replay the same request with allowMove.
  const [moveRequest, setMoveRequest] = useState(null);
  // The learner whose password was last reset, and what it now is. One at a
  // time on purpose — this is read out loud to one child at a keyboard.
  const [resetResult, setResetResult] = useState(null);
  const [resettingId, setResettingId] = useState(null);

  useEffect(() => { fetchSections(); }, []);

  /**
   * Fix a misspelt name. The student ID is their login and is left alone —
   * see the route's comment.
   */
  const renameStudent = async (sectionId, student) => {
    const name = prompt(
      `Correct the spelling of this learner's name.\n\nTheir Student ID (${student.username}) will not change, so they sign in exactly as before.`,
      student.name
    );
    if (name === null) return;                       // cancelled
    const trimmed = name.trim();
    if (!trimmed || trimmed === student.name) return;

    try {
      const res = await apiFetch(
        `${API_URL}/api/teacher/sections/${sectionId}/students/${student.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        }
      );
      const data = await res.json();
      if (data.success) fetchSections();
      else alert('Could not rename: ' + (data.error || 'unknown error'));
    } catch {
      alert('Cannot reach the server. Check your connection and try again.');
    }
  };

  /**
   * Give one learner a new password, in front of them.
   *
   * Confirmed first because it ends their current session: a learner who is
   * signed in on another machine is signed out by this, which is the right
   * behaviour for a forgotten password and a surprise for anything else.
   */
  const resetStudentPassword = async (sectionId, student) => {
    if (!confirm(
      `Give ${student.name} a new password?\n\n`
      + 'They will be signed out everywhere, and you will need to read the new password to them.'
    )) return;

    setResettingId(student.id);
    setResetResult(null);
    try {
      const res = await apiFetch(
        `${API_URL}/api/teacher/sections/${sectionId}/students/${student.id}/password`,
        { method: 'PUT' }
      );
      const data = await res.json();
      if (data.success) {
        setResetResult({ id: student.id, password: data.password, source: data.passwordSource });
      } else {
        alert('Could not reset the password: ' + (data.error || 'unknown error'));
      }
    } catch {
      alert('Cannot reach the server. Check your connection and try again.');
    } finally {
      setResettingId(null);
    }
  };

  const fetchSections = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (!user) return;
      const res = await apiFetch(`${API_URL}/api/teacher/${user.id}/sections`);
      const data = await res.json();
      if (data.success) setSections(data.sections);
    } catch (e) { console.error(e); }
  };

  /** Rows to send, or null once the teacher has been asked to fix a date. */
  const payloadFrom = (rows) => rosterPayload(rows, alert);

  /**
   * The one call both "create a section" and "add students" make.
   *
   * `allowMove` is off on the first attempt, so the server reports names that
   * already belong to another section instead of quietly re-homing them. When
   * the teacher confirms, the identical request is replayed with it on.
   */
  const submitRoster = async ({ sectionName, grade, studentsList, allowMove, onDone }) => {
    const user = JSON.parse(localStorage.getItem('user'));
    const res = await apiFetch(`${API_URL}/api/teacher/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sectionName, gradeLevel: grade, teacherId: user.id, studentsList, allowMove })
    });
    const data = await res.json();
    if (!data.success) { alert('Error: ' + data.error); return null; }

    fetchSections();
    // Appended, not replaced: the confirm-and-replay path runs this twice, and
    // the second pass reports only the moves — replacing would throw away the
    // passwords the first pass generated, which are unrecoverable.
    setNewAccounts(prev => [...prev, ...(data.createdStudents || [])]);

    const lines = [data.message].filter(Boolean);
    if (data.skippedStudents?.length) {
      lines.push(`Already in this section, so left alone: ${data.skippedStudents.map(s => s.name).join(', ')}.`);
    }
    if (data.linkedStudents?.length) {
      lines.push(`Moved into this section: ${data.linkedStudents.map(s => `${s.name} (${s.username})`).join(', ')}.`);
    }
    setNotice(lines.join(' '));

    if (data.pendingMoves?.length) {
      // Nothing was written for these — hold the request so it can be replayed.
      setMoveRequest({ sectionName, grade, studentsList, moves: data.pendingMoves, onDone });
    } else {
      onDone?.();
    }
    return data;
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const studentsList = payloadFrom(studentRows);
    if (!studentsList) return;
    if (!studentsList.length) return alert('Please add at least one learner.');
    setIsLoading(true);
    setNewAccounts([]);
    try {
      await submitRoster({
        sectionName: name, grade: gradeLevel, studentsList, allowMove: false,
        onDone: () => { setName(''); setGradeLevel(''); setStudentRows(emptyRoster()); setShowForm(false); }
      });
    } catch { alert('Network error.'); }
    finally { setIsLoading(false); }
  };

  /** The teacher confirmed the move — replay the same roster with allowMove. */
  const confirmMoves = async () => {
    const req = moveRequest;
    if (!req) return;
    setIsLoading(true);
    try {
      // submitRoster runs onDone itself once nothing is left pending.
      await submitRoster({ ...req, allowMove: true });
      setMoveRequest(null);
    } catch { alert('Network error.'); }
    finally { setIsLoading(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsExtracting(true);
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/extract-students`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.names) {
        // Appended to whatever is already typed, and re-parsed so an extracted
        // "Name, 03/15/2014" still lands in two columns.
        const extracted = parseRosterLines(data.names.join('\n'));
        setStudentRows(prev => withBlankRow([...prev.filter(isFilledRow), ...extracted]));
      } else {
        alert("Extraction failed: " + data.error);
      }
    } catch (error) {
      alert("Network error during extraction.");
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSection = (id) => setExpandedId(prev => prev === id ? null : id);

  const handleAddStudents = async (section) => {
    const studentsList = payloadFrom(addStudentRows);
    if (!studentsList) return;
    if (!studentsList.length) return alert('Please enter at least one student name.');
    setIsAddingStudents(true);
    setNewAccounts([]);
    try {
      await submitRoster({
        sectionName: section.name, grade: section.gradeLevel, studentsList, allowMove: false,
        onDone: () => { setAddStudentRows(emptyRoster()); setEditingSectionId(null); }
      });
    } catch { alert('Network error.'); }
    finally { setIsAddingStudents(false); }
  };

  const handleEditFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtractingEdit(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/extract-students`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.names) {
        const extracted = parseRosterLines(data.names.join('\n'));
        setAddStudentRows(prev => withBlankRow([...prev.filter(isFilledRow), ...extracted]));
      } else { alert('Extraction failed: ' + data.error); }
    } catch (error) { alert('Network error during extraction.'); }
    finally {
      setIsExtractingEdit(false);
      if (editFileRef.current) editFileRef.current.value = '';
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Block Sections</h1>
          <p className="text-slate-500 text-sm">Shared school-wide sections and student accounts</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm ${showForm ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-brand-navy text-white hover:bg-blue-900'}`}>
          {showForm ? <><X className="w-4 h-4" /> Close</> : <><Plus className="w-4 h-4" /> Create Section</>}
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
        targetSection={moveRequest?.sectionName}
        busy={isLoading || isAddingStudents}
        onConfirm={confirmMoves}
        onCancel={() => { setMoveRequest(null); moveRequest?.onDone?.(); }}
      />

      <div className="mb-6 relative">
        <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sections by name..." 
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-navy outline-none shadow-sm"
        />
      </div>

      {/* Collapsible Create Form */}
      {showForm && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-8 animate-in slide-in-from-top">
          <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-brand-navy" /> New Section
          </h2>
          {/* Two columns, separated and numbered: naming the section and
              listing forty learners are different jobs, and running them
              together down one page made the roster box look like one more
              field on the same form. Stacks on a narrow screen, where a
              divider would be meaningless. */}
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ── Column 1: the section itself ── */}
              <div className="space-y-4 lg:border-r lg:border-slate-200 lg:pr-6">
                <p className="text-xs font-extrabold uppercase tracking-wider text-brand-navy">
                  Step 1 · About the section
                </p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Section Name</label>
                  <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                    placeholder="e.g. Rizal" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level *</label>
                  <select required value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                    <option value="">-- Select --</option>
                    {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <p className="text-xs text-slate-400">
                  Sections are shared with everyone at your school and grouped by grade level. If this
                  section already exists, students will be added to it.
                </p>
              </div>

              {/* ── Column 2: who is in it ── */}
              <div className="space-y-2">
                <p className="text-xs font-extrabold uppercase tracking-wider text-brand-navy">
                  Step 2 · Who is in it
                </p>
                <RosterEditor
                  rows={studentRows}
                  onChange={setStudentRows}
                  onPickFile={() => fileInputRef.current?.click()}
                  isExtracting={isExtracting}
                  fileRef={fileInputRef}
                  onFileChange={handleFileUpload}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={isLoading}
                className="flex-1 py-2.5 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900 transition-colors disabled:opacity-50">
                {isLoading ? 'Creating...' : 'Create Section & Accounts'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sections List */}
      <div className="space-y-3">
        {(() => {
          const filteredSections = sections.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
          
          if (sections.length === 0) {
            return (
              <div className="text-center p-12 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500">
                <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">No sections yet</p>
                <p className="text-sm mt-1">Click "Create Section" above to get started.</p>
              </div>
            );
          }

          if (filteredSections.length === 0) {
            return (
              <div className="text-center p-12 border border-slate-200 bg-white rounded-2xl text-slate-500">
                <Search className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">No sections found matching "{searchQuery}"</p>
              </div>
            );
          }

          // Segment by grade level, ordered by the canonical grade list so
          // "Grade 10" doesn't sort between "Grade 1" and "Grade 2".
          const byGrade = filteredSections.reduce((acc, s) => {
            const key = s.gradeLevel || 'Unassigned grade level';
            (acc[key] = acc[key] || []).push(s);
            return acc;
          }, {});
          const gradeOrder = [...GRADE_LEVELS, 'Unassigned grade level'];
          const gradeKeys = Object.keys(byGrade).sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));

          return gradeKeys.map(grade => (
            <div key={grade} className="pt-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-brand-navy bg-blue-50 px-2.5 py-1 rounded-full">{grade}</span>
                <span className="text-xs text-slate-400">
                  {byGrade[grade].length} section{byGrade[grade].length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-3">
          {byGrade[grade].map(section => {
            const isOpen = expandedId === section.id;
            const studentCount = section._count?.students || section.students?.length || 0;
            return (
              <div key={section.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="w-full p-4 flex justify-between items-center hover:bg-slate-50 transition-colors">
                  <button onClick={() => toggleSection(section.id)} className="flex items-center gap-3 flex-1 text-left">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-brand-navy flex items-center justify-center font-bold text-sm">
                      {studentCount}
                    </div>
                    <div>
                      <h3 className="font-bold text-brand-slate flex items-center gap-2">
                        {section.name}
                        {section.isOwn === false && (
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            {section.teacher?.name || 'Colleague'}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-500">{studentCount} student{studentCount !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setEditingSectionId(prev => prev === section.id ? null : section.id); setAddStudentRows(emptyRoster()); if (expandedId !== section.id) setExpandedId(section.id); }}
                      className={`p-2 rounded-lg transition-colors ${editingSectionId === section.id ? 'bg-brand-navy text-white' : 'text-slate-400 hover:text-brand-navy hover:bg-blue-50'}`}
                      title="Add students to this section">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleSection(section.id)}>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
                {isOpen && section.students && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-2">
                    {/* Add Students Form */}
                    {editingSectionId === section.id && (
                      <div className="mb-4 p-4 bg-blue-50/50 border border-blue-200 rounded-xl">
                        <h4 className="text-sm font-bold text-brand-navy mb-3 flex items-center gap-2">
                          <UserPlus className="w-4 h-4" /> Add Students to {section.name}
                        </h4>
                        <div className="space-y-3">
                          <RosterEditor
                            rows={addStudentRows}
                            onChange={setAddStudentRows}
                            onPickFile={() => editFileRef.current?.click()}
                            isExtracting={isExtractingEdit}
                            fileRef={editFileRef}
                            onFileChange={handleEditFileUpload}
                          />
                          <div className="flex gap-2">
                            <button onClick={() => { setEditingSectionId(null); setAddStudentRows(emptyRoster()); }}
                              className="flex-1 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-white">Cancel</button>
                            <button onClick={() => handleAddStudents(section)} disabled={isAddingStudents || !addStudentRows.some(isFilledRow)}
                              className="flex-1 py-2 bg-brand-navy text-white rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                              {isAddingStudents ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : <><UserPlus className="w-4 h-4" /> Add Students</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {section.students.length === 0 ? (
                      <p className="text-sm text-slate-400 py-2">No students in this section.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-72 overflow-y-auto">
                        {section.students.map((s, i) => (
                          <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                            <span className="text-xs text-slate-400 w-5 text-right font-mono">{i + 1}</span>
                            <div className="w-7 h-7 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center text-xs font-bold shrink-0">
                              {s.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-brand-slate truncate">{s.name}</p>
                              <p className="text-[11px] text-slate-400 font-mono">ID: {s.username}</p>
                              {/* Shown inline and left on screen until the next
                                  reset: the teacher has to read it out to the
                                  learner, and a toast that fades is exactly the
                                  mistake the old window.alert made. */}
                              {resetResult?.id === s.id && (
                                <p className="mt-1 text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 inline-block">
                                  New password: <span className="font-mono select-all">{resetResult.password}</span>
                                  {resetResult.source === 'birthday' ? ' (their birthday)' : ' — write this down, it is random'}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => renameStudent(section.id, s)}
                              className="shrink-0 text-[11px] font-bold text-brand-navy border border-slate-200 bg-white px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-1"
                              title={`Correct ${s.name}'s spelling`}
                            >
                              <Pencil className="w-3 h-3" /> Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => resetStudentPassword(section.id, s)}
                              disabled={resettingId === s.id}
                              className="shrink-0 text-[11px] font-bold text-brand-navy border border-slate-200 bg-white px-2.5 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
                              title={`Reset ${s.name}'s password`}
                            >
                              <KeyRound className="w-3 h-3" />
                              {resettingId === s.id ? 'Resetting…' : 'Reset password'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
              </div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
