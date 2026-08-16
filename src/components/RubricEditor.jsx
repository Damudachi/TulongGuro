import { Plus, Trash2 } from 'lucide-react';
import { BLANK_CRITERION, totalWeight } from '../utils/rubric';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * The criteria table an admin fills in by hand.
 *
 * Lifted out of the School Rubrics page so the curriculum form can ask for a
 * rubric with the same fields, the same weights-total-100 rule and the same
 * running total. Two copies of this would have drifted the first time either
 * page changed, and the rule they share is the one thing about a rubric this
 * system does enforce.
 *
 * Controlled: the parent owns the criteria array and the save button. This
 * renders the rows and reports edits back, nothing else.
 */
export default function RubricEditor({ criteria, onChange, disabled = false }) {
  const total = totalWeight(criteria);

  const update = (idx, field, value) =>
    onChange(criteria.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));

  const remove = (idx) => onChange(criteria.filter((_, i) => i !== idx));

  const add = () => onChange([...criteria, { ...BLANK_CRITERION }]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-slate-700">Criteria</label>
        <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
          total === 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
          {total}% / 100%
        </span>
      </div>
      <div className="space-y-2">
        {criteria.map((c, i) => (
          <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="flex gap-2">
              <input required type="text" value={c.name} placeholder="Criterion name" disabled={disabled}
                onChange={e => update(i, 'name', e.target.value)}
                className="flex-1 min-w-0 border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
              <input required type="number" min={0} max={100} value={c.points === 0 ? '' : c.points}
                placeholder="%" disabled={disabled}
                onChange={e => update(i, 'points', e.target.value === '' ? 0 : parseInt(e.target.value))}
                className="w-20 border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
              {criteria.length > 1 && (
                <button type="button" onClick={() => remove(i)} disabled={disabled}
                  className="text-slate-400 hover:text-red-500 px-1 disabled:opacity-40">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <input type="text" value={c.description || ''} placeholder="What this criterion evaluates"
              disabled={disabled}
              onChange={e => update(i, 'description', e.target.value)}
              className="w-full border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
          </div>
        ))}
      </div>
      <button type="button" onClick={add} disabled={disabled}
        className="mt-2 text-xs font-bold text-brand-navy bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 flex items-center gap-1.5 disabled:opacity-40">
        <Plus className="w-3.5 h-3.5" /> Add Criterion
      </button>
    </div>
  );
}
