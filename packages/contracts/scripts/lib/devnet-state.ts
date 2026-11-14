/** Devnet provisioning state (.devnet/state.json, git-ignored) and its ProvisionDeps over RPC. */
import fs from "node:fs";
import path from "node:path";
import { createKeyPairSignerFromBytes, type Address } from "@solana/kit";
import * as v1 from "@aroma/guard";
import { GENESIS } from "./cluster";
import { assertIgnored, CONTRACTS_ROOT, newExportableKeypair } from "./keys";
import type { ProvisionDeps, ProvisionState } from "./provision";
import type { Connection } from "./send";

export const STATE_FILE = path.join(CONTRACTS_ROOT, ".devnet", "state.json");

export function loadState(file = STATE_FILE): ProvisionState {
  if (!fs.existsSync(file))
    return {
      network: "devnet",
      genesisHash: GENESIS.devnet,
      programId: v1.AROMA_GUARD_V1_PROGRAM_ID,
      assets: {},
    };
  const state = JSON.parse(fs.readFileSync(file, "utf8")) as ProvisionState;
  if (
    state.network !== "devnet" ||
    state.genesisHash !== GENESIS.devnet ||
    state.programId !== v1.AROMA_GUARD_V1_PROGRAM_ID
  )
    throw new Error(
      `${file} is not devnet state for program ${v1.AROMA_GUARD_V1_PROGRAM_ID}.`,
    );
  return state;
}

export function rpcDeps(c: Connection, file = STATE_FILE): ProvisionDeps {
  const exported = new Map<string, number[]>();
  return {
    async readAccount(addr: Address) {
      const info = (
        await c.rpc.getAccountInfo(addr, { encoding: "base64" }).send()
      ).value;
      return info
        ? {
            owner: info.owner,
            data: Uint8Array.from(Buffer.from(info.data[0], "base64")),
          }
        : null;
    },
    send: (payer, ixs) => c.send(payer, ixs),
    async generateMint() {
      const { signer, secret } = await newExportableKeypair();
      exported.set(signer.address, secret);
      return signer;
    },
    restoreMint: (secret) =>
      createKeyPairSignerFromBytes(Uint8Array.from(secret)),
    async exportSecret(mint) {
      const secret = exported.get(mint.address);
      if (!secret)
        throw new Error("Only freshly generated mints can be checkpointed.");
      return secret;
    },
    async save(state) {
      assertIgnored(file);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", {
        mode: 0o600,
      });
    },
  };
}
