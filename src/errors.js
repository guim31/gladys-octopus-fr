// -----------------------------------------------------------------------------
// The errors of the Octopus Energy France API (Kraken GraphQL).
//
// The cycle decides what to do from the class alone: a refused password is not
// retried (the user must fix the configuration), a rate limit waits an hour,
// anything else is a transient failure retried at the next cycle. Messages
// never carry a credential, a token or an e-mail address: they end up in the
// logs and in the Gladys interface.
// -----------------------------------------------------------------------------

/** Octopus refused the e-mail address or the password. */
export class InvalidAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidAuthError';
  }
}

/** A network error, a server error or an answer that changed: retried later. */
export class CannotConnectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CannotConnectError';
  }
}

/** The Kraken rate limit (error KT-CT-1199): wait before asking again. */
export class RateLimitError extends CannotConnectError {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
  }
}
