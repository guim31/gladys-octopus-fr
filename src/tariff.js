// -----------------------------------------------------------------------------
// The off-peak hours of a contract and the tariff period of an instant.
// Pure functions, no I/O.
//
// Where the off-peak hours come from, most precise first (the order of
// ha-octopus-french):
//   1. the time slots of the off-peak rate of the active agreement
//      ("22:00:00" → "06:00:00");
//   2. the description of the off-peak class of the meter's provider
//      calendar ("0H50-6H50", "Novembre à mars, de 23h à 7h");
//   3. the off-peak label Enedis gives the Linky meter ("HC (22H00-6H00)").
// All hours are French legal time (Europe/Paris), DST included.
//
// Periods: 'base' (one price all day), 'off_peak' and 'peak'. The price of the
// period comes from the agreement's rates; it stays unknown (null) for Tempo
// offers, whose price depends on the colour of the day, which the account
// does not tell in advance.
// -----------------------------------------------------------------------------

import { FRANCE, formatMinutes, minuteOfDay, wallClock } from './time.js';

export const PERIOD = { BASE: 'base', OFF_PEAK: 'off_peak', PEAK: 'peak' };

const MONTHS = {
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12,
};

// Two-season offers (heures pleines / creuses été et hiver) and Tempo-like
// offers (OctoTempo: été, hiver, jours rouges).
const SEASON_CODES = {
  HPB: { season: 'summer', off: false },
  HCB: { season: 'summer', off: true },
  HPH: { season: 'winter', off: false },
  HCH: { season: 'winter', off: true },
};
const TEMPO_CODES = new Set(['HPE', 'HCE', 'HPHI', 'HCHI', 'HPP', 'HCP']);
// The seasons when the calendar does not say: April to October is summer.
const DEFAULT_SUMMER = [4, 10];

const RANGE = /(\d{1,2})\s*[hH:](\d{2})?\s*(?:-|à|a|to)\s*(\d{1,2})\s*[hH:](\d{2})?/g;

/** "HC (22H00-6H00)", "de 21h à 7h et de 11h à 17h" → minute ranges. */
export function parseRanges(text) {
  const ranges = [];
  for (const match of String(text ?? '').matchAll(RANGE)) {
    const start = Number(match[1]) * 60 + Number(match[2] ?? 0);
    const end = Number(match[3]) * 60 + Number(match[4] ?? 0);
    if (start <= 1440 && end <= 1440 && start !== end) {
      ranges.push({ start: start % 1440, end: end % 1440 });
    }
  }
  return ranges;
}

/** "Avril à octobre", "Novembre à mars" → [first month, last month], or null. */
export function parseSeasonMonths(text) {
  const found = [
    ...String(text ?? '')
      .toLowerCase()
      .matchAll(/\p{L}+/gu),
  ]
    .map((match) => MONTHS[match[0]])
    .filter(Boolean);
  return found.length >= 2 ? [found[0], found[1]] : null;
}

const inMonths = (month, [first, last]) =>
  first <= last ? month >= first && month <= last : month >= first || month <= last;

/** True when an instant (minutes since midnight) falls in a range, end excluded. */
export function inRange(minute, { start, end }) {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The kind of offer: 'base', 'hphc', 'two_season', 'tempo' or null (unknown). */
export function offerKind(point) {
  const codes = new Set([
    ...(point.agreement?.rates ?? []).map((rate) => rate.code).filter(Boolean),
    ...(point.temporalClasses ?? []).map((entry) => entry.code).filter(Boolean),
  ]);
  if ([...codes].some((code) => TEMPO_CODES.has(code))) {
    return 'tempo';
  }
  if ([...codes].some((code) => SEASON_CODES[code])) {
    return 'two_season';
  }
  if (codes.has('HC') || codes.has('HP')) {
    return 'hphc';
  }
  const rates = point.agreement?.rates ?? [];
  if (codes.has('BASE') || rates.length === 1) {
    return 'base';
  }
  if (rates.length >= 2) {
    // No class on the rates: two prices are a peak/off-peak offer.
    return 'hphc';
  }
  return null;
}

/** The season of a date for a two-season offer, from the calendar descriptions. */
export function seasonOf(point, month) {
  for (const entry of point.temporalClasses ?? []) {
    const info = SEASON_CODES[entry.code];
    const months = info ? parseSeasonMonths(entry.description) : null;
    if (months && inMonths(month, months)) {
      return info.season;
    }
  }
  return inMonths(month, DEFAULT_SUMMER) ? 'summer' : 'winter';
}

/** Is this rate (or calendar class) an off-peak one for the season? */
function isOffPeakCode(code, kind, season) {
  if (!code) {
    return false;
  }
  if (kind === 'two_season') {
    return SEASON_CODES[code]?.off === true && SEASON_CODES[code].season === season;
  }
  if (kind === 'tempo') {
    return code.startsWith('HC');
  }
  return code === 'HC';
}

function isPeakCode(code, kind, season) {
  if (!code) {
    return false;
  }
  if (kind === 'two_season') {
    return SEASON_CODES[code]?.off === false && SEASON_CODES[code].season === season;
  }
  return code === 'HP';
}

/**
 * The off-peak hours of a supply point on a given month.
 * @returns {{ ranges: Array<{ start: number, end: number }>, source: string|null }}
 */
export function offPeakHours(point, month) {
  const kind = offerKind(point);
  if (kind === 'base' || kind === null) {
    return { ranges: [], source: null };
  }
  const season = kind === 'two_season' ? seasonOf(point, month) : null;
  const rates = point.agreement?.rates ?? [];

  const fromRate =
    rates.find((rate) => isOffPeakCode(rate.code, kind, season) && rate.slots.length > 0) ??
    // Rates without class: the cheaper one carrying slots.
    [...rates]
      .filter((rate) => !rate.code && rate.slots.length > 0)
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
  if (fromRate) {
    return {
      ranges: fromRate.slots.filter((slot) => slot.start !== slot.end),
      source: 'contract',
    };
  }

  const fromCalendar = (point.temporalClasses ?? []).find((entry) =>
    isOffPeakCode(entry.code, kind, season),
  );
  const calendarRanges = parseRanges(fromCalendar?.description);
  if (calendarRanges.length > 0) {
    return { ranges: calendarRanges, source: 'calendar' };
  }

  const linkyRanges = parseRanges(point.offPeakLabel);
  if (linkyRanges.length > 0) {
    return { ranges: linkyRanges, source: 'linky' };
  }
  return { ranges: [], source: null };
}

/** "22:00–06:00, 12:00–14:00" */
export function formatRanges(ranges) {
  return ranges
    .map((range) => `${formatMinutes(range.start)}–${formatMinutes(range.end)}`)
    .join(', ');
}

/**
 * The tariff period of an electricity supply point at an instant.
 * @returns {{ period: string, price: number|null, until: string|null,
 *   ranges: Array<{ start: number, end: number }>, kind: string } | null}
 *   null when the contract does not tell (no agreement read yet)
 */
export function currentPeriod(point, ms) {
  const kind = offerKind(point);
  if (kind === null) {
    return null;
  }
  const rates = point.agreement?.rates ?? [];
  if (kind === 'base') {
    const rate = rates.find((entry) => entry.code === 'BASE') ?? rates[0] ?? null;
    return { period: PERIOD.BASE, price: rate?.price ?? null, until: null, ranges: [], kind };
  }
  const { month } = wallClock(ms, FRANCE);
  const { ranges } = offPeakHours(point, month);
  if (ranges.length === 0) {
    return null;
  }
  const minute = minuteOfDay(ms, FRANCE);
  const current = ranges.find((range) => inRange(minute, range));
  const period = current ? PERIOD.OFF_PEAK : PERIOD.PEAK;

  // When the period ends: the end of this off-peak range, or the next start.
  let until;
  if (current) {
    until = current.end;
  } else {
    const ahead = (start) => (start - minute + 1440) % 1440;
    until = ranges.map((range) => range.start).sort((a, b) => ahead(a) - ahead(b))[0];
  }

  let price = null;
  if (kind !== 'tempo') {
    const season = kind === 'two_season' ? seasonOf(point, month) : null;
    const match = (rate) =>
      current ? isOffPeakCode(rate.code, kind, season) : isPeakCode(rate.code, kind, season);
    const rate = rates.find(match);
    if (rate) {
      price = rate.price;
    } else if (rates.length === 2 && rates.every((entry) => !entry.code)) {
      // No class on the rates: the cheaper is off-peak.
      const sorted = [...rates].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
      price = (current ? sorted[0] : sorted[1]).price;
    }
  }
  return { period, price, until: formatMinutes(until), ranges, kind };
}
