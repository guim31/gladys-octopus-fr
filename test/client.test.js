// The Kraken client against the fake API: sign-in, refresh token, expired
// access token, refusals, rate limit, network and HTTP errors, pages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKrakenClient, describeErrors, jwtExpiry } from '../src/octopus/client.js';
import { CannotConnectError, InvalidAuthError, RateLimitError } from '../src/errors.js';
import { createKrakenServer, fixture, makeJwt } from './helpers/kraken-server.js';

const NOW = Date.parse('2026-10-14T10:00:00Z');
const CREDENTIALS = { email: 'client@example.com', password: 'bon mot de passe' };

function setup({ saved = null, server: serverOptions = {} } = {}) {
  const clock = { ms: NOW };
  const server = createKrakenServer({
    now: () => clock.ms,
    dataUntil: () => clock.ms - 34 * 3600 * 1000,
    ...serverOptions,
  });
  const tokens = [];
  const client = createKrakenClient({
    fetch: server.fetch,
    now: () => clock.ms,
    saved,
    onTokens: (value) => tokens.push(value),
  });
  return { clock, server, client, tokens };
}

const inputs = (server) =>
  server.requests
    .filter((request) => request.operation === 'obtainKrakenToken')
    .map((request) => Object.keys(request.variables.input).sort().join(','));

test('the JWT expiry is read without checking the signature', () => {
  assert.equal(jwtExpiry(makeJwt(NOW + 3600 * 1000)), NOW + 3600 * 1000);
  assert.equal(jwtExpiry('not-a-jwt'), null);
  assert.equal(
    describeErrors([{ message: 'Too many requests.', extensions: { errorCode: 'KT-CT-1199' } }]),
    'KT-CT-1199 Too many requests.',
  );
});

test('signs in with the password once, then reuses the access token and keeps the refresh token', async () => {
  const { server, client, tokens } = setup();
  assert.deepEqual(await client.getAccountNumbers(CREDENTIALS), ['A-0F1E2D3C']);
  await client.getAccount(CREDENTIALS, 'A-0F1E2D3C');
  assert.deepEqual(inputs(server), ['email,password']);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].refreshToken, 'fake-refresh-token-0001');
  assert.equal(tokens[0].refreshExpiresAt, NOW + 604800 * 1000);
  assert.ok(server.requests.slice(1).every((request) => request.authorization.startsWith('JWT ')));
});

test('an expired access token is renewed from the refresh token, without the password', async () => {
  const { clock, server, client } = setup();
  await client.getAccountNumbers(CREDENTIALS);
  clock.ms += 2 * 3600 * 1000;
  await client.getAccountNumbers(CREDENTIALS);
  assert.deepEqual(inputs(server), ['email,password', 'refreshToken']);
});

test('a refresh token saved by a previous run signs in without the password', async () => {
  const first = setup();
  await first.client.getAccountNumbers(CREDENTIALS);
  const saved = first.tokens.at(-1);
  const { server, client } = setup({ saved });
  server.refreshTokens.add(saved.refreshToken);
  await client.getAccountNumbers({ email: 'client@example.com', password: '' });
  assert.deepEqual(inputs(server), ['refreshToken']);
});

test('a refused refresh token is forgotten and the password is used', async () => {
  const { server, client, tokens } = setup({
    saved: { refreshToken: 'revoked', refreshExpiresAt: NOW + 3600 * 1000 },
  });
  await client.getAccountNumbers(CREDENTIALS);
  assert.deepEqual(inputs(server), ['refreshToken', 'email,password']);
  assert.equal(tokens[0], null, 'the refused token is dropped from /data');
  assert.equal(tokens[1].refreshToken, 'fake-refresh-token-0001');
});

test('an access token refused in the middle of a query signs in again, once', async () => {
  const { server, client } = setup();
  await client.getAccountNumbers(CREDENTIALS);
  server.force.account = [fixture('token-expired.json')];
  const account = await client.getAccount(CREDENTIALS, 'A-0F1E2D3C');
  assert.equal(account.number, 'A-0F1E2D3C');
  assert.deepEqual(inputs(server), ['email,password', 'refreshToken']);
  // Refused again after the new sign-in: an error, not a loop.
  server.force.account = fixture('token-expired.json');
  await assert.rejects(client.getAccount(CREDENTIALS, 'A-0F1E2D3C'), CannotConnectError);
  delete server.force.account;
});

test('a wrong password is an InvalidAuthError; a malformed sign-in query is not', async () => {
  const { client } = setup();
  await assert.rejects(
    client.getAccountNumbers({ email: 'client@example.com', password: 'faux' }),
    (err) => err instanceof InvalidAuthError && /KT-CT-1135/.test(err.message),
  );
  const other = setup();
  other.server.force.obtainKrakenToken = {
    errors: [{ message: 'Unknown argument "input".', locations: [{ line: 2, column: 3 }] }],
  };
  await assert.rejects(other.client.getAccountNumbers(CREDENTIALS), CannotConnectError);
  await assert.rejects(
    setup().client.getAccountNumbers({ email: '', password: '' }),
    InvalidAuthError,
  );
});

test('the rate limit, an HTTP error and the network are told apart', async () => {
  const { server, client } = setup();
  server.force.obtainKrakenToken = fixture('rate-limited.json');
  await assert.rejects(client.getAccountNumbers(CREDENTIALS), RateLimitError);
  server.force.obtainKrakenToken = { status: 429 };
  await assert.rejects(client.getAccountNumbers(CREDENTIALS), RateLimitError);
  server.force.obtainKrakenToken = { status: 502 };
  await assert.rejects(client.getAccountNumbers(CREDENTIALS), /HTTP 502/);
  delete server.force.obtainKrakenToken;
  server.down = true;
  await assert.rejects(client.getAccountNumbers(CREDENTIALS), /unreachable/);
  server.down = false;
  await client.getAccountNumbers(CREDENTIALS);
  server.force.account = fixture('rate-limited.json');
  await assert.rejects(client.getAccount(CREDENTIALS, 'A-0F1E2D3C'), RateLimitError);
});

test('measurements are read page after page, with the filters Kraken expects', async () => {
  const { server, client } = setup();
  const nodes = await client.getMeasurements(CREDENTIALS, {
    propertyId: '100001',
    supplyPointId: '09876543210123',
    utility: 'electricity',
    frequency: 'DAY_INTERVAL',
    from: '2026-01-01T00:00:00+01:00',
    to: new Date(NOW).toISOString(),
  });
  // 1 January to 12 October: 285 days, three pages of 100.
  assert.equal(nodes.length, 285);
  const pages = server.requests.filter((request) => request.operation === 'measurements');
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0].variables.utilityFilters, [
    {
      electricityFilters: {
        readingFrequencyType: 'DAY_INTERVAL',
        marketSupplyPointId: '09876543210123',
        readingQuality: 'ACTUAL',
      },
    },
  ]);
  assert.deepEqual(
    pages.map((page) => page.variables.after),
    [null, '100', '200'],
  );
  await client.getMeasurements(CREDENTIALS, {
    propertyId: '100001',
    supplyPointId: '21987654321098',
    utility: 'gas',
    frequency: 'DAY_INTERVAL',
    from: '2026-10-01T00:00:00+02:00',
    to: new Date(NOW).toISOString(),
  });
  assert.deepEqual(server.requests.at(-1).variables.utilityFilters, [
    {
      gasFilters: {
        readingFrequencyType: 'DAY_INTERVAL',
        marketSupplyPointId: '21987654321098',
      },
    },
  ]);
});
