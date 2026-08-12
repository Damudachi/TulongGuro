import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveActivitySnapshot, mergeActivitySnapshot, readActivitySnapshot,
  saveTeacherSnapshot, readTeacherSnapshot,
  saveClassSnapshot, readClassSnapshot,
  clearActivitySnapshots, SNAPSHOT_MAX_AGE_MS,
} from '../../src/utils/offlineSnapshot.js';
import { clearStoredSession, storeSession } from '../../src/utils/session.js';

/**
 * The list a student sees when the network is gone.
 *
 * A student on a dropped connection could already queue a submission — the
 * queue has worked for months (offlineQueue.js) — but only from the submit
 * form for an activity they had already chosen. Getting to that form needs the
 * activity list, the list comes from /api/, and the service worker refuses to
 * cache /api/ on purpose. So the page saves its own copy.
 *
 * What that copy may contain is the whole design. Not a grade, not a status,
 * not a path to a scanned paper — a shared classroom phone must not carry any
 * of that between two students, and a grade shown from last week with no way
 * to tell it is stale is worse than no grade at all.
 */

const storage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
};

beforeEach(() => {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
});

afterEach(() => {
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  vi.useRealTimers();
});

const activity = (over = {}) => ({
  id: 'act_1',
  title: 'Essay on Rizal',
  className: 'English 7 — Rosal',
  type: 'ESSAY',
  points: 20,
  deadline: '2026-08-20T15:00:00.000Z',
  lateUntil: '2026-08-22T15:00:00.000Z',
  maxAttempts: 2,
  instructions: 'Write three paragraphs.',
  ...over,
});

describe('offline activity snapshot', () => {
  it('reads back what was written', () => {
    saveActivitySnapshot('stu_1', [activity()]);
    const { activities } = readActivitySnapshot('stu_1');
    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe('Essay on Rizal');
    expect(activities[0].deadline).toBe('2026-08-20T15:00:00.000Z');
    expect(activities[0].maxAttempts).toBe(2);
  });

  it('never stores a submission, a grade, or a path to a scanned paper', () => {
    saveActivitySnapshot('stu_1', [activity({
      mySubmission: { status: 'GRADED', grade: 18, imageUrl: '/uploads/abc.jpg', attemptCount: 1 },
    })]);

    const [saved] = readActivitySnapshot('stu_1').activities;
    expect(saved.mySubmission).toBeUndefined();
    expect(localStorage.getItem('tg_activities_stu_1')).not.toMatch(/uploads|GRADED|grade/i);
  });

  it('drops fields it was not told to keep, so a new API field is excluded by default', () => {
    saveActivitySnapshot('stu_1', [activity({ teacherPrivateNote: 'watch this one', rubric: [{ id: 'r1' }] })]);
    const [saved] = readActivitySnapshot('stu_1').activities;
    expect(saved.teacherPrivateNote).toBeUndefined();
    expect(saved.rubric).toBeUndefined();
  });

  it('keeps each student separate on a shared phone', () => {
    saveActivitySnapshot('stu_1', [activity({ title: 'A' })]);
    saveActivitySnapshot('stu_2', [activity({ title: 'B' })]);
    expect(readActivitySnapshot('stu_1').activities[0].title).toBe('A');
    expect(readActivitySnapshot('stu_2').activities[0].title).toBe('B');
  });

  it('is absent once it is older than the maximum age', () => {
    vi.useFakeTimers();
    const saved = new Date('2026-08-01T00:00:00.000Z').getTime();
    vi.setSystemTime(saved);
    saveActivitySnapshot('stu_1', [activity()]);

    vi.setSystemTime(saved + SNAPSHOT_MAX_AGE_MS - 1000);
    expect(readActivitySnapshot('stu_1').activities).toHaveLength(1);

    vi.setSystemTime(saved + SNAPSHOT_MAX_AGE_MS + 1000);
    expect(readActivitySnapshot('stu_1')).toBeNull();
  });

  it('reports when it was saved, so the page can say so', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T09:30:00.000Z'));
    saveActivitySnapshot('stu_1', [activity()]);
    expect(readActivitySnapshot('stu_1').savedAt).toBe('2026-08-11T09:30:00.000Z');
  });

  it('is absent rather than throwing when the stored JSON is corrupt', () => {
    localStorage.setItem('tg_activities_stu_1', '{not json');
    expect(readActivitySnapshot('stu_1')).toBeNull();
  });

  it('is absent for a student who has never saved one', () => {
    expect(readActivitySnapshot('stu_never')).toBeNull();
  });

  it('is absent when asked for without a user id', () => {
    expect(readActivitySnapshot(undefined)).toBeNull();
    expect(() => saveActivitySnapshot(undefined, [activity()])).not.toThrow();
  });

  it('replaces the previous snapshot rather than appending to it', () => {
    saveActivitySnapshot('stu_1', [activity({ id: 'a' }), activity({ id: 'b' })]);
    saveActivitySnapshot('stu_1', [activity({ id: 'c' })]);
    expect(readActivitySnapshot('stu_1').activities.map(a => a.id)).toEqual(['c']);
  });

  it('clears every student on the device, not just the one signing out', () => {
    saveActivitySnapshot('stu_1', [activity()]);
    saveActivitySnapshot('stu_2', [activity()]);
    clearActivitySnapshots();
    expect(readActivitySnapshot('stu_1')).toBeNull();
    expect(readActivitySnapshot('stu_2')).toBeNull();
  });

  it('leaves unrelated keys alone when clearing', () => {
    localStorage.setItem('tg_upload_queue', '[{"id":"q_1"}]');
    saveActivitySnapshot('stu_1', [activity()]);
    clearActivitySnapshots();
    expect(localStorage.getItem('tg_upload_queue')).toBe('[{"id":"q_1"}]');
  });
});

describe('merging a partial list into the saved one', () => {
  // The submit page fetches the whole student-submittable list and can replace
  // the snapshot outright. The dashboard and subjects pages see thinner slices
  // — the dashboard drops anything already submitted or past its deadline —
  // so they must fill in rather than overwrite, or simply opening the app on
  // the home screen would quietly delete most of what could be submitted.

  it('adds activities the snapshot did not have', () => {
    saveActivitySnapshot('stu_1', [activity({ id: 'a' })]);
    mergeActivitySnapshot('stu_1', [activity({ id: 'b' })]);
    expect(readActivitySnapshot('stu_1').activities.map(a => a.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps fields a thinner source does not carry', () => {
    saveActivitySnapshot('stu_1', [activity({ id: 'a' })]);
    // What /dashboard returns: no lateUntil, no instructions.
    mergeActivitySnapshot('stu_1', [{ id: 'a', title: 'Renamed', points: 25, className: 'English 7 — Rosal' }]);

    const [merged] = readActivitySnapshot('stu_1').activities;
    expect(merged.title).toBe('Renamed');
    expect(merged.points).toBe(25);
    expect(merged.lateUntil).toBe('2026-08-22T15:00:00.000Z');
    expect(merged.instructions).toBe('Write three paragraphs.');
  });

  it('never removes an activity the thinner source left out', () => {
    saveActivitySnapshot('stu_1', [activity({ id: 'a' }), activity({ id: 'b' })]);
    mergeActivitySnapshot('stu_1', [activity({ id: 'a' })]);
    expect(readActivitySnapshot('stu_1').activities).toHaveLength(2);
  });

  it('starts a snapshot when there is none yet', () => {
    mergeActivitySnapshot('stu_1', [activity({ id: 'a' })]);
    expect(readActivitySnapshot('stu_1').activities).toHaveLength(1);
  });

  it('strips the same fields a full save does', () => {
    mergeActivitySnapshot('stu_1', [activity({ mySubmission: { status: 'GRADED', grade: 18 } })]);
    expect(readActivitySnapshot('stu_1').activities[0].mySubmission).toBeUndefined();
  });

  it('refreshes how recently the list was seen', () => {
    vi.useFakeTimers();
    const day1 = new Date('2026-08-01T00:00:00.000Z').getTime();
    vi.setSystemTime(day1);
    saveActivitySnapshot('stu_1', [activity({ id: 'a' })]);

    // Six days later — still inside the window, so the merge has something to
    // merge into, and the result must not expire on the original clock.
    vi.setSystemTime(day1 + 6 * 24 * 60 * 60 * 1000);
    mergeActivitySnapshot('stu_1', [activity({ id: 'b' })]);

    vi.setSystemTime(day1 + 8 * 24 * 60 * 60 * 1000);
    expect(readActivitySnapshot('stu_1').activities).toHaveLength(2);
  });

  it('does not resurrect an expired snapshot, it replaces it', () => {
    vi.useFakeTimers();
    const day1 = new Date('2026-08-01T00:00:00.000Z').getTime();
    vi.setSystemTime(day1);
    saveActivitySnapshot('stu_1', [activity({ id: 'old' })]);

    vi.setSystemTime(day1 + SNAPSHOT_MAX_AGE_MS + 1000);
    mergeActivitySnapshot('stu_1', [activity({ id: 'new' })]);

    expect(readActivitySnapshot('stu_1').activities.map(a => a.id)).toEqual(['new']);
  });
});

describe('the teacher snapshot', () => {
  const cls = (over = {}) => ({
    id: 'cls_1', name: 'English 7 — Rosal', subject: 'English', gradeLevel: 7,
    schoolYear: '2026-2027',
    section: { id: 'sec_1', name: 'Rosal' },
    _count: { activities: 3 },
    ...over,
  });

  it('reads back everything the class card prints', () => {
    saveTeacherSnapshot('tch_1', { classes: [cls()] });
    const [saved] = readTeacherSnapshot('tch_1').classes;
    expect(saved.name).toBe('English 7 — Rosal');
    expect(saved.schoolYear).toBe('2026-2027');
    expect(saved.section.name).toBe('Rosal');
    expect(saved._count.activities).toBe(3);
  });

  it('never stores a learner name, a score, or a scanned paper', () => {
    saveTeacherSnapshot('tch_1', {
      classes: [cls({
        students: [{ id: 's1', name: 'Maria Santos' }],
        section: { id: 'sec_1', name: 'Rosal', students: [{ name: 'Jose Cruz' }] },
        overallGrade: 88,
      })],
    });
    const raw = localStorage.getItem('tg_teacher_tch_1');
    expect(raw).not.toMatch(/Maria|Jose|overallGrade/);
  });

  it('keeps counts but not the people they count', () => {
    saveTeacherSnapshot('tch_1', { classes: [cls({ _count: { activities: 3, students: 41 } })] });
    const [saved] = readTeacherSnapshot('tch_1').classes;
    expect(saved._count).toEqual({ activities: 3 });
  });

  it('keeps each teacher separate and clears with the session', () => {
    saveTeacherSnapshot('tch_1', { classes: [cls({ name: 'A' })] });
    saveTeacherSnapshot('tch_2', { classes: [cls({ name: 'B' })] });
    expect(readTeacherSnapshot('tch_1').classes[0].name).toBe('A');

    clearStoredSession();
    expect(readTeacherSnapshot('tch_1')).toBeNull();
    expect(readTeacherSnapshot('tch_2')).toBeNull();
  });

  it('expires on the same clock as the student one', () => {
    vi.useFakeTimers();
    const day1 = new Date('2026-08-01T00:00:00.000Z').getTime();
    vi.setSystemTime(day1);
    saveTeacherSnapshot('tch_1', { classes: [cls()] });

    vi.setSystemTime(day1 + SNAPSHOT_MAX_AGE_MS + 1000);
    expect(readTeacherSnapshot('tch_1')).toBeNull();
  });

  it('is absent rather than throwing on corrupt storage', () => {
    localStorage.setItem('tg_teacher_tch_1', 'not json at all');
    expect(readTeacherSnapshot('tch_1')).toBeNull();
  });
});

describe('the class snapshot a teacher uploads against', () => {
  /**
   * The one place learner names are written to disk, and only because batch
   * upload is meaningless without them — a teacher holding a stack of scanned
   * papers has to say which paper belongs to whom, and there is no way to ask
   * that question without a roster.
   *
   * Scoped as tightly as that reason allows: the teacher's own classes, on the
   * teacher's own device, gone at sign-out, gone after a week. Names and ids
   * only — no score, no submission, no scanned paper.
   */
  const classData = (over = {}) => ({
    id: 'cls_1',
    name: 'English 7 — Rosal',
    subject: 'English',
    section: {
      id: 'sec_1',
      name: 'Rosal',
      students: [
        { id: 'stu_1', name: 'Santos, Maria', lrn: '123456789012', email: 'maria@example.com' },
        { id: 'stu_2', name: 'Cruz, Jose', lrn: '210987654321', email: 'jose@example.com' },
      ],
    },
    activities: [{
      id: 'act_1', title: 'Essay on Rizal', type: 'ESSAY', points: 20,
      deadline: '2026-08-20T15:00:00.000Z', submissionMode: 'TEACHER_UPLOAD',
      submissions: [{ id: 'sub_1', hitlScore: 88, imageUrl: '/uploads/a.jpg' }],
    }],
    ...over,
  });

  it('keeps the roster, so a paper can be assigned to a learner offline', () => {
    saveClassSnapshot('tch_1', 'cls_1', classData());
    const saved = readClassSnapshot('tch_1', 'cls_1');
    expect(saved.section.students).toHaveLength(2);
    expect(saved.section.students[0]).toEqual({ id: 'stu_1', name: 'Santos, Maria' });
  });

  it('keeps only the name and id of a learner, nothing else on the record', () => {
    saveClassSnapshot('tch_1', 'cls_1', classData());
    const raw = localStorage.getItem('tg_class_tch_1_cls_1');
    expect(raw).not.toMatch(/123456789012|maria@example|lrn|email/);
  });

  it('keeps the activities to upload against, without their submissions', () => {
    saveClassSnapshot('tch_1', 'cls_1', classData());
    const saved = readClassSnapshot('tch_1', 'cls_1');
    expect(saved.activities[0].title).toBe('Essay on Rizal');
    expect(saved.activities[0].submissions).toBeUndefined();

    const raw = localStorage.getItem('tg_class_tch_1_cls_1');
    expect(raw).not.toMatch(/hitlScore|imageUrl|uploads|submissions/);
  });

  it('keeps one class apart from another', () => {
    saveClassSnapshot('tch_1', 'cls_1', classData({ name: 'A' }));
    saveClassSnapshot('tch_1', 'cls_2', classData({ id: 'cls_2', name: 'B' }));
    expect(readClassSnapshot('tch_1', 'cls_1').name).toBe('A');
    expect(readClassSnapshot('tch_1', 'cls_2').name).toBe('B');
  });

  it('keeps one teacher apart from another', () => {
    saveClassSnapshot('tch_1', 'cls_1', classData({ name: 'Mine' }));
    expect(readClassSnapshot('tch_2', 'cls_1')).toBeNull();
  });

  it('expires, and goes at sign-out, like every other snapshot', () => {
    vi.useFakeTimers();
    const day1 = new Date('2026-08-01T00:00:00.000Z').getTime();
    vi.setSystemTime(day1);
    saveClassSnapshot('tch_1', 'cls_1', classData());

    vi.setSystemTime(day1 + SNAPSHOT_MAX_AGE_MS + 1000);
    expect(readClassSnapshot('tch_1', 'cls_1')).toBeNull();

    vi.setSystemTime(day1);
    saveClassSnapshot('tch_1', 'cls_1', classData());
    clearStoredSession();
    expect(readClassSnapshot('tch_1', 'cls_1')).toBeNull();
  });

  it('survives a class with no section or no activities', () => {
    saveClassSnapshot('tch_1', 'cls_1', { id: 'cls_1', name: 'Bare' });
    const saved = readClassSnapshot('tch_1', 'cls_1');
    expect(saved.name).toBe('Bare');
    expect(saved.activities).toEqual([]);
    expect(saved.section).toBeUndefined();
  });

  it('is absent rather than throwing on corrupt storage', () => {
    localStorage.setItem('tg_class_tch_1_cls_1', 'nonsense');
    expect(readClassSnapshot('tch_1', 'cls_1')).toBeNull();
  });
});

describe('signing out', () => {
  it('takes the saved activity list with it', () => {
    storeSession({ id: 'stu_1', role: 'STUDENT' }, 'tok', { remember: true });
    saveActivitySnapshot('stu_1', [activity()]);

    clearStoredSession();

    expect(readActivitySnapshot('stu_1')).toBeNull();
  });

  it('does not discard work queued for upload — that is the student\'s, not the session\'s', () => {
    // A submission saved offline has to survive a sign-out on a shared phone,
    // or the work is simply gone. It carries its own studentId and the server
    // re-checks the token when it finally flushes.
    localStorage.setItem('tg_upload_queue', '[{"id":"q_1"}]');
    clearStoredSession();
    expect(localStorage.getItem('tg_upload_queue')).toBe('[{"id":"q_1"}]');
  });
});
