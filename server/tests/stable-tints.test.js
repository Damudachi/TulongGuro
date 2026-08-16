import { describe, it, expect } from 'vitest';
import { FOLDER_TINTS, tintFor, tintForKey, indexForKey } from '../../src/constants/folderTints.js';

/**
 * A card's colour must not depend on where it happens to sit in a list.
 *
 * Both the teacher dashboard and the student subject list picked their tint
 * with `palette[index % palette.length]` over the *filtered* array. Filtering by
 * subject renumbered the list, so every card repainted — the same class was
 * royal blue on the full dashboard and lime green under "Filipino" — and
 * creating a class shifted the colour of everything below it. The student list
 * additionally carried the raw index into the detail screen, so an opened
 * subject's header colour depended on the row it was opened from.
 *
 * Keying off the record id fixes all of that. These tests hold the property the
 * screens actually depend on: same id, same colour, forever.
 */

describe('indexForKey', () => {
  it('always lands inside the palette', () => {
    for (const key of ['a', 'class-1', '', 'ckv92hf00000xyz', '🙂', 'x'.repeat(500)]) {
      const i = indexForKey(key, FOLDER_TINTS.length);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(FOLDER_TINTS.length);
    }
  });

  it('is stable across calls — this is the whole point', () => {
    expect(indexForKey('class-abc', 6)).toBe(indexForKey('class-abc', 6));
  });

  it('survives a null or undefined id without throwing', () => {
    // A class rendered before its id arrives must get *a* colour, not a crash.
    expect(indexForKey(null, 6)).toBeGreaterThanOrEqual(0);
    expect(indexForKey(undefined, 6)).toBeGreaterThanOrEqual(0);
  });

  it('works for a palette of any length, not just six', () => {
    // Subjects.jsx has its own six-entry palette; nothing should assume the
    // folder palette's size.
    for (const len of [1, 3, 6, 11]) {
      expect(indexForKey('class-abc', len)).toBeLessThan(len);
    }
  });

  it('spreads a run of similar ids across the whole palette', () => {
    // Real ids differ in their last characters. A hash that only looked at the
    // first few would give a teacher six identical cards.
    const used = new Set(
      Array.from({ length: 60 }, (_, n) => indexForKey(`clx0000000000000${n}`, FOLDER_TINTS.length))
    );
    expect(used.size).toBe(FOLDER_TINTS.length);
  });
});

describe('tintForKey', () => {
  it('returns a real palette entry', () => {
    expect(FOLDER_TINTS).toContain(tintForKey('class-1'));
  });

  it('gives one class the same tint no matter what else is on screen', () => {
    // The reported symptom: filtering the dashboard recoloured the cards. The
    // id is all that decides now, so the class's position cannot reach it.
    const unfiltered = ['class-a', 'class-b', 'class-c', 'class-d'];
    const filtered = ['class-c'];

    expect(tintForKey(filtered[0])).toEqual(tintForKey(unfiltered[2]));
  });

  it('still gives neighbouring classes different tints', () => {
    // Variety is the job the colour is doing; a hash that collided constantly
    // would be stable and useless.
    const tints = ['class-a', 'class-b', 'class-c'].map(tintForKey);
    expect(new Set(tints.map(t => t.fill)).size).toBeGreaterThan(1);
  });
});

describe('tintFor', () => {
  it('is kept for callers that genuinely have no id', () => {
    expect(tintFor(0)).toEqual(FOLDER_TINTS[0]);
    expect(tintFor(FOLDER_TINTS.length)).toEqual(FOLDER_TINTS[0]);
  });
});
