#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Octopus Energy France API (Kraken GraphQL), read-only.
//
// The code sessions of this repository cannot reach api.oefr-kraken.energy:
// this script is run from a machine that can, to check the client against
// the real API without showing anything personal.
//
//   node scripts/probe.mjs            # schema + a made-up account (refusal expected)
//   node scripts/probe.mjs --trace    # also lists every request (operation, status)
//   OCTOPUS_EMAIL=… OCTOPUS_PASSWORD=… node scripts/probe.mjs
//                                     # + a real account: counts only, no number,
//                                     #   no address, no amount, no token printed
//
// Steps:
//   1. introspection: do the types and fields the queries use exist?
//   2. sign-in with a made-up account: is it refused as a wrong password
//      (InvalidAuthError), not as an API change?
//   3. (real account only) sign-in, accounts, supply points, agreement and
//      rates, 40 days of daily readings: what the integration would show,
//      as counts and kinds.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { createKrakenClient } from '../src/octopus/client.js';
import { parseAccount } from '../src/octopus/parse.js';
import { ENDPOINT } from '../src/octopus/queries.js';
import { computeSummary, toDays } from '../src/summary.js';
import { currentPeriod, offerKind, offPeakHours } from '../src/tariff.js';
import { addDays, FRANCE, isoWithOffset, localDate, startOfLocalDay } from '../src/time.js';

const trace = process.argv.includes('--trace');
let failures = 0;

const ok = (message) => console.log(`  ok    ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const info = (message) => console.log(`  ..    ${message}`);

/** fetch, with the request listed (operation and status only) when tracing. */
async function tracedFetch(url, init) {
  const operation = String(JSON.parse(init.body).query).match(/(query|mutation)\s+(\w+)/)?.[2];
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    if (trace) {
      info(`${operation ?? '(anonymous)'} → HTTP ${response.status} in ${Date.now() - started} ms`);
    }
    return response;
  } catch (err) {
    if (trace) {
      info(`${operation ?? '(anonymous)'} → ${err.name} after ${Date.now() - started} ms`);
    }
    throw err;
  }
}

async function graphql(query, variables = {}) {
  const response = await tracedFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// The fields the queries of src/octopus/queries.js read, by type.
const EXPECTED = {
  Mutation: ['obtainKrakenToken'],
  Query: ['viewer', 'account', 'property'],
  ObtainKrakenJSONWebToken: ['token', 'refreshToken', 'refreshExpiresIn'],
  AccountType: ['number', 'ledgers', 'properties', 'agreements'],
  ElectricityMeterPoint: ['distributorStatus', 'meterKind', 'offPeakLabel', 'providerCalendar'],
  GasMeterPoint: ['gasNature', 'poweredStatus'],
  IntervalMeasurementType: ['value', 'startAt', 'endAt', 'metaData'],
  ElectricitySupplyConsumptionRateType: ['timeSlots', 'temporalClass', 'pricePerUnitWithTaxes'],
};

async function stepSchema() {
  console.log('\n1. Schema (introspection, no account)');
  for (const [type, fields] of Object.entries(EXPECTED)) {
    try {
      const { status, body } = await graphql(
        'query probeType($name: String!) { __type(name: $name) { name fields { name } } }',
        { name: type },
      );
      const found = body?.data?.__type;
      if (!found) {
        const reason = body?.errors?.[0]?.message ?? `HTTP ${status}`;
        info(`${type}: not readable (${String(reason).slice(0, 100)})`);
        continue;
      }
      const names = new Set((found.fields ?? []).map((entry) => entry.name));
      const missing = fields.filter((name) => !names.has(name));
      if (missing.length === 0) {
        ok(`${type}: ${fields.join(', ')}`);
      } else {
        fail(`${type}: missing ${missing.join(', ')}`);
      }
    } catch (err) {
      fail(`${type}: ${err.message}`);
    }
  }
}

async function stepMadeUp() {
  console.log('\n2. Sign-in with a made-up account (a refusal is expected)');
  const client = createKrakenClient({ fetch: tracedFetch });
  const credentials = {
    email: `probe-${randomBytes(4).toString('hex')}@example.com`,
    password: randomBytes(12).toString('base64url'),
  };
  try {
    await client.signIn(credentials);
    fail('a made-up account was accepted');
  } catch (err) {
    if (err.name === 'InvalidAuthError') {
      ok(`refused as a wrong password: ${err.message.replace(credentials.email, '<email>')}`);
    } else {
      fail(`${err.name}: ${err.message}`);
    }
  }
}

async function stepReal() {
  const email = process.env.OCTOPUS_EMAIL;
  const password = process.env.OCTOPUS_PASSWORD;
  if (!email || !password) {
    console.log('\n3. Real account: skipped (set OCTOPUS_EMAIL and OCTOPUS_PASSWORD)');
    return;
  }
  console.log('\n3. Real account (counts only)');
  const secrets = [email, password];
  const clean = (text) => secrets.reduce((acc, secret) => acc.split(secret).join('***'), text);
  let saved = false;
  const client = createKrakenClient({
    fetch: tracedFetch,
    onTokens: (tokens) => {
      saved = Boolean(tokens?.refreshToken);
    },
  });
  const credentials = { email, password };
  try {
    const numbers = await client.getAccountNumbers(credentials);
    ok(`signed in; refresh token received: ${saved}; ${numbers.length} account(s)`);
    for (const [index, number] of numbers.entries()) {
      const points = parseAccount(await client.getAccount(credentials, number));
      ok(
        `account ${index + 1}: ${points.length} supply point(s): ${points.map((p) => p.kind).join(', ')}`,
      );
      for (const point of points) {
        const label = `  ${point.kind}`;
        info(
          `${label}: agreement ${point.agreement ? 'found' : 'MISSING'}, ${point.agreement?.rates.length ?? 0} rate(s) [${(point.agreement?.rates ?? []).map((rate) => rate.code ?? '?').join(', ')}], balance ${point.balance === null ? 'MISSING' : 'found'}, next payment ${point.agreement?.nextPayment ? 'found' : 'none'}`,
        );
        if (point.kind === 'electricity') {
          const { source, ranges } = offPeakHours(point, new Date().getUTCMonth() + 1);
          info(
            `${label}: offer kind ${offerKind(point)}, off-peak source ${source ?? 'none'} (${ranges.length} range(s)), period now ${currentPeriod(point, Date.now())?.period ?? 'unknown'}`,
          );
        }
        const today = localDate(Date.now(), FRANCE);
        const nodes = await client.getMeasurements(credentials, {
          propertyId: point.propertyId,
          supplyPointId: point.id,
          utility: point.kind,
          frequency: 'DAY_INTERVAL',
          from: isoWithOffset(startOfLocalDay(addDays(today, -40), FRANCE), FRANCE),
          to: new Date().toISOString(),
        });
        const days = toDays(nodes, Date.now());
        const summary = computeSummary(days);
        const withCost = days.filter((day) => day.cost !== null).length;
        const lag = summary.lastDay
          ? Math.round((Date.parse(today) - Date.parse(summary.lastDay.date)) / 86400000)
          : null;
        const labels = new Set(
          nodes.flatMap((node) =>
            (node?.metaData?.statistics ?? []).map((stat) => String(stat?.label ?? '?')),
          ),
        );
        info(
          `${label}: ${nodes.length} daily measurement(s), ${days.length} complete day(s), ${withCost} with a cost, last day ${lag === null ? 'none' : `${lag} day(s) ago`}; statistic labels: ${[...labels].join(', ') || 'none'}`,
        );
      }
    }
    info(`${client.requests} request(s) in all`);
  } catch (err) {
    fail(`${err.name}: ${clean(err.message)}`);
  }
}

console.log(`Octopus Energy France probe — ${ENDPOINT}`);
await stepSchema();
await stepMadeUp();
await stepReal();
console.log(failures === 0 ? '\nDone: no failure.' : `\nDone: ${failures} failure(s).`);
process.exitCode = failures === 0 ? 0 : 1;
