import type {
  FaucetResponse,
  PlansResponse,
  PrepareCreateRequest,
  PreparedTransaction,
  SubmitResponse,
} from "./schema";

/**
 * Client fetchers for /api/v1/plans and /api/v1/faucet. A non-2xx answer becomes an
 * InvestApiError carrying the server's user-safe `{ code, message }`, nothing else.
 */
export class InvestApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new InvestApiError(
      "NETWORK",
      "The network request failed. Check your connection and try again.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null || typeof body !== "object") {
    const error = body as { code?: unknown; message?: unknown } | null;
    throw new InvestApiError(
      typeof error?.code === "string" ? error.code : "INTERNAL",
      typeof error?.message === "string"
        ? error.message
        : "Something went wrong.",
    );
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const investApi = {
  plans: (owner: string) =>
    call<PlansResponse>(`/api/v1/plans?owner=${encodeURIComponent(owner)}`),
  prepareCreate: (request: PrepareCreateRequest) =>
    call<PreparedTransaction>("/api/v1/plans/prepare-create", post(request)),
  prepareClose: (plan: string, owner: string) =>
    call<PreparedTransaction>(
      `/api/v1/plans/${encodeURIComponent(plan)}/prepare-close`,
      post({ owner }),
    ),
  submit: (authorization: string, transaction: string) =>
    call<SubmitResponse>(
      "/api/v1/plans/submit",
      post({ authorization, transaction }),
    ),
  faucet: (body: {
    wallet: string;
    turnstileToken: string;
    issuedAt: string;
    signature: string;
  }) => call<FaucetResponse>("/api/v1/faucet", post(body)),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
