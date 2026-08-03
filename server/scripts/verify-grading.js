/**
 * Checks the grading engine against the published DepEd Order 8, s. 2015
 * transmutation table, row by row, plus the fairness rule that motivated the
 * change. Run after any edit to grading.js:  node scripts/verify-grading.js
 */
const { transmute, componentPercentage, computeGrade, legacyAverage } = require('../grading');

// [initialGradeLowerBound, initialGradeUpperBound, expectedTransmutedGrade]
const TABLE = [
  [100.00, 100.00, 100], [98.40, 99.99, 99], [96.80, 98.39, 98], [95.20, 96.79, 97],
  [93.60, 95.19, 96], [92.00, 93.59, 95], [90.40, 91.99, 94], [88.80, 90.39, 93],
  [87.20, 88.79, 92], [85.60, 87.19, 91], [84.00, 85.59, 90], [82.40, 83.99, 89],
  [80.80, 82.39, 88], [79.20, 80.79, 87], [77.60, 79.19, 86], [76.00, 77.59, 85],
  [74.40, 75.99, 84], [72.80, 74.39, 83], [71.20, 72.79, 82], [69.60, 71.19, 81],
  [68.00, 69.59, 80], [66.40, 67.99, 79], [64.80, 66.39, 78], [63.20, 64.79, 77],
  [61.60, 63.19, 76], [60.00, 61.59, 75], [56.00, 59.99, 74], [52.00, 55.99, 73],
  [48.00, 51.99, 72], [44.00, 47.99, 71], [40.00, 43.99, 70], [36.00, 39.99, 69],
  [32.00, 35.99, 68], [28.00, 31.99, 67], [24.00, 27.99, 66], [20.00, 23.99, 65],
  [16.00, 19.99, 64], [12.00, 15.99, 63], [8.00, 11.99, 62], [4.00, 7.99, 61],
  [0.00, 3.99, 60],
];

let pass = 0, fail = 0;
const check = (label, got, want) => {
  if (got === want) { pass++; return; }
  fail++;
  console.error(`  FAIL ${label}: got ${got}, expected ${want}`);
};

console.log('Transmutation table (both band edges of all 41 rows):');
for (const [lo, hi, expected] of TABLE) {
  check(`IG ${lo.toFixed(2)}`, transmute(lo), expected);
  check(`IG ${hi.toFixed(2)}`, transmute(hi), expected);
}

console.log('Fairness rule (points-weighted, not mean of percentages):');
// The example from the brief: 90/100 and 40/50.
const work = [{ percent: 90, points: 100 }, { percent: 80, points: 50 }];
check('componentPercentage 90/100 + 40/50', Math.round(componentPercentage(work) * 100) / 100, 86.67);
check('legacyAverage of the same work', legacyAverage(work), 85);

console.log('Edge cases:');
check('no graded work -> null', componentPercentage([]), null);
check('zero-point activity ignored', componentPercentage([{ percent: 50, points: 0 }]), null);
check('null initial grade transmutes to null', transmute(null), null);

console.log('Missing components renormalise:');
// Only Written Work graded so far — grade must reflect WW alone, not 30% of it.
const wwOnly = computeGrade([{ percent: 88, points: 100, component: 'WW' }], { WW: 30, PT: 50, QA: 20 });
check('WW-only initial grade', wwOnly.initialGrade, 88);
check('WW-only reports missing PT and QA', wwOnly.missingComponents.join(','), 'PT,QA');

console.log('Unknown component falls back to Written Work:');
const legacy = computeGrade([{ percent: 70, points: 100, component: undefined }], { WW: 30, PT: 50, QA: 20 });
check('uncategorised activity still grades', legacy.initialGrade, 70);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
