import assert from 'node:assert/strict';
import {
  calculateProductivityTat,
  calculateRevenueCredit,
  calculateTargetPace,
  calculateUtilization,
  daysBetweenInclusive,
  getTrackingStart,
  getUtilizationStatus,
  reportRanges,
  resolvePeriodRange,
  weeksBetween
} from '../src/productivityCalculations.js';

const fixedToday = new Date('2026-08-12T09:00:00.000Z');

assert.equal(getTrackingStart(fixedToday), '2026-07-01');
assert.deepEqual(resolvePeriodRange('month', '', '', fixedToday), {
  key: 'month',
  from: '2026-08-01',
  to: '2026-08-12',
  trackingStart: '2026-07-01',
  trackingEnd: '2026-08-12'
});
assert.deepEqual(resolvePeriodRange('custom', '2026-06-01', '2026-12-01', fixedToday), {
  key: 'custom',
  from: '2026-07-01',
  to: '2026-08-12',
  trackingStart: '2026-07-01',
  trackingEnd: '2026-08-12'
});
assert.equal(daysBetweenInclusive('2026-08-01', '2026-08-07'), 7);
assert.equal(weeksBetween('2026-08-01', '2026-08-07'), 1);
assert.equal(Math.round(calculateUtilization(46, 40, 1)), 115);
assert.equal(getUtilizationStatus(115), 'overworked');
assert.equal(getUtilizationStatus(54.9), 'underutilised');
assert.equal(calculateRevenueCredit(50000, 30), 15000);
assert.equal(calculateProductivityTat('2026-08-01', '2026-08-04'), 3);
assert.equal(calculateTargetPace(10, 10), 'on_pace');
assert.equal(calculateTargetPace(7, 10), 'behind');
assert.equal(calculateTargetPace(4, 10), 'off_pace');

const ranges = reportRanges(fixedToday);
assert.deepEqual(ranges.mtd, { from: '2026-08-01', to: '2026-08-12' });
assert.deepEqual(ranges.lmtd, { from: '2026-07-01', to: '2026-07-12' });
assert.deepEqual(ranges.ytd, { from: '2026-01-01', to: '2026-08-12' });

console.log('productivity calculation tests passed');
