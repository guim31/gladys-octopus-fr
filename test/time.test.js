// Dates in French legal time, DST changes included, without a library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  FRANCE,
  formatMinutes,
  isoWithOffset,
  isValidTimeZone,
  localDate,
  minuteOfDay,
  monthStart,
  startOfLocalDay,
} from '../src/time.js';

test('a French day starts at midnight in Paris, 23 or 25 hours long around DST', () => {
  assert.equal(
    new Date(startOfLocalDay('2026-07-01', FRANCE)).toISOString(),
    '2026-06-30T22:00:00.000Z',
  );
  assert.equal(
    new Date(startOfLocalDay('2026-01-15', FRANCE)).toISOString(),
    '2026-01-14T23:00:00.000Z',
  );
  // 2026-03-29: spring forward; 2026-10-25: fall back.
  const spring = startOfLocalDay('2026-03-30', FRANCE) - startOfLocalDay('2026-03-29', FRANCE);
  const fall = startOfLocalDay('2026-10-26', FRANCE) - startOfLocalDay('2026-10-25', FRANCE);
  assert.equal(spring / 3600000, 23);
  assert.equal(fall / 3600000, 25);
});

test('an instant prints with the Paris offset, as the measurements query takes it', () => {
  assert.equal(
    isoWithOffset(Date.parse('2026-06-30T22:00:00Z'), FRANCE),
    '2026-07-01T00:00:00+02:00',
  );
  assert.equal(
    isoWithOffset(Date.parse('2026-01-14T23:00:00Z'), FRANCE),
    '2026-01-15T00:00:00+01:00',
  );
});

test('the local date, the minute of the day and the calendar arithmetic', () => {
  assert.equal(localDate(Date.parse('2026-10-13T22:30:00Z'), FRANCE), '2026-10-14');
  assert.equal(localDate(Date.parse('2026-10-13T22:30:00Z'), 'UTC'), '2026-10-13');
  assert.equal(minuteOfDay(Date.parse('2026-10-14T20:00:00Z'), FRANCE), 22 * 60);
  assert.equal(minuteOfDay(Date.parse('2026-12-14T21:00:00Z'), FRANCE), 22 * 60);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(monthStart('2026-10-14'), '2026-10-01');
  assert.equal(formatMinutes(360), '06:00');
  assert.equal(formatMinutes(1440), '00:00');
  assert.equal(isValidTimeZone(FRANCE), true);
  assert.equal(isValidTimeZone('Nowhere/City'), false);
});
