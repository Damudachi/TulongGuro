import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

const { computeGrade, transmute, gradePercentOf } = grading;

const POLICY = { WW: 30, PT: 50, QA: 20 };

/**
 * Which basis produces the number on a report card.
 *
 * School.useTransmutation was persisted, exposed on the admin API, toggled in
 * the UI behind a confirmation warning, and snapshotted into the audit log —
 * while every computeGrade call site in the app passed `{ transmute: false }`.
 * The switch changed nothing anywhere. These tests pin down both bases and,
 * more importantly, that they actually differ.
 */

/** Mirrors the export's row-average step. */
const exportAverage = (submissions, { useTransmutation, points = 100 }) => {
  const entries = submissions
    .map(sub => ({ percent: gradePercentOf(sub), points, component: 'WW' }))
    .filter(e => e.percent !== null);
  return computeGrade(entries, POLICY, { transmute: useTransmutation }).finalGrade;
};

const graded = (score) => ({ status: 'GRADED', hitlScore: score, archivedAt: null });

describe('the export honours the school transmutation setting', () => {
  it('reports the untransmuted Initial Grade when the setting is off', () => {
    expect(exportAverage([graded(69)], { useTransmutation: false })).toBe(69);
  });

  it('reports the transmuted grade when the setting is on', () => {
    // 69 -> floor((69-60)/1.6) = 5 -> 75 + 5 = 80.
    expect(exportAverage([graded(69)], { useTransmutation: true })).toBe(80);
  });

  it('actually differs between the two bases — the bug was that it did not', () => {
    const off = exportAverage([graded(69)], { useTransmutation: false });
    const on = exportAverage([graded(69)], { useTransmutation: true });
    expect(on).not.toBe(off);
    expect(on).toBeGreaterThan(off);
  });

  it('can flip a failing grade to passing, which is why the toggle is warned about', () => {
    const passing = 75;
    const raw = 69;
    expect(exportAverage([graded(raw)], { useTransmutation: false })).toBeLessThan(passing);
    expect(exportAverage([graded(raw)], { useTransmutation: true })).toBeGreaterThanOrEqual(passing);
  });

  it('never lowers a grade at any point on the scale', () => {
    for (let raw = 0; raw <= 100; raw += 1) {
      const off = exportAverage([graded(raw)], { useTransmutation: false });
      const on = exportAverage([graded(raw)], { useTransmutation: true });
      expect(on).toBeGreaterThanOrEqual(off);
    }
  });

  it('floors a transmuted grade at 60, however low the raw mark', () => {
    expect(exportAverage([graded(0)], { useTransmutation: true })).toBe(60);
  });

  it('returns null on both bases when nothing is validated', () => {
    const drafts = [{ status: 'PENDING', aiScore: 88, archivedAt: null }];
    expect(exportAverage(drafts, { useTransmutation: false })).toBeNull();
    expect(exportAverage(drafts, { useTransmutation: true })).toBeNull();
  });

  it('transmutes the computed grade, not each activity score', () => {
    // Two 50-point activities at 60% and 78%. Transmuting each and then
    // averaging (75 and 86 -> 80.5) is not the same as averaging then
    // transmuting (69 -> 80), and only the second is what DO 8 specifies.
    const subs = [graded(60), graded(78)];
    const combined = exportAverage(subs, { useTransmutation: true, points: 50 });
    expect(combined).toBe(transmute(69));
    expect(combined).not.toBe(Math.round((transmute(60) + transmute(78)) / 2));
  });
});

describe('analytics stay untransmuted regardless of the school setting', () => {
  /** Mirrors workingAverage() — the number the at-risk list reads. */
  const workingAverage = (submissions) => {
    const entries = submissions
      .map(sub => ({ percent: gradePercentOf(sub), points: 100, component: 'WW' }))
      .filter(e => e.percent !== null);
    const { initialGrade } = computeGrade(entries, POLICY, { transmute: false });
    return initialGrade === null ? null : Math.round(initialGrade);
  };

  it('keeps a struggling student below the passing line even when the export would raise them', () => {
    // The whole reason intervention does not transmute: this learner reads 80
    // on the report card and 69 — correctly — on the support list.
    const subs = [graded(69)];
    expect(workingAverage(subs)).toBe(69);
    expect(exportAverage(subs, { useTransmutation: true })).toBe(80);
    expect(workingAverage(subs)).toBeLessThan(75);
  });
});
