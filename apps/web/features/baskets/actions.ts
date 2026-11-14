import "server-only";
import {
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import type {
  ActionGetResponse,
  ActionPostResponse,
  CompletedAction,
} from "@solana/actions";
import { z } from "zod";
import { lookupCreatorBasket } from "@/features/creators/basket-page";
import { getMarkets } from "@/features/markets/server";
import {
  base58Address,
  decimalAmount,
  USDC_MINT,
} from "@/features/trade/schema";
import { creatorBasketId } from "@/features/trade/server/creator-target";
import type { PreparedQuote } from "@/features/trade/server/quote";
import type { MainnetRpc } from "@/features/trade/server/rpc";
import { receiptRows, type ReceiptWriter } from "@/features/trade/server/store";
import { openAuthorization, type TradeKeyring } from "@/server/auth/trade";
import { messageHash } from "@/server/auth/trade-transactions";
import { AppError } from "@/server/errors";
import { routes } from "@/features/shared/routes";

/**
 * Solana Actions for v1 baskets (M5b B4, port of lib/server/basket-buy-actions.ts). There is no
 * separate trade logic: POST quotes through M4's quoteTrade (the same target rules, routes,
 * simulation and HMAC authorization as the trade ticket) and returns the unsigned transaction
 * for the `account` in the body. The wallet signs and sends it; Aroma never holds a key.
 *
 * Receipts: the Blink client sends the transaction itself, so /api/v1/trade/submit never sees
 * it. The POST response chains a `links.next` POST callback carrying the authorization; after
 * the transaction confirms, the client posts `{ account, signature }` there and the server
 * records a receipt only after reading the transaction from mainnet and matching it to the
 * authorized message hash, fee payer and wallet. A client that does not call back is not
 * counted (never guessed).
 *
 * Paths: /api/v1/actions/baskets/:id (gated by AROMA_V1_ENABLED). The prototype's
 * /api/actions/* paths are untouched until M7, when this moves to /api/actions/baskets/:id
 * and actions.json maps /basket/* to it (docs/M4-DEPLOY.md, M5 section).
 */

export const ACTION_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/** How long after a quote expires its purchase may still be recorded (confirmation lag). */
export const CONFIRM_GRACE_MS = 15 * 60_000;

export type ActionBasket = { id: string; name: string; ticker: string };

/** A curated basket (catalog snapshot) or a PUBLISHED creator basket; anything else is 404. */
export async function resolveActionBasket(id: string): Promise<ActionBasket> {
  const creatorId = creatorBasketId(id);
  if (creatorId) {
    const basket = await lookupCreatorBasket(creatorId);
    if (basket === "unavailable")
      throw new AppError("SERVICE_UNAVAILABLE", { detail: "registry down" });
    if (!basket || basket.status !== "published")
      throw new AppError("NOT_FOUND", {
        publicMessage: "This basket is not published.",
        detail: `creator basket ${basket?.status ?? "missing"}`,
      });
    return { id: basket.id, name: basket.name, ticker: basket.ticker };
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
    throw new AppError("NOT_FOUND", { detail: "bad basket id" });
  const markets = await getMarkets();
  if (markets.state !== "ok")
    throw new AppError("UPSTREAM_UNAVAILABLE", { detail: "catalog down" });
  const basket = markets.data.baskets.find((b) => b.id === id);
  if (!basket) throw new AppError("NOT_FOUND", { detail: "unknown basket" });
  return { id: basket.id, name: basket.name, ticker: basket.ticker };
}

export function actionHref(origin: string, id: string, path = ""): string {
  return `${origin}/api/v1/actions/baskets/${encodeURIComponent(id)}${path}`;
}

export function actionMetadata(
  basket: ActionBasket,
  origin: string,
): ActionGetResponse {
  return {
    type: "action",
    icon: `${origin}/v1/og.png`,
    title: `Buy ${basket.name} (${basket.ticker}) · Mainnet spot purchase`,
    description:
      "Buy the whole basket once with mainnet USDC, in one transaction your wallet signs. Constituent tokens settle to your wallet. Maximum slippage is 1%; SOL is needed for network fees and account rent. If the basket needs more than one transaction, buy it on Aroma instead. No partial basket is ever bought.",
    label: "Buy basket",
    links: {
      actions: [
        {
          type: "transaction",
          label: "Buy with USDC",
          href: `${actionHref(origin, basket.id)}?amount={amount}`,
          parameters: [
            {
              name: "amount",
              label: "USDC to invest",
              type: "number",
              required: true,
              min: 0.000001,
            },
          ],
        },
      ],
    },
  };
}

const postBodySchema = z.strictObject({
  account: base58Address,
  // Clients may send an empty `data` object; nothing else is accepted.
  data: z.strictObject({}).optional(),
  type: z.literal("transaction").optional(),
});

/** `?amount=` (USDC, at most six decimals) and the `account` that will sign and pay. */
export function parseActionPost(search: URLSearchParams, body: unknown) {
  for (const key of search.keys())
    if (key !== "amount" || search.getAll(key).length !== 1)
      throw new AppError("VALIDATION_FAILED", {
        publicMessage: "Unexpected or duplicate purchase parameter.",
        detail: `param ${key}`,
      });
  const amount = decimalAmount
    .refine((value) => !/\.\d{7,}$/.test(value), "six decimals")
    .safeParse(search.get("amount") ?? "");
  if (!amount.success)
    throw new AppError("VALIDATION_FAILED", {
      publicMessage:
        "Choose a USDC amount above zero with at most six decimal places.",
      detail: "amount",
    });
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: "Provide the wallet account buying this basket.",
      detail: "body",
    });
  return { account: parsed.data.account, amount: amount.data };
}

/** The quote request a v1 Action makes: USDC in, V0 transactions (what Blink clients sign). */
export function actionQuoteRequest(
  id: string,
  input: { account: string; amount: string },
) {
  return {
    target: { kind: "basket" as const, basketId: id },
    inputMint: USDC_MINT,
    amount: input.amount,
    taker: input.account,
    slippageBps: 100,
    supportedTransactionVersions: [0 as const],
  };
}

export function actionTransaction(
  prepared: PreparedQuote,
  basket: ActionBasket,
  origin: string,
): ActionPostResponse {
  if (prepared.mode !== "single" || prepared.transactions.length !== 1)
    throw new AppError("BUNDLE_UNAVAILABLE", {
      publicMessage: `This basket needs more than one transaction right now. Review and buy it at ${origin}${routes.basket(basket.id)}. Nothing was submitted.`,
      detail: "action needs a bundle",
    });
  const minimums = prepared.quote.legs
    .map((leg) => `${leg.symbol} (raw minimum ${leg.minimumAmount})`)
    .join(", ");
  return {
    type: "transaction",
    transaction: prepared.transactions[0]!,
    message: `Mainnet spot purchase of ${basket.name}: up to ${prepared.quote.maxDebit} raw USDC units (${prepared.quote.inAmount} plus the reviewed buffer). Maximum slippage 1%. Minimum outputs: ${minimums}. Network fees and account rent also apply. Sign promptly; the quote expires in about a minute.`,
    links: {
      next: {
        type: "post",
        href: `${actionHref(origin, basket.id, "/confirm")}?authorization=${encodeURIComponent(prepared.authorization)}`,
      },
    },
  };
}

export type ConfirmDeps = {
  keyring: TradeKeyring;
  rpc: MainnetRpc;
  receipts: ReceiptWriter;
  now: () => number;
};

type RpcTransaction = {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown } | null;
  transaction: [string, string];
} | null;

const confirmBodySchema = z.strictObject({
  account: base58Address,
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
});

/**
 * The `links.next` callback: record a receipt for a purchase made through the Action, but only
 * for the transaction this server authorized, read back from mainnet: same message hash, fee
 * payer and wallet as the authorization, and the signature the client named.
 */
export async function recordActionPurchase(
  input: { basketId: string; authorization: string | null; body: unknown },
  deps: ConfirmDeps,
): Promise<{ status: "confirmed" | "failed" }> {
  const body = confirmBodySchema.safeParse(input.body);
  if (!body.success)
    throw new AppError("VALIDATION_FAILED", { detail: "confirm body" });
  const payload = openAuthorization(input.authorization, deps.keyring, {
    allowExpired: true,
  });
  if (deps.now() > payload.expiresAt + CONFIRM_GRACE_MS)
    throw new AppError("QUOTE_EXPIRED", { detail: "confirm too late" });
  if (
    payload.taker !== body.data.account ||
    payload.receipt.kind !== "basket" ||
    payload.receipt.basketId !==
      (creatorBasketId(input.basketId) ?? input.basketId) ||
    payload.messageHashes.length !== 1
  )
    throw new AppError("AUTHORIZATION_INVALID", { detail: "confirm mismatch" });
  const found = await deps.rpc<RpcTransaction>("getTransaction", [
    body.data.signature,
    {
      encoding: "base64",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    },
  ]);
  if (!found)
    throw new AppError("CONFLICT", {
      publicMessage:
        "The transaction is not confirmed yet. Try again in a few seconds.",
      detail: "not confirmed",
    });
  const transaction = getTransactionDecoder().decode(
    Buffer.from(found.transaction[0], "base64"),
  );
  const message = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  );
  const feePayer = message.staticAccounts[0];
  const signature = feePayer ? transaction.signatures[feePayer] : null;
  if (
    messageHash(transaction.messageBytes) !== payload.messageHashes[0] ||
    feePayer !== payload.taker ||
    !signature ||
    getBase58Decoder().decode(signature) !== body.data.signature
  )
    throw new AppError("TRANSACTION_MISMATCH", {
      detail: "transaction mismatch",
    });
  const status = found.meta && found.meta.err === null ? "confirmed" : "failed";
  await deps.receipts.insertPending(
    receiptRows({
      id: payload.requestId,
      taker: payload.taker,
      signatures: [body.data.signature],
      receipt: payload.receipt,
    }),
  );
  await deps.receipts.mark([body.data.signature], {
    status,
    slot: BigInt(found.slot),
    blockTime:
      found.blockTime === null ? null : new Date(found.blockTime * 1000),
  });
  return { status };
}

export function completedAction(
  origin: string,
  status: "confirmed" | "failed",
): CompletedAction {
  return {
    type: "completed",
    icon: `${origin}/v1/og.png`,
    title:
      status === "confirmed" ? "Basket purchase confirmed" : "Purchase failed",
    description:
      status === "confirmed"
        ? "Confirmed on Solana mainnet. The tokens are in your wallet."
        : "The transaction failed on-chain. No basket was bought; network fees may apply.",
    label: status === "confirmed" ? "Confirmed" : "Failed",
  };
}
