// /data/octopus-state.json: owner-only, atomic, tolerant of a missing or
// foreign file, and keyed by a hash (no e-mail address in the file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore, emptyState, identityOf } from '../src/store.js';

test('the state is saved owner-only and read back; a missing or foreign file is a new state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-store-'));
  try {
    const store = createFileStore(directory);
    assert.deepEqual(await store.load(), emptyState());
    const state = {
      version: 1,
      tokens: { [identityOf('Client@Example.com ')]: { refreshToken: 'r', refreshExpiresAt: 1 } },
      meters: { '09876543210123': { fedUntil: '2026-10-12', announced: '2026-10-12' } },
    };
    await store.save(state);
    assert.deepEqual(await store.load(), state);
    if (process.platform !== 'win32') {
      assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    }
    const text = await readFile(store.path, 'utf8');
    assert.doesNotMatch(text, /example\.com/i);
    assert.equal(identityOf('client@example.com'), identityOf(' CLIENT@example.com'));
    await writeFile(store.path, '{"version":99}');
    assert.deepEqual(await store.load(), emptyState());
    await writeFile(store.path, 'not json');
    assert.deepEqual(await store.load(), emptyState());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
