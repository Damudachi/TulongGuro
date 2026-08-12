import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveActivitySnapshot, readActivitySnapshot, clearActivitySnapshots, SNAPSHOT_MAX_AGE_MS,
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
