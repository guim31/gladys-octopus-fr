// -----------------------------------------------------------------------------
// One Gladys device per supply point: an electricity meter (PRM, Linky) or a
// gas meter (PCE, Gazpar).
//
// External ids are built from the supply point number Enedis or GRDF gave the
// meter (14 digits), which never changes with the contract:
// `ext:<selector>:electricity:<PRM>` / `ext:<selector>:gas:<PCE>`. Feature
// keys are forever.
//
// Electricity feeds the Gladys energy tracking with a daily consumption the
// integration dates itself (POST /energy/consumption): Enedis readings reach
// Octopus a day or two late, and the core's index pipeline would collapse a
// late day into the half hour it is received in. No cumulative index is
// published. The core derives the cost feature of that consumption from the
// user's contract in Gladys.
//
// The other figures (last day, month, cost, balance, payment, tariff period)
// are plain readings: none is a consumption or an index type, so nothing is
// counted twice in the energy tracking. Gas has no consumption feature: the
// energy tracking of Gladys 5.2 prices electricity only, and a gas
// consumption would be attached to the electric meter.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { FEATURE_NAMES, METER_NAMES, PERIOD_NAMES, formatDate, pick } from './i18n.js';
import { formatRanges } from './tariff.js';

export const FEATURE = {
  CONSUMPTION: 'consumption',
  LAST_DAY_CONSUMPTION: 'last_day_consumption',
  LAST_DAY_COST: 'last_day_cost',
  MONTH_CONSUMPTION: 'month_consumption',
  MONTH_COST: 'month_cost',
  BALANCE: 'balance',
  NEXT_PAYMENT: 'next_payment',
  NEXT_PAYMENT_DATE: 'next_payment_date',
  OFFER: 'offer',
  OFF_PEAK: 'off_peak',
  TARIFF_PERIOD: 'tariff_period',
  CURRENT_PRICE: 'current_price',
  OFF_PEAK_HOURS: 'off_peak_hours',
};

/** The ids of a supply point's device and features. */
export function meterIds(gladys, point) {
  return gladys.externalIds(point.kind, point.id);
}

/** "…4321": enough to tell two meters apart. */
function suffix(point) {
  return `…${point.id.slice(-4)}`;
}

/** The device name, e.g. "Octopus Électricité …4321". */
export function deviceName(point, language) {
  return `Octopus ${pick(METER_NAMES, language)[point.kind]} ${suffix(point)}`;
}

/**
 * The device Gladys discovers for a supply point.
 * @param {object} gladys the SDK client
 * @param {object} point a supply point of src/octopus/parse.js
 * @param {string} language
 */
export function buildDevice(gladys, point, language) {
  const ids = meterIds(gladys, point);
  const names = pick(FEATURE_NAMES, language);
  const feature = (key, kind, min, max) => ({
    name: names[key],
    external_id: ids.feature(key),
    ...kind,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min,
    max,
  });
  // A plain energy reading: neither an index nor a consumption type, so the
  // core does not count it in the energy tracking.
  const energy = {
    category: CAT.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.INDEX_YESTERDAY,
    unit: UNIT.KILOWATT_HOUR,
  };
  const money = { category: CAT.CURRENCY, type: TYPE.CURRENCY.DECIMAL, unit: UNIT.EURO };
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT };

  const features = [];
  if (point.kind === 'electricity') {
    features.push(
      feature(
        FEATURE.CONSUMPTION,
        {
          category: CAT.ENERGY_SENSOR,
          type: TYPE.ENERGY_SENSOR.DAILY_CONSUMPTION,
          unit: UNIT.KILOWATT_HOUR,
        },
        0,
        1000000,
      ),
    );
  }
  features.push(
    feature(FEATURE.LAST_DAY_CONSUMPTION, energy, 0, 1000000),
    feature(FEATURE.LAST_DAY_COST, money, -100000, 100000),
    feature(FEATURE.MONTH_CONSUMPTION, energy, 0, 1000000),
    feature(FEATURE.MONTH_COST, money, -100000, 100000),
    // A negative balance is a debt, a positive one a credit.
    feature(FEATURE.BALANCE, money, -100000, 100000),
    feature(FEATURE.NEXT_PAYMENT, money, -100000, 100000),
    // min/max are NOT NULL in the core, text features included.
    feature(FEATURE.NEXT_PAYMENT_DATE, text, 0, 0),
    feature(FEATURE.OFFER, text, 0, 0),
  );
  if (point.kind === 'electricity') {
    features.push(
      feature(FEATURE.OFF_PEAK, { category: CAT.INPUT, type: TYPE.INPUT.BINARY }, 0, 1),
      feature(FEATURE.TARIFF_PERIOD, text, 0, 0),
      feature(FEATURE.CURRENT_PRICE, money, 0, 10),
      feature(FEATURE.OFF_PEAK_HOURS, text, 0, 0),
    );
  }

  return {
    name: deviceName(point, language),
    external_id: ids.device,
    // The container refreshes the meters itself (src/poller.js); the core's
    // poll, once a minute, is only a fallback.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    features,
  };
}

/** The states read from Octopus (cloud cycle), for publishChangedStates. */
export function readingStates(gladys, point, summary, language) {
  const ids = meterIds(gladys, point);
  const states = [];
  const number = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const text = (key, value) => {
    // An empty text is ignored by the core: nothing is sent.
    if (typeof value === 'string' && value.trim() !== '') {
      states.push({ device_feature_external_id: ids.feature(key), text: value.slice(0, 200) });
    }
  };
  number(FEATURE.LAST_DAY_CONSUMPTION, summary?.lastDay?.kwh);
  number(FEATURE.LAST_DAY_COST, summary?.lastDay?.cost);
  number(FEATURE.MONTH_CONSUMPTION, summary?.month?.kwh);
  number(FEATURE.MONTH_COST, summary?.month?.cost);
  number(FEATURE.BALANCE, point.balance);
  number(FEATURE.NEXT_PAYMENT, point.agreement?.nextPayment?.amount);
  const paymentDate = point.agreement?.nextPayment?.date;
  if (paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    text(FEATURE.NEXT_PAYMENT_DATE, formatDate(paymentDate, language));
  }
  text(FEATURE.OFFER, point.agreement?.product);
  return states;
}

/** The states of the tariff clock (every minute, no network). */
export function tariffStates(gladys, point, period, language) {
  if (point.kind !== 'electricity' || !period) {
    return [];
  }
  const ids = meterIds(gladys, point);
  const states = [
    {
      device_feature_external_id: ids.feature(FEATURE.OFF_PEAK),
      state: period.period === 'off_peak' ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature(FEATURE.TARIFF_PERIOD),
      text: pick(PERIOD_NAMES, language)[period.period],
    },
  ];
  if (typeof period.price === 'number' && Number.isFinite(period.price)) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.CURRENT_PRICE),
      state: period.price,
    });
  }
  if (period.ranges.length > 0) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.OFF_PEAK_HOURS),
      text: formatRanges(period.ranges),
    });
  }
  return states;
}
