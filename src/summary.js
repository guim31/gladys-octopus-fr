// -----------------------------------------------------------------------------
// From the Octopus measurements to what Gladys shows. Pure functions, no I/O.
//
//   - `toDays`: daily measurements → one entry per French day, complete days
//     only (Octopus counts days in Europe/Paris);
//   - `toDailyConsumption`: those days → the dated daily consumption of the
//     Gladys energy tracking (POST /energy/consumption), elapsed days of the
//     Gladys zone only;
//   - `computeSummary`: the last day with a reading, its month (to date) and
//     the last 14 days, for the features, the widget and the scenes.
//
// The month is the month of the last reading, not the calendar month: on the
// 1st, before Enedis sends the first day of the month, it still shows the
// month that just ended (as the Octopus customer area and ha-octopus-french
// do), never a false zero.
// -----------------------------------------------------------------------------

import { parseMeasurement } from './octopus/parse.js';
import { FRANCE, localDate } from './time.js';

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * @param {Array<object>} nodes daily measurement nodes
 * @param {number} now
 * @returns {Array<{ date: string, kwh: number, cost: number|null }>} oldest first
 */
export function toDays(nodes, now) {
  const days = new Map();
  for (const node of nodes) {
    const read = parseMeasurement(node);
    if (!read || read.kwh === null) {
      continue;
    }
    if (read.end !== null && read.end > now) {
      continue;
    }
    const date = localDate(read.start, FRANCE);
    const day = days.get(date) ?? { date, kwh: 0, cost: null };
    day.kwh = round(day.kwh + read.kwh, 6);
    if (read.cost !== null) {
      day.cost = round((day.cost ?? 0) + read.cost, 4);
    }
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Days → `{ date, kwh }` for the energy tracking: elapsed in the Gladys zone,
 * from `from` (YYYY-MM-DD) on, never negative.
 */
export function toDailyConsumption(days, { from, now, gladysTimeZone }) {
  const today = localDate(now, gladysTimeZone);
  return days
    .filter((day) => day.date >= from && day.date < today)
    .map((day) => ({ date: day.date, kwh: Math.max(0, day.kwh) }));
}

/**
 * @param {Array<{ date: string, kwh: number, cost: number|null }>} days
 * @param {object} [monthly] a monthly reading when there is no daily one (gas)
 * @returns {{ lastDay: object|null, month: object|null, recent: Array<object> }}
 */
export function computeSummary(days, monthly = null) {
  const lastDay = days.at(-1) ?? null;
  let month = null;
  if (lastDay) {
    const key = lastDay.date.slice(0, 7);
    const ofMonth = days.filter((day) => day.date.startsWith(key));
    const costs = ofMonth.filter((day) => day.cost !== null);
    month = {
      month: key,
      kwh: round(
        ofMonth.reduce((sum, day) => sum + day.kwh, 0),
        3,
      ),
      // A cost only when every day of the month has one: a partial sum would mislead.
      cost:
        costs.length === ofMonth.length && costs.length > 0
          ? round(
              costs.reduce((sum, day) => sum + day.cost, 0),
              2,
            )
          : null,
      until: lastDay.date,
    };
  } else if (monthly) {
    month = { month: monthly.month, kwh: round(monthly.kwh, 3), cost: monthly.cost, until: null };
  }
  return {
    lastDay: lastDay
      ? {
          date: lastDay.date,
          kwh: round(lastDay.kwh, 3),
          cost: lastDay.cost === null ? null : round(lastDay.cost, 2),
        }
      : null,
    month,
    recent: days.slice(-14).map((day) => ({ date: day.date, kwh: round(day.kwh, 3) })),
  };
}

/** The last monthly measurement → `{ month, kwh, cost }`, or null. */
export function lastMonthly(nodes) {
  const reads = nodes
    .map(parseMeasurement)
    .filter((read) => read && read.kwh !== null)
    .sort((a, b) => a.start - b.start);
  const last = reads.at(-1);
  if (!last) {
    return null;
  }
  // A monthly reading starts on the 1st (Paris): a few hours past it in UTC.
  return {
    month: localDate(last.start + 12 * 3600 * 1000, FRANCE).slice(0, 7),
    kwh: last.kwh,
    cost: last.cost === null ? null : Math.round(last.cost * 100) / 100,
  };
}
