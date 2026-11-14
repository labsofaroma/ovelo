/** Cluster guards: every script checks the genesis hash before any other RPC call. */
export const GENESIS = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;

export type GenesisReader = { getGenesisHash(): { send(): Promise<string> } };

/** Devnet scripts refuse every other genesis (AGENTS.md rule 3). */
export async function assertDevnet(rpc: GenesisReader): Promise<void> {
  let genesis: string;
  try {
    genesis = await rpc.getGenesisHash().send();
  } catch (error) {
    throw new Error(
      `Cannot identify the cluster (RPC offline?): ${(error as Error).message}`,
    );
  }
  if (genesis !== GENESIS.devnet)
    throw new Error(
      `Refusing to run: genesis ${genesis} is not Solana devnet.`,
    );
}

/** The local run refuses anything but a loopback validator with a fresh (unknown) genesis. */
export async function assertLocalnet(
  rpc: GenesisReader,
  url: string,
): Promise<void> {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error(`Refusing to run against ${host}: localnet only.`);
  const genesis = await rpc.getGenesisHash().send();
  if ((Object.values(GENESIS) as string[]).includes(genesis))
    throw new Error(`Refusing to run: genesis ${genesis} is a public cluster.`);
}
