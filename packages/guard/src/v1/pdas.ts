/** Program-derived addresses for Aroma Guard v1 and the Subscriptions program. */
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import {
  AROMA_GUARD_V1_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_ID,
  SUBSCRIPTIONS_PROGRAM_ID,
} from "./constants";

const utf8 = getUtf8Encoder();
const key = getAddressEncoder();
const u64 = getU64Encoder();

async function pda(
  programAddress: Address,
  seeds: Uint8Array[],
): Promise<Address> {
  const [found] = await getProgramDerivedAddress({
    programAddress,
    seeds: seeds.map((s) => Uint8Array.from(s)),
  });
  return found;
}

export const findConfigPda = (program = AROMA_GUARD_V1_PROGRAM_ID) =>
  pda(program, [Uint8Array.from(utf8.encode("config"))]);

export const findAssetPda = (
  mint: Address,
  program = AROMA_GUARD_V1_PROGRAM_ID,
) =>
  pda(program, [
    Uint8Array.from(utf8.encode("asset")),
    Uint8Array.from(key.encode(mint)),
  ]);

/** `["plan", owner, funding_mint, nonce_le_u64]`. */
export const findPlanPda = (
  owner: Address,
  fundingMint: Address,
  nonce: bigint,
  program = AROMA_GUARD_V1_PROGRAM_ID,
) =>
  pda(program, [
    Uint8Array.from(utf8.encode("plan")),
    Uint8Array.from(key.encode(owner)),
    Uint8Array.from(key.encode(fundingMint)),
    Uint8Array.from(u64.encode(nonce)),
  ]);

/** Devnet build: the per-asset mint authority `["mock_mint", mint]`. */
export const findMockMintAuthorityPda = (
  mint: Address,
  program = AROMA_GUARD_V1_PROGRAM_ID,
) =>
  pda(program, [
    Uint8Array.from(utf8.encode("mock_mint")),
    Uint8Array.from(key.encode(mint)),
  ]);

/** The upgradeable loader's ProgramData account for a program (checked by `initialize_config`). */
export const findProgramDataAddress = (program = AROMA_GUARD_V1_PROGRAM_ID) =>
  pda(BPF_LOADER_UPGRADEABLE_ID, [Uint8Array.from(key.encode(program))]);

export const findAssociatedTokenAddress = (
  owner: Address,
  mint: Address,
  tokenProgram: Address,
) =>
  pda(ASSOCIATED_TOKEN_PROGRAM_ID, [
    Uint8Array.from(key.encode(owner)),
    Uint8Array.from(key.encode(tokenProgram)),
    Uint8Array.from(key.encode(mint)),
  ]);

export const findSubscriptionAuthorityPda = (user: Address, mint: Address) =>
  pda(SUBSCRIPTIONS_PROGRAM_ID, [
    Uint8Array.from(utf8.encode("SubscriptionAuthority")),
    Uint8Array.from(key.encode(user)),
    Uint8Array.from(key.encode(mint)),
  ]);

export const findRecurringDelegationPda = (
  authority: Address,
  delegator: Address,
  delegatee: Address,
  nonce: bigint,
) =>
  pda(SUBSCRIPTIONS_PROGRAM_ID, [
    Uint8Array.from(utf8.encode("delegation")),
    Uint8Array.from(key.encode(authority)),
    Uint8Array.from(key.encode(delegator)),
    Uint8Array.from(key.encode(delegatee)),
    Uint8Array.from(u64.encode(nonce)),
  ]);

export const findSubscriptionsEventAuthorityPda = () =>
  pda(SUBSCRIPTIONS_PROGRAM_ID, [
    Uint8Array.from(utf8.encode("event_authority")),
  ]);

/** Every address a plan touches, derived once. */
export async function planAddresses(params: {
  owner: Address;
  fundingMint: Address;
  fundingTokenProgram: Address;
  nonce: bigint;
}) {
  const plan = await findPlanPda(
    params.owner,
    params.fundingMint,
    params.nonce,
  );
  const subscriptionAuthority = await findSubscriptionAuthorityPda(
    params.owner,
    params.fundingMint,
  );
  return {
    plan,
    config: await findConfigPda(),
    staging: await findAssociatedTokenAddress(
      plan,
      params.fundingMint,
      params.fundingTokenProgram,
    ),
    ownerFundingToken: await findAssociatedTokenAddress(
      params.owner,
      params.fundingMint,
      params.fundingTokenProgram,
    ),
    subscriptionAuthority,
    recurringDelegation: await findRecurringDelegationPda(
      subscriptionAuthority,
      params.owner,
      plan,
      params.nonce,
    ),
    subscriptionsEventAuthority: await findSubscriptionsEventAuthorityPda(),
  };
}
