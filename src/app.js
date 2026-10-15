// -----------------------------------------------------------------------------
// The integration: a cloud cycle reads Octopus Energy France, a clock follows
// the off-peak hours, and both feed Gladys.
//
// A cloud cycle (every 3 hours, src/poller.js):
//   1. signs in (the saved refresh token, else the e-mail and password);
//   2. reads the accounts: supply points (Linky PRM, Gazpar PCE), active
//      agreement and its rates, balances, next payment;
//   3. reads the daily measurements of each supply point, from the last day
//      Gladys has (3 days of overlap: Enedis corrects its recent readings) or,
//      the first time, from the history the user chose;
//   4. publishes the devices, the dated daily consumption of the energy
//      tracking, the readings, and the "new day of readings" scene event.
// The clock (every minute, no network) computes the tariff period of each
// electricity meter from its contract, publishes it with its price, and fires
// the "off-peak hours start / end" scene triggers on the minute.
//
// What Octopus answered is kept in memory: a device added later, the widget
// and the scene action are served from it without a new request.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, secretsOf } from './config.js';
import { InvalidAuthError, RateLimitError } from './errors.js';
import { MESSAGES, formatDate } from './i18n.js';
import { createIssueLog } from './issues.js';
import { buildDevice, FEATURE, meterIds, readingStates, tariffStates } from './meters.js';
import { createKrakenClient } from './octopus/client.js';
import { parseAccount } from './octopus/parse.js';
import { createClock, createPoller } from './poller.js';
import { emptyState, identityOf } from './store.js';
import { computeSummary, lastMonthly, toDailyConsumption, toDays } from './summary.js';
import { currentPeriod, PERIOD } from './tariff.js';
import {
  addDays,
  FRANCE,
  isoWithOffset,
  localDate,
  minuteOfDay,
  monthStart,
  startOfLocalDay,
} from './time.js';
import { buildWidgetContent } from './widgets.js';

export const ACTION = {
  REFRESH: 'refresh_now',
};

export const TRIGGER = {
  OFF_PEAK_STARTED: 'off_peak_started',
  OFF_PEAK_ENDED: 'off_peak_ended',
  NEW_READING: 'daily_reading_available',
};

export const SCENE_ACTION = {
  SUMMARY: 'get_meter_summary',
};

export const WIDGET = {
  SUMMARY: 'energy_summary',
};

// Enedis corrects its last readings: every cycle sends the last 3 days again;
// the core writes only what changed.
const OVERLAP_DAYS = 3;
// What a cycle reads besides the history: the month of the last reading and
// 14 days for the chart, whatever the day of the month.
const RECENT_DAYS = 40;
// A manual refresh within this delay of a successful one is refused.
const MANUAL_REFRESH_MIN_MS = 15 * 60 * 1000;
// An action answers within its timeout; a longer refresh goes on alone.
const ACTION_WAIT_MS = 100 * 1000;
// Re-send unchanged values at least this often ("no recent value" otherwise).
const HEARTBEAT_MS = 6 * 3600 * 1000;
const MAX_INTERVALS_PER_CALL = 2000;

/** A logger that blanks the configured secrets, whatever a message carries. */
function redacting(base, secrets) {
  const clean = (args) =>
    args.map((arg) => {
      let text = arg instanceof Error ? arg.message : arg;
      if (typeof text !== 'string') {
        return arg;
      }
      for (const secret of secrets()) {
        text = text.split(secret).join('***');
      }
      return text;
    });
  return {
    debug: (...args) => base.debug(...clean(args)),
    info: (...args) => base.info(...clean(args)),
    warn: (...args) => base.warn(...clean(args)),
    error: (...args) => base.error(...clean(args)),
  };
}

/** A reason short enough for a status line. */
function reasonOf(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

const earliest = (...dates) => [...dates].sort()[0];

/**
 * Gas readings come without an amount: a day's cost is its kWh at the
 * contract's single price (incl. taxes, standing charge left out). An offer
 * with several prices is never estimated: the split is unknown.
 */
function withEstimatedCost(days, point) {
  const rates = point.agreement?.rates ?? [];
  const price = rates.length === 1 ? rates[0].price : null;
  if (typeof price !== 'number') {
    return days;
  }
  return days.map((day) =>
    day.cost === null ? { ...day, cost: Math.round(day.kwh * price * 10000) / 10000 } : day,
  );
}

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {object} options.store persistence (src/store.js)
 * @param {typeof fetch} [options.fetch] for the Octopus requests
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] arm the refresh timer and the clock
 * @param {number} [options.refreshPeriodMs] the cloud cycle period (tests)
 * @param {number} [options.tickMs] the clock period (tests)
 * @param {object} [options.logger]
 * @param {string} [options.gladysTimeZone] the zone Gladys stamps daily states in
 */
export function createApp({
  gladys,
  store,
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timers = true,
  refreshPeriodMs,
  tickMs,
  logger: baseLogger = createLogger({ name: 'octopus-fr' }),
  gladysTimeZone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
}) {
  let config = normalizeConfig(DEFAULT_CONFIG);
  const logger = redacting(baseLogger, () => secretsOf(config));
  const issues = createIssueLog(logger);
  let persisted = emptyState();

  /** Supply points read by the last cycle, by number, each with its summary and feed. */
  let points = new Map();
  /** The tariff period of each electricity meter at the last tick. */
  const periods = new Map();
  /** True while Octopus refuses the password: no new try until the user acts. */
  let refused = false;
  let lastSuccessAt = null;
  let running = null;
  let client = null;
  let clientIdentity = null;

  const identity = () => identityOf(config.email);
  const credentials = () => ({ email: config.email, password: config.password });

  async function setStatus(connected, message) {
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`Connection status not sent: ${reasonOf(err)}`);
    }
  }

  async function save() {
    try {
      await store.save(persisted);
    } catch (err) {
      issues.fail('store', `Cannot write the state file: ${reasonOf(err)}`);
      return;
    }
    issues.ok('store', 'The state file is writable again');
  }

  /** One client per account: it keeps the access token between cycles. */
  function getClient() {
    const id = identity();
    if (!client || clientIdentity !== id) {
      clientIdentity = id;
      client = createKrakenClient({
        fetch: fetchImpl,
        now,
        saved: persisted.tokens[id] ?? null,
        onTokens: async (saved) => {
          if (saved) {
            persisted.tokens = { [id]: saved };
          } else {
            delete persisted.tokens[id];
          }
          await save();
        },
      });
    }
    return client;
  }

  function createdDevices() {
    return new Set((gladys.devices ?? []).map((device) => device.external_id));
  }

  function pointByDevice(externalId) {
    for (const point of points.values()) {
      if (meterIds(gladys, point).device === externalId) {
        return point;
      }
    }
    return null;
  }

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(
      [...points.values()].map((point) => buildDevice(gladys, point, config.language)),
    );
  }

  /** Read the measurements of one supply point; resolves its summary and feed. */
  async function readPoint(point) {
    const at = now();
    const today = localDate(at, FRANCE);
    const state = persisted.meters[point.id] ?? {};
    const recentFrom = monthStart(addDays(today, -RECENT_DAYS));
    const feedFrom =
      point.kind === 'electricity'
        ? earliest(
            typeof state.fedUntil === 'string'
              ? addDays(state.fedUntil, -OVERLAP_DAYS)
              : addDays(today, -config.historyDays),
            today,
          )
        : null;
    const from = feedFrom ? earliest(feedFrom, recentFrom) : recentFrom;
    const request = {
      propertyId: point.propertyId,
      supplyPointId: point.id,
      utility: point.kind,
      to: new Date(at).toISOString(),
    };
    const daily = await getClient().getMeasurements(credentials(), {
      ...request,
      frequency: 'DAY_INTERVAL',
      from: isoWithOffset(startOfLocalDay(from, FRANCE), FRANCE),
    });
    const days = withEstimatedCost(toDays(daily, at), point);
    let monthly = null;
    if (days.length === 0 && point.kind === 'gas') {
      // Some Gazpar meters only send a monthly reading.
      monthly = lastMonthlyWithCost(
        await getClient().getMeasurements(credentials(), {
          ...request,
          frequency: 'MONTH_INTERVAL',
          from: isoWithOffset(startOfLocalDay(monthStart(addDays(today, -62)), FRANCE), FRANCE),
        }),
      );
    }
    function lastMonthlyWithCost(nodes) {
      const found = lastMonthly(nodes);
      const rates = point.agreement?.rates ?? [];
      if (
        found &&
        found.cost === null &&
        rates.length === 1 &&
        typeof rates[0].price === 'number'
      ) {
        found.cost = Math.round(found.kwh * rates[0].price * 100) / 100;
      }
      return found;
    }
    return {
      ...point,
      summary: computeSummary(days, monthly),
      feed: feedFrom ? toDailyConsumption(days, { from: feedFrom, now: at, gladysTimeZone }) : [],
      updatedAt: at,
    };
  }

  /**
   * Send a supply point to Gladys: its dated consumption, its readings, its
   * new-day event. Only for a device the user added (Gladys drops the rest).
   */
  async function publishPoint(point) {
    const ids = meterIds(gladys, point);
    const state = (persisted.meters[point.id] ??= {});
    const created = createdDevices().has(ids.device);

    // The scene event: once per new day of readings. The first reading only
    // sets the baseline, so installing never replays the history.
    const lastDay = point.summary?.lastDay;
    let announce = false;
    if (lastDay && lastDay.date !== state.announced) {
      announce = state.announced !== undefined && lastDay.date > state.announced;
      state.announced = lastDay.date;
    }
    if (!created) {
      await save();
      return false;
    }

    if (point.feed?.length > 0) {
      try {
        for (let i = 0; i < point.feed.length; i += MAX_INTERVALS_PER_CALL) {
          await gladys.publishEnergyConsumption(
            ids.feature(FEATURE.CONSUMPTION),
            point.feed.slice(i, i + MAX_INTERVALS_PER_CALL),
          );
        }
        const last = point.feed.at(-1).date;
        if (!state.fedUntil || last > state.fedUntil) {
          state.fedUntil = last;
        }
        issues.ok(`feed:${point.id}`, 'The energy tracking takes the consumption again');
      } catch (err) {
        issues.fail(
          `feed:${point.id}`,
          `The energy tracking refused the consumption (${reasonOf(err)})`,
        );
      }
    }

    try {
      await gladys.publishChangedStates(
        readingStates(gladys, point, point.summary, config.language),
        { heartbeat: HEARTBEAT_MS },
      );
      issues.ok(`states:${point.id}`, 'Readings published again');
    } catch (err) {
      issues.fail(`states:${point.id}`, `Readings not published (${reasonOf(err)})`);
    }

    if (announce) {
      const month = point.summary.month;
      try {
        await gladys.publishSceneEvent(TRIGGER.NEW_READING, {
          meter: ids.device,
          energy: point.kind,
          date: lastDay.date,
          consumption: lastDay.kwh,
          cost: lastDay.cost,
          month_consumption: month?.kwh ?? null,
          month_cost: month?.cost ?? null,
        });
      } catch (err) {
        logger.debug(`New-reading event not sent: ${reasonOf(err)}`);
      }
    }
    await save();
    return true;
  }

  async function refreshWidget() {
    try {
      await gladys.requestWidgetRefresh(WIDGET.SUMMARY);
    } catch (err) {
      logger.debug(`Widget refresh not sent: ${reasonOf(err)}`);
    }
  }

  /**
   * The clock: the tariff period of each electricity meter, its states, and
   * the off-peak triggers when it changed since the last tick. Never throws
   * on a Gladys error (logged); the first tick after a start only sets the
   * baseline, so a restart during off-peak hours fires nothing.
   */
  async function tick() {
    const at = now();
    const created = createdDevices();
    let changed = false;
    for (const point of points.values()) {
      if (point.kind !== 'electricity') {
        continue;
      }
      const period = currentPeriod(point, at);
      const previous = periods.get(point.id);
      periods.set(point.id, period?.period ?? null);
      const ids = meterIds(gladys, point);
      if (period && previous !== undefined && previous !== null && previous !== period.period) {
        changed = true;
        const event =
          period.period === PERIOD.OFF_PEAK
            ? TRIGGER.OFF_PEAK_STARTED
            : previous === PERIOD.OFF_PEAK
              ? TRIGGER.OFF_PEAK_ENDED
              : null;
        if (event) {
          logger.debug(`Tariff period: ${previous} → ${period.period}`);
          try {
            await gladys.publishSceneEvent(event, {
              meter: ids.device,
              until: period.until,
              price: period.price,
            });
          } catch (err) {
            logger.debug(`Off-peak event not sent: ${reasonOf(err)}`);
          }
        }
      }
      if (!created.has(ids.device)) {
        continue;
      }
      try {
        await gladys.publishChangedStates(tariffStates(gladys, point, period, config.language), {
          heartbeat: HEARTBEAT_MS,
        });
        issues.ok(`tariff:${point.id}`, 'Tariff period published again');
      } catch (err) {
        issues.fail(`tariff:${point.id}`, `Tariff period not published (${reasonOf(err)})`);
      }
    }
    if (changed) {
      await refreshWidget();
    }
  }

  /**
   * One cloud cycle. Never throws: resolves its outcome, `retry` when Octopus
   * could not be reached (the poller tries again within the hour).
   * @returns {Promise<{ status: string, retry?: boolean, reason?: string }>}
   */
  async function cycle({ force = false } = {}) {
    if (!isConfigured(config)) {
      await setStatus(false, MESSAGES.notConfigured);
      return { status: 'not_configured' };
    }
    if (refused && !force) {
      // Trying a refused password again and again could lock the account.
      logger.debug('The password was refused: cycle skipped until the configuration changes');
      return { status: 'password' };
    }

    const octopus = getClient();
    let raw;
    try {
      const numbers = await octopus.getAccountNumbers(credentials());
      raw = [];
      for (const number of numbers) {
        raw.push(...parseAccount(await octopus.getAccount(credentials(), number)));
      }
      if (refused) {
        refused = false;
      }
      issues.ok('auth', 'Signed in to Octopus Energy again');
      issues.ok('reach', 'Octopus Energy answers again');
    } catch (err) {
      if (err instanceof InvalidAuthError) {
        refused = true;
        issues.fail('auth', `Octopus Energy refused the sign-in: ${reasonOf(err)}`);
        await setStatus(false, MESSAGES.invalidAuth);
        return { status: 'password' };
      }
      if (err instanceof RateLimitError) {
        issues.fail('reach', `Octopus Energy rate limit: ${reasonOf(err)}`);
        await setStatus(false, MESSAGES.rateLimited);
        return { status: 'rate_limited', retry: true, reason: reasonOf(err) };
      }
      issues.fail('reach', `Octopus Energy cannot be read: ${reasonOf(err)}`);
      await setStatus(false, MESSAGES.cannotConnect(reasonOf(err)));
      return { status: 'unreachable', retry: true, reason: reasonOf(err) };
    }

    const read = new Map();
    let failed = 0;
    for (const point of raw) {
      try {
        read.set(point.id, await readPoint(point));
        issues.ok(`meter:${point.id}`, `A ${point.kind} meter is read again`);
      } catch (err) {
        failed += 1;
        issues.fail(
          `meter:${point.id}`,
          `A ${point.kind} meter could not be read (${reasonOf(err)})`,
        );
        // Keep what the previous cycle read: still the best known values.
        const previous = points.get(point.id);
        read.set(point.id, {
          ...point,
          summary: previous?.summary ?? computeSummary([]),
          feed: [],
          updatedAt: previous?.updatedAt ?? null,
        });
      }
    }
    const previousCount = points.size;
    points = read;

    try {
      await publishDevices();
    } catch (err) {
      issues.fail('devices', `Publishing the meters failed: ${reasonOf(err)}`);
      await setStatus(false, MESSAGES.cannotConnect(reasonOf(err)));
      return { status: 'unreachable', retry: true, reason: reasonOf(err) };
    }
    issues.ok('devices', 'Meters published again');
    if (points.size !== previousCount) {
      logger.info(`Octopus Energy: ${points.size} supply point(s) found`);
    }

    for (const point of points.values()) {
      await publishPoint(point);
    }
    await tick();
    await refreshWidget();

    if (points.size === 0) {
      await setStatus(false, MESSAGES.noMeter);
      return { status: 'no_meter' };
    }
    await setStatus(true);
    lastSuccessAt = now();
    logger.debug(`Cycle done: ${points.size} supply point(s), ${failed} failed`);
    return { status: 'ok', retry: failed > 0 };
  }

  /** One cycle at a time: a second caller waits for the one in progress. */
  function sync(options) {
    if (!running) {
      running = cycle(options)
        .catch((err) => {
          logger.error(`Cycle failed: ${reasonOf(err)}`);
          return { status: 'unreachable', retry: true, reason: reasonOf(err) };
        })
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  const poller = createPoller({
    run: () => sync(),
    now,
    timers,
    ...(refreshPeriodMs ? { periodMs: refreshPeriodMs, retryMs: refreshPeriodMs } : {}),
  });
  const clock = createClock({
    tick: () => tick().catch((err) => logger.debug(`Tick failed: ${reasonOf(err)}`)),
    now,
    timers,
    ...(tickMs ? { periodMs: tickMs } : {}),
  });

  /** Wait for a refresh at most ACTION_WAIT_MS; it goes on alone past that. */
  async function refreshForAction() {
    let timeout;
    const outcome = await Promise.race([
      sync({ force: true }),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), ACTION_WAIT_MS);
        timeout.unref?.();
      }),
    ]);
    clearTimeout(timeout);
    return outcome;
  }

  /** The message of an action that ran a cycle. */
  function outcomeMessage(outcome) {
    switch (outcome?.status) {
      case undefined:
        return MESSAGES.stillRunning;
      case 'ok': {
        const created = createdDevices();
        const missing = [...points.values()].some(
          (point) => !created.has(meterIds(gladys, point).device),
        );
        return missing ? MESSAGES.signedIn(points.size) : MESSAGES.refreshed(points.size);
      }
      case 'password':
        return MESSAGES.invalidAuth;
      case 'rate_limited':
        return MESSAGES.rateLimited;
      case 'no_meter':
        return MESSAGES.noMeter;
      case 'not_configured':
        return MESSAGES.notConfigured;
      default:
        return MESSAGES.cannotConnect(outcome.reason ?? 'see the logs');
    }
  }

  /** The seconds until the tariff period of a meter changes, or null. */
  function secondsToChange(period, at) {
    if (!period?.until) {
      return null;
    }
    const [h, m] = period.until.split(':').map(Number);
    const minutes = (h * 60 + m - minuteOfDay(at, FRANCE) + 1440) % 1440 || 1440;
    return minutes * 60 - (Math.floor(at / 1000) % 60);
  }

  const api = {
    get config() {
      return config;
    },
    get points() {
      return points;
    },
    poller,
    sync,
    tick,

    /** (Re)connected to Gladys: read the config and the saved state, then a cycle. */
    async start() {
      config = normalizeConfig(await gladys.getConfig());
      persisted = await store.load();
      logger.info(
        isConfigured(config)
          ? 'Octopus Energy France integration started'
          : 'Octopus Energy France integration started: waiting for the configuration',
      );
      clock.start();
      // A reconnection reads Octopus again only when a cycle is due.
      await poller.start({ force: false });
      if (points.size > 0) {
        await tick();
      }
    },

    async configUpdated(raw) {
      const previous = { identity: identity(), historyDays: config.historyDays };
      config = normalizeConfig(raw);
      logger.info('Configuration updated');
      // New credentials (or the same ones typed again): worth a new try.
      refused = false;
      if (identity() !== previous.identity) {
        // Another account: forget its supply points and their periods.
        points = new Map();
        periods.clear();
        client = null;
        persisted.tokens = {};
        await save();
      } else if (client) {
        // Same account, maybe another password: sign in from scratch.
        client = null;
      }
      if (config.historyDays > previous.historyDays) {
        // A longer history asked: the next cycle imports it again (the core
        // writes only the values it does not have).
        for (const state of Object.values(persisted.meters)) {
          delete state.fedUntil;
        }
        await save();
      }
      await poller.start();
    },

    async scanRequest() {
      if (points.size === 0 && isConfigured(config)) {
        await sync();
      }
      await publishDevices();
    },

    async deviceCreated(device) {
      const point = pointByDevice(device.external_id);
      if (!point) {
        return;
      }
      logger.info(`Octopus ${point.kind} meter added to Gladys, sending its data`);
      await publishPoint(point);
      await tick();
      await refreshWidget();
    },

    async deviceUpdated(device) {
      const point = pointByDevice(device.external_id);
      if (point) {
        await publishPoint(point);
        await tick();
      }
    },

    /**
     * The core's poll: acked at once; the clock ticks and, when one is due,
     * a cloud cycle runs on (it lasts longer than the ack delay).
     */
    poll() {
      tick().catch((err) => logger.debug(`Poll tick failed: ${reasonOf(err)}`));
      poller.fromCore().catch((err) => logger.debug(`Poll fallback failed: ${reasonOf(err)}`));
    },

    stop() {
      poller.stop();
      clock.stop();
    },

    /** Configuration action: sign in and read now. */
    async refreshNow() {
      logger.info('Action: refresh now');
      if (!isConfigured(config)) {
        return MESSAGES.notConfigured;
      }
      if (lastSuccessAt !== null && now() - lastSuccessAt < MANUAL_REFRESH_MIN_MS) {
        return MESSAGES.refreshTooSoon(
          Math.ceil((MANUAL_REFRESH_MIN_MS - (now() - lastSuccessAt)) / 60000),
        );
      }
      return outcomeMessage(await refreshForAction());
    },

    /** Scene action: the figures of a supply point, for a message. */
    async meterSummary(fields = {}) {
      const point = pointByDevice(fields.meter);
      if (!point) {
        throw new Error('Unknown meter: add it to Gladys, then pick it in the action');
      }
      const { lastDay, month } = point.summary ?? {};
      const period = point.kind === 'electricity' ? currentPeriod(point, now()) : null;
      // An unknown figure is left out (null for the scene), never a false 0.
      const outputs = {};
      const add = (key, value) => {
        if (value !== null && value !== undefined) {
          outputs[key] = value;
        }
      };
      add('date', lastDay?.date);
      add('consumption', lastDay?.kwh);
      add('cost', lastDay?.cost);
      add('month_consumption', month?.kwh);
      add('month_cost', month?.cost);
      add('balance', point.balance);
      add('next_payment', point.agreement?.nextPayment?.amount);
      add(
        'next_payment_date',
        point.agreement?.nextPayment?.date
          ? formatDate(point.agreement.nextPayment.date, config.language)
          : null,
      );
      add('period', period?.period);
      add('price', period?.price);
      return outputs;
    },

    /** Dashboard widget content. */
    async widget({ settings = {}, language = 'en' } = {}) {
      const all = [...points.values()];
      const point =
        pointByDevice(settings.meter) ??
        all.find((candidate) => candidate.kind === 'electricity') ??
        all[0] ??
        null;
      const at = now();
      const period = point?.kind === 'electricity' ? currentPeriod(point, at) : null;
      return buildWidgetContent({
        meter: point,
        period,
        language,
        configured: isConfigured(config),
        refused,
        secondsToChange: secondsToChange(period, at),
      });
    },
  };
  return api;
}

/**
 * Register every handler on the SDK client (before connect()).
 * @param {object} gladys
 * @param {ReturnType<typeof createApp>} app
 */
export function registerHandlers(gladys, app) {
  gladys.onScanRequest(() => app.scanRequest());
  gladys.onPoll(() => app.poll());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceUpdated(device));
  gladys.onConfigUpdated((config) => app.configUpdated(config));
  gladys.onAction(ACTION.REFRESH, () => app.refreshNow());
  gladys.onSceneAction(SCENE_ACTION.SUMMARY, (fields) => app.meterSummary(fields));
  gladys.onWidgetGet(WIDGET.SUMMARY, (request) => app.widget(request));
  gladys.on('connected', async () => {
    try {
      await app.start();
    } catch (err) {
      await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
      throw err;
    }
  });
  gladys.on('disconnected', () => app.stop());
}
