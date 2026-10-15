// -----------------------------------------------------------------------------
// A whole world for the end-to-end tests: the SDK's fake Gladys, the app wired
// to it, a fake Kraken API, an in-memory store, a clock the test moves, and
// the log lines the app wrote.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp, registerHandlers } from '../../src/app.js';
import { createMemoryStore } from '../../src/store.js';
import { createKrakenServer } from './kraken-server.js';

// Noon in Paris, 14 October 2026 (a peak hour): before the real "now" of the
// test run, so the fake Gladys takes the days as elapsed.
export const NOON = Date.parse('2026-10-14T10:00:00Z');

export const CONFIG = {
  email: 'client@example.com',
  password: 'bon mot de passe',
  language: 'fr',
  history_days: '7',
};

/** A logger recording every line, by level. */
export function recordingLogger() {
  const lines = [];
  const record =
    (level) =>
    (...args) =>
      lines.push({
        level,
        text: args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '),
      });
  return {
    lines,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    at: (level) => lines.filter((line) => line.level === level).map((line) => line.text),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.config]
 * @param {number} [options.now] the clock (ms), moved through `world.clock`
 * @param {number} [options.lagHours] how late the meter data is (hours)
 * @param {object} [options.kraken] options of the fake Kraken API
 * @param {object} [options.store] the persisted state to start from
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.timers] arm the timers
 * @param {object} [options.app] more options of createApp
 */
export function createWorld({
  config = CONFIG,
  now = NOON,
  lagHours = 34,
  kraken = {},
  store = createMemoryStore(),
  devices = [],
  timers = false,
  app: appOptions = {},
} = {}) {
  const clock = { ms: now };
  const server = createKrakenServer({
    now: () => clock.ms,
    dataUntil: () => clock.ms - lagHours * 3600 * 1000,
    ...kraken,
  });
  const gladys = createFakeGladys({ config, devices });
  const logger = recordingLogger();
  const app = createApp({
    gladys,
    store,
    fetch: server.fetch,
    now: () => clock.ms,
    timers,
    logger,
    gladysTimeZone: 'UTC',
    ...appOptions,
  });
  registerHandlers(gladys, app);
  return {
    clock,
    server,
    gladys,
    app,
    store,
    logger,
    async connect() {
      await gladys.connect();
    },
    /** Add every discovered supply point to Gladys, as the user would. */
    async addAll() {
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(device);
      }
    },
    device(kind) {
      return gladys.fake.discoveredDevices.find((device) =>
        device.external_id.includes(`:${kind}:`),
      );
    },
    async stop() {
      app.stop();
      await gladys.disconnect();
    },
  };
}
