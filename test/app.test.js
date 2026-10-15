// -----------------------------------------------------------------------------
// End to end, against the SDK's fake Gladys and the fake Kraken API: the
// cycle, the energy tracking, the clock and its triggers, the widget, the
// scene action, the refresh action, the quiet logs and the secrets.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { fixture } from './helpers/kraken-server.js';
import { CONFIG, createWorld, NOON } from './helpers/world.js';
import { createMemoryStore } from '../src/store.js';

const HOUR = 3600 * 1000;
const ELEC = 'ext:test-integration:electricity:09876543210123';
const GAS = 'ext:test-integration:gas:21987654321098';

const operations = (world) => world.server.requests.map((request) => request.operation);
const eventsOf = (world, key) => world.gladys.fake.sceneEvents.filter((event) => event.key === key);

test('a first cycle signs in, finds the supply points and says so', async () => {
  const world = createWorld();
  try {
    await world.connect();
    assert.deepEqual(
      world.gladys.fake.discoveredDevices.map((device) => [device.name, device.external_id]),
      [
        ['Octopus Électricité …0123', ELEC],
        ['Octopus Gaz …1098', GAS],
      ],
    );
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    assert.deepEqual(operations(world), [
      'obtainKrakenToken',
      'accounts',
      'account',
      'measurements',
      'measurements',
    ]);
    // Nothing is published for a device the user has not added.
    assert.equal(world.gladys.fake.states.length, 0);
    assert.equal(world.gladys.fake.publishedEnergyConsumption.length, 0);
    // The refresh token is kept in /data, the password never.
    const saved = JSON.stringify(world.store.saved);
    assert.match(saved, /fake-refresh-token-0001/);
    assert.doesNotMatch(saved, /bon mot de passe|client@example\.com/);
  } finally {
    await world.stop();
  }
});

test('adding a meter sends its daily consumption, its readings and its tariff period', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    const fake = world.gladys.fake;
    // History of 7 days, data up to the 12th (Enedis delay), the Gladys zone is UTC here.
    assert.deepEqual(fake.energyConsumption[`${ELEC}:consumption`], [
      { created_at: '2026-10-07T00:00:00.000Z', kwh: 10 },
      { created_at: '2026-10-08T00:00:00.000Z', kwh: 11 },
      { created_at: '2026-10-09T00:00:00.000Z', kwh: 12 },
      { created_at: '2026-10-10T00:00:00.000Z', kwh: 8 },
      { created_at: '2026-10-11T00:00:00.000Z', kwh: 9 },
      { created_at: '2026-10-12T00:00:00.000Z', kwh: 10 },
    ]);
    assert.equal(fake.energyConsumption[`${GAS}:consumption`], undefined, 'no gas in the tracking');
    const last = (key) => fake.lastState(`${ELEC}:${key}`);
    assert.equal(last('last_day_consumption'), 10);
    assert.equal(last('last_day_cost'), 1.9);
    assert.equal(last('month_consumption'), 119);
    assert.equal(last('month_cost'), 22.64);
    assert.equal(last('balance'), 42.1);
    assert.equal(last('next_payment'), 85);
    assert.equal(last('next_payment_date'), '5 nov. 2026');
    assert.equal(last('offer'), 'Électricité Fixe HP/HC');
    assert.equal(last('off_peak'), 0);
    assert.equal(last('tariff_period'), 'Heures pleines');
    assert.equal(last('current_price'), 0.2081);
    assert.equal(last('off_peak_hours'), '22:00–06:00');
    // Gas: the cost of its kWh at the single price of the contract.
    assert.equal(fake.lastState(`${GAS}:last_day_consumption`), 20);
    assert.equal(fake.lastState(`${GAS}:last_day_cost`), 2.24);
    assert.equal(fake.lastState(`${GAS}:balance`), -15.5);
    assert.ok(fake.widgetRefreshes.includes('energy_summary'));
    // The cursor moved: the next cycle starts 3 days before the last day fed.
    assert.equal(world.store.saved.meters['09876543210123'].fedUntil, '2026-10-12');
  } finally {
    await world.stop();
  }
});

test('the next cycles read from the last day fed, with 3 days of overlap', async () => {
  const world = createWorld({ devices: [] });
  try {
    await world.connect();
    await world.addAll();
    world.clock.ms += 24 * HOUR;
    world.server.requests.length = 0;
    await world.app.sync();
    const electricity = world.server.requests.find(
      (request) =>
        request.operation === 'measurements' &&
        request.variables.utilityFilters[0].electricityFilters,
    );
    // The month of the last reading and 14 days: 40 days back, from the 1st of that month.
    assert.equal(electricity.variables.startAt, '2026-09-01T00:00:00+02:00');
    const fed = world.gladys.fake.publishedEnergyConsumption.at(-1).intervals;
    assert.deepEqual(
      fed.map((interval) => interval.date),
      ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'],
    );
    const signIns = world.server.requests.filter(
      (request) => request.operation === 'obtainKrakenToken',
    );
    assert.deepEqual(
      signIns.map((request) => Object.keys(request.variables.input)),
      [['refreshToken']],
      'a day later, the refresh token renews the access token: no password',
    );
  } finally {
    await world.stop();
  }
});

test('a new day of readings fires its trigger once, never on the first reading', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    await world.app.sync();
    assert.equal(eventsOf(world, 'daily_reading_available').length, 0, 'the baseline only');
    world.clock.ms += 24 * HOUR;
    await world.app.sync();
    await world.app.sync();
    const events = eventsOf(world, 'daily_reading_available');
    assert.deepEqual(
      events.map((event) => event.data),
      [
        {
          meter: ELEC,
          energy: 'electricity',
          date: '2026-10-13',
          consumption: 11,
          cost: 2.09,
          month_consumption: 130,
          month_cost: 24.73,
        },
        {
          meter: GAS,
          energy: 'gas',
          date: '2026-10-13',
          consumption: 21,
          cost: 2.35,
          month_consumption: 273,
          month_cost: 30.58,
        },
      ],
    );
  } finally {
    await world.stop();
  }
});

test('the off-peak hours start and end on the minute, with their triggers', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    const fake = world.gladys.fake;
    // 21:59 in Paris: still peak, nothing fires.
    world.clock.ms = Date.parse('2026-10-14T19:59:30Z');
    await world.app.tick();
    assert.equal(eventsOf(world, 'off_peak_started').length, 0);
    // 22:00 in Paris.
    world.clock.ms = Date.parse('2026-10-14T20:00:01Z');
    await world.app.tick();
    assert.deepEqual(
      eventsOf(world, 'off_peak_started').map((event) => event.data),
      [{ meter: ELEC, until: '06:00', price: 0.1635 }],
    );
    assert.equal(fake.lastState(`${ELEC}:off_peak`), 1);
    assert.equal(fake.lastState(`${ELEC}:tariff_period`), 'Heures creuses');
    assert.equal(fake.lastState(`${ELEC}:current_price`), 0.1635);
    // The next ticks of the night fire nothing more.
    world.clock.ms += 60 * 1000;
    await world.app.tick();
    assert.equal(eventsOf(world, 'off_peak_started').length, 1);
    // 06:00 in Paris.
    world.clock.ms = Date.parse('2026-10-15T04:00:01Z');
    await world.app.tick();
    assert.deepEqual(
      eventsOf(world, 'off_peak_ended').map((event) => event.data),
      [{ meter: ELEC, until: '22:00', price: 0.2081 }],
    );
    assert.equal(fake.lastState(`${ELEC}:off_peak`), 0);
    // The widget follows the period.
    assert.ok(fake.widgetRefreshes.filter((key) => key === 'energy_summary').length >= 3);
  } finally {
    await world.stop();
  }
});

test('a restart during the off-peak hours fires no trigger', async () => {
  const world = createWorld({ now: Date.parse('2026-10-14T21:00:00Z') });
  try {
    await world.connect();
    await world.addAll();
    world.clock.ms += 60 * 1000;
    await world.app.tick();
    assert.equal(eventsOf(world, 'off_peak_started').length, 0);
    assert.equal(world.gladys.fake.lastState(`${ELEC}:off_peak`), 1);
  } finally {
    await world.stop();
  }
});

test('the states refresh without the core polling: the container has its own timers', async () => {
  const world = createWorld({
    timers: true,
    app: { refreshPeriodMs: 60, tickMs: 40 },
  });
  try {
    await world.connect();
    await world.addAll();
    const fake = world.gladys.fake;
    assert.equal(fake.lastState(`${ELEC}:balance`), 42.1);
    // Octopus records a payment.
    world.server.account.data.account.ledgers[0].balance = 12710;
    // The clock moves past 22:00 in Paris: the next tick sees off-peak hours.
    world.clock.ms = Date.parse('2026-10-14T20:00:05Z');
    const deadline = Date.now() + 2000;
    while (
      (fake.lastState(`${ELEC}:balance`) !== 127.1 || fake.lastState(`${ELEC}:off_peak`) !== 1) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fake.lastState(`${ELEC}:balance`), 127.1);
    assert.equal(fake.lastState(`${ELEC}:off_peak`), 1);
    assert.equal(
      fake.wsMessages.filter((message) => /poll/i.test(message.type ?? '')).length,
      0,
      'the core never polled',
    );
  } finally {
    await world.stop();
  }
});

test('the core poll is a fallback: acked at once, no new read while the timer is on time', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    const before = world.server.requests.length;
    assert.deepEqual(await world.gladys.fake.poll(world.device('electricity')), { success: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(world.server.requests.length, before, 'no read: the last one is recent');
    world.clock.ms += 3 * HOUR;
    await world.gladys.fake.poll(world.device('electricity'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(world.server.requests.length > before, 'a missed cycle is caught up');
  } finally {
    await world.stop();
  }
});

test('the states are re-sent at least every 12 hours (heartbeat)', async (t) => {
  const world = createWorld();
  try {
    await world.connect();
    const heartbeats = [];
    const original = world.gladys.publishChangedStates.bind(world.gladys);
    t.mock.method(world.gladys, 'publishChangedStates', (states, options) => {
      heartbeats.push(options?.heartbeat);
      return original(states, options);
    });
    await world.addAll();
    assert.ok(heartbeats.length > 0);
    for (const heartbeat of heartbeats) {
      assert.ok(heartbeat > 0 && heartbeat <= 12 * HOUR, `heartbeat ${heartbeat}`);
    }
  } finally {
    await world.stop();
  }
});

test('a normal cycle writes nothing at info level; failures once, and their end once', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    const infoBefore = world.logger.at('info').length;
    for (let i = 0; i < 3; i += 1) {
      world.clock.ms += 3 * HOUR;
      await world.app.sync();
      await world.app.tick();
    }
    assert.equal(world.logger.at('info').length, infoBefore, world.logger.at('info').join('\n'));
    assert.equal(world.logger.at('warn').length, 0);

    world.server.down = true;
    for (let i = 0; i < 3; i += 1) {
      world.clock.ms += HOUR;
      const outcome = await world.app.sync();
      assert.equal(outcome.retry, true);
    }
    assert.equal(world.logger.at('warn').length, 1, world.logger.at('warn').join('\n'));
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    world.server.down = false;
    world.clock.ms += HOUR;
    await world.app.sync();
    assert.deepEqual(world.logger.at('info').slice(infoBefore), ['Octopus Energy answers again']);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.stop();
  }
});

test('a refused password stops the tries until the configuration changes', async () => {
  const world = createWorld({ config: { ...CONFIG, password: 'faux' } });
  try {
    await world.connect();
    const status = world.gladys.fake.connectionStatus;
    assert.equal(status.connected, false);
    assert.match(status.message.fr, /refuse l’adresse e-mail ou le mot de passe/);
    const signIns = () => operations(world).filter((op) => op === 'obtainKrakenToken').length;
    assert.equal(signIns(), 1);
    world.clock.ms += 3 * HOUR;
    assert.deepEqual(await world.app.sync(), { status: 'password' });
    assert.equal(signIns(), 1, 'no new try: it could lock the account');
    const widget = await world.gladys.fake.widgetGet('energy_summary', {
      settings: {},
      language: 'fr',
    });
    assert.match(widget.data.content.components[0].text, /refuse la connexion/);
    await world.gladys.fake.configUpdated({ ...CONFIG });
    assert.equal(signIns(), 2);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.stop();
  }
});

test('no secret of the configuration reaches the logs, even inside an Octopus error', async () => {
  const world = createWorld();
  try {
    world.server.force.obtainKrakenToken = {
      errors: [
        {
          message: `No account for client@example.com with password bon mot de passe.`,
          path: ['obtainKrakenToken'],
          extensions: { errorCode: 'KT-CT-1135' },
        },
      ],
      data: { obtainKrakenToken: null },
    };
    await world.connect();
    world.server.down = true;
    await world.app.sync({ force: true });
    const text = world.logger.lines.map((line) => line.text).join('\n');
    assert.match(text, /refused the sign-in/);
    assert.doesNotMatch(text, /bon mot de passe/);
    assert.doesNotMatch(text, /client@example\.com/);
    assert.doesNotMatch(text, /fake-refresh-token|eyJ/);
  } finally {
    await world.stop();
  }
});

test('the rate limit waits an hour and says so', async () => {
  const world = createWorld();
  try {
    world.server.force.obtainKrakenToken = fixture('rate-limited.json');
    await world.connect();
    assert.match(world.gladys.fake.connectionStatus.message.en, /slow down/);
    assert.equal(world.app.poller.lastRunAt, world.clock.ms);
  } finally {
    await world.stop();
  }
});

test('a restart signs in with the saved refresh token, not the password', async () => {
  const store = createMemoryStore();
  const first = createWorld({ store });
  await first.connect();
  await first.stop();
  const second = createWorld({ store });
  try {
    for (const token of first.server.refreshTokens) {
      second.server.refreshTokens.add(token);
    }
    await second.connect();
    const signIn = second.server.requests.find(
      (request) => request.operation === 'obtainKrakenToken',
    );
    assert.deepEqual(Object.keys(signIn.variables.input), ['refreshToken']);
  } finally {
    await second.stop();
  }
});

test('another account in the configuration forgets the previous one', async () => {
  const world = createWorld();
  try {
    await world.connect();
    assert.ok(Object.keys(world.store.saved.tokens).length === 1);
    await world.gladys.fake.configUpdated({ ...CONFIG, email: 'autre@example.com' });
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.equal(world.app.points.size, 0);
    assert.deepEqual(world.store.saved.tokens, {});
  } finally {
    await world.stop();
  }
});

test('the refresh action reads now, then refuses a second read within 15 minutes', async () => {
  const world = createWorld();
  try {
    await world.connect();
    world.clock.ms += HOUR;
    const first = await world.gladys.fake.action('refresh_now', {});
    assert.match(first.data.message.fr, /2 point\(s\) de livraison trouvé\(s\)/);
    await world.addAll();
    world.clock.ms += 5 * 60 * 1000;
    const second = await world.gladys.fake.action('refresh_now', {});
    assert.match(second.data.message.fr, /réessayez dans 10 min/);
    world.clock.ms += 15 * 60 * 1000;
    const third = await world.gladys.fake.action('refresh_now', {});
    assert.match(third.data.message.en, /Refreshed: 2 supply point/);
  } finally {
    await world.stop();
  }
});

test('the scene action gives the figures of a meter, the unknown ones left out', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    const ack = await world.gladys.fake.sceneAction('get_meter_summary', { meter: ELEC });
    assert.deepEqual(ack.data.outputs, {
      date: '2026-10-12',
      consumption: 10,
      cost: 1.9,
      month_consumption: 119,
      month_cost: 22.64,
      balance: 42.1,
      next_payment: 85,
      next_payment_date: '5 nov. 2026',
      period: 'peak',
      price: 0.2081,
    });
    const gas = await world.gladys.fake.sceneAction('get_meter_summary', { meter: GAS });
    assert.equal(gas.data.outputs.period, undefined);
    const unknown = await world.gladys.fake.sceneAction('get_meter_summary', { meter: 'nope' });
    assert.equal(unknown.success, false);
  } finally {
    await world.stop();
  }
});

test('the widget fits the core budget, in every language, for both energies', async () => {
  const world = createWorld();
  try {
    await world.connect();
    for (const language of ['en', 'fr', 'de', 'es']) {
      for (const meter of [undefined, ELEC, GAS]) {
        const ack = await world.gladys.fake.widgetGet('energy_summary', {
          settings: meter ? { meter } : {},
          language,
        });
        const content = ack.data.content;
        assert.deepEqual(validateWidgetContent(content), [], `${language} ${meter}`);
        assert.ok(content.components.length >= 5);
      }
    }
    const fr = (
      await world.gladys.fake.widgetGet('energy_summary', { settings: {}, language: 'fr' })
    ).data.content;
    const status = fr.components.find((component) => component.type === 'status');
    assert.deepEqual(status.items[0], {
      label: 'Période tarifaire',
      value: 'Heures pleines jusqu’à 22:00',
      icon: 'sun',
      color: 'neutral',
    });
    assert.ok(
      fr.components.some(
        (component) => component.type === 'value' && component.label === 'Octobre',
      ),
    );
    // At 21:58, the content expires with the period.
    world.clock.ms = Date.parse('2026-10-14T19:58:00Z');
    const late = await world.gladys.fake.widgetGet('energy_summary', {
      settings: {},
      language: 'fr',
    });
    assert.ok(late.data.content.ttl_seconds <= 130);
  } finally {
    await world.stop();
  }
});

test('the widget asks for the configuration when nothing is set', async () => {
  const world = createWorld({ config: {} });
  try {
    await world.connect();
    const ack = await world.gladys.fake.widgetGet('energy_summary', {
      settings: {},
      language: 'de',
    });
    assert.match(ack.data.content.components[0].text, /Richte die Integration/);
    assert.equal(world.server.requests.length, 0);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /Saisissez l’adresse e-mail/);
  } finally {
    await world.stop();
  }
});

test('a gas meter with monthly readings only shows its month', async () => {
  const world = createWorld({ kraken: { gasDaily: false } });
  try {
    await world.connect();
    await world.addAll();
    const fake = world.gladys.fake;
    assert.equal(fake.lastState(`${GAS}:month_consumption`), 640.5);
    assert.equal(fake.lastState(`${GAS}:month_cost`), 71.74);
    assert.equal(fake.lastState(`${GAS}:last_day_consumption`), undefined);
  } finally {
    await world.stop();
  }
});

test('a longer history asked imports it again', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    await world.gladys.fake.configUpdated({ ...CONFIG, history_days: '30' });
    const fed = world.gladys.fake.publishedEnergyConsumption.at(-1).intervals;
    assert.equal(fed[0].date, '2026-09-14');
    assert.equal(fed.length, 29);
  } finally {
    await world.stop();
  }
});

test('NOON is a peak hour in Paris', () => {
  assert.equal(new Date(NOON).toISOString(), '2026-10-14T10:00:00.000Z');
});
