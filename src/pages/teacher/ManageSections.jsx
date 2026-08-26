import { useState, useEffect } from 'react';
import { Users, ChevronDown, Search, Info } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS } from '../../constants/school';
import { matchesRosterQuery, foldForSearch, sortRosterByName } from '../../utils/roster';

/**
 * The block sections a teacher works in, as a reference list.
 *
 * This screen used to create sections and their student accounts, add learners
 * to an existing roster, correct a misspelt name and reset a learner's
 * password. All four are the school admin's now, and the routes behind them are
 * gone — a section, its adviser and its roster are decisions made once for the
 * whole school rather than separately by each teacher who needs them.
 *
 * What remains is the question this page was most used for anyway: which block
 * is this child in, and who advises it. So the search, the grade-level
 * segmentation and the rosters all stay, and the controls that wrote are gone
 * rather than left on screen to fail. The banner names where the work moved to,
 * because a teacher who came here to fix a spelling needs to be told who can.
 */
export default function ManageSections() {
  const [sections, setSections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  // Past school years are collapsed by default; the server flags them rather
  // than withholding them, so this is purely a view toggle.
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = sections.filter(s => s.isArchived).length;

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user?.id) return;
    apiFetch(`${API_URL}/api/teacher/${user.id}/sections`)
      .then(r => r.json())
      .then(d => { if (d.success) setSections(d.sections); })
      .catch(() => {}); /* a failed read leaves the empty state, which is what renders */
  }, []);

  const toggleSection = (id) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">Block Sections</h1>
        <p className="text-slate-500 text-sm">The sections and class lists your school has set up</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-xl p-4 mb-6 flex items-start gap-3">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Your school admin manages these</p>
          <p className="mt-0.5 leading-relaxed">
            Sections, class lists and student sign-in details are set up in the admin console —
            including adding a learner, correcting a misspelt name and resetting a forgotten
            password. Ask your school admin if something here needs changing.
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sections or students..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-navy outline-none shadow-sm"
          />
        </div>
        {/* Only offered when there is something to reveal, so the control does
            not imply hidden sections to a teacher in their first year. */}
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium border shadow-sm transition-colors ${
              showArchived
                ? 'bg-brand-navy text-white border-brand-navy'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showArchived ? 'Hide' : 'Show'} past years ({archivedCount})
          </button>
        )}
      </div>

      {/* Sections List */}
      <div className="space-y-3">
        {(() => {
          // Past school years are folded away rather than dropped. A section
          // that has ended is still a record — its gradebook and feedback are
          // last year's marks — so "hidden" here means out of the way by
          // default, never unreachable.
          // Folded the same way the admin roster search folds, so the two
          // sides of the app agree on what a query means: accents dropped
          // ("pena" finds "Peña"), punctuation reduced to spaces, and each
          // term matched independently so word order is not a rule the
          // teacher has to guess at.
          const q = foldForSearch(searchQuery);
          const sectionNameMatches = (s) => foldForSearch(s.name).includes(q);
          const filteredSections = sections
            .filter(s => {
              if (sectionNameMatches(s)) return true;
              // Also match if any enrolled learner does, so a teacher can find
              // which block a child sits in — the one question this page's
              // search is really for.
              return (s.students || []).some(st => matchesRosterQuery(st, searchQuery));
            })
            .filter(s => showArchived || !s.isArchived);
          // When the query matched a student rather than the section name,
          // auto-expand the section so the teacher sees who matched.
          const studentMatchedIds = q
            ? filteredSections
                .filter(s => !sectionNameMatches(s) && (s.students || []).some(st => matchesRosterQuery(st, searchQuery)))
                .map(s => s.id)
            : [];

          if (sections.length === 0) {
            return (
              <div className="text-center p-12 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500">
                <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">No sections yet</p>
                <p className="text-sm mt-1">
                  They appear here as soon as your school admin creates them.
                </p>
              </div>
            );
          }

          if (filteredSections.length === 0) {
            return (
              <div className="text-center p-12 border border-slate-200 bg-white rounded-2xl text-slate-500">
                <Search className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">No sections or students found matching "{searchQuery}"</p>
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
            const isOpen = expandedId === section.id || studentMatchedIds.includes(section.id);
            const studentCount = section._count?.students || section.students?.length || 0;
            return (
              <div key={section.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button onClick={() => toggleSection(section.id)}
                  className="w-full p-4 flex justify-between items-center hover:bg-slate-50 transition-colors text-left">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-brand-navy flex items-center justify-center font-bold text-sm shrink-0">
                      {studentCount}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-brand-slate flex items-center gap-2 flex-wrap">
                        {section.name}
                        {/* Named, not just dimmed: a teacher looking at two
                            same-named blocks needs to know which year each is. */}
                        {section.isArchived && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            {section.schoolYear || 'past year'}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {studentCount} student{studentCount !== 1 ? 's' : ''}
                        {/* Every section in the school is listed, because
                            colleagues teach the same blocks. The adviser is
                            named on all of them now rather than only on
                            somebody else's: with nothing on this page editable,
                            "whose roster is this" stopped being about
                            permission and became the useful fact — they are who
                            a teacher takes a correction to. */}
                        {section.teacher?.name && <> · Adviser: {section.teacher.name}</>}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && section.students && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-2">
                    {section.students.length === 0 ? (
                      <p className="text-sm text-slate-400 py-2">No students in this section.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-72 overflow-y-auto">
                        {/* Alphabetical, the same order the admin's rosters
                            read in — for a name stored "Dela Cruz, Juan
                            Miguel" that is surname order with no parsing. The
                            whole roster stays on screen while searching, with
                            the match highlighted, because this list is short
                            enough to scan and its neighbours are the context
                            "which block is she in" is asking about. */}
                        {sortRosterByName(section.students).map((s, i) => (
                          <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                            <span className="text-xs text-slate-400 w-5 text-right font-mono">{i + 1}</span>
                            <div className="w-7 h-7 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center text-xs font-bold shrink-0">
                              {s.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Highlighted through the same matcher that did
                                  the filtering. Kept as its own test rather
                                  than reusing the section's: a query that hit
                                  the section name expands every row, and
                                  marking all of them yellow would say each one
                                  matched. */}
                              <p className="text-sm font-medium text-brand-slate truncate">{q && matchesRosterQuery(s, searchQuery) ? <span className="bg-yellow-200 rounded px-0.5">{s.name}</span> : s.name}</p>
                              <p className="text-[11px] text-slate-400 font-mono">ID: {s.username}</p>
                            </div>
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
