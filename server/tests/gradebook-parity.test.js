import { describe, it, expect } from 'vitest';
import server from '../grading.js';
import * as client from '../../src/utils/grading.js';

/**
 * The class gradebook table and the exported file have to show the same grade.
 *
 * They did not. The table totalled raw points across every activity — no DepEd
 * component weights, and counting AI drafts the teacher had never validated —
 * while the export ran the real DO 8 s.2015 pipeline over validated work only.
 * On the same class the screen said 62% and the file said 87%.
 *
 * The table now runs computeGrade too, which means the computation exists in
 * two files: server/grading.js (CommonJS, used by the API) and
 * src/utils/grading.js (ES module, bundled by Vite). Neither can import the
 * other without a build step, so this test is the thing that stops them
 * drifting: it loads BOTH and asserts they agree.
 *
 * If you change one and not the other, this fails.
 */

const POLICIES = [
  { WW: 30, PT: 50, QA: 20 },   // Languages / AP / EsP
  { WW: 40, PT: 40, QA: 20 },   // Science / Math
  { WW: 20, PT: 60, QA: 20 },   // MAPEH / EPP / TLE
  { WW: 33, PT: 33, QA: 34 },   // a school's own override
];

describe('the transmutation table is identical on both sides', () => {
  it('agrees on every whole Initial Grade from 0 to 100', () => {
    for (let ig = 0; ig <= 100; ig += 1) {
      expect(client.transmute(ig)).toBe(server.transmute(ig));
    }
  });

  it('agrees on the band edges, where flooring vs rounding actually differs', () => {
    // 38.4/1.6 is 23.999… in IEEE 754 — the case both sides guard with
    // toFixed(6). If one guard is removed this is the test that catches it.
    for (const ig of [59.99, 60, 60.01, 98.39, 98.4, 99.99, 76.8, 38.4, 0.01]) {
      expect(client.transmute(ig)).toBe(server.transmute(ig));
    }
  });

  it('agrees that nothing graded transmutes to nothing', () => {
    expect(client.transmute(null)).toBeNull();
    expect(server.transmute(null)).toBeNull();
  });
});

describe('componentPercentage is identical on both sides', () => {
  it('weighs by points, not by activity count, in both files', () => {
    const entries = [
      { percent: 90, points: 100 },
      { percent: 80, points: 50 },
    ];
    expect(client.componentPercentage(entries)).toBe(server.componentPercentage(entries));
    // And it is the points-weighted answer, not the plain mean of 85.
    expect(Math.round(client.componentPercentage(entries))).toBe(87);
  });

  it('agrees that an empty component is null, not zero', () => {
    expect(client.componentPercentage([])).toBeNull();
    expect(server.componentPercentage([])).toBeNull();
  });
});

describe('computeGrade is identical on both sides', () => {
  /** A spread of shapes: missing components, mixed point values, edge scores. */
  const CASES = [
    { name: 'nothing graded', entries: [] },
    { name: 'written work only', entries: [{ percent: 80, points: 100, component: 'WW' }] },
    {
      name: 'all three components, mixed point values',
      entries: [
        { percent: 90, points: 100, component: 'WW' },
        { percent: 72, points: 50, component: 'PT' },
        { percent: 61, points: 30, component: 'PT' },
        { percent: 55, points: 100, component: 'QA' },
      ],
    },
    {
      name: 'an unrecognised component falls back to WW on both sides',
      entries: [
        { percent: 88, points: 20, component: 'SOMETHING_ELSE' },
        { percent: 44, points: 20, component: 'QA' },
      ],
    },
    {
      name: 'a perfect and a zero mark together',
      entries: [
        { percent: 100, points: 40, component: 'WW' },
        { percent: 0, points: 40, component: 'PT' },
      ],
    },
    {
      name: 'the screenshot case — small drills next to a big essay',
      entries: [
        { percent: 100, points: 10, component: 'WW' },
        { percent: 100, points: 10, component: 'WW' },
        { percent: 100, points: 100, component: 'PT' },
        { percent: 83, points: 20, component: 'PT' },
        { percent: 30, points: 100, component: 'PT' },
      ],
    },
  ];

  for (const policy of POLICIES) {
    for (const transmuteOn of [false, true]) {
      for (const { name, entries } of CASES) {
        it(`${name} — weights ${policy.WW}/${policy.PT}/${policy.QA}, transmute ${transmuteOn}`, () => {
          const a = client.computeGrade(entries, policy, { transmute: transmuteOn });
          const b = server.computeGrade(entries, policy, { transmute: transmuteOn });
          expect(a.initialGrade).toEqual(b.initialGrade);
          expect(a.transmutedGrade).toEqual(b.transmutedGrade);
          expect(a.finalGrade).toEqual(b.finalGrade);
          expect(a.componentPercents).toEqual(b.componentPercents);
          expect(a.usedWeights).toEqual(b.usedWeights);
          expect(a.missingComponents).toEqual(b.missingComponents);
        });
      }
    }
  }

  it('agrees across a swept range of single marks, both bases', () => {
    for (let raw = 0; raw <= 100; raw += 1) {
      const entries = [{ percent: raw, points: 75, component: 'PT' }];
      for (const transmuteOn of [false, true]) {
        expect(client.computeGrade(entries, POLICIES[0], { transmute: transmuteOn }).finalGrade)
          .toBe(server.computeGrade(entries, POLICIES[0], { transmute: transmuteOn }).finalGrade);
      }
    }
  });
});

describe('the default weight policy is identical on both sides', () => {
  const SUBJECTS = [
    'English', 'Filipino 6', 'Math', 'Mathematics', 'Science', 'Agham',
    'MAPEH', 'Music', 'EPP', 'TLE', 'Araling Panlipunan', 'EsP', '', null,
  ];

  for (const subject of SUBJECTS) {
    it(`agrees on the weights for ${JSON.stringify(subject)}`, () => {
      expect(client.defaultPolicyFor(subject)).toEqual(server.defaultPolicyFor(subject));
      expect(client.weightGroupForSubject(subject)).toBe(server.weightGroupForSubject(subject));
    });
  }
});
