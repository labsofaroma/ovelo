/**
 * Read-only: records the real devnet Pyth receiver Config and the Wormhole guardian sets it
 * verifies against into tests/fixtures/pyth-devnet-receiver.json, so tests know the live layout
 * and data source (Pythnet chain 26 and its emitter). Tests WRITE their own config and guardian
 * set with a test key; this file is reference data only. Never loads a wallet or sends.
 *
 *   pnpm --filter @ovelo/contracts exec vite-node scripts/record-pyth-devnet.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getAddressEncoder } from "@solana/kit";
import {
  decodeReceiverConfig,
  findGuardianSetPda,
  findReceiverConfigPda,
  WORMHOLE_PROGRAM_ID,
} from "@ovelo/guard/pyth";
import { httpRpc, readOnly } from "./lib/jsonrpc";
import { CONTRACTS_ROOT } from "./lib/keys";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const url = process.env.OVELO_V1_FIXTURE_RPC ?? "https://api.devnet.solana.com";

type Info = {
  value: { owner: string; lamports: number; data: [string, string] } | null;
};

async function main() {
  const rpc = readOnly(httpRpc(url));
  if ((await rpc<string>("getGenesisHash")) !== DEVNET_GENESIS)
    throw new Error("Pyth fixtures are recorded from Solana devnet only.");
  const slot = await rpc<number>("getSlot");
  const configAddress = await findReceiverConfigPda();
  const config = await rpc<Info>("getAccountInfo", [
    configAddress,
    { encoding: "base64" },
  ]);
  if (!config.value) throw new Error("Receiver config is missing on devnet.");
  const decoded = decodeReceiverConfig(
    Buffer.from(config.value.data[0], "base64"),
  );
  const guardianSets = [];
  for (let index = 0; index < 16; index += 1) {
    const address = await findGuardianSetPda(index);
    const info = await rpc<Info>("getAccountInfo", [
      address,
      { encoding: "base64" },
    ]);
    if (!info.value) continue;
    if (info.value.owner !== WORMHOLE_PROGRAM_ID)
      throw new Error(`Guardian set ${index} has an unexpected owner.`);
    guardianSets.push({ index, address, dataBase64: info.value.data[0] });
  }
  const out = {
    comment:
      "Real devnet Pyth receiver Config and Wormhole guardian sets, read-only (scripts/record-pyth-devnet.ts). Reference only: tests write their own config and guardian set signed by a runtime test key.",
    source: url,
    genesisHash: DEVNET_GENESIS,
    slot,
    readAt: new Date().toISOString(),
    receiverConfig: {
      address: configAddress,
      owner: config.value.owner,
      dataBase64: config.value.data[0],
      decoded: {
        ...decoded,
        singleUpdateFeeLamports: decoded.singleUpdateFeeLamports.toString(),
        validDataSources: decoded.validDataSources.map((s) => ({
          chain: s.chain,
          emitter: s.emitter,
          emitterHex: Buffer.from(
            getAddressEncoder().encode(s.emitter),
          ).toString("hex"),
        })),
      },
    },
    guardianSets,
  };
  const file = path.join(
    CONTRACTS_ROOT,
    "tests/fixtures/pyth-devnet-receiver.json",
  );
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Recorded ${path.relative(CONTRACTS_ROOT, file)} at slot ${slot}.`,
  );
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
