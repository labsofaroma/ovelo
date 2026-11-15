// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Match = { file: string; variables: string[]; found: string[] };
type Scan = {
  configuredServerSecrets(o: {
    envFiles: string[];
    environment: Record<string, string>;
  }): Promise<Map<string, string[]>>;
  scanClientArtifacts(
    dirs: string[],
    secrets: Map<string, string[]>,
    o?: {
      forbiddenNames?: string[];
      markers?: string[];
      keyMaterial?: boolean;
    },
  ): Promise<{ matches: Match[] }>;
  containsKeyMaterial(text: string): boolean;
  FORBIDDEN_NAMES: string[];
  LOCALNET_MARKERS: string[];
};
// A plain ESM script without types; imported by a non-literal path so no tsconfig resolves it.
const SCRIPT = "../../../scripts/check-client-secrets.mjs";
const s = (await import(/* @vite-ignore */ SCRIPT)) as Scan;

/** Generated at runtime: no key-shaped literal is committed. */
const keyArray = () =>
  JSON.stringify(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256));

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ovelo-scan-m7-"));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("client-secret scan, M7 additions", () => {
  it("fails on the localnet marker in a production build and allows it in a localnet test build", async () => {
    await writeFile(
      join(dir, "chunk.js"),
      'localStorage.getItem("oveloLocalnetCluster")',
    );
    const strict = await s.scanClientArtifacts([dir], new Map(), {
      markers: s.LOCALNET_MARKERS,
    });
    expect(strict.matches[0]?.found).toEqual(["marker:oveloLocalnetCluster"]);
    const allowed = await s.scanClientArtifacts([dir], new Map(), {
      markers: [],
    });
    expect(allowed.matches).toEqual([]);
  });

  it("fails on secret-key-shaped material (a 64-byte JSON array) anywhere in a client artifact", async () => {
    await writeFile(join(dir, "leak.js"), `const k=${keyArray()};`);
    await writeFile(join(dir, "ok.js"), "const short=[1,2,3,4];");
    const result = await s.scanClientArtifacts([dir], new Map(), {
      keyMaterial: true,
    });
    expect(
      result.matches.map((m) => [m.file.endsWith("leak.js"), m.found]),
    ).toEqual([[true, ["key-material"]]]);
    expect(s.containsKeyMaterial(keyArray().replace("[", "[ 300,"))).toBe(
      false,
    );
  });

  it("treats the keeper and faucet keys and the Turnstile secret as secrets, by value and by name", async () => {
    const faucet = keyArray();
    const secrets = await s.configuredServerSecrets({
      envFiles: [],
      environment: {
        OVELO_V1_FAUCET_KEYPAIR: faucet,
        KEEPER_KEYPAIR: keyArray().replace("11", "12"),
        TURNSTILE_SECRET_KEY: "0x4AAAAAAAtest-secret-value",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      },
    });
    expect([...secrets.values()].flat().sort()).toEqual([
      "KEEPER_KEYPAIR",
      "OVELO_V1_FAUCET_KEYPAIR",
      "TURNSTILE_SECRET_KEY",
    ]);
    await writeFile(
      join(dir, "a.js"),
      `x=${JSON.stringify(faucet)};y="TURNSTILE_SECRET_KEY"`,
    );
    const result = await s.scanClientArtifacts([dir], secrets, {
      forbiddenNames: s.FORBIDDEN_NAMES,
    });
    expect(result.matches[0]?.variables).toEqual(["OVELO_V1_FAUCET_KEYPAIR"]);
    expect(result.matches[0]?.found).toContain("name:TURNSTILE_SECRET_KEY");
    for (const name of [
      "OVELO_V1_FAUCET_KEYPAIR",
      "KEEPER_KEYPAIR",
      "TURNSTILE_SECRET_KEY",
    ])
      expect(s.FORBIDDEN_NAMES).toContain(name);
  });
});
