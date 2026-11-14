import { NextResponse } from "next/server";
import { actionHeaders } from "@/features/baskets/actions-headers";
import { ERROR_CODES } from "./errors";

/**
 * M9 cutover: the prototype's API routes are deleted. Their paths answer 410
 * `{ code: "GONE", message }` (not a 404), so an old client or a Blink already shared knows the
 * endpoint is gone for good. The old Action paths (/api/actions/*) also carry the Solana Actions
 * headers, so a Blink client can show the message. /api/v1 is never matched.
 */
export const GONE_API_PREFIXES = [
  "actions",
  "baskets",
  "bundles",
  "buy-basket",
  "creators",
  "faucet",
  "health",
  "markets",
  "news",
  "portfolio",
  "recurring",
  "research",
  "tokens",
  "trade",
  "transaction",
] as const;

const GONE = new RegExp(`^/api/(${GONE_API_PREFIXES.join("|")})(/|$)`);

/** Whether a (normalised) path is a removed prototype API. */
export function isGonePath(pathname: string): boolean {
  return GONE.test(pathname);
}

export function goneResponse(pathname: string): NextResponse {
  const { status, message } = ERROR_CODES.GONE;
  const action =
    pathname.startsWith("/api/actions/") || pathname === "/api/actions";
  return NextResponse.json(
    { code: "GONE", message },
    {
      status,
      headers: {
        ...(action ? actionHeaders() : {}),
        "Cache-Control": "no-store",
      },
    },
  );
}
