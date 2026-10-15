// -----------------------------------------------------------------------------
// What the integration keeps between restarts, in /data (the only writable
// volume of the container):
//   - the Kraken refresh token (valid about a week), so a restart signs in
//     without sending the password again, keyed by a hash of the e-mail;
//   - per supply point, how far its consumption reached Gladys and the last
//     day a scene was told about.
// The file holds a secret: it is written owner-only (0600), atomically (a
// temporary file renamed over the old one), and never logged. The access
// token (one hour) stays in memory.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const VERSION = 1;

export function emptyState() {
  return { version: VERSION, tokens: {}, meters: {} };
}

/** The key of one sign-in: the e-mail, hashed (no address in the file). */
export function identityOf(email) {
  return createHash('sha256')
    .update(
      `octopus-fr\n${String(email ?? '')
        .trim()
        .toLowerCase()}`,
    )
    .digest('hex')
    .slice(0, 32);
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) {
    return emptyState();
  }
  return {
    version: VERSION,
    tokens: raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {},
    meters: raw.meters && typeof raw.meters === 'object' ? raw.meters : {},
  };
}

/**
 * @param {string} [directory] default: $DATA_DIR, else /data
 */
export function createFileStore(directory = process.env.DATA_DIR || '/data') {
  const path = join(directory, 'octopus-state.json');
  return {
    path,
    async load() {
      try {
        return normalize(JSON.parse(await readFile(path, 'utf8')));
      } catch {
        return emptyState();
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

/** The same contract in memory (tests). */
export function createMemoryStore(initial = emptyState()) {
  let saved = structuredClone(initial);
  return {
    async load() {
      return normalize(structuredClone(saved));
    },
    async save(state) {
      saved = structuredClone(state);
    },
    get saved() {
      return saved;
    },
  };
}
