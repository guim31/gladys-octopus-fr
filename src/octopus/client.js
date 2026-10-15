// -----------------------------------------------------------------------------
// The Kraken GraphQL client of Octopus Energy France.
//
// Sign-in: the `obtainKrakenToken` mutation trades the e-mail and password of
// the customer area for an access token (a JWT of about an hour, sent as
// `Authorization: JWT <token>`) and a refresh token (about a week). The
// refresh token is kept in /data by the caller (`onTokens`), so a restart or
// an expired access token signs in again without the password; the password
// is only sent when there is no valid refresh token.
//
// Errors: Kraken answers HTTP 200 with an `errors` list. An error raised by
// the `obtainKrakenToken` resolver itself (it carries a `path`) is a refusal
// of the credentials; an error without a path is a malformed query (the API
// changed), never reported as a wrong password. KT-CT-1199 is the rate limit.
// An expired access token met during a query signs in again once.
// -----------------------------------------------------------------------------

import { CannotConnectError, InvalidAuthError, RateLimitError } from '../errors.js';
import { ACCOUNT, ACCOUNTS, ENDPOINT, MEASUREMENTS, OBTAIN_TOKEN } from './queries.js';

const TIMEOUT_MS = 30 * 1000;
// Renew the access token this long before it expires.
const EXPIRY_MARGIN_MS = 60 * 1000;
const DEFAULT_ACCESS_MS = 55 * 60 * 1000;
const DEFAULT_REFRESH_MS = 7 * 24 * 3600 * 1000;
const RATE_LIMIT_CODE = 'KT-CT-1199';
// Kraken codes of an invalid or expired token (KT-CT-1111, 1112, 1124…), and
// the words of their messages, in case the codes move.
const TOKEN_CODES = new Set(['KT-CT-1111', 'KT-CT-1112', 'KT-CT-1124']);
const TOKEN_WORDS = /expired|unauthori[sz]ed|authentication|signature|jwt/i;
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

/** The expiry (ms) written in a JWT, or null (the signature is not checked: the server does). */
export function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The codes and messages of a GraphQL error list, short and without data. */
export function describeErrors(errors) {
  return errors
    .map((error) => {
      const code = error?.extensions?.errorCode;
      const message = String(error?.message ?? 'unknown error').slice(0, 120);
      return code ? `${code} ${message}` : message;
    })
    .join('; ');
}

const isRateLimited = (errors) =>
  errors.some(
    (error) =>
      error?.extensions?.errorCode === RATE_LIMIT_CODE ||
      /too many requests/i.test(String(error?.message ?? '')),
  );

const isTokenProblem = (errors) =>
  errors.some(
    (error) =>
      TOKEN_CODES.has(error?.extensions?.errorCode) || TOKEN_WORDS.test(String(error?.message)),
  );

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.endpoint]
 * @param {() => number} [options.now]
 * @param {{ refreshToken: string, refreshExpiresAt: number } | null} [options.saved]
 *   the refresh token saved by a previous run
 * @param {(saved: { refreshToken: string, refreshExpiresAt: number } | null) => Promise<void> | void} [options.onTokens]
 *   called with a new refresh token (null when Octopus refused it)
 */
export function createKrakenClient({
  fetch: fetchImpl = globalThis.fetch,
  endpoint = ENDPOINT,
  now = () => Date.now(),
  saved = null,
  onTokens = () => {},
} = {}) {
  let access = null;
  let accessExpiresAt = 0;
  let refresh = saved?.refreshToken ? { ...saved } : null;
  let requests = 0;

  async function post(query, variables, token) {
    requests += 1;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) {
      headers.Authorization = `JWT ${token}`;
    }
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'no answer within 30 s' : err?.message;
      throw new CannotConnectError(`Octopus is unreachable (${reason ?? 'network error'})`);
    }
    if (response.status === 429) {
      throw new RateLimitError('Octopus asks to slow down (HTTP 429)');
    }
    if (!response.ok) {
      throw new CannotConnectError(`Octopus answered HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new CannotConnectError('Octopus sent an answer that is not JSON');
    }
  }

  async function keep(payload) {
    const token = payload?.token;
    if (typeof token !== 'string' || token === '') {
      return false;
    }
    access = token;
    accessExpiresAt = jwtExpiry(token) ?? now() + DEFAULT_ACCESS_MS;
    if (typeof payload.refreshToken === 'string' && payload.refreshToken !== '') {
      const seconds = Number(payload.refreshExpiresIn);
      refresh = {
        refreshToken: payload.refreshToken,
        refreshExpiresAt:
          now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_REFRESH_MS),
      };
      await onTokens({ ...refresh });
    }
    return true;
  }

  async function obtain(input) {
    const answer = await post(OBTAIN_TOKEN, { input });
    const errors = Array.isArray(answer?.errors) ? answer.errors : [];
    if (isRateLimited(errors)) {
      throw new RateLimitError(`Octopus rate limit reached (${describeErrors(errors)})`);
    }
    if (await keep(answer?.data?.obtainKrakenToken)) {
      return { ok: true };
    }
    return { ok: false, errors };
  }

  /** A valid access token, from the refresh token or else the password. */
  async function authenticate(credentials) {
    if (access && now() < accessExpiresAt - EXPIRY_MARGIN_MS) {
      return access;
    }
    access = null;
    if (refresh && now() < refresh.refreshExpiresAt - EXPIRY_MARGIN_MS) {
      const outcome = await obtain({ refreshToken: refresh.refreshToken });
      if (outcome.ok) {
        return access;
      }
      // Refused (revoked, password changed): forget it, sign in with the password.
      refresh = null;
      await onTokens(null);
    }
    if (!credentials?.email || !credentials?.password) {
      throw new InvalidAuthError('No e-mail address or password configured');
    }
    const outcome = await obtain({ email: credentials.email, password: credentials.password });
    if (outcome.ok) {
      return access;
    }
    const errors = outcome.errors;
    if (errors.length === 0) {
      throw new CannotConnectError('Octopus sent neither a token nor an error');
    }
    if (errors.every((error) => !error?.path)) {
      // Not a refusal: the query itself was rejected.
      throw new CannotConnectError(
        `Octopus rejected the sign-in query (${describeErrors(errors)})`,
      );
    }
    throw new InvalidAuthError(
      `Octopus refused the e-mail address or the password${
        errors.length ? ` (${describeErrors(errors)})` : ''
      }`,
    );
  }

  /** Run a query signed in; signs in again once on an expired token. */
  async function query(credentials, document, variables, retried = false) {
    const token = await authenticate(credentials);
    const answer = await post(document, variables, token);
    const errors = Array.isArray(answer?.errors) ? answer.errors : [];
    if (errors.length > 0) {
      if (isRateLimited(errors)) {
        throw new RateLimitError(`Octopus rate limit reached (${describeErrors(errors)})`);
      }
      if (isTokenProblem(errors) && !retried) {
        access = null;
        return query(credentials, document, variables, true);
      }
      if (!answer?.data) {
        throw new CannotConnectError(`Octopus refused the query (${describeErrors(errors)})`);
      }
    }
    if (!answer?.data) {
      throw new CannotConnectError('Octopus sent an empty answer');
    }
    return answer.data;
  }

  return {
    /** How many HTTP requests were sent (quota tracking, tests). */
    get requests() {
      return requests;
    },

    /** Sign in now (the "test" path of the refresh action). */
    async signIn(credentials) {
      await authenticate(credentials);
    },

    /** @returns {Promise<string[]>} the account numbers of the customer */
    async getAccountNumbers(credentials) {
      const data = await query(credentials, ACCOUNTS, {});
      return (data?.viewer?.accounts ?? [])
        .map((account) => account?.number)
        .filter((number) => typeof number === 'string' && number !== '');
    },

    /** The raw account: ledgers, properties and supply points, agreements and rates. */
    async getAccount(credentials, accountNumber) {
      const data = await query(credentials, ACCOUNT, {
        accountNumber,
        activeAt: new Date(now()).toISOString(),
      });
      if (!data?.account) {
        throw new CannotConnectError('Octopus did not return the account');
      }
      return data.account;
    },

    /**
     * The interval measurements of a supply point, every page.
     * @param {object} credentials
     * @param {object} request
     * @param {string} request.propertyId
     * @param {string} request.supplyPointId the PRM or the PCE
     * @param {'electricity'|'gas'} request.utility
     * @param {'DAY_INTERVAL'|'MONTH_INTERVAL'} request.frequency
     * @param {string} request.from ISO instant
     * @param {string} request.to ISO instant
     */
    async getMeasurements(
      credentials,
      { propertyId, supplyPointId, utility, frequency, from, to },
    ) {
      const filter = { readingFrequencyType: frequency, marketSupplyPointId: supplyPointId };
      if (utility === 'electricity') {
        // Validated readings only: the estimates come back corrected later.
        filter.readingQuality = 'ACTUAL';
      }
      const nodes = [];
      let after = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const data = await query(credentials, MEASUREMENTS, {
          propertyId,
          startAt: from,
          endAt: to,
          utilityFilters: [{ [`${utility}Filters`]: filter }],
          first: PAGE_SIZE,
          after,
        });
        const measurements = data?.property?.measurements ?? {};
        for (const edge of measurements.edges ?? []) {
          if (edge?.node) {
            nodes.push(edge.node);
          }
        }
        if (!measurements.pageInfo?.hasNextPage || !measurements.pageInfo?.endCursor) {
          return nodes;
        }
        after = measurements.pageInfo.endCursor;
      }
      return nodes;
    },
  };
}
