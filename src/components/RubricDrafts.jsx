/**
 * The rubric cards an admin fills in, and the two ways of starting one.
 *
 * Shared by the Add Curriculum form and the editor for a curriculum that is
 * already published — a rubric written in August has to be addable the same way
 * as one attached on the day the curriculum was published, from the same cards,
 * or the second route quietly becomes a worse version of the first.
 *
 * State lives in useRubricDrafts; these two only draw it.
 */
import { useState } from 'react';
import { Loader2, Trash2, UploadCloud, FileText, PenLine, Percent, ListOrdered, ArrowLeft } from 'lucide-react';
import RubricEditor from './RubricEditor';
import { draftReady } from '../utils/useRubricDrafts';
import { detectRubricType } from '../utils/rubric';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

export function RubricDraftCard({ draft, index, onChange, onRemove }) {
  // Read off the draft rather than taken as a prop: an uploaded card does not
  // know its shape until the extraction comes back, and the card is on screen
  // before then.
  const type = detectRubricType(draft);
  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Rubric {index + 1}
          {draftReady(draft) && <span className="ml-2 text-emerald-600 normal-case tracking-normal">Ready</span>}
        </p>
        <button type="button" onClick={onRemove}
          className="text-xs font-medium text-slate-400 hover:text-red-600 flex items-center gap-1 shrink-0">
          <Trash2 className="w-3.5 h-3.5" /> Remove
        </button>
      </div>

      {draft.fileName && (
        <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-xs font-medium text-slate-600 truncate flex-1">{draft.fileName}</span>
          {draft.isReading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>
      )}

      {draft.isReading ? (
        <p className="text-xs text-slate-500">Reading the rubric…</p>
      ) : (
        <>
          {draft.mode === 'upload' && !draft.error && (
            <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-2.5 leading-relaxed">
              {/* Which shape it was read as is said out loud, because it decides
                  what the columns below mean and it is the one thing on this
                  card nobody chose. */}
              Read as a <strong>{type === 'range' ? 'range rubric — scored on bands' : 'standard rubric — percentage weights'}</strong>.
              {' '}Check these against your document before saving — correct anything that came out wrong.
            </p>
          )}
          {draft.error && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{draft.error}</p>
          )}
          {/* Said where the changed numbers are. The criteria below no longer
              read the way the uploaded document does, and an unexplained 25
              where the paper says 4 looks like a misreading rather than a
              conversion. */}
          {draft.scaledFrom != null && (
            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-2.5 leading-relaxed">
              Your rubric adds up to <strong>{draft.scaledFrom}</strong>, so these have been
              converted to percentages of 100 — each criterion keeps exactly the share of the
              mark it had in your document. Teachers apply this as weights; the points an
              activity is worth stay theirs to set.
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Rubric name</label>
            {/* Deliberately not `required`. A card the admin added and then
                thought better of is meant to be publishable — it is simply not
                saved — and the browser's own validation refused that, popping
                "Please fill out this field" on an input that may be scrolled
                out of the modal. It also took the nameless case away from the
                message in useRubricDrafts, which explains the choice in words.
                A card with criteria but no name is still caught there. */}
            <input type="text" value={draft.name}
              onChange={e => onChange({ name: e.target.value })}
              placeholder="e.g. Grade 6 English — Written Output"
              className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
          </div>
          <RubricEditor criteria={draft.criteria} onChange={next => onChange({ criteria: next })} type={type} />
        </>
      )}
    </div>
  );
}

/**
 * Both entry points stay on screen whatever is already added — the second
 * rubric is added exactly the way the first was.
 *
 * Typing one in asks for its shape first. The two are different units and the
 * table's columns change with the answer, so asking here is cheaper than an
 * admin filling in five criteria and then finding they are in the wrong ones.
 * Uploading asks nothing: the document says which shape it is, and the
 * extractor has already worked it out by the time the card is drawn.
 *
 * The choice is revealed in place rather than in a dialog, because both callers
 * render these inside a modal already and a dialog over a dialog is a stacking
 * problem for a two-way question.
 */
export function RubricDraftButtons({ count, onUpload, onManual, className }) {
  const [picking, setPicking] = useState(false);

  if (picking) {
    return (
      <div className={cn('border-2 border-dashed border-slate-200 rounded-lg p-3', className)}>
        <div className="flex items-center gap-2 mb-2">
          <button type="button" onClick={() => setPicking(false)} aria-label="Back"
            className="text-slate-400 hover:text-slate-600 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="text-xs font-bold text-slate-600">How is this rubric marked?</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setPicking(false); onManual('standard'); }}
            className="border border-slate-200 rounded-lg p-2.5 text-left hover:border-brand-navy hover:bg-blue-50 transition-colors">
            <Percent className="w-4 h-4 mb-1 text-green-600" />
            <span className="block text-xs font-bold text-slate-600">Percentage weights</span>
            <span className="block text-[11px] text-slate-400 mt-0.5 leading-relaxed">
              Each criterion takes a share of the mark, totalling 100%.
            </span>
          </button>
          <button type="button" onClick={() => { setPicking(false); onManual('range'); }}
            className="border border-slate-200 rounded-lg p-2.5 text-left hover:border-brand-navy hover:bg-blue-50 transition-colors">
            <ListOrdered className="w-4 h-4 mb-1 text-purple-600" />
            <span className="block text-xs font-bold text-slate-600">Scoring bands</span>
            <span className="block text-[11px] text-slate-400 mt-0.5 leading-relaxed">
              A ladder per criterion — Excellent down to Needs Improvement.
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      <label className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
        <UploadCloud className="w-5 h-5 mx-auto mb-1 text-slate-400" />
        <span className="block text-xs font-medium text-slate-600">
          {count ? 'Upload another' : 'Upload our rubric'}
        </span>
        <span className="block text-[11px] text-slate-400 mt-0.5">Weights or bands, read out for you</span>
        <input type="file" accept=".pdf,.docx,image/*" className="hidden"
          onChange={e => {
            const input = e.target;
            const picked = input.files?.[0];
            if (!picked) return;
            // Cleared straight away so picking the same file again still fires
            // a change event. `picked` is already a File reference and survives
            // this.
            input.value = '';
            onUpload(picked);
          }} />
      </label>
      <button type="button" onClick={() => setPicking(true)}
        className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center hover:border-brand-navy hover:bg-blue-50 transition-colors">
        <PenLine className="w-5 h-5 mx-auto mb-1 text-slate-400" />
        <span className="block text-xs font-medium text-slate-600">
          {count ? 'Type another in' : 'Type it in'}
        </span>
        <span className="block text-[11px] text-slate-400 mt-0.5">Name and criteria</span>
      </button>
    </div>
  );
}
