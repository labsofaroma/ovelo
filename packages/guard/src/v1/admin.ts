/** Admin instruction builders (signed by the upgrade authority or the config admin). */
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import {
  getInitializeConfigInstruction,
  getRegisterAssetInstruction,
  getSetAssetEnabledInstruction,
  getSetPausedInstruction,
  getUpdateConfigInstruction,
  type ConfigParamsArgs,
} from "./generated";
import { OVELO_GUARD_V1_PROGRAM_ID } from "./constants";
import { findAssetPda, findConfigPda, findProgramDataAddress } from "./pdas";

export async function buildInitializeConfigInstruction(params: {
  authority: TransactionSigner;
  params: ConfigParamsArgs;
}): Promise<Instruction> {
  return getInitializeConfigInstruction({
    authority: params.authority,
    config: await findConfigPda(),
    program: OVELO_GUARD_V1_PROGRAM_ID,
    programData: await findProgramDataAddress(),
    params: params.params,
  });
}

export async function buildUpdateConfigInstruction(
  admin: TransactionSigner,
  params: ConfigParamsArgs,
) {
  return getUpdateConfigInstruction({
    admin,
    config: await findConfigPda(),
    params,
  });
}

export async function buildSetPausedInstruction(
  admin: TransactionSigner,
  paused: boolean,
) {
  return getSetPausedInstruction({
    admin,
    config: await findConfigPda(),
    paused,
  });
}

export async function buildRegisterAssetInstruction(params: {
  admin: TransactionSigner;
  mint: Address;
  tokenProgram: Address;
  pythFeedId: Uint8Array;
}): Promise<Instruction> {
  if (params.pythFeedId.length !== 32)
    throw new Error("A Pyth feed id is 32 bytes.");
  return getRegisterAssetInstruction({
    admin: params.admin,
    config: await findConfigPda(),
    asset: await findAssetPda(params.mint),
    mint: params.mint,
    tokenProgram: params.tokenProgram,
    pythFeedId: params.pythFeedId,
  });
}

export async function buildSetAssetEnabledInstruction(
  admin: TransactionSigner,
  mint: Address,
  enabled: boolean,
) {
  return getSetAssetEnabledInstruction({
    admin,
    config: await findConfigPda(),
    asset: await findAssetPda(mint),
    enabled,
  });
}
