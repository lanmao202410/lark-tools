import {
  buildSlotRanges,
  inclusiveDaysOverlap,
  mergeAdjacentSlots,
  resolveFieldByName,
  resolveBookingDateFields,
  resolveBookingTableId,
  resolveBookingTimeFields,
  resolveResourceOptions,
} from '../src/bookingSlots.js';

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
assertDeepEqual(resolveResourceOptions([], ['A', 'B'], true), []);
assertDeepEqual(resolveBookingDateFields('小时', { start: day1, end: day2 }), null);
assertDeepEqual(resolveBookingDateFields('天', { start: day1, end: day2 }), {
  startDate: day1,
  endDate: day2,
});
assertDeepEqual(resolveBookingTimeFields('天', { start: day1, end: day2 }), null);
assertDeepEqual(resolveBookingTimeFields('小时', { start: day1, end: day2 }), {
  startTime: day1,
  endTime: day2,
});
assertDeepEqual(
  resolveFieldByName(
    [
      { id: 'field-type', name: '资源类型' },
      { id: 'field-name', name: '资源名称' },
    ],
    ['资源名称', '资源'],
  )?.id,
  'field-name',
);
assertDeepEqual(
  resolveFieldByName(
    [
      { id: 'field-type', name: '资源类型' },
      { id: 'field-name', name: '名称' },
    ],
    ['资源名称', '名称', '资源'],
    ['类型'],
  )?.id,
  'field-name',
);

assertDeepEqual(
  resolveBookingTableId('tbl-booking', 'tbl-current', ['tbl-booking', 'tbl-resource']),
  'tbl-booking',
);
assertDeepEqual(
  resolveBookingTableId('tbl-deleted', 'tbl-current', ['tbl-booking', 'tbl-current']),
  'tbl-current',
);

const halfHourSlots = buildSlotRanges('2026-08-30', '09:00', '10:00', 30);
assertDeepEqual(
  halfHourSlots.map((slot) => ({
    start: new Date(slot.start).toTimeString().slice(0, 5),
    end: new Date(slot.end).toTimeString().slice(0, 5),
  })),
  [
    { start: '09:00', end: '09:30' },
    { start: '09:30', end: '10:00' },
  ],
);
