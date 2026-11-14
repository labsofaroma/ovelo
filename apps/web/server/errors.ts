import { ZodError } from "zod";

/**
 * Stable, client-safe error codes. Add codes; never rename or reuse them (clients switch on them).
 * Internal details (RPC failures, SQL, keypair parsing, stack traces) go to logs, never to clients.
 */
export const ERROR_CODES = {
  BAD_REQUEST: { status: 400, message: "The request could not be processed." },
  VALIDATION_FAILED: { status: 400, message: "The request is invalid." },
  INVALID_JSON: {
    status: 400,
    message: "The request body must be valid JSON.",
  },
  UNAUTHORIZED: { status: 401, message: "Authentication is required." },
  FORBIDDEN: { status: 403, message: "This action is not allowed." },
  NOT_FOUND: { status: 404, message: "The resource was not found." },
  CONFLICT: {
    status: 409,
    message: "The request conflicts with the current state.",
  },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request body is too large." },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: "Send an application/json request.",
  },
  RATE_LIMITED: {
    status: 429,
    message: "Too many requests. Please wait and try again.",
  },
  WRONG_CLUSTER: {
    status: 503,
    message: "The network is temporarily unavailable.",
  },
  UPSTREAM_UNAVAILABLE: {
    status: 502,
    message: "An upstream service is unavailable.",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "This service is temporarily unavailable.",
  },
  INTERNAL: { status: 500, message: "Something went wrong." },
  // Trading (M4). Messages are fixed; details stay in logs.
  ORIGIN_FORBIDDEN: {
    status: 403,
    message: "This browser origin is not allowed.",
  },
  TRADING_UNAVAILABLE: {
    status: 503,
    message: "Trading is temporarily unavailable on this deployment.",
  },
  WALLET_UNSUPPORTED: {
    status: 422,
    message:
      "Connect a wallet that can sign Solana v0 or v1 transactions to trade.",
  },
  ASSET_UNAVAILABLE: {
    status: 422,
    message: "This asset or basket is not tradable right now.",
  },
  ROUTE_UNAVAILABLE: {
    status: 422,
    message:
      "No safe route is available for this order right now. Try a smaller amount or another funding token.",
  },
  INSUFFICIENT_FUNDS: {
    status: 422,
    message:
      "Your wallet does not hold enough for this order, including network fees, account rent and the reviewed allowance.",
  },
  SIMULATION_FAILED: {
    status: 422,
    message:
      "The transaction failed its mainnet simulation, so it was not offered for signing.",
  },
  QUOTE_EXPIRED: {
    status: 410,
    message: "This quote expired. Request a new quote.",
  },
  BLOCKHASH_EXPIRED: {
    status: 410,
    message: "The transaction's blockhash expired. Request a new quote.",
  },
  AUTHORIZATION_INVALID: {
    status: 403,
    message: "This trade authorization is not valid. Request a new quote.",
  },
  TRANSACTION_MISMATCH: {
    status: 409,
    message:
      "The signed transactions differ from the reviewed ones. Request a new quote.",
  },
  SIGNATURE_INVALID: {
    status: 400,
    message:
      "A valid wallet signature is required on every reviewed transaction.",
  },
  TRANSACTION_FAILED: {
    status: 422,
    message:
      "The transaction failed on chain; its asset changes were rolled back. Network fees may still apply.",
  },
  BUNDLE_UNAVAILABLE: {
    status: 422,
    message:
      "This basket needs several transactions and bundle submission is not available. No partial order was created.",
  },
  // M7: recurring investing on devnet and the devnet faucet.
  INVEST_UNAVAILABLE: {
    status: 503,
    message:
      "Recurring investing is not available on devnet yet. Nothing was created.",
  },
  CAPTCHA_FAILED: {
    status: 403,
    message: "The human check did not pass. Complete it and try again.",
  },
  FAUCET_LIMITED: {
    status: 429,
    message:
      "This wallet or network already claimed test tokens recently. Try again later.",
  },
  FAUCET_EXHAUSTED: {
    status: 503,
    message:
      "The test faucet has handed out today's budget. Try again tomorrow (UTC).",
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** What a client may see. Nothing else is ever serialised from an error. */
export type PublicError = { code: ErrorCode; message: string };

export type MappedError = { status: number; body: PublicError };

/**
 * An error whose `code` and `publicMessage` are safe to show. `cause` and `detail` are for logs
 * only. Construct with a fixed message; never interpolate user input or upstream error text.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly publicMessage: string;
  readonly detail: string | undefined;

  constructor(
    code: ErrorCode,
    options: { publicMessage?: string; detail?: string; cause?: unknown } = {},
  ) {
    super(
      options.detail ?? options.publicMessage ?? ERROR_CODES[code].message,
      {
        cause: options.cause,
      },
    );
    this.name = "AppError";
    this.code = code;
    this.publicMessage = options.publicMessage ?? ERROR_CODES[code].message;
    this.detail = options.detail;
  }
}

const SAFE_PATH = /^[A-Za-z0-9_.[\]-]{1,64}$/;

function describeZodIssues(error: ZodError): string {
  const fields = [
    ...new Set(
      error.issues
        .map((issue) => issue.path.map(String).join("."))
        .filter((path) => path.length > 0 && SAFE_PATH.test(path)),
    ),
  ].slice(0, 5);
  return fields.length
    ? `The request is invalid: ${fields.join(", ")}.`
    : ERROR_CODES.VALIDATION_FAILED.message;
}

/** Map any thrown value to a client-safe `{ status, body: { code, message } }`. */
export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return {
      status: ERROR_CODES[error.code].status,
      body: { code: error.code, message: error.publicMessage },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: ERROR_CODES.VALIDATION_FAILED.status,
      body: { code: "VALIDATION_FAILED", message: describeZodIssues(error) },
    };
  }
  return {
    status: ERROR_CODES.INTERNAL.status,
    body: { code: "INTERNAL", message: ERROR_CODES.INTERNAL.message },
  };
}
