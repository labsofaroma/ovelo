import { NextResponse } from "next/server";
import { actionHeaders } from "@/features/baskets/actions-headers";
import { actionsJsonRules } from "@/features/baskets/actions-json";

export const runtime = "nodejs";
// Read the flag per request (it decides the v1 rule), not once at build time.
export const dynamic = "force-dynamic";

// v1 Actions are mainnet spot purchases (M9 Step 3: the prototype's devnet rules are gone).
const ACTIONS_JSON_CHAIN = "mainnet" as const;

export function GET() {
  return NextResponse.json(
    { rules: actionsJsonRules() },
    {
      headers: {
        ...actionHeaders(ACTIONS_JSON_CHAIN),
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: actionHeaders(ACTIONS_JSON_CHAIN),
  });
}
