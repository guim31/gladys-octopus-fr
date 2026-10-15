// -----------------------------------------------------------------------------
// The container's own timers.
//
// Two paces, two timers:
//   - the cloud refresh: Octopus gets the Linky and Gazpar readings from
//     Enedis and GRDF once a day, a day or two late, and the balance moves
//     with the bills. One read every 3 hours keeps Gladys close to what the
//     customer area shows, for about ten GraphQL requests per read (the
//     Home Assistant integration reads every hour). A read that could not
//     reach Octopus, or hit its rate limit, is retried after an hour;
//   - the clock: off-peak hours start and end on the minute, and nothing
//     needs the network to know it (the contract's hours are read by the
//     cloud refresh). A tick every minute updates the current period, its
//     price and fires the scene triggers.
//
// The core cannot be trusted to poll an external device: Gladys 5.2 skips the
// devices created without `should_poll`, and keeps that forever
// (GladysAssistant/Gladys#3198). So these timers do the work, and the core's
// onPoll (once a minute) is a fallback: it ticks the clock, and runs a cloud
// read only when the timer missed one — never two reads in a period.
// -----------------------------------------------------------------------------

export const REFRESH_PERIOD_MS = 3 * 3600 * 1000;
export const RETRY_DELAY_MS = 3600 * 1000;
export const TICK_MS = 60 * 1000;

/**
 * @param {object} options
 * @param {() => Promise<{ retry?: boolean } | void>} options.run one cycle (never throws)
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] arm the timer (the tests drive the cycles by hand)
 * @param {number} [options.periodMs]
 * @param {number} [options.retryMs]
 */
export function createPoller({
  run,
  now = () => Date.now(),
  timers = true,
  periodMs = REFRESH_PERIOD_MS,
  retryMs = RETRY_DELAY_MS,
}) {
  let timer = null;
  let stopped = true;
  let lastRunAt = null;
  let nextDelay = periodMs;

  function schedule(delay) {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      api.runNow().finally(() => schedule(nextDelay));
    }, delay);
    // The timer must not keep a stopping process alive.
    timer.unref?.();
  }

  const api = {
    /** Run a cycle now and note when. */
    async runNow() {
      lastRunAt = now();
      const outcome = await run();
      nextDelay = outcome?.retry ? retryMs : periodMs;
      return outcome;
    },

    /**
     * (Re)start: a cycle now, then one every period. A reconnection to Gladys
     * (`force` false) reads again only when a cycle is due.
     */
    async start({ force = true } = {}) {
      stopped = false;
      if (!force && lastRunAt !== null && now() - lastRunAt < nextDelay * 0.9) {
        schedule(nextDelay - (now() - lastRunAt));
        return null;
      }
      const outcome = await api.runNow();
      schedule(nextDelay);
      return outcome;
    },

    /**
     * The core's poll: a cycle only when the timer has not run one for 90 %
     * of a period (it stalled, or the container just started without it).
     * @returns {Promise<boolean>} true when a cycle ran
     */
    async fromCore() {
      if (lastRunAt !== null && now() - lastRunAt < nextDelay * 0.9) {
        return false;
      }
      await api.runNow();
      schedule(nextDelay);
      return true;
    },

    /** When the last cycle started (ms), or null. */
    get lastRunAt() {
      return lastRunAt;
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
  return api;
}

/**
 * A tick on every minute (a second past it, so the clock has turned).
 * @param {object} options
 * @param {() => Promise<void> | void} options.tick never throws
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers]
 * @param {number} [options.periodMs]
 */
export function createClock({ tick, now = () => Date.now(), timers = true, periodMs = TICK_MS }) {
  let timer = null;

  function schedule() {
    clearTimeout(timer);
    // Aligned on the period (the minute) plus a second.
    const delay = periodMs - (now() % periodMs) + Math.min(1000, periodMs / 10);
    timer = setTimeout(async () => {
      timer = null;
      await tick();
      if (timer === null && api.running) {
        schedule();
      }
    }, delay);
    timer.unref?.();
  }

  const api = {
    running: false,
    start() {
      if (!timers) {
        return;
      }
      api.running = true;
      schedule();
    },
    stop() {
      api.running = false;
      clearTimeout(timer);
      timer = null;
    },
  };
  return api;
}
