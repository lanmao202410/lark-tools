import { inclusiveDaysOverlap, mergeAdjacentSlots, resolveResourceOptions } from '../src/bookingSlots.js';

function assertDeepEqual(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

const merged = mergeAdjacentSlots([
  { start: 11, end: 12 },
  { start: 9, end: 10 },
  { start: 10, end: 11 },
  { start: 15, end: 16 },
]);

assertDeepEqual(merged, [
  { start: 9, end: 12 },
  { start: 15, end: 16 },
]);

const overlapping = mergeAdjacentSlots([
  { start: 9, end: 11 },
  { start: 10, end: 12 },
]);

assertDeepEqual(overlapping, [{ start: 9, end: 12 }]);

const day1 = new Date('2026-08-26T00:00:00').getTime();
const day2 = new Date('2026-08-27T00:00:00').getTime();
const day3 = new Date('2026-08-28T00:00:00').getTime();
const day4 = new Date('2026-08-29T00:00:00').getTime();

assertDeepEqual(inclusiveDaysOverlap(day1, day3, day3, day4), true);
assertDeepEqual(inclusiveDaysOverlap(day1, day2, day3, day4), false);

assertDeepEqual(resolveResourceOptions(['台架A', '工程师D'], ['A', 'B', '会议室C']), ['台架A', '工程师D']);
assertDeepEqual(resolveResourceOptions([], ['A', 'B', '会议室C']), ['A', 'B', '会议室C']);
