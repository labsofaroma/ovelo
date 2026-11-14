import { NextResponse } from "next/server";
import { actionHeaders } from "@/features/baskets/actions-headers";
import { actionsJsonRules } from "@/features/baskets/actions-json";
import { isV1Enabled } from "@/server/env";

export const runtime = "nodejs";
// Read the flag per request (it decides the v1 rule), not once at build time.
export const dynamic = "force-dynamic";

// The chain id stays "devnet" (the prototype default, byte-identical response) until Step 4 of the
// cutover replaces the prototype rules with the mainnet v1 rules and switches it to mainnet.
const ACTIONS_JSON_CHAIN = "devnet" as const;

export function GET() {
  return NextResponse.json(
    { rules: actionsJsonRules(isV1Enabled()) },
    { headers: { ...actionHeaders(ACTIONS_JSON_CHAIN), "Cache-Control": "public, max-age=300" } },
  );
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: actionHeaders(ACTIONS_JSON_CHAIN) });
}
