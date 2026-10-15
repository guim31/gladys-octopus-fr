// -----------------------------------------------------------------------------
// From the raw Kraken account to the supply points the integration shows.
// Pure functions, no I/O.
//
// Kraken returns explicit `null` for the parts it does not have (a meter
// without calendar, an agreement without product): every read tolerates it.
// Money comes in euro cents (balances, payment forecasts, measured costs) and
// unit prices in cents per kWh: everything leaves here in euros.
// -----------------------------------------------------------------------------

const list = (value) => (Array.isArray(value) ? value : []);
const edges = (connection) =>
  list(connection?.edges)
    .map((edge) => edge?.node)
    .filter(Boolean);

/** A number from a Kraken value (numbers arrive as strings, e.g. "0E-18"), or null. */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Cents → euros, or null. */
export function euros(cents) {
  const number = toNumber(cents);
  return number === null ? null : round(number / 100, 2);
}

/** "22:00:00" or "22:00" → 1320 minutes, or null. */
export function parseClock(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * An electricity supply point is shown unless the distributor cancelled it
 * (RESIL) and it is no longer powered (the rule of ha-octopus-french).
 */
function isActiveElectricity(meterPoint) {
  if (meterPoint?.distributorStatus !== 'RESIL') {
    return true;
  }
  const powered = meterPoint?.poweredStatus;
  return powered !== null && powered !== undefined && powered !== 'LIMI';
}

/** The consumption rates of an agreement, in €/kWh incl. taxes. */
function ratesOf(agreement) {
  const rates = [];
  for (const node of edges(agreement?.energySupplyRate?.rates)) {
    if (/standing/i.test(node.__typename ?? '')) {
      continue;
    }
    const cents = toNumber(node.pricePerUnitWithTaxes);
    rates.push({
      code: node.temporalClass?.code ? String(node.temporalClass.code).toUpperCase() : null,
      label: node.temporalClass?.label ?? null,
      price: cents === null ? null : round(cents / 100, 5),
      slots: list(node.timeSlots)
        .map((slot) => ({ start: parseClock(slot?.startAt), end: parseClock(slot?.endAt) }))
        .filter((slot) => slot.start !== null && slot.end !== null),
    });
  }
  return rates;
}

function agreementFor(agreements, supplyPointId) {
  const mine = agreements.filter(
    (agreement) => agreement?.supplyPoint?.externalIdentifier === supplyPointId,
  );
  const chosen = mine.find((agreement) => agreement.isActive) ?? mine[0] ?? null;
  if (!chosen) {
    return null;
  }
  return {
    product: chosen.product?.displayName || chosen.product?.code || null,
    productCode: chosen.product?.code ?? null,
    validFrom: chosen.validFrom ?? null,
    rates: ratesOf(chosen),
    nextPayment: chosen.nextPaymentForecast
      ? {
          amount: euros(chosen.nextPaymentForecast.amount),
          date:
            typeof chosen.nextPaymentForecast.date === 'string'
              ? chosen.nextPaymentForecast.date.slice(0, 10)
              : null,
        }
      : null,
  };
}

const LEDGER_TYPES = { electricity: 'FRA_ELECTRICITY_LEDGER', gas: 'FRA_GAS_LEDGER' };

/**
 * The balance of a supply point's ledger, in euros. Kraken keeps one ledger
 * per energy; with two meters of the same energy, the ledger name carries the
 * meter number in brackets.
 */
function balanceFor(ledgers, kind, supplyPointId) {
  const ofKind = ledgers.filter((ledger) => ledger?.ledgerType === LEDGER_TYPES[kind]);
  const named = ofKind.find((ledger) => String(ledger.name ?? '').includes(`(${supplyPointId})`));
  const ledger = named ?? (ofKind.length === 1 ? ofKind[0] : null);
  return ledger ? euros(ledger.balance) : null;
}

/**
 * @param {object} account the `account` of the ACCOUNT query
 * @returns {Array<object>} one entry per supply point
 */
export function parseAccount(account) {
  const agreements = edges(account?.agreements);
  const ledgers = list(account?.ledgers);
  const points = [];
  for (const property of list(account?.properties)) {
    for (const node of edges(property?.supplyPoints)) {
      const meterPoint = node.meterPoint ?? {};
      const id = typeof node.externalIdentifier === 'string' ? node.externalIdentifier.trim() : '';
      if (!id) {
        continue;
      }
      const electricity = 'meterKind' in meterPoint || 'distributorStatus' in meterPoint;
      const gas = 'gasNature' in meterPoint;
      if (!electricity && !gas) {
        continue;
      }
      if (electricity && !isActiveElectricity(meterPoint)) {
        continue;
      }
      const kind = electricity ? 'electricity' : 'gas';
      points.push({
        kind,
        id,
        accountNumber: account.number,
        propertyId: property.id,
        offPeakLabel: electricity ? (meterPoint.offPeakLabel ?? null) : null,
        temporalClasses: electricity
          ? list(meterPoint.providerCalendar?.temporalClasses).map((entry) => ({
              code: entry?.code ? String(entry.code).toUpperCase() : null,
              label: entry?.label ?? null,
              description: entry?.description ?? null,
            }))
          : [],
        subscribedPower: electricity ? toNumber(meterPoint.subscribedMaxPower) : null,
        agreement: agreementFor(agreements, id),
        balance: balanceFor(ledgers, kind, id),
      });
    }
  }
  return points;
}

// Labels of the statistics that are not energy (the standing charge).
const NOT_ENERGY = /ABONNEMENT|STANDING|SUBSCRIPTION/i;

/**
 * One interval measurement → `{ start, end, kwh, cost }`. The kWh is the
 * measurement value (else the sum of its energy statistics); the cost is the
 * sum of the energy statistics' amounts incl. taxes, the standing charge left
 * out, or null when Octopus gave none.
 */
export function parseMeasurement(node) {
  const start = Date.parse(node?.startAt ?? '');
  const end = Date.parse(node?.endAt ?? '');
  if (!Number.isFinite(start)) {
    return null;
  }
  const statistics = list(node?.metaData?.statistics).filter(
    (stat) => !NOT_ENERGY.test(String(stat?.label ?? '')),
  );
  let kwh = toNumber(node?.value);
  if (kwh === null && statistics.length > 0) {
    const values = statistics.map((stat) => toNumber(stat?.value)).filter((v) => v !== null);
    kwh = values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  }
  const amounts = statistics
    .map((stat) => toNumber(stat?.costInclTax?.estimatedAmount))
    .filter((amount) => amount !== null);
  return {
    start,
    end: Number.isFinite(end) ? end : null,
    kwh: kwh === null ? null : round(kwh, 6),
    cost: amounts.length > 0 ? round(amounts.reduce((a, b) => a + b, 0) / 100, 4) : null,
  };
}
