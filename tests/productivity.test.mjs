import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateUtilization,
  getUtilizationStatus,
  calculateRevenueCredit,
  calculateProductivityTat,
  calculateTargetPace,
  calculateSalaryEfficiency
} from '../server/src/services/productivityCalculationService.js';
import {
  getTrackingStart,
  getTrackingEnd,
  resolvePeriodRange,
  getComparativeReportRanges
} from '../server/src/utils/productivityDates.js';

test('Calculates utilization and status correctly across thresholds', () => {
  // Overworked (>= 115%)
  const u1 = calculateUtilization(60, 48, 1);
  assert.equal(u1, 125);
  assert.equal(getUtilizationStatus(u1), 'overworked');

  // Stretched (>= 90% and < 115%)
  const u2 = calculateUtilization(40, 40, 1);
  assert.equal(u2, 100);
  assert.equal(getUtilizationStatus(u2), 'stretched');

  // Balanced (>= 55% and < 90%)
  const u3 = calculateUtilization(25, 40, 1);
  assert.equal(u3, 62.5);
  assert.equal(getUtilizationStatus(u3), 'balanced');

  // Underutilised (>= 25% and < 55%)
  const u4 = calculateUtilization(15, 40, 1);
  assert.equal(u4, 37.5);
  assert.equal(getUtilizationStatus(u4), 'underutilised');

  // Idle (< 25%)
  const u5 = calculateUtilization(5, 40, 1);
  assert.equal(u5, 12.5);
  assert.equal(getUtilizationStatus(u5), 'idle');
});

test('Calculates revenue credit according to allocation percentage', () => {
  const credit = calculateRevenueCredit(50000, 30);
  assert.equal(credit, 15000);

  const creditFull = calculateRevenueCredit(120000, 100);
  assert.equal(creditFull, 120000);
});

test('Calculates productivity turnaround time in days', () => {
  const tat = calculateProductivityTat('2026-07-10', '2026-07-13');
  assert.equal(tat, 3);

  const inProgressTat = calculateProductivityTat('2026-07-10', null);
  assert.equal(inProgressTat, null);
});

test('Calculates throughput target pace matching business thresholds', () => {
  // On pace (>= 1.0)
  assert.equal(calculateTargetPace(5, 5), 'on_pace');
  assert.equal(calculateTargetPace(7, 5), 'on_pace');

  // Behind (>= 0.6 and < 1.0)
  assert.equal(calculateTargetPace(3, 5), 'behind');

  // Off pace (< 0.6)
  assert.equal(calculateTargetPace(2, 5), 'off_pace');
  assert.equal(calculateTargetPace(0, 5), 'off_pace');
});

test('Resolves 1 July reporting cycle tracking start', () => {
  // In August 2026 (month >= 6) -> July 1 2026
  const augDate = new Date(2026, 7, 15);
  const startAug = getTrackingStart(augDate);
  assert.equal(startAug.getFullYear(), 2026);
  assert.equal(startAug.getMonth(), 6);
  assert.equal(startAug.getDate(), 1);

  // In March 2027 (month < 6) -> July 1 2026
  const marDate = new Date(2027, 2, 10);
  const startMar = getTrackingStart(marDate);
  assert.equal(startMar.getFullYear(), 2026);
  assert.equal(startMar.getMonth(), 6);
  assert.equal(startMar.getDate(), 1);
});

test('Calculates salary grade efficiency multipliers with privacy', () => {
  // Grade B midpoint: (25000 + 45000) / 2 = 35000
  // Revenue credit: 70000, 1 month -> 2.0x
  const efficiency = calculateSalaryEfficiency(70000, 35000, 1);
  assert.equal(efficiency, 2.0);

  const nullEff = calculateSalaryEfficiency(70000, 0, 1);
  assert.equal(nullEff, null);
});
