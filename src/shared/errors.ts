/**
 * Every error the SDK throws on purpose is a {@link StealthError}. Each one carries a `code`: a stable string you can switch on.
 * SDK-side problems use the codes in {@link STEALTH_ERROR_CODES}; an {@link StealthApiError} carries the API's own code instead,
 * such as `invalid_request`, `not_found` or `rate_limited`.
 *
 * ```ts
 * try {
 *   await stealth.sol.tokens.get(mint);
 * } catch (error) {
 *   if (isStealthError(error, "not_found")) console.log("No such coin");
 *   else throw error;
 * }
 * ```
 *
 * @module
 */

/** The codes the SDK itself raises. API errors carry the API's code, which is any string. */
export const STEALTH_ERROR_CODES = {
  /** Base class, without a more precise code. */
  error: "stealth_error",
  /** The SDK refused an input before it reached the chain or the API. */
  input: "invalid_input",
  /** A trade would pay more than `maxFeeBps`. */
  feeTooHigh: "fee_too_high",
  /** A transaction built by the API wasn't what was asked for, so it wasn't signed. */
  transactionMismatch: "transaction_mismatch",
  /** A browser page on another site tried to write to the official API. */
  browserWrite: "browser_write_blocked",
  /** The request never got an answer: DNS, TLS, connection reset, offline. */
  network: "network_error",
  /** The request took longer than its timeout. */
  timeout: "timeout",
  /** The caller's `AbortSignal` fired. */
  aborted: "aborted",
  /** The API answered with something that isn't the JSON it should be. */
  invalidResponse: "invalid_response",
  /** The live stream couldn't connect, or closed for good. */
  websocket: "websocket_error",
  /** The environment lacks something the call needs, such as a WebSocket implementation. */
  unsupported: "unsupported",
  /** A transaction failed on chain or wasn't confirmed in time. */
  transaction: "transaction_failed",
} as const;

export type StealthErrorCode = (typeof STEALTH_ERROR_CODES)[keyof typeof STEALTH_ERROR_CODES];

export interface StealthErrorOptions {
  /** Overrides the class's default code. */
  code?: string;
  /** The underlying error, if any. */
  cause?: unknown;
}

/** Marks the SDK's errors, so {@link isStealthError} knows them even from another copy of the SDK in the same process. */
const BRAND = Symbol.for("juststealthit.sdk.error");

/** Base class of everything this SDK throws on purpose. */
export class StealthError extends Error {
  /** @internal */
  readonly [BRAND] = true;
  /** A stable, machine-readable code. See {@link STEALTH_ERROR_CODES}. */
  readonly code: string;

  constructor(message: string, opts: StealthErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code ?? (new.target as unknown as { defaultCode?: string }).defaultCode ?? STEALTH_ERROR_CODES.error;
  }

  /** Whether trying again later could succeed. */
  get retryable(): boolean {
    return false;
  }
}

/** A value the SDK refused before it reached the chain or the API. */
export class StealthInputError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.input;
}

/** The trade would pay more than `maxFeeBps`: most often, it's inside a coin's first 15 seconds. */
export class StealthFeeTooHighError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.feeTooHigh;
  constructor(
    /** What the trade would pay right now, in bps. */
    readonly feeBps: number,
    /** The limit it was checked against, in bps. */
    readonly maxFeeBps: number,
  ) {
    super(`This trade pays ${feeBps / 100}% right now, above the ${maxFeeBps / 100}% limit. Wait out the anti-sniper window, or raise maxFeeBps.`);
  }

  override get retryable(): boolean {
    return true;
  }
}

/** A transaction from the API didn't match what was asked for, so it wasn't signed. */
export class StealthTransactionMismatchError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.transactionMismatch;
}

/** A transaction failed on chain, or wasn't confirmed before the SDK stopped waiting. */
export class StealthTransactionError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.transaction;
  constructor(
    message: string,
    /** The signature or hash, when there is one. */
    readonly signature: string | null = null,
    opts: StealthErrorOptions = {},
  ) {
    super(message, opts);
  }
}

/** Where a request went, for logs and support. */
export interface RequestInfo {
  method: string;
  url: string;
  /** The id the SDK sent as `x-request-id`, or the one the API answered with. */
  requestId: string | null;
  /** 1 for the first try. */
  attempt: number;
}

/** The API's error JSON: `{ error: "<code>", message?, issues?, retryAfterSec? }`. */
export class StealthApiError extends StealthError {
  /** The request's id, method and URL, when known. */
  readonly request: RequestInfo | null;

  constructor(
    /** HTTP status. */
    readonly status: number,
    /** The API's stable machine code, such as `invalid_request`, `not_found` or `rate_limited`. */
    code: string,
    message: string,
    /** Validation problems, on `invalid_request`. */
    readonly issues: { path: string; message: string }[] = [],
    /** Seconds to wait, on a 429. */
    readonly retryAfterSec: number | null = null,
    request: RequestInfo | null = null,
  ) {
    super(message, { code });
    this.request = request;
  }

  /** The request id, if the SDK sent one. Quote it when you report a problem. */
  get requestId(): string | null {
    return this.request?.requestId ?? null;
  }

  /** 408, 425, 429 and 5xx can pass on a later try. */
  override get retryable(): boolean {
    return this.status === 408 || this.status === 425 || this.status === 429 || this.status >= 500;
  }
}

/**
 * The official API answers cross-origin writes only for its own site. A browser page elsewhere would fail with an opaque CORS error,
 * so the SDK says why instead.
 */
export class StealthBrowserWriteError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.browserWrite;
  constructor() {
    super(
      "The official API refuses writes from other sites' browser pages (CORS). Call this from a server, or pass `apiUrl` pointing at your own backend that forwards to it. Reads work from anywhere.",
    );
  }
}

/** The request never got an answer. */
export class StealthNetworkError extends StealthError {
  static readonly defaultCode: string = STEALTH_ERROR_CODES.network;
  constructor(
    message: string,
    readonly request: RequestInfo | null = null,
    opts: StealthErrorOptions = {},
  ) {
    super(message, opts);
  }
  override get retryable(): boolean {
    return true;
  }
}

/** The request took longer than `timeoutMs`. */
export class StealthTimeoutError extends StealthNetworkError {
  constructor(
    readonly timeoutMs: number,
    request: RequestInfo | null = null,
  ) {
    super(`The API didn't answer within ${timeoutMs} ms.`, request, { code: STEALTH_ERROR_CODES.timeout });
  }
}

/** The caller's `AbortSignal` fired. Never retried. */
export class StealthAbortError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.aborted;
  constructor(opts: StealthErrorOptions = {}) {
    super("The request was aborted.", opts);
  }
}

/** The API answered, but not with JSON. */
export class StealthParseError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.invalidResponse;
  constructor(
    message = "The API sent something that isn't JSON.",
    readonly request: RequestInfo | null = null,
  ) {
    super(message);
  }
}

/** The live stream failed to connect, or gave up reconnecting. */
export class StealthWebSocketError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.websocket;
}

/** Something the call needs is missing from this environment. */
export class StealthUnsupportedError extends StealthError {
  static readonly defaultCode = STEALTH_ERROR_CODES.unsupported;
}

/**
 * Narrows `error` to a {@link StealthError}, optionally with a given code.
 *
 * ```ts
 * if (isStealthError(e, "rate_limited")) await sleep(e.retryAfterSec * 1000);
 * ```
 */
export function isStealthError(error: unknown, code?: string): error is StealthError & { retryAfterSec?: number | null } {
  // `instanceof` fails across two installed copies of the SDK (an app and a tool built on it, say); the brand doesn't
  const ours = error instanceof StealthError || (typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[BRAND] === true);
  return ours && (code === undefined || (error as StealthError).code === code);
}
