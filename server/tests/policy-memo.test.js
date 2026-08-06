import { describe, it, expect, vi } from 'vitest';
import grading from '../grading.js';

const { memoPolicyLoader } = grading;

/**
 * The memo that removed the N+1 in the analytics endpoints.
 *
 * workingAverageAcrossSubjects looks up a grading policy for each subject a
 * student has work in, and it is called once per student. Forty pupils across
 * three subjects therefore issued up to 120 sequential database reads per page
 * load, for at most three distinct answers.
 */

describe('memoPolicyLoader', () => {
  it('loads each (gradeLevel, subject) pair exactly once', async () => {
    const load = vi.fn(async (g, s) => ({ g, s }));
    const policyFor = memoPolicyLoader(load);

    // Forty students, three subjects each — the shape of a real class set.
    for (let student = 0; student < 40; student++) {
      await policyFor('Grade 6', 'English');
      await policyFor('Grade 6', 'Mathematics');
      await policyFor('Grade 6', 'Science');
    }

    expect(load).toHaveBeenCalledTimes(3);   // was 120
  });

  it('returns the right answer for each pair, not just the first one', async () => {
    const policyFor = memoPolicyLoader(async (g, s) => `${g}/${s}`);
    expect(await policyFor('Grade 6', 'English')).toBe('Grade 6/English');
    expect(await policyFor('Grade 3', 'Mathematics')).toBe('Grade 3/Mathematics');
    expect(await policyFor('Grade 6', 'English')).toBe('Grade 6/English');
  });

  it('keys on grade level as well as subject', async () => {
    // A school may set its own weights per grade AND subject, so these are two
    // different questions and must not share a cache entry.
    const load = vi.fn(async (g, s) => `${g}/${s}`);
    const policyFor = memoPolicyLoader(load);
    await policyFor('Grade 6', 'English');
    await policyFor('Grade 3', 'English');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    // Caches the promise, not the resolved value. Without that, ten students
    // resolved in parallel would each miss the cache and issue their own query.
    let resolveIt;
    const load = vi.fn(() => new Promise(r => { resolveIt = r; }));
    const policyFor = memoPolicyLoader(load);

    const inFlight = [policyFor('Grade 6', 'English'), policyFor('Grade 6', 'English')];
    resolveIt({ WW: 30, PT: 50, QA: 20 });
    const [a, b] = await Promise.all(inFlight);

    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('groups unknown grade levels and subjects into one bucket', async () => {
    // They all take the generic default, so one lookup is the right answer —
    // and they must not collide with a real subject named ''.
    const load = vi.fn(async () => 'default');
    const policyFor = memoPolicyLoader(load);
    await policyFor(null, null);
    await policyFor(undefined, undefined);
    await policyFor('', '');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('holds no reference to a school — lifetime is the caller\'s to decide', async () => {
    // Two memos built from two loaders stay independent, which is what lets a
    // per-request cache avoid serving stale weights after an admin edit.
    const first = memoPolicyLoader(async () => 'old weights');
    const second = memoPolicyLoader(async () => 'new weights');
    expect(await first('Grade 6', 'English')).toBe('old weights');
    expect(await second('Grade 6', 'English')).toBe('new weights');
  });
});
