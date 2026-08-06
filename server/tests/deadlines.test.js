import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deadlineInstant, isPastDeadline, submissionWindow } from '../../src/utils/deadlines.js';

/**
 * When an activity actually closes.
 *
 * A deadline is stored as a bare "YYYY-MM-DD" — a calendar date a teacher
 * typed, with no time and no timezone. `new Date("2025-03-15")` parses that as
 * midnight UTC, which is 08:00 in Manila, so every hand-rolled
 * `new Date(deadline) < new Date()` in this codebase closed an activity
 * sixteen hours early. deadlines.js and isPastDeadline() in server.js exist to
 * stop that, and three separate places had drifted back to doing it by hand.
 *
 * These test the client copy. server.js's isPastDeadline is a private function
 * in a module that starts an HTTP listener on import, so it cannot be pulled in
 * here — but both files carry a comment saying they implement one rule, and the
 * fixed instants below are that rule written down. If the server copy is ever
 * changed, these are the values it has to keep producing.
 */

/** 15 March 2025, 23:59:59.999 Philippine time, as UTC. */
const MAR_15_CLOSE_UTC = Date.UTC(2025, 2, 15, 15, 59, 59, 999);

describe('deadlineInstant', () => {
  it('resolves a date-only deadline to the end of that day in Manila', () => {
    expect(deadlineInstant('2025-03-15').getTime()).toBe(MAR_15_CLOSE_UTC);
  });

  it('is emphatically not midnight UTC — that is the whole bug', () => {
    expect(deadlineInstant('2025-03-15').getTime())
      .not.toBe(new Date('2025-03-15').getTime());
    // Sixteen hours apart: 08:00 Manila on the due date vs 23:59:59 Manila.
    const gapHours = (deadlineInstant('2025-03-15').getTime() - new Date('2025-03-15').getTime()) / 3_600_000;
    expect(gapHours).toBeCloseTo(16, 3);
  });

  it('returns null for no deadline and for an unreadable one', () => {
    expect(deadlineInstant(null)).toBeNull();
    expect(deadlineInstant('')).toBeNull();
    expect(deadlineInstant('not a date')).toBeNull();
  });
});

describe('isPastDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is still open at 08:00 Manila on the due date — the morning that used to be "late"', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 15, 0, 0, 0)));   // 08:00 in Manila
    expect(isPastDeadline('2025-03-15')).toBe(false);
  });

  it('is still open one second before the day ends in Manila', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC - 1000));
    expect(isPastDeadline('2025-03-15')).toBe(false);
  });

  it('is past once the day has ended in Manila', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    expect(isPastDeadline('2025-03-15')).toBe(true);
  });

  it('never treats "no deadline" or an unreadable one as past', () => {
    // A display bug must not lock a student out of submitting.
    vi.setSystemTime(new Date(Date.UTC(2030, 0, 1)));
    expect(isPastDeadline(null)).toBe(false);
    expect(isPastDeadline(undefined)).toBe(false);
    expect(isPastDeadline('')).toBe(false);
    expect(isPastDeadline('garbage')).toBe(false);
  });
});

describe('submissionWindow — late and closed are two different questions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('with no late window, an activity closes exactly when it stops being on time', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    const w = submissionWindow({ deadline: '2025-03-15', lateUntil: null });
    expect(w).toMatchObject({ isLate: true, isClosed: true, acceptsLate: false });
  });

  it('with a late window, work is late but still accepted', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    const w = submissionWindow({ deadline: '2025-03-15', lateUntil: '2025-03-20' });
    expect(w).toMatchObject({ isLate: true, isClosed: false, acceptsLate: true });
  });

  it('closes once the late window itself has passed', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 21, 12, 0, 0)));
    const w = submissionWindow({ deadline: '2025-03-15', lateUntil: '2025-03-20' });
    expect(w).toMatchObject({ isLate: true, isClosed: true });
  });

  it('is neither late nor closed before the due date', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 10)));
    const w = submissionWindow({ deadline: '2025-03-15', lateUntil: '2025-03-20' });
    expect(w).toMatchObject({ isLate: false, isClosed: false });
  });
});

describe('the two screens that re-derived lateness by hand', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a task due today still counts as upcoming on the student dashboard at breakfast', () => {
    // The dashboard filter is now `!isPastDeadline(a.deadline)`. It used to be
    // `new Date(a.deadline) >= now`, which dropped the task at 08:00 Manila
    // while the submit endpoint would still accept it for another 16 hours.
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 15, 0, 30, 0)));   // 08:30 Manila
    expect(isPastDeadline('2025-03-15')).toBe(false);
  });

  it('an unsubmitted activity is only MISSING after the day has actually ended', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 15, 0, 30, 0)));
    expect(isPastDeadline('2025-03-15')).toBe(false);          // UPCOMING
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1));
    expect(isPastDeadline('2025-03-15')).toBe(true);           // MISSING
  });
});
