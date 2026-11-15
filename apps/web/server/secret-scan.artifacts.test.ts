// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * `scripts/check-client-secrets.mjs` (run at the end of every `pnpm build:web`): which variables
 * count as server secrets, and that the artifact scan finds them literal or gzipped without ever
 * echoing a value. Ported in M9 Step 1 from the legacy node:test suites
 * `tests/client-secret-scan.test.mjs` and `tests/secrets-configuration.test.mjs` (same assertions;
 * the public-config example is now a variable v1 reads). The forbidden-name and key-material rules
 * are covered in `secret-scan.m7.test.ts`.
 */
type Scan = {
  configuredServerSecrets(o: {
    envFiles: string[];
    environment: Record<string, string>;
  }): Promise<Map<string, string[]>>;
  scanClientArtifacts(
    dirs: string[],
    secrets: Map<string, string[]>,
  ): Promise<{ matches: { file: string; variables: string[] }[] }>;
};
// A plain ESM script without types; imported by a non-literal path so no tsconfig resolves it.
const SCRIPT = "../../../scripts/check-client-secrets.mjs";
const s = (await import(/* @vite-ignore */ SCRIPT)) as Scan;

describe("check-client-secrets: configured server secrets", () => {
  it("includes creator invitations, collector keypairs and rotating API keys, never public config", async () => {
    const secrets = await s.configuredServerSecrets({
      envFiles: [],
      environment: {
        NODE_ENV: "test",
        CREATOR_INVITE_CODES: "test-invitation-only",
        BOT_KEYPAIR: "test-collector-key-only",
        JUPITER_API_KEYS: "test-rotation-only",
        NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "public-config.example",
      },
    });
    expect(secrets.size).toBe(3);
    expect(secrets.has("public-config.example")).toBe(false);
  });
});

describe("check-client-secrets: artifact scan", () => {
  it("catches literal and compressed server secrets and excludes public config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ovelo-secret-scan-"));
    try {
      const server = "test-only-server-credential-42";
      const secrets = await s.configuredServerSecrets({
        envFiles: [],
        environment: {
          OVELO_TRADE_SECRET: server,
          NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "public-id",
          EXPO_PUBLIC_API_URL: "https://public.example",
        },
      });
      expect(secrets.size).toBe(1);
      await writeFile(join(dir, "clean.js"), 'const publicId="public-id";');
      expect(
        (await s.scanClientArtifacts([dir], secrets)).matches,
      ).toHaveLength(0);
      await writeFile(
        join(dir, "leak.js"),
        `const key=${JSON.stringify(server)};`,
      );
      await writeFile(
        join(dir, "leak.js.gz"),
        gzipSync(`const key=${JSON.stringify(server)};`),
      );
      const result = await s.scanClientArtifacts([dir], secrets);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]?.variables).toEqual(["OVELO_TRADE_SECRET"]);
      expect(JSON.stringify(result)).not.toContain(server);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
