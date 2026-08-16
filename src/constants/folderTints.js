/**
 * Pastel fills for the folder-card stack. Each entry is one flat colour used by
 * both the tab and the body of a FolderCard — they must match, or the folder
 * silhouette splits into two shapes. All are light enough to carry dark navy
 * text on top.
 *
 * Kept out of FolderCard.jsx on purpose: a file that exports both components
 * and plain values breaks React Fast Refresh, so editing the card during dev
 * would force a full page reload instead of a hot update.
 */
export const FOLDER_TINTS = [
  { fill: 'bg-royal-200',   chip: 'bg-royal-100/70',   accent: 'text-royal-800' },
  { fill: 'bg-magenta-200', chip: 'bg-magenta-100/70', accent: 'text-magenta-800' },
  { fill: 'bg-lime-200',    chip: 'bg-lime-100/70',    accent: 'text-lime-800' },
  { fill: 'bg-sun-200',     chip: 'bg-sun-100/70',     accent: 'text-sun-800' },
  { fill: 'bg-aqua-200',    chip: 'bg-aqua-100/70',    accent: 'text-aqua-800' },
  { fill: 'bg-lilac-200',   chip: 'bg-lilac-100/70',   accent: 'text-lilac-800' },
];

export const tintFor = (index) => FOLDER_TINTS[index % FOLDER_TINTS.length];

/**
 * A palette slot chosen from a stable identity rather than a list position.
 *
 * Keying colour to position meant filtering the dashboard by subject renumbered
 * the list and repainted every card — the same class was royal blue unfiltered
 * and lime green under "Filipino" — and creating a class shifted the ones below
 * it. Colour that moves under the reader looks like a code they have failed to
 * crack, when it is only meant to tell one card from the next.
 *
 * Any stable string works; the callers pass a record id. Deliberately not a
 * cryptographic hash — this picks between six pastels.
 */
export function indexForKey(key, length) {
  const s = String(key ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h % length;
}

export const tintForKey = (key) => FOLDER_TINTS[indexForKey(key, FOLDER_TINTS.length)];
