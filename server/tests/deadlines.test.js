import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dayAfter, deadlineInstant, isPastDeadline, submissionWindow } from '../../src/utils/deadlines.js';

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

describe('the teacher activity list tells the same story as the student one', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Class Hub used to label an activity "(Closed)" from isPastDeadline(deadline)
   * alone, ignoring lateUntil entirely. So while a late window was open the
   * student saw "Late accepted" and their teacher — looking at the same activity
   * at the same moment — saw Closed, and had no reason to expect more uploads.
   * It now reads submissionWindow(), the same as the four student screens, and
   * these are the three states it renders.
   */
  const teacherLabel = (activity) => {
    const w = submissionWindow(activity);
    if (!activity.deadline) return null;
    if (w.isClosed) return 'closed';
    if (w.isLate) return 'late-accepted';
    return 'open';
  };

  const WITH_LATE = { deadline: '2025-03-15', lateUntil: '2025-03-20' };
  const NO_LATE = { deadline: '2025-03-15' };

  it('says late-accepted, not closed, while the teacher\'s own late window is open', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 17)));
    expect(teacherLabel(WITH_LATE)).toBe('late-accepted');
  });

  it('says closed once the late window itself has passed', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 21)));
    expect(teacherLabel(WITH_LATE)).toBe('closed');
  });

  it('closes at the deadline when no late window was offered', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1));
    expect(teacherLabel(NO_LATE)).toBe('closed');
  });

  it('says nothing at all before the due date', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 10)));
    expect(teacherLabel(WITH_LATE)).toBe('open');
    expect(teacherLabel(NO_LATE)).toBe('open');
  });

  it('never labels an activity that has no deadline', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 2, 21)));
    expect(teacherLabel({ deadline: null })).toBeNull();
  });

  it('agrees with the student view at every instant across the window', () => {
    // The property that was actually broken: the two roles must never disagree
    // about whether work can still be handed in.
    for (const day of [10, 15, 16, 18, 20, 22]) {
      vi.setSystemTime(new Date(Date.UTC(2025, 2, day, 12)));
      const student = submissionWindow(WITH_LATE);
      expect(teacherLabel(WITH_LATE) === 'closed').toBe(student.isClosed);
    }
  });
});

describe('work the teacher uploads has no submission window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * A deadline on a teacher-upload activity is a due date for the paper, not a
   * gate on the scanner.
   *
   * The papers were handed in on paper, on time; the teacher scans the stack
   * whenever they get to it, which is routinely days later. Reading that date
   * as a submission window meant the activity was labelled "(Closed)" to the
   * teacher who was still entering marks for it, and every scan made afterwards
   * was stamped "Submitted late" — a permanent flag on a child's record for
   * their teacher's scheduling. Scores-only activities are the same case: there
   * is no upload at all, so there is nothing to be late.
   */
  const PAST_DUE = { deadline: '2025-03-15', lateUntil: null };

  it('is never late and never closed, however long after the due date', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));   // ten months late
    for (const mode of ['TEACHER_UPLOAD', 'MANUAL_SCORE']) {
      const w = submissionWindow({ ...PAST_DUE, submissionMode: mode });
      expect(w, mode).toMatchObject({ isLate: false, isClosed: false, acceptsLate: false });
    }
  });

  it('still closes student-submit work on the same date', () => {
    // The rule narrows to one mode; it does not soften the deadline that
    // actually governs a learner pressing Submit.
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    const w = submissionWindow({ ...PAST_DUE, submissionMode: 'STUDENT_SUBMIT' });
    expect(w).toMatchObject({ isLate: true, isClosed: true });
  });

  it('treats an activity with no mode as student-submit', () => {
    // Callers that select only the dates — and older rows — must keep the
    // stricter reading. Guessing "teacher upload" here would quietly reopen a
    // closed deadline for a learner.
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    expect(submissionWindow(PAST_DUE)).toMatchObject({ isLate: true, isClosed: true });
    expect(submissionWindow({ ...PAST_DUE, submissionMode: null })).toMatchObject({ isClosed: true });
  });
});

/**
 * A late window that closes on the due date itself.
 *
 * The builder's "Accept late submissions" checkbox used to default the window
 * to the deadline, and the server accepted it (`late >= due`). Both dates are
 * bare calendar days and a date-only deadline runs to the END of its day, so
 * that window is zero length — it can accept nothing that was not already on
 * time. Yet acceptsLate was read off the mere presence of the field, so the
 * student screen said "you can still submit until 2 September" on an activity
 * that had shut at the end of 2 September, and the teacher believed they had
 * left a grace period.
 *
 * The write path refuses such a window now (resolveLateWindow in server.js),
 * but rows saved before that are still in the database — which is why the read
 * path has to hold the line too.
 */
describe('a late window must close strictly after the due date', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SAME_DAY = { deadline: '2025-03-15', lateUntil: '2025-03-15' };

  it('does not advertise a grace period that is zero days long', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC - 1000));   // still open
    expect(submissionWindow(SAME_DAY)).toMatchObject({ acceptsLate: false });
  });

  it('closes such an activity exactly when its deadline passes', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    expect(submissionWindow(SAME_DAY)).toMatchObject({ isLate: true, isClosed: true, acceptsLate: false });
  });

  it('ignores a window that closes BEFORE the due date', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    const w = submissionWindow({ deadline: '2025-03-15', lateUntil: '2025-03-10' });
    // Closing on the earlier date would refuse work that was never late.
    expect(w).toMatchObject({ acceptsLate: false, closesOn: '2025-03-15' });
  });

  it('still honours a real window of one day', () => {
    vi.setSystemTime(new Date(MAR_15_CLOSE_UTC + 1000));
    const w = submissionWindow({ deadline: '2025-03-15', lateUntil: '2025-03-16' });
    expect(w).toMatchObject({ isLate: true, isClosed: false, acceptsLate: true, closesOn: '2025-03-16' });
  });

  it('keeps a window on an activity that has no due date to be shorter than', () => {
    // Incoherent, but it is the only closing date such a row has — dropping it
    // would turn a closed activity into one that never closes.
    vi.setSystemTime(new Date(Date.UTC(2030, 0, 1)));
    const w = submissionWindow({ deadline: null, lateUntil: '2025-03-16' });
    expect(w).toMatchObject({ acceptsLate: true, isClosed: true, closesOn: '2025-03-16' });
  });
});

describe('dayAfter — the earliest a late window may close', () => {
  it('steps one calendar day', () => {
    expect(dayAfter('2025-03-15')).toBe('2025-03-16');
  });

  it('rolls month and year ends', () => {
    expect(dayAfter('2025-03-31')).toBe('2025-04-01');
    expect(dayAfter('2025-12-31')).toBe('2026-01-01');
  });

  it('handles a leap day', () => {
    expect(dayAfter('2024-02-28')).toBe('2024-02-29');
    expect(dayAfter('2025-02-28')).toBe('2025-03-01');
  });

  it('returns blank for anything that is not a date, so the input just has no floor', () => {
    expect(dayAfter('')).toBe('');
    expect(dayAfter(null)).toBe('');
    expect(dayAfter(undefined)).toBe('');
    expect(dayAfter('not a date')).toBe('');
  });
});
