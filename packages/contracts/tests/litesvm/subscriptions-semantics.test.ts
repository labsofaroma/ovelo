/**
 * M8 decision 2: the upstream Subscriptions rules Ovelo Guard relies on, tested on the binary
 * directly (no Ovelo program involved). Run twice by `test:litesvm:subscriptions-mainnet`: with
 * the pinned devnet binary and with mainnet's (`OVELO_V1_SUBSCRIPTIONS=mainnet`).
 *
 * - `validate_recurring_transfer`: at most `amount_per_period` per period, no carry-over, nothing
 *   before the start or after the expiry, period boundaries on the delegation's grid.
 * - the same-slot `init_id` sentinel (`UNKNOWN_INIT_ID`) used by the 1-step create flow, and a
 *   stale `init_id` refused.
 * - the delegatee must sign.
 */
import { describe, expect, test } from "vitest";
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import {
  UNKNOWN_INIT_ID,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  getCreateRecurringDelegationInstruction,
  getInitSubscriptionAuthorityInstruction,
  getTransferRecurringInstructionAsync,
} from "@solana/subscriptions";
import * as v1 from "@ovelo/guard";
import { Env, START } from "./harness";

const DAY = 86_400n;
// Upstream error codes (@solana/subscriptions 0.5.0).
const EXCEEDS_PERIOD_LIMIT = 400;
const EXPIRED = 128;
const STALE_AUTHORITY = 136;
const UNAUTHORIZED = 130;
const PER_PERIOD = 20_000_000n;

async function setup(o: { initId?: bigint } = {}) {
  const env = await Env.create(null);
  const [owner, delegatee] = [await env.signer(), await env.signer()];
  const admin = await generateKeyPairSigner();
  const usd = (await generateKeyPairSigner()).address;
  env.classicMint(usd, 6, admin.address);
  const ownerUsd = await env.classicAta(owner.address, usd, 1_000_000_000n);
  const receiver = await env.classicAta(delegatee.address, usd, 0n);
  const [authority] = await findSubscriptionAuthorityPda({
    user: owner.address,
    tokenMint: usd,
  });
  const [delegation] = await findRecurringDelegationPda({
    subscriptionAuthority: authority,
    delegator: owner.address,
    delegatee: delegatee.address,
    nonce: 1n,
  });
  const create = await env.trySend(owner, [
    getInitSubscriptionAuthorityInstruction({
      owner,
      subscriptionAuthority: authority,
      tokenMint: usd,
      userAta: ownerUsd,
      tokenProgram: v1.TOKEN_PROGRAM_ID,
    }),
    getCreateRecurringDelegationInstruction({
      delegator: owner,
      subscriptionAuthority: authority,
      delegationAccount: delegation,
      delegatee: delegatee.address,
      recurringDelegation: {
        nonce: 1n,
        amountPerPeriod: PER_PERIOD,
        periodLengthS: DAY,
        startTs: START,
        expiryTs: START + 3n * DAY,
        expectedSubscriptionAuthorityInitId: o.initId ?? UNKNOWN_INIT_ID,
      },
    }),
  ]);
  const pull = async (amount: bigint, signer: KeyPairSigner = delegatee) =>
    env.trySend(signer, [
      await getTransferRecurringInstructionAsync({
        delegationPda: delegation,
        subscriptionAuthority: authority,
        delegatorAta: ownerUsd,
        receiverAta: receiver,
        tokenMint: usd,
        tokenProgram: v1.TOKEN_PROGRAM_ID,
        delegatee: signer,
        transferData: { amount, delegator: owner.address, mint: usd },
      }),
    ]);
  return { env, create, pull, receiver, owner };
}

/** Upstream custom error from the logs ("custom program error: 0x…"), as a number. */
const code = (r: { ok: boolean; error: string; logs: string[] }) => {
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(
    [r.error, ...r.logs].join("\n"),
  );
  return r.ok ? "ok" : m ? Number.parseInt(m[1]!, 16) : r.error;
};

const label =
  process.env.OVELO_V1_SUBSCRIPTIONS === "mainnet" ? "mainnet" : "devnet";

describe(`Subscriptions rules Ovelo relies on (${label} binary)`, () => {
  test("1-step create: the same-slot sentinel is accepted; a stale init_id is refused", async () => {
    expect((await setup()).create.ok).toBe(true);
    const stale = await setup({ initId: 12_345n });
    expect(code(stale.create)).toBe(STALE_AUTHORITY);
  });

  test("at most amount_per_period per period, with no carry-over", async () => {
    const s = await setup();
    expect(s.create.ok, s.create.logs.join("\n")).toBe(true);
    expect((await s.pull(PER_PERIOD / 2n)).ok).toBe(true);
    expect((await s.pull(PER_PERIOD / 2n)).ok).toBe(true);
    expect(code(await s.pull(1n))).toBe(EXCEEDS_PERIOD_LIMIT); // allowance spent
    s.env.setClock(START + DAY + 1n);
    // Period 0's unused allowance never carries over (nothing was left, and never more than one
    // period's worth at once).
    expect(code(await s.pull(PER_PERIOD + 1n))).toBe(EXCEEDS_PERIOD_LIMIT);
    expect((await s.pull(PER_PERIOD)).ok).toBe(true);
    s.env.setClock(START + 2n * DAY + 5n);
    expect((await s.pull(PER_PERIOD)).ok).toBe(true);
    expect(s.env.tokenAmount(s.receiver)).toBe(3n * PER_PERIOD);
  });

  test("an unused period does not double the next one", async () => {
    const s = await setup();
    s.env.setClock(START + DAY + 1n); // period 0 skipped entirely
    expect(code(await s.pull(2n * PER_PERIOD))).toBe(EXCEEDS_PERIOD_LIMIT);
    expect((await s.pull(PER_PERIOD)).ok).toBe(true);
  });

  test("nothing after the expiry, and only the delegatee can pull", async () => {
    const s = await setup();
    const stranger = await s.env.signer();
    expect(code(await s.pull(1n, stranger))).toBe(UNAUTHORIZED);
    s.env.setClock(START + 3n * DAY + 1n);
    expect(code(await s.pull(1n))).toBe(EXPIRED);
  });
});
