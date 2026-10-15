// From the Kraken account and measurements to the supply points, their days
// and their summaries: pure functions, against the shapes of the fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/kraken-server.js';
import {
  euros,
  parseAccount,
  parseClock,
  parseMeasurement,
  toNumber,
} from '../src/octopus/parse.js';
import { computeSummary, lastMonthly, toDailyConsumption, toDays } from '../src/summary.js';

const day = (date, value, statistics = []) => ({
  value,
  startAt: `${date}T00:00:00+02:00`,
  endAt: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, '0')}T00:00:00+02:00`,
  metaData: { statistics },
});

test('the account gives one supply point per active meter, money in euros', () => {
  const points = parseAccount(fixture('account-hphc.json').data.account);
  assert.deepEqual(
    points.map((point) => [point.kind, point.id]),
    [
      ['electricity', '09876543210123'],
      ['gas', '21987654321098'],
    ],
    'the cancelled, unpowered meter is left out',
  );
  const [electricity, gas] = points;
  assert.equal(electricity.balance, 42.1);
  assert.equal(gas.balance, -15.5);
  assert.equal(electricity.propertyId, '100001');
  assert.equal(electricity.offPeakLabel, 'HC (22H00-6H00)');
  assert.equal(electricity.subscribedPower, 9);
  assert.deepEqual(electricity.agreement.nextPayment, { amount: 85, date: '2026-11-05' });
  assert.equal(electricity.agreement.product, 'Électricité Fixe HP/HC');
  assert.deepEqual(
    electricity.agreement.rates.map((rate) => [rate.code, rate.price, rate.slots]),
    [
      ['HP', 0.2081, []],
      ['HC', 0.1635, [{ start: 1320, end: 360 }]],
    ],
  );
  assert.deepEqual(
    gas.agreement.rates.map((rate) => [rate.code, rate.price]),
    [[null, 0.112]],
  );
});

test('partial answers with explicit nulls are tolerated', () => {
  assert.deepEqual(parseAccount(null), []);
  assert.deepEqual(
    parseAccount({
      number: 'A-1',
      ledgers: null,
      agreements: null,
      properties: [
        { id: '1', supplyPoints: null },
        { id: '2', supplyPoints: { edges: [{ node: null }, { node: { meterPoint: null } }] } },
        {
          id: '3',
          supplyPoints: {
            edges: [
              {
                node: {
                  externalIdentifier: '12345678901234',
                  meterPoint: { meterKind: 'LINKY', providerCalendar: null },
                },
              },
            ],
          },
        },
      ],
    }),
    [
      {
        kind: 'electricity',
        id: '12345678901234',
        accountNumber: 'A-1',
        propertyId: '3',
        offPeakLabel: null,
        temporalClasses: [],
        subscribedPower: null,
        agreement: null,
        balance: null,
      },
    ],
  );
});

test('two meters of the same energy: each ledger is found by the number in its name', () => {
  const answer = fixture('account-hphc.json').data.account;
  answer.ledgers.push({
    balance: 990,
    ledgerType: 'FRA_ELECTRICITY_LEDGER',
    name: 'Électricité (11111111111111)',
  });
  const copy = structuredClone(answer.properties[0].supplyPoints.edges[0]);
  copy.node.externalIdentifier = '11111111111111';
  answer.properties[0].supplyPoints.edges.push(copy);
  const balances = parseAccount(answer).map((point) => [point.id, point.balance]);
  assert.deepEqual(balances, [
    ['09876543210123', 42.1],
    ['21987654321098', -15.5],
    ['11111111111111', 9.9],
  ]);
});

test('Kraken numbers arrive as strings, sometimes in exponent form', () => {
  assert.equal(toNumber('0E-18'), 0);
  assert.equal(toNumber('12.5'), 12.5);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(euros('8500'), 85);
  assert.equal(euros(null), null);
  assert.equal(parseClock('22:00:00'), 1320);
  assert.equal(parseClock('6:30'), 390);
  assert.equal(parseClock('24:00:00'), 1440);
  assert.equal(parseClock('bad'), null);
});

test('a measurement: its kWh, and the cost of its energy without the standing charge', () => {
  const read = parseMeasurement(
    day('2026-10-12', '10', [
      { label: 'HEURES_PLEINES', value: '6', costInclTax: { estimatedAmount: '124.86' } },
      { label: 'HEURES_CREUSES', value: '4', costInclTax: { estimatedAmount: 65.4 } },
      { label: 'ABONNEMENT', value: null, costInclTax: { estimatedAmount: '53.49' } },
    ]),
  );
  assert.equal(read.kwh, 10);
  assert.equal(read.cost, 1.9026);
  // No total value: the energy statistics are summed.
  const summed = parseMeasurement(
    day('2026-10-12', null, [
      { label: 'HEURES_PLEINES', value: '6' },
      { label: 'HEURES_CREUSES', value: '4' },
    ]),
  );
  assert.deepEqual([summed.kwh, summed.cost], [10, null]);
  assert.equal(parseMeasurement({ startAt: 'nope' }), null);
});

test('days are French days, complete ones only, oldest first', () => {
  const now = Date.parse('2026-10-14T10:00:00Z');
  const nodes = [
    day('2026-10-12', '10'),
    // The start in UTC, a few hours before the French midnight's date change.
    { value: '9', startAt: '2026-10-10T22:00:00Z', endAt: '2026-10-11T22:00:00Z' },
    // Today, not finished.
    day('2026-10-14', '3'),
  ];
  assert.deepEqual(toDays(nodes, now), [
    { date: '2026-10-11', kwh: 9, cost: null },
    { date: '2026-10-12', kwh: 10, cost: null },
  ]);
});

test('the energy tracking gets the elapsed days of the Gladys zone, from a date on', () => {
  const days = [
    { date: '2026-10-10', kwh: 8, cost: null },
    { date: '2026-10-11', kwh: 9, cost: null },
    { date: '2026-10-12', kwh: -1, cost: null },
  ];
  assert.deepEqual(
    toDailyConsumption(days, {
      from: '2026-10-11',
      now: Date.parse('2026-10-12T10:00:00Z'),
      gladysTimeZone: 'Europe/Paris',
    }),
    [{ date: '2026-10-11', kwh: 9 }],
  );
  assert.deepEqual(
    toDailyConsumption(days, {
      from: '2026-10-01',
      now: Date.parse('2026-10-14T10:00:00Z'),
      gladysTimeZone: 'UTC',
    }),
    [
      { date: '2026-10-10', kwh: 8 },
      { date: '2026-10-11', kwh: 9 },
      { date: '2026-10-12', kwh: 0 },
    ],
    'never negative',
  );
});

test('the month is the month of the last reading; its cost only when every day has one', () => {
  const days = [
    { date: '2026-09-30', kwh: 7, cost: 1.4 },
    { date: '2026-10-01', kwh: 8, cost: 1.6 },
    { date: '2026-10-02', kwh: 9, cost: 1.8 },
  ];
  const summary = computeSummary(days);
  assert.deepEqual(summary.lastDay, { date: '2026-10-02', kwh: 9, cost: 1.8 });
  assert.deepEqual(summary.month, { month: '2026-10', kwh: 17, cost: 3.4, until: '2026-10-02' });
  assert.equal(summary.recent.length, 3);
  const partial = computeSummary([...days.slice(0, 2), { date: '2026-10-02', kwh: 9, cost: null }]);
  assert.equal(partial.month.cost, null);
  assert.deepEqual(computeSummary([]), { lastDay: null, month: null, recent: [] });
  // Monthly gas only.
  const gas = computeSummary([], { month: '2026-09', kwh: 640.5, cost: 71.74 });
  assert.deepEqual(gas.month, { month: '2026-09', kwh: 640.5, cost: 71.74, until: null });
  assert.equal(gas.lastDay, null);
});

test('the last monthly reading names its French month', () => {
  assert.deepEqual(
    lastMonthly([
      { value: '600', startAt: '2026-08-31T22:00:00Z', endAt: '2026-09-30T22:00:00Z' },
      { value: '640.5', startAt: '2026-09-30T22:00:00Z', endAt: '2026-10-31T23:00:00Z' },
    ]),
    { month: '2026-10', kwh: 640.5, cost: null },
  );
  assert.equal(lastMonthly([]), null);
});
