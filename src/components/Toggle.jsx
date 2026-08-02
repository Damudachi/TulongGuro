/**
 * Labelled on/off switch used by the Settings screens.
 *
 * Declared as its own module (not nested inside a page) so React keeps the same
 * element across renders instead of remounting and dropping focus.
 */
export default function Toggle({ checked, onChange, label, accent = 'bg-royal-500' }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
      <span className="text-sm font-semibold text-navy-700 min-w-0">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${checked ? accent : 'bg-cream-300'}`}
      >
        <span
          className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </label>
  );
}
