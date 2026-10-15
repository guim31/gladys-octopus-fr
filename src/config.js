// -----------------------------------------------------------------------------
// The configuration filled in by the user (manifest `config_schema`).
//
// DEFAULT_CONFIG mirrors the manifest defaults (test/manifest.test.js checks
// it); normalizeConfig trims and types what the form sends, so the rest of the
// code never deals with an absent or malformed value.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './i18n.js';

export { LANGUAGES };

/** Days of electricity imported into the energy tracking on the first reading. */
export const HISTORY_DAYS = ['7', '30', '90', '365'];

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  history_days: '30',
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} [raw] the config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const historyDays = HISTORY_DAYS.includes(String(raw.history_days))
    ? String(raw.history_days)
    : DEFAULT_CONFIG.history_days;
  return {
    email: text(raw.email),
    // A password may legitimately start or end with a space: kept as typed.
    password: typeof raw.password === 'string' ? raw.password : '',
    history_days: historyDays,
    historyDays: Number(historyDays),
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language,
  };
}

/** True when a sign-in can be tried. */
export function isConfigured(config) {
  return Boolean(config.email && config.password);
}

/** The values that must never reach a log line. */
export function secretsOf(config) {
  return [config.password, config.email].filter((value) => value && value.length >= 3);
}
