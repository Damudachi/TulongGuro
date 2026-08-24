import { describe, it, expect } from 'vitest';
import {
  fileNameFromDisposition, fileNamePart, gradebookFileName,
} from '../../src/utils/exportFile.js';

/**
 * What the exported gradebook is called when it lands in a downloads folder.
 *
 * The page used to name its own download `grades_${classId}.xlsx` — and
 * classId is a uuid, so a teacher's folder filled with
 * `grades_3f9c1b2e-7a04-4f11-9c2e-8b1d6f0a2c93.xlsx`. It also threw away the
 * name the server had already chosen and sent in Content-Disposition.
 */

describe('reading the name the server chose', () => {
  it('prefers the RFC 5987 form, which is the one that survives an accent', () => {
    const header = 'attachment; filename="Ingles-Las-Pinas_Grades_2026-08-24.xlsx"; '
      + "filename*=UTF-8''Ingles-Las-Pi%C3%B1as_Grades_2026-08-24.xlsx";
    expect(fileNameFromDisposition(header)).toBe('Ingles-Las-Piñas_Grades_2026-08-24.xlsx');
  });

  it('falls back to the plain quoted form when there is no extended one', () => {
    expect(fileNameFromDisposition('attachment; filename="English-Grade-6-Newton_Grades_2026-08-24.xlsx"'))
      .toBe('English-Grade-6-Newton_Grades_2026-08-24.xlsx');
  });

  it('falls back to the plain form when the extended one is malformed', () => {
    // A truncated percent-escape throws inside decodeURIComponent. Without the
    // catch the whole export fails on a filename.
    const header = 'attachment; filename="Fallback.xlsx"; filename*=UTF-8\'\'Broken%E0%A4%A.xlsx';
    expect(fileNameFromDisposition(header)).toBe('Fallback.xlsx');
  });

  it('returns null — not a guess — when there is no header to read', () => {
    // What a cross-origin response looks like when Content-Disposition is not
    // in Access-Control-Expose-Headers. The caller then builds its own name.
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(fileNameFromDisposition('')).toBeNull();
    expect(fileNameFromDisposition('attachment')).toBeNull();
  });
});

describe('building a readable name', () => {
  it('collapses a run of punctuation to one hyphen, not one underscore each', () => {
    // The actual bug: "English Grade 6 - Newton" became
    // "English_Grade_6___Newton" under a per-character replace.
    expect(fileNamePart('English Grade 6 - Newton')).toBe('English-Grade-6-Newton');
  });

  it('folds accents rather than dropping them', () => {
    expect(fileNamePart('Las Piñas')).toBe('Las-Pinas');
  });

  it('never leaves a leading or trailing hyphen', () => {
    expect(fileNamePart('  — Math 6 —  ')).toBe('Math-6');
  });

  it('falls back rather than producing an empty name', () => {
    expect(fileNamePart('###')).toBe('Class');
    expect(fileNamePart('')).toBe('Class');
    expect(fileNamePart(null)).toBe('Class');
  });

  it('names a whole-year export with the class and the day', () => {
    const name = gradebookFileName('English Grade 6 - Newton', null, 'xlsx');
    expect(name).toMatch(/^English-Grade-6-Newton_Grades_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('puts the term in the name, so two terms of one class do not collide', () => {
    const t1 = gradebookFileName('English Grade 6 - Newton', '1', 'xlsx');
    const t2 = gradebookFileName('English Grade 6 - Newton', '2', 'xlsx');
    expect(t1).toContain('_Term-1_');
    expect(t2).toContain('_Term-2_');
    expect(t1).not.toBe(t2);
  });

  it('uses the right extension for a CSV', () => {
    expect(gradebookFileName('Math 6', null, 'csv')).toMatch(/\.csv$/);
  });

  it('contains no character that would need escaping on Windows', () => {
    const name = gradebookFileName('Math 6 / Section: "Newton" \\ *?', '1', 'xlsx');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });
});
