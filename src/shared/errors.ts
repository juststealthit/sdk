/** Base class of everything this SDK throws on purpose. */
export class StealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A value the SDK refused before it reached the chain or the API. */
export class StealthInputError extends StealthError {}

/** The trade would pay more than `maxFeeBps`: most often, it's inside a coin's first 15 seconds. */
export class StealthFeeTooHighError extends StealthError {
  constructor(
    readonly feeBps: number,
    readonly maxFeeBps: number,
  ) {
    super(`This trade pays ${feeBps / 100}% right now, above the ${maxFeeBps / 100}% limit. Wait out the anti-sniper window, or raise maxFeeBps.`);
  }
}

/** A transaction from the API didn't match what was asked for, so it wasn't signed. */
export class StealthTransactionMismatchError extends StealthError {}

/** The API's error JSON: `{ error: "<code>", message?, issues?, retryAfterSec? }`. */
export class StealthApiError extends StealthError {
  constructor(
    /** HTTP status. */
    readonly status: number,
    /** The API's stable machine code, such as `invalid_request` or `rate_limited`. */
    readonly code: string,
    message: string,
    /** Validation problems, on `invalid_request`. */
    readonly issues: { path: string; message: string }[] = [],
    /** Seconds to wait, on a 429. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
  }
}

/**
 * The official API answers cross-origin writes only for its own site. A browser page elsewhere would fail with an opaque CORS error,
 * so the SDK says why instead.
 */
export class StealthBrowserWriteError extends StealthError {
  constructor() {
    super(
      "The official API refuses writes from other sites' browser pages (CORS). Call this from a server, or pass `apiUrl` pointing at your own backend that forwards to it. Reads work from anywhere.",
    );
  }
}
