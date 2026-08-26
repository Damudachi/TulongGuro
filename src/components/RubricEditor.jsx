import { useRef } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { BLANK_CRITERION, totalWeight, blankCriterion, rescaleBands, DEFAULT_RANGE_BANDS } from '../utils/rubric';

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
 * ── Two shapes, one table ──
 *
 * `type` picks between them and they are genuinely different, which is why it
 * is a prop rather than something inferred here:
 *
 *   standard — each criterion takes a share of the mark and the shares add up
 *              to 100. The running total is a rule, so it is shown against it.
 *   range    — each criterion is scored on its own band ladder. There is no
 *              total to hit, so showing "40% / 100%" against one would be
 *              inventing a rule the rubric does not have.
 *
 * Controlled: the parent owns the criteria array and the save button. This
 * renders the rows and reports edits back, nothing else.
 */
export default function RubricEditor({ criteria, onChange, disabled = false, type = 'standard' }) {
  const isRange = type === 'range';
  const total = totalWeight(criteria);

  /**
   * The band ladder each criterion's Points box is currently being rescaled
   * FROM, keyed by criterion index and captured on the first keystroke.
   *
   * Rescaling from whatever the bands hold right now loses the ladder to
   * typing: reaching 30 by way of "3" rescales 1/2/3/4/5 onto a 3-point
   * criterion (1/1/2/2/3, the distinctions already gone) and then rescales
   * THAT onto 30. Held in a ref because it is not rendered and must not
   * schedule a render of its own — it is a fact about the keystroke in
   * progress, released on blur.
   */
  const bandBasisRef = useRef({});

  const update = (idx, field, value) =>
    onChange(criteria.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));

  const remove = (idx) => onChange(criteria.filter((_, i) => i !== idx));

  const add = () => onChange([...criteria, isRange ? blankCriterion('range') : { ...BLANK_CRITERION }]);

  /** Re-point one criterion, carrying its band ladder with it. See rescaleBands. */
  const setPoints = (idx, raw) => {
    const points = raw === '' ? 0 : parseInt(raw) || 0;
    const c = criteria[idx];
    if (!bandBasisRef.current[idx] && c.bands?.length) {
      bandBasisRef.current[idx] = c.bands.map(b => Number(b.score) || 0);
    }
    onChange(criteria.map((each, i) => (i === idx
      ? {
          ...each,
          points,
          // Standard rubrics carry no bands, so this is a no-op there rather
          // than a branch.
          ...(each.bands?.length ? { bands: rescaleBands(each.bands, points, bandBasisRef.current[idx]) } : {}),
        }
      : each)));
  };

  const updateBand = (idx, bandIdx, field, value) =>
    onChange(criteria.map((c, i) => (i === idx
      ? { ...c, bands: c.bands.map((b, bi) => (bi === bandIdx ? { ...b, [field]: value } : b)) }
      : c)));

  const removeBand = (idx, bandIdx) =>
    onChange(criteria.map((c, i) => (i === idx
      ? { ...c, bands: c.bands.filter((_, bi) => bi !== bandIdx) }
      : c)));

  const addBand = (idx) =>
    onChange(criteria.map((c, i) => (i === idx
      ? { ...c, bands: [...(c.bands || []), { label: 'New Band', score: 0, description: '' }] }
      : c)));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-slate-700">Criteria</label>
        {isRange ? (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
            Scoring bands
          </span>
        ) : (
          <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
            total === 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
            {total}% / 100%
          </span>
        )}
      </div>
      <div className="space-y-2">
        {criteria.map((c, i) => (
          <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="flex gap-2">
              <input required type="text" value={c.name} placeholder="Criterion name" disabled={disabled}
                onChange={e => update(i, 'name', e.target.value)}
                className="flex-1 min-w-0 border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
              <input required type="number" min={0} max={isRange ? undefined : 100}
                value={c.points === 0 ? '' : c.points}
                placeholder={isRange ? 'Pts' : '%'} disabled={disabled}
                onChange={e => setPoints(i, e.target.value)}
                onBlur={() => { delete bandBasisRef.current[i]; }}
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

            {isRange && (
              <div className="pl-3 border-l-2 border-purple-200 space-y-2 pt-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-xs font-bold text-purple-700">Scoring bands</p>
                  <span className="text-[10px] text-slate-400">
                    Band points rescale with this criterion&apos;s Points — edit any band after to overrule.
                  </span>
                </div>
                {(c.bands || []).map((b, bi) => (
                  <div key={bi} className="flex gap-2">
                    <input type="text" value={b.label || ''} disabled={disabled}
                      onChange={e => updateBand(i, bi, 'label', e.target.value)}
                      placeholder="Label (e.g. Excellent)"
                      className="w-1/4 min-w-0 p-1.5 text-xs border border-slate-200 rounded font-bold outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
                    <input type="number" value={b.score === 0 ? '' : (b.score ?? '')} disabled={disabled}
                      onChange={e => updateBand(i, bi, 'score', parseInt(e.target.value) || 0)}
                      placeholder="Pts"
                      className="w-16 shrink-0 p-1.5 text-xs border border-slate-200 rounded text-center outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
                    <input type="text" value={b.description || ''} disabled={disabled}
                      onChange={e => updateBand(i, bi, 'description', e.target.value)}
                      placeholder="Band description..."
                      className="flex-1 min-w-0 p-1.5 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100" />
                    {(c.bands || []).length > 1 && (
                      <button type="button" onClick={() => removeBand(i, bi)} disabled={disabled}
                        aria-label="Remove band"
                        className="text-slate-400 hover:text-red-500 p-1.5 shrink-0 disabled:opacity-40">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => addBand(i)} disabled={disabled}
                  className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1 disabled:opacity-40">
                  <Plus className="w-3 h-3" /> Add band
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={add} disabled={disabled}
        className="mt-2 text-xs font-bold text-brand-navy bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 flex items-center gap-1.5 disabled:opacity-40">
        <Plus className="w-3.5 h-3.5" /> Add Criterion
      </button>
      {isRange && (
        <p className="mt-2 text-[11px] text-slate-400">
          A new criterion starts on the {DEFAULT_RANGE_BANDS.length}-band ladder
          ({DEFAULT_RANGE_BANDS[0].label} down to {DEFAULT_RANGE_BANDS.at(-1).label}). Change any of it.
        </p>
      )}
    </div>
  );
}
