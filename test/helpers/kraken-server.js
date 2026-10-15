// -----------------------------------------------------------------------------
// A fake Kraken GraphQL API of Octopus Energy France, as a `fetch`.
//
// It answers the four documents of src/octopus/queries.js with the shapes of
// test/fixtures/kraken (sign-in, accounts, account) and generates the daily
// measurements of the supply points: one per French day up to `dataUntil()`
// (the Enedis delay), paginated like Kraken. It checks what a real server
// would: the JWT on every query, the variables, the sign-in.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { localDate, startOfLocalDay, addDays, isoWithOffset } from '../../src/time.js';

const FRANCE = 'Europe/Paris';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/kraken/${name}`, import.meta.url), 'utf8'));
}

/** A JWT the client can read the expiry of (unsigned: the fake does not check signatures). */
export function makeJwt(expMs, subject = 'kraken|account-user:0001') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject, exp: Math.floor(expMs / 1000) })}.c2ln`;
}

/** The kWh of a day: a steady pattern, 60 % peak and 40 % off-peak. */
export function electricityDay(date) {
  const n = Number(date.slice(8, 10));
  const total = 8 + (n % 5);
  return {
    total,
    hp: Math.round(total * 0.6 * 1000) / 1000,
    hc: Math.round(total * 0.4 * 1000) / 1000,
  };
}

export function gasDay(date) {
  const n = Number(date.slice(8, 10));
  return 20 + (n % 3);
}

const HP_CENTS = 20.81;
const HC_CENTS = 16.35;
const STANDING_CENTS_PER_DAY = 53.49;

/**
 * @param {object} options
 * @param {() => number} options.now the clock
 * @param {() => number} options.dataUntil readings exist for the days ending before this instant
 * @param {string} [options.email]
 * @param {string} [options.password]
 * @param {object} [options.account] the ACCOUNT answer (fixture)
 * @param {boolean} [options.gasDaily] serve daily gas readings (else monthly only)
 */
export function createKrakenServer({
  now,
  dataUntil,
  email = 'client@example.com',
  password = 'bon mot de passe',
  account = fixture('account-hphc.json'),
  gasDaily = true,
}) {
  const server = {
    requests: [],
    /** Next answers forced by a test, by operation: a JSON body, or { status }. */
    force: {},
    down: false,
    accessMs: 3600 * 1000,
    tokens: new Set(),
    refreshTokens: new Set(),
    account,
    gasDaily,
  };
  let issued = 0;

  function sign() {
    issued += 1;
    const token = makeJwt(now() + server.accessMs, `kraken|account-user:${issued}`);
    const refresh = `fake-refresh-token-${String(issued).padStart(4, '0')}`;
    server.tokens.add(token);
    server.refreshTokens.add(refresh);
    return {
      data: {
        obtainKrakenToken: { token, refreshToken: refresh, refreshExpiresIn: 604800 },
      },
    };
  }

  function operationOf(query) {
    const match = String(query).match(/^\s*(query|mutation)\s+(\w+)/);
    return match ? match[2] : null;
  }

  function measurements(variables) {
    const filter = variables.utilityFilters?.[0] ?? {};
    const utility = filter.electricityFilters ? 'electricity' : 'gas';
    const { readingFrequencyType, marketSupplyPointId } =
      filter.electricityFilters ?? filter.gasFilters ?? {};
    if (!variables.propertyId || !marketSupplyPointId || !readingFrequencyType) {
      return { errors: [{ message: 'Missing variables.', path: ['property'] }], data: null };
    }
    const from = Date.parse(variables.startAt);
    const to = Math.min(Date.parse(variables.endAt), dataUntil());
    const nodes = [];
    if (readingFrequencyType === 'DAY_INTERVAL' && (utility === 'electricity' || server.gasDaily)) {
      for (let date = localDate(from, FRANCE); ; date = addDays(date, 1)) {
        const start = startOfLocalDay(date, FRANCE);
        const end = startOfLocalDay(addDays(date, 1), FRANCE);
        if (end > to) {
          break;
        }
        if (start < from) {
          continue;
        }
        if (utility === 'electricity') {
          const day = electricityDay(date);
          nodes.push({
            value: String(day.total),
            startAt: isoWithOffset(start, FRANCE),
            endAt: isoWithOffset(end, FRANCE),
            metaData: {
              statistics: [
                {
                  label: 'CONSUMPTION_FIXE_HPHC_HP_0.0_9.0',
                  value: String(day.hp),
                  costInclTax: {
                    estimatedAmount: (day.hp * HP_CENTS).toFixed(4),
                    costCurrency: 'EUR',
                  },
                },
                {
                  label: 'CONSUMPTION_FIXE_HPHC_HC_0.0_9.0',
                  value: String(day.hc),
                  costInclTax: {
                    estimatedAmount: (day.hc * HC_CENTS).toFixed(4),
                    costCurrency: 'EUR',
                  },
                },
                {
                  label: 'ABONNEMENT',
                  value: null,
                  costInclTax: {
                    estimatedAmount: STANDING_CENTS_PER_DAY.toFixed(4),
                    costCurrency: 'EUR',
                  },
                },
              ],
            },
          });
        } else {
          nodes.push({
            value: String(gasDay(date)),
            startAt: isoWithOffset(start, FRANCE),
            endAt: isoWithOffset(end, FRANCE),
            metaData: { statistics: [] },
          });
        }
      }
    }
    if (readingFrequencyType === 'MONTH_INTERVAL' && utility === 'gas') {
      const month = localDate(to - 40 * 24 * 3600 * 1000, FRANCE).slice(0, 7);
      const start = startOfLocalDay(`${month}-01`, FRANCE);
      const [y, m] = month.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const end = startOfLocalDay(next, FRANCE);
      nodes.push({
        value: '640.5',
        startAt: isoWithOffset(start, FRANCE),
        endAt: isoWithOffset(end, FRANCE),
        metaData: { statistics: [] },
      });
    }
    const first = variables.first ?? 100;
    const offset = variables.after ? Number(variables.after) : 0;
    const page = nodes.slice(offset, offset + first);
    const next = offset + first < nodes.length;
    return {
      data: {
        property: {
          measurements: {
            pageInfo: { hasNextPage: next, endCursor: next ? String(offset + first) : null },
            edges: page.map((node) => ({ node })),
          },
        },
      },
    };
  }

  function answer(operation, variables, authorization) {
    const forced = server.force[operation];
    if (forced !== undefined) {
      if (Array.isArray(forced)) {
        const next = forced.shift();
        if (forced.length === 0) {
          delete server.force[operation];
        }
        if (next !== undefined && next !== null) {
          return next;
        }
      } else {
        return forced;
      }
    }
    if (operation === 'obtainKrakenToken') {
      const input = variables.input ?? {};
      if (input.refreshToken) {
        return server.refreshTokens.has(input.refreshToken)
          ? sign()
          : fixture('token-refused.json');
      }
      if (input.email === email && input.password === password) {
        return sign();
      }
      return fixture('token-refused.json');
    }
    const token = String(authorization ?? '').replace(/^JWT /, '');
    if (!server.tokens.has(token)) {
      return {
        errors: [
          {
            message: 'Unauthorized.',
            path: [operation],
            extensions: { errorType: 'AUTHORIZATION', errorCode: 'KT-CT-1111' },
          },
        ],
        data: null,
      };
    }
    switch (operation) {
      case 'accounts':
        return fixture('accounts.json');
      case 'account':
        return variables.accountNumber === server.account.data.account.number &&
          typeof variables.activeAt === 'string'
          ? server.account
          : { errors: [{ message: 'Account not found.', path: ['account'] }], data: null };
      case 'measurements':
        return measurements(variables);
      default:
        return { errors: [{ message: `Cannot query field "${operation}".` }] };
    }
  }

  server.fetch = async (url, init = {}) => {
    if (server.down) {
      throw new TypeError('fetch failed');
    }
    const body = JSON.parse(init.body);
    const operation = operationOf(body.query);
    const authorization = init.headers?.Authorization;
    server.requests.push({ url, operation, variables: body.variables, authorization });
    const result = answer(operation, body.variables ?? {}, authorization);
    if (result && typeof result.status === 'number') {
      return new Response('error', { status: result.status });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return server;
}
