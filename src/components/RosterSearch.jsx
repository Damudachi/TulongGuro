import { Search, X } from 'lucide-react';

/**
 * The box above a roster.
 *
 * Shared by the two admin screens that show one, so they cannot drift into
 * behaving differently — the matching itself lives in
 * utils/roster.js (matchesRosterQuery) for the same reason.
 *
 * `type="search"` rather than `type="text"`: it gives the mobile keyboard a
 * Search key instead of a newline one, and lets a desktop browser offer Escape
 * to clear. The visible × is still here because neither of those is
 * discoverable, and a filter an admin cannot see how to undo reads as a roster
 * that has lost people.
 */
export default function RosterSearch({ value, onChange, count, total, placeholder, className = '' }) {
  const filtering = value.trim().length > 0;
  return (
    <div className={className}>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Search by name or Student ID…'}
          className="w-full border border-slate-200 rounded-lg pl-9 pr-9 py-2 text-sm text-brand-slate placeholder:text-slate-300 outline-none focus:ring-2 focus:ring-brand-navy/30"
        />
        {filtering && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {/* Only while filtering, and always naming the total: "0 of 16" says the
          roster is intact and the query is wrong, where a bare empty list
          reads as an empty section. */}
      {filtering && (
        <p className={`text-[11px] mt-1.5 ${count === 0 ? 'text-amber-600' : 'text-slate-400'}`}>
          {count === 0
            ? `No one on this roster matches “${value.trim()}” — all ${total} student${total === 1 ? '' : 's'} are still here.`
            : `Showing ${count} of ${total} student${total === 1 ? '' : 's'}.`}
        </p>
      )}
    </div>
  );
}
