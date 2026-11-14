/** Tiny CLI argument parser shared by the devnet scripts. */
export type Args = { flags: Set<string>; values: Map<string, string> };

export function parseArgs(
  argv: string[],
  known: { flags?: string[]; values?: string[] },
): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (known.flags?.includes(arg)) flags.add(arg);
    else if (known.values?.includes(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value.`);
      values.set(arg, value);
      i += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { flags, values };
}

export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const DEFAULT_DEPLOYER = "~/.config/solana/aroma-deployer.json";
