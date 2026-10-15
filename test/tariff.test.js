// The off-peak hours of a contract and the tariff period of an instant, in
// French legal time. Shapes from the account fixture and the ha-octopus-french
// tests (offPeakLabel "HC (22H00-6H00)", calendar descriptions, time slots).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/kraken-server.js';
import { parseAccount } from '../src/octopus/parse.js';
import {
  currentPeriod,
  formatRanges,
  inRange,
  offerKind,
  offPeakHours,
  parseRanges,
  parseSeasonMonths,
  seasonOf,
} from '../src/tariff.js';

const at = (iso) => Date.parse(iso);
const [electricity, gas] = parseAccount(fixture('account-hphc.json').data.account);

test('the off-peak ranges are read from the labels Enedis and Octopus write', () => {
  assert.deepEqual(parseRanges('HC (22H00-6H00)'), [{ start: 1320, end: 360 }]);
  assert.deepEqual(parseRanges('HC (23H30-7H30)'), [{ start: 1410, end: 450 }]);
  assert.deepEqual(parseRanges('0H50-6H50'), [{ start: 50, end: 410 }]);
  assert.deepEqual(parseRanges('Avril à octobre, 21h à 7h et de 11h à 17h'), [
    { start: 1260, end: 420 },
    { start: 660, end: 1020 },
  ]);
  assert.deepEqual(parseRanges('HC (2H00-7H00;14H00-17H00)'), [
    { start: 120, end: 420 },
    { start: 840, end: 1020 },
  ]);
  assert.deepEqual(parseRanges(''), []);
  assert.deepEqual(parseRanges(null), []);
  assert.deepEqual(parseSeasonMonths('Novembre à mars, de 23h à 7h'), [11, 3]);
  assert.deepEqual(parseSeasonMonths('Avril à octobre'), [4, 10]);
  assert.equal(parseSeasonMonths('de 22h à 6h'), null);
  assert.equal(
    formatRanges([
      { start: 1320, end: 360 },
      { start: 840, end: 1020 },
    ]),
    '22:00–06:00, 14:00–17:00',
  );
});

test('a range crossing midnight includes its start and excludes its end', () => {
  const night = { start: 1320, end: 360 };
  assert.equal(inRange(1320, night), true);
  assert.equal(inRange(0, night), true);
  assert.equal(inRange(359, night), true);
  assert.equal(inRange(360, night), false);
  assert.equal(inRange(1319, night), false);
  assert.equal(inRange(840, { start: 840, end: 1020 }), true);
  assert.equal(inRange(1020, { start: 840, end: 1020 }), false);
});

test('a peak/off-peak contract: the period, its price and when it ends, in Paris time', () => {
  assert.equal(offerKind(electricity), 'hphc');
  assert.deepEqual(offPeakHours(electricity, 10).source, 'contract');
  // 12:00 in Paris (summer time): peak, until 22:00.
  assert.deepEqual(currentPeriod(electricity, at('2026-10-14T10:00:00Z')), {
    period: 'peak',
    price: 0.2081,
    until: '22:00',
    ranges: [{ start: 1320, end: 360 }],
    kind: 'hphc',
  });
  // 22:00 in Paris is 20:00 UTC in October: off-peak until 06:00.
  const night = currentPeriod(electricity, at('2026-10-14T20:00:00Z'));
  assert.equal(night.period, 'off_peak');
  assert.equal(night.price, 0.1635);
  assert.equal(night.until, '06:00');
  assert.equal(currentPeriod(electricity, at('2026-10-14T19:59:00Z')).period, 'peak');
  // Winter time: 22:00 in Paris is 21:00 UTC.
  assert.equal(currentPeriod(electricity, at('2026-12-01T20:30:00Z')).period, 'peak');
  assert.equal(currentPeriod(electricity, at('2026-12-01T21:00:00Z')).period, 'off_peak');
  // The night of the change to winter time (25 October 2026, 03:00 → 02:00).
  assert.equal(currentPeriod(electricity, at('2026-10-25T00:30:00Z')).period, 'off_peak');
  assert.equal(currentPeriod(electricity, at('2026-10-25T05:00:00Z')).period, 'peak');
});

test('without contract slots, the calendar, then the Linky label give the off-peak hours', () => {
  const noSlots = structuredClone(electricity);
  for (const rate of noSlots.agreement.rates) {
    rate.slots = [];
  }
  noSlots.temporalClasses = [{ code: 'HC', label: 'Heures creuses', description: '0H50-6H50' }];
  assert.deepEqual(offPeakHours(noSlots, 10), {
    ranges: [{ start: 50, end: 410 }],
    source: 'calendar',
  });
  noSlots.temporalClasses = [{ code: 'HC', label: 'Heures creuses', description: '' }];
  noSlots.offPeakLabel = 'HC (23H30-7H30)';
  assert.deepEqual(offPeakHours(noSlots, 10), {
    ranges: [{ start: 1410, end: 450 }],
    source: 'linky',
  });
  noSlots.offPeakLabel = null;
  assert.equal(
    currentPeriod(noSlots, at('2026-10-14T10:00:00Z')),
    null,
    'unknown hours: no period',
  );
});

test('a base contract has one period and one price, all day', () => {
  const base = structuredClone(electricity);
  base.agreement.rates = [{ code: 'BASE', label: 'Base', price: 0.194, slots: [] }];
  base.temporalClasses = [];
  assert.equal(offerKind(base), 'base');
  assert.deepEqual(currentPeriod(base, at('2026-10-14T21:00:00Z')), {
    period: 'base',
    price: 0.194,
    until: null,
    ranges: [],
    kind: 'base',
  });
});

test('rates without a class: two prices are peak and off-peak, the cheaper being off-peak', () => {
  const plain = structuredClone(electricity);
  plain.agreement.rates = [
    { code: null, label: null, price: 0.2081, slots: [] },
    { code: null, label: null, price: 0.1635, slots: [{ start: 1320, end: 360 }] },
  ];
  plain.temporalClasses = [];
  assert.equal(offerKind(plain), 'hphc');
  assert.equal(currentPeriod(plain, at('2026-10-14T21:00:00Z')).price, 0.1635);
  assert.equal(currentPeriod(plain, at('2026-10-14T10:00:00Z')).price, 0.2081);
});

test('a two-season contract takes the hours and the price of the season', () => {
  const seasons = structuredClone(electricity);
  seasons.agreement.rates = [
    { code: 'HPB', price: 0.19, slots: [] },
    { code: 'HCB', price: 0.15, slots: [] },
    { code: 'HPH', price: 0.24, slots: [] },
    { code: 'HCH', price: 0.18, slots: [] },
  ];
  seasons.temporalClasses = [
    { code: 'HPB', description: 'Avril à octobre, de 6h à 22h' },
    { code: 'HCB', description: 'Avril à octobre, de 22h à 6h' },
    { code: 'HPH', description: 'Novembre à mars, de 7h à 23h' },
    { code: 'HCH', description: 'Novembre à mars, de 23h à 7h' },
  ];
  assert.equal(offerKind(seasons), 'two_season');
  assert.equal(seasonOf(seasons, 10), 'summer');
  assert.equal(seasonOf(seasons, 1), 'winter');
  // October, 22:30 in Paris: summer off-peak.
  const summer = currentPeriod(seasons, at('2026-10-14T20:30:00Z'));
  assert.deepEqual([summer.period, summer.price, summer.until], ['off_peak', 0.15, '06:00']);
  // December, 22:30 in Paris: still winter peak until 23:00.
  const winter = currentPeriod(seasons, at('2026-12-01T21:30:00Z'));
  assert.deepEqual([winter.period, winter.price, winter.until], ['peak', 0.24, '23:00']);
});

test('a Tempo-like contract tells the period but not the price (the day colour is unknown)', () => {
  const tempo = structuredClone(electricity);
  tempo.agreement.rates = ['HPE', 'HCE', 'HPHI', 'HCHI', 'HPP', 'HCP'].map((code, index) => ({
    code,
    price: 0.1 + index / 100,
    slots: code.startsWith('HC') ? [{ start: 1320, end: 360 }] : [],
  }));
  assert.equal(offerKind(tempo), 'tempo');
  const night = currentPeriod(tempo, at('2026-10-14T21:00:00Z'));
  assert.equal(night.period, 'off_peak');
  assert.equal(night.price, null);
});

test('gas and a supply point without agreement have no tariff period', () => {
  assert.equal(offerKind(gas), 'base', 'one price: the gas offer');
  const unknown = { ...electricity, agreement: null, temporalClasses: [] };
  assert.equal(offerKind(unknown), null);
  assert.equal(currentPeriod(unknown, at('2026-10-14T10:00:00Z')), null);
});
