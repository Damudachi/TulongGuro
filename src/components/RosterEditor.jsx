import { Upload, Plus, X } from 'lucide-react';
import { isReadableDate, previewPassword, parseRosterLines, isFilledRow, rowsMissingBirthday, withBlankRow, emptyRoster, normalizeRosterName } from '../utils/roster';

/**
 * The class list, as a name column and a birthday column.
 *
 * It was one textarea taking "Last name, First name, Birthday" per line. The
 * format was doing too much work: the same comma separated a surname from a
 * first name and a name from a date, and a teacher typing forty learners had
 * to hold that in their head with no feedback until they submitted. Two
 * labelled columns say what goes where.
 *
 * The birthday was optional and is now required. Blank used to mean "issue a
 * random six-digit password", which reads as a convenience and lands as a
 * Grade 3 pupil holding a string nobody can reconstruct — shown once, then
 * re-issued by the teacher all year. Every row therefore shows what is still
 * missing as it is typed, rather than only at submit.
 *
 * Pasting is preserved deliberately — it is how a forty-name roster actually
 * gets entered. Paste a block of lines into any name box and it expands into
 * rows from that point down, still splitting "Name, 03/15/2014" if the line
 * carries a date.
 */

function BirthdayStatus({ row }) {
  const raw = row.birthday?.trim();
  if (!isFilledRow(row)) return null;

  if (!raw) {
    return <span className="text-[11px] text-red-600 font-medium whitespace-nowrap">birthday needed</span>;
  }
  if (!isReadableDate(raw)) {
    return <span className="text-[11px] text-red-600 font-medium whitespace-nowrap">can&apos;t read this date</span>;
  }
  return (
    <span className="text-[11px] text-slate-500 whitespace-nowrap">
      password <span className="font-mono font-bold text-brand-slate">{previewPassword(raw)}</span>
    </span>
  );
}

export default function RosterEditor({
  rows,
  onChange,
  onPickFile,
  isExtracting,
  fileRef,
  onFileChange,
}) {
  const setRow = (index, patch) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(withBlankRow(next));
  };

  const removeRow = (index) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(withBlankRow(next.length ? next : emptyRoster()));
  };

  /**
   * A multi-line paste fills rows downward from here rather than dropping the
   * whole block into one name box.
   */
  const handlePaste = (index, event) => {
    const text = event.clipboardData?.getData('text') || '';
    if (!text.includes('\n')) return;              // ordinary single-value paste
    event.preventDefault();

    const pasted = parseRosterLines(text);
    if (!pasted.length) return;

    const next = [...rows];
    pasted.forEach((row, offset) => {
      const target = index + offset;
      // Keep a birthday already typed against an existing row if the pasted
      // line does not carry one.
      next[target] = {
        name: row.name,
        birthday: row.birthday || next[target]?.birthday || '',
      };
    });
    onChange(withBlankRow(next));
  };

  const filled = rows.filter(isFilledRow);
  const missingCount = rowsMissingBirthday(rows).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-sm font-medium text-slate-700">
          Class list <span className="font-normal text-slate-500">({filled.length} {filled.length === 1 ? 'learner' : 'learners'})</span>
        </p>
        <button type="button" onClick={onPickFile} disabled={isExtracting}
          title="Upload an Excel class list, or a photo of a printed one"
          className="text-xs font-bold text-brand-navy bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50 shrink-0">
          {isExtracting ? 'Reading the list...' : <><Upload className="w-3.5 h-3.5" /> Auto-fill from Excel or photo</>}
        </button>
        {/* A printed School Form photographed on a phone is how most class
            lists actually exist, so images and PDF are accepted alongside the
            spreadsheet. `capture` is deliberately not set: it would force the
            camera on mobile and hide the photos already in the gallery. */}
        <input type="file" accept=".xlsx,.xls,image/*,.pdf" className="hidden" ref={fileRef} onChange={onFileChange} />
      </div>

      {/* Surname first, matching the DepEd School Form 1 the roster is copied
          from — and it is what the class list, the gradebook and every export
          are sorted by, so a mixed roster sorts by first name for some
          learners and surname for others. The comma after the surname is
          optional but recommended and is kept when typed: it is the only thing
          in the stored name that says where a family name ends, and without it
          a two-word surname cannot be told from a second given name — which is
          how the dashboard came to greet children by the wrong name. */}
      <p className="text-xs font-medium text-brand-navy bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
        Enter names <span className="font-bold">last name first</span> — e.g. <span className="font-mono">Dela Cruz, Juan Miguel</span>.
        The comma after the surname is optional, but it lets us greet the learner by their real first name.
        You can paste a whole list into the first box.
      </p>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_10rem_auto] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Learner&apos;s name <span className="text-red-500">*</span>
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Birthday <span className="text-red-500">*</span>
          </span>
          <span className="w-7" aria-hidden="true" />
        </div>

        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_10rem_auto] gap-2 px-3 py-2 items-center">
              <input
                type="text"
                value={row.name}
                onChange={(e) => setRow(i, { name: normalizeRosterName(e.target.value) })}
                onPaste={(e) => handlePaste(i, e)}
                placeholder={i === 0 ? 'Dela Cruz, Juan Miguel' : ''}
                aria-label={`Learner ${i + 1} name`}
                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-navy outline-none"
              />
              <div>
                <input
                  type="text"
                  value={row.birthday}
                  onChange={(e) => setRow(i, { birthday: e.target.value })}
                  placeholder={i === 0 ? 'MM/DD/YYYY' : ''}
                  inputMode="numeric"
                  aria-label={`Learner ${i + 1} birthday, required`}
                  aria-required="true"
                  className={`w-full px-2 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-brand-navy outline-none ${
                    // A named learner with the box still empty is flagged the
                    // same as an unreadable date: both stop the roster, so
                    // both should look like something to fix.
                    isFilledRow(row) && !isReadableDate(row.birthday?.trim() || '')
                      ? 'border-red-300 bg-red-50'
                      : 'border-slate-200'
                  }`}
                />
                <div className="mt-0.5 h-4"><BirthdayStatus row={row} /></div>
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                aria-label={`Remove learner ${i + 1}`}
                className="w-7 h-7 grid place-items-center rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onChange([...rows, { name: '', birthday: '' }])}
        className="mt-2 text-xs font-bold text-brand-navy hover:bg-blue-50 px-2 py-1.5 rounded-lg flex items-center gap-1"
      >
        <Plus className="w-3.5 h-3.5" /> Add another learner
      </button>

      {/* The count is what the teacher needs, and a forty-name list scrolls
          past the per-row notes. Stated as work still to do rather than as an
          error: nothing is wrong with the roster yet, it is only unfinished. */}
      {missingCount > 0 && (
        <div className="mt-2 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="font-bold">{missingCount} of {filled.length}</span> {missingCount === 1 ? 'learner still needs' : 'learners still need'} a
          birthday. It is on the School Form the class list comes from, and it becomes the password they sign in with —
          one they can be reminded of, and one you can work out again later.
        </div>
      )}

      <p className="text-xs text-slate-500 mt-1">
        The birthday becomes the pupil&apos;s password (03/15/2014 → <span className="font-mono">03152014</span>). Existing students
        won&apos;t be duplicated; anyone already in another section is listed for you to confirm before they are moved.
      </p>
    </div>
  );
}
