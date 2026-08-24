import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, ChevronDown, Loader2 } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import PageHeader from '../../components/PageHeader';
import { gradeTone, toPoints, formatPoints, computeGrade, defaultPolicyFor } from '../../utils/grading';
import { usePassingGrade } from '../../utils/useSchool';
import { fileNameFromDisposition, gradebookFileName } from '../../utils/exportFile';

import { showAlert } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Score colouring lives in utils/grading and follows the school's passing grade.

/**
 * The value the term filter holds when it is not narrowing anything, and the
 * one it holds for work nobody has placed in a term yet.
 *
 * 'untagged' is a real choice rather than a leftover: `Activity.term` is
 * nullable and every activity created before it existed is null, so a filter
 * offering only 1/2/3 would make that work unreachable on the screen a teacher
 * uses to check their own record.
 */
const ALL_TERMS = 'all';
const NO_TERM = 'untagged';

/**
 * The DepEd component an activity counts toward, spelled out.
 *
 * Shown under each column heading because the component is what decides how
 * heavily the mark counts — a teacher looking at a grade that surprises them
 * needs to be able to see, without leaving the page, that the 100-point task
 * they thought was a Performance Task is filed as Written Work.
 */
const COMPONENT_LABELS = { WW: 'Written Work', PT: 'Performance Task', QA: 'Quarterly' };

export default function GradebookClass() {
  const passingGrade = usePassingGrade();
  const { classId } = useParams();
  const [data, setData] = useState(null);
  // Nobody signed in means there is nothing to fetch, so this must not open on
  // a spinner that only the first commit would take away again.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [term, setTerm] = useState(ALL_TERMS);
  const menuRef = useRef(null);

  // Dismiss the export menu on an outside click — without this it stays open
  // until something else re-renders.
  useEffect(() => {
    if (!showExportMenu) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showExportMenu]);

  const handleExport = async (format) => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setExporting(true);
    setShowExportMenu(false);
    try {
      // The file has to contain what the screen is showing. The Export button
      // sits directly above a term-filtered table, so a whole-year file here
      // would silently disagree with the columns the teacher was looking at
      // when they pressed it.
      //
      // 'untagged' is deliberately not sent: the server filters to a term
      // number, and there is no query that means "the ones with no term".
      // Exporting from that view falls back to every term, and the sheet says
      // which it is on its own Term: line.
      const params = new URLSearchParams({ classId, format });
      if (term !== ALL_TERMS && term !== NO_TERM) params.set('term', term);
      const response = await apiFetch(`${API_URL}/api/teacher/${user.id}/gradebook/export?${params}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // The server names the file — class, term and date — and says so in
      // Content-Disposition. This used to overwrite that with
      // `grades_<classId>.xlsx`, and classId is a uuid, so every export landed
      // in the downloads folder as `grades_3f9c1b2e-….xlsx`: unreadable, and
      // indistinguishable from every other class's.
      const className = (data?.classes || []).find(c => c.id === classId)?.name;
      a.download = fileNameFromDisposition(response.headers.get('content-disposition'))
        || gradebookFileName(className, term !== ALL_TERMS && term !== NO_TERM ? term : null, format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      showAlert('Failed to export grades. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    apiFetch(`${API_URL}/api/teacher/${user.id}/gradebook?classId=${classId}`).then(r => r.json()).then(d => { if (d.success) setData(d); }).catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [classId]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );
  if (!data) return <div className="p-8 text-center font-bold text-navy-500">No data.</div>;

  const allActivities = data.activities || [];
  const classes = data.classes || [];
  const targetClass = classes.find(c => c.id === classId) || {};
  const students = targetClass.section?.students || [];

  // ── The school's grading policy ──
  //
  // Component weights and the transmutation switch are school data — an admin
  // sets them in Admin → Grading — so the table cannot derive them and must be
  // told. They come down with the gradebook, per class, because a school may
  // set a different policy per grade level and subject.
  //
  // The fallbacks are for the moment before the response lands and for the
  // handful of accounts with no school attached; they are the same DepEd
  // defaults the server seeds with, so the number never jumps when the real
  // policy arrives unless the school has actually overridden it.
  const classGrading = data.grading?.[classId] || {};
  const policy = classGrading.policy || defaultPolicyFor(targetClass.subject);
  const useTransmutation = !!classGrading.useTransmutation;
  // The class's own school, which is the section's — not the signed-in
  // teacher's, which is what usePassingGrade resolves. They are the same
  // school in every ordinary case, and where they are not (a teacher moved
  // between schools mid-year, a co-admin looking at another site's section)
  // the line that decides pass or fail belongs to the learners' school, and
  // has to be the same one the exported sheet colours against.
  const passing = classGrading.passingGrade ?? passingGrade;

  // ── Term filter ──
  // Only the terms this class actually has work in are offered. A filter
  // showing three terms for a class that has only started the first is three
  // ways to reach an empty table.
  const termsPresent = [1, 2, 3].filter(t => allActivities.some(a => a.term === t));
  const hasUntagged = allActivities.some(a => a.term === null || a.term === undefined);
  const activities = allActivities.filter(a => {
    if (term === ALL_TERMS) return true;
    if (term === NO_TERM) return a.term === null || a.term === undefined;
    return String(a.term) === String(term);
  })
    // Oldest first. The gradebook query sorts newest-first, which is right for
    // a review queue and backwards for a record book — a teacher reads these
    // columns in the order the work was set.
    .slice().reverse();

  const scoreMap = {};
  allActivities.forEach(a => (a.submissions || []).forEach(s => {
    if (!scoreMap[s.studentId]) scoreMap[s.studentId] = {};
    scoreMap[s.studentId][a.id] = s;
  }));

  /**
   * One student's mark on one activity, in raw points.
   *
   * Raw rather than percentage on purpose: this is the detailed view, and it
   * is read the way a paper record book is — 42 out of 50, not 84%. The
   * percentage is what the whole-class averages are built from, and it is
   * still on the row total, but the cell a teacher checks against a marked
   * paper has to hold the number written on that paper.
   *
   * Drafts are shown but marked. This is the teacher's working view and hiding
   * a score they can see in the review queue would be worse than useless — but
   * only validated work is exported, so an unmarked draft here would silently
   * disagree with the file.
   */
  function cellFor(studentId, activity) {
    const sub = scoreMap[studentId]?.[activity.id];
    if (!sub) return { state: 'none' };
    if (sub.excusedAt) return { state: 'excused' };
    const percent = sub.hitlScore ?? sub.aiScore ?? null;
    if (percent === null) return { state: 'none' };
    return {
      state: 'scored',
      percent,
      points: toPoints(percent, activity.points),
      isDraft: sub.status !== 'GRADED',
    };
  }

  /**
   * The grade this class's work adds up to, for one student.
   *
   * This is the whole point of the fix. It used to be a flat points total —
   * every activity summed, divided by every activity's points — which is not
   * how a DepEd grade is computed and is not what the exported file computed
   * either. On the same class the table said 62% and the file said 87%,
   * because the table (a) gave a 10-point drill the same standing per point as
   * a 100-point performance task instead of weighting Written Work, Performance
   * Task and Quarterly Assessment by the school's policy, and (b) counted AI
   * drafts the teacher had never validated.
   *
   * Both are now the same computation: computeGrade, over validated work only,
   * with the school's own weights and its transmutation setting. The raw
   * points total is still shown underneath, because that is the number a
   * teacher checks against a stack of marked papers — it is just no longer
   * passed off as the grade.
   *
   * Excused work is dropped rather than zeroed, and a component with nothing
   * graded in it is dropped and its weight shared out over the rest — so a
   * learner excused from a task, or a quarter before the Quarterly Assessment
   * exists, is graded on what they were actually asked to do.
   */
  function gradeFor(studentId) {
    const entries = [];
    let earned = 0, possible = 0, anyMark = false, hasDraft = false;
    for (const a of activities) {
      const cell = cellFor(studentId, a);
      if (cell.state !== 'scored') continue;
      anyMark = true;
      // A draft is visible in its cell but counts toward nothing — not the
      // grade, and not the points line either. Letting the points include it
      // while the grade excluded it would rebuild a small version of the
      // discrepancy this whole change exists to remove: two numbers on one
      // row, counting different work, with nothing saying so.
      if (cell.isDraft) { hasDraft = true; continue; }
      earned += cell.points;
      possible += a.points || 100;
      entries.push({ percent: cell.percent, points: a.points || 100, component: a.component });
    }
    if (!anyMark) return null;
    const { initialGrade, finalGrade } = computeGrade(entries, policy, { transmute: useTransmutation });
    return {
      earned: Math.round(earned * 10) / 10,
      possible,
      // Null, not zero, when everything a student has is still a draft: they
      // have no grade of record yet, and a 0 would read as a failing one.
      grade: finalGrade,
      initialGrade,
      hasDraft,
    };
  }

  const anyDrafts = students.some(s => activities.some(a => cellFor(s.id, a).isDraft));

  const exportButton = (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowExportMenu(!showExportMenu)}
        disabled={exporting}
        aria-expanded={showExportMenu}
        className="tg-btn-primary !py-2.5 !px-4 text-xs"
      >
        {exporting
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <><Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span> <ChevronDown className="w-3.5 h-3.5" /></>}
      </button>
      {showExportMenu && (
        <div className="absolute right-0 mt-2 w-60 bg-white border-2 border-cream-200 rounded-2xl shadow-card-lg py-1.5 z-50">
          {/* Says what the file will hold before it is made, because the
              filter above is the only thing that decides it and the two
              controls are far enough apart to forget. */}
          <p className="px-4 py-1.5 text-[11px] font-bold text-navy-400">
            {term === ALL_TERMS || term === NO_TERM ? 'All terms' : `Term ${term} only`}
          </p>
          <button onClick={() => handleExport('csv')}
            className="w-full px-4 py-2.5 hover:bg-cream-100 flex items-center gap-2 text-sm font-bold text-navy-700">
            📄 Export as CSV
          </button>
          <button onClick={() => handleExport('xlsx')}
            className="w-full px-4 py-2.5 hover:bg-cream-100 flex items-center gap-2 text-sm font-bold text-navy-700">
            📊 Export as Excel
          </button>
        </div>
      )}
    </div>
  );

  const termChip = (value, label) => (
    <button key={value} type="button" onClick={() => setTerm(value)}
      aria-pressed={term === value}
      className={cn('px-4 py-1.5 rounded-full text-xs font-extrabold border-2 transition-colors',
        term === value
          ? 'bg-royal-500 text-white border-royal-500'
          : 'bg-white text-navy-600 border-cream-200 hover:border-royal-300')}>
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title={targetClass.name || 'Class'}
        subtitle={targetClass.section?.name ? `Section ${targetClass.section.name}` : undefined}
        back
        actions={exportButton}
      />

      <div className="tg-page pt-4 md:pt-0">
        {(termsPresent.length > 0 || hasUntagged) && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {termChip(ALL_TERMS, 'All terms')}
            {termsPresent.map(t => termChip(String(t), `Term ${t}`))}
            {hasUntagged && termChip(NO_TERM, 'No term set')}
          </div>
        )}

        {activities.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-cream-300 rounded-3xl">
            <p className="font-bold text-navy-600">
              {term === ALL_TERMS ? 'No activities yet for this class' : 'No activities in this term'}
            </p>
            <p className="text-sm text-navy-400 mt-1">
              {term === ALL_TERMS
                ? 'Create activities in this class to see grades here.'
                : 'Pick another term, or set this term on an activity in the Activity Builder.'}
            </p>
          </div>
        ) : (
          <>
            <p className="md:hidden text-[11px] font-bold text-navy-400 mb-2">← Swipe the table to see all columns</p>

            <div className="overflow-x-auto rounded-3xl border-2 border-cream-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-cream-100 border-b-2 border-cream-200">
                    <th className="px-4 py-3 text-left font-extrabold text-navy-700 sticky left-0 bg-cream-100 min-w-[190px] z-10">Student</th>
                    {activities.map(a => (
                      /* One column per activity, headed with what it is out of
                         — a raw mark is meaningless without its denominator,
                         and repeating "/50" in forty cells is noise.

                         The title wraps in full rather than being clipped to
                         two lines. Every activity a teacher sets in a term
                         tends to start with the same words ("PETA GOLD #9",
                         "PETA GOLD #10"), so a clipped heading hid the only
                         part that told two columns apart — and the teacher had
                         no way to see the rest without leaving the page. */
                      <th key={a.id} title={a.title}
                        className="px-3 py-3 text-center font-extrabold text-navy-700 min-w-[120px] align-top">
                        {/* The cap goes on this div, not on the <th>: table
                            layout ignores max-width on a cell, so a single
                            long title would otherwise stretch its column
                            across the screen instead of wrapping. */}
                        <div className="max-w-[180px] mx-auto leading-snug whitespace-normal break-words">{a.title}</div>
                        <div className="text-[10px] text-navy-400 font-bold mt-1">
                          {a.points} pts{a.component ? ` · ${COMPONENT_LABELS[a.component] || a.component}` : ''}
                        </div>
                        {a.type && (
                          <div className="text-[10px] text-navy-400 font-semibold">{a.type}</div>
                        )}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-extrabold text-navy-700 min-w-[124px] align-top">
                      {/* Named for what it is. It used to say "Total / points"
                          while holding a flat points percentage that no report
                          card would ever show; this is the DepEd grade, and it
                          says which basis produced it. */}
                      <div>{useTransmutation ? 'Final Grade' : 'Initial Grade'}</div>
                      <div className="text-[10px] text-navy-400 font-bold mt-1">
                        {useTransmutation ? 'transmuted · DO 8' : 'weighted · DO 8'}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr><td colSpan={activities.length + 2} className="py-12 text-center font-bold text-navy-400">No students found</td></tr>
                  ) : students.map(student => {
                    const total = gradeFor(student.id);
                    return (
                      <tr key={student.id}
                        className={cn(
                          'border-b border-cream-200 last:border-0 hover:bg-cream-50 transition-colors',
                          student.transferredOut && 'opacity-60'
                        )}>
                        <td className="px-4 py-3 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-royal-100 flex items-center justify-center text-royal-700 font-extrabold text-xs shrink-0">
                              {student.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <Link to={`/teacher/gradebook/student/${student.id}`}
                                className="font-bold text-navy-700 text-sm hover:text-royal-600 truncate block">
                                {student.name}
                              </Link>
                              <p className="text-xs text-navy-400 font-semibold truncate">{student.username}</p>
                              {student.transferredOut && (
                                <p className="text-[11px] font-bold text-slate-500 truncate">
                                  Transferred out {new Date(student.transferredOutAt).toLocaleDateString('en-GB', {
                                    timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric',
                                  })}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        {activities.map(a => {
                          const cell = cellFor(student.id, a);
                          if (cell.state === 'excused') {
                            return (
                              <td key={a.id} className="px-4 py-3 text-center">
                                <span className="text-[11px] font-bold text-lilac-700" title="Excused — does not count toward the total">Exc</span>
                              </td>
                            );
                          }
                          if (cell.state !== 'scored') {
                            return <td key={a.id} className="px-4 py-3 text-center text-navy-300">—</td>;
                          }
                          return (
                            <td key={a.id} className="px-4 py-3 text-center">
                              {/* Colour on the number itself rather than a
                                  filled pill: forty pills in a row is a wall,
                                  and this table is read by scanning down a
                                  column for the low marks. */}
                              <span className={cn('font-extrabold tabular-nums', gradeTone(cell.percent, passing))}
                                title={cell.isDraft
                                  ? 'An AI draft you have not validated yet. It counts toward nothing — not the grade, not the class average, and it is not exported.'
                                  : `${Math.round(cell.percent)}% of ${a.points} pts`}>
                                {formatPoints(cell.percent, a.points)}
                                {cell.isDraft && <span className="text-amber-600">*</span>}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center">
                          {total === null ? (
                            <span className="text-navy-300">—</span>
                          ) : (
                            <>
                              {/* The grade leads, the raw points follow. The
                                  points are still worth showing — it is what a
                                  teacher checks against a stack of marked
                                  papers — but they are not the grade, and
                                  showing them as one is what made this table
                                  disagree with the exported file. */}
                              <span className={cn('font-extrabold text-base tabular-nums', gradeTone(total.grade, passing))}
                                title={total.grade === null
                                  ? 'Nothing validated yet — every mark here is still an AI draft.'
                                  : useTransmutation
                                    ? `Initial Grade ${Math.round(total.initialGrade)}, transmuted to ${total.grade} (DepEd DO 8 s.2015).`
                                    : `Points-weighted across Written Work, Performance Task and Quarterly Assessment (DepEd DO 8 s.2015).`}>
                                {total.grade === null ? '—' : total.grade}
                                {total.hasDraft && <span className="text-amber-600">*</span>}
                              </span>
                              {total.possible > 0 && (
                                <p className="text-[10px] font-bold text-navy-400 tabular-nums">
                                  {total.earned}/{total.possible} pts
                                </p>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-royal-50 border-t-2 border-royal-100">
                    <td className="px-4 py-3 font-extrabold text-royal-700 text-sm sticky left-0 bg-royal-50 z-10">Class Average</td>
                    {activities.map(a => {
                      // Averaged over the learners who have a validated mark,
                      // in points, so it lands in the same unit as the column
                      // above it and in the same unit as the exported sheet.
                      //
                      // Drafts and transferred-out learners are both left out,
                      // for the reasons the footnote and the export give: a
                      // draft is not a grade, and a learner who left is graded
                      // on the part of the quarter they were present for.
                      const pts = students
                        .filter(s => !s.transferredOut)
                        .map(s => cellFor(s.id, a))
                        .filter(c => c.state === 'scored' && !c.isDraft)
                        .map(c => c.points);
                      return (
                        <td key={a.id} className="px-4 py-3 text-center text-sm font-extrabold text-royal-700 tabular-nums">
                          {pts.length
                            ? Math.round((pts.reduce((x, y) => x + y, 0) / pts.length) * 10) / 10
                            : '—'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center text-sm font-extrabold text-royal-700 tabular-nums">
                      {(() => {
                        // The mean of the learners who have a grade, over the
                        // current roster only — a learner who transferred out
                        // is graded on the part of the quarter they were here
                        // for, so averaging them in compares two different
                        // things. Same rule as the exported sheet.
                        const grades = students
                          .filter(s => !s.transferredOut)
                          .map(s => gradeFor(s.id)?.grade)
                          .filter(g => typeof g === 'number');
                        if (!grades.length) return '—';
                        return Math.round(grades.reduce((sum, g) => sum + g, 0) / grades.length);
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {anyDrafts && (
              <p className="mt-3 text-xs font-semibold text-navy-500 flex items-start gap-1.5">
                <span className="text-amber-600 font-extrabold shrink-0">*</span>
                Includes an AI draft you haven&apos;t validated yet. Drafts show here so you can see where the class
                stands, but they are not part of the official record — they are left out of the grade column, the
                class average and the exported file alike. Validate them in the review queue to lock them in.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
