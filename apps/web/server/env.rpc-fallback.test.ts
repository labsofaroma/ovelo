import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.schema";
import { genesisFindings, MAINNET_GENESIS, staticFindings } from "./prod-env";

/**
 * M9 failover config: SOLANA_RPC_FALLBACK_URL is optional, validated like SOLANA_RPC_URL (HTTPS,
 * no credentials; loopback only for the declared E2E fork), must differ from the primary, and
 * check:prod-env refuses a non-mainnet one, warns on the same host, and checks its genesis.
 */
const variables = (result: ReturnType<typeof parseEnv>) =>
  result.ok ? [] : result.error.issues.map((issue) => issue.variable);
const PRIMARY = "https://mainnet.helius-rpc.com/?api-key=k";
const FORK = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

describe("boot schema", () => {
  it("is optional", () => {
    expect(parseEnv({ SOLANA_RPC_URL: PRIMARY }).ok).toBe(true);
  });

  it("accepts a second HTTPS provider", () => {
    expect(
      parseEnv({
        SOLANA_RPC_URL: PRIMARY,
        SOLANA_RPC_FALLBACK_URL: "https://aroma.mainnet.rpcpool.com/k",
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["plain http", "http://rpc.example.test"],
    ["embedded credentials", "https://u:p@rpc.example.test"],
    ["not a URL", "rpc.example.test"],
    ["loopback without the fork switch", "http://127.0.0.1:8899"],
  ])("refuses %s", (_label, url) => {
    expect(
      variables(
        parseEnv({ SOLANA_RPC_URL: PRIMARY, SOLANA_RPC_FALLBACK_URL: url }),
      ),
    ).toContain("SOLANA_RPC_FALLBACK_URL");
  });

  it("must differ from SOLANA_RPC_URL (also from the default public endpoint)", () => {
    expect(
      variables(
        parseEnv({ SOLANA_RPC_URL: PRIMARY, SOLANA_RPC_FALLBACK_URL: PRIMARY }),
      ),
    ).toContain("SOLANA_RPC_FALLBACK_URL");
    expect(
      variables(
        parseEnv({
          SOLANA_RPC_FALLBACK_URL: "https://api.mainnet-beta.solana.com/",
        }),
      ),
    ).toContain("SOLANA_RPC_FALLBACK_URL");
  });

  it("a loopback fallback is refused next to an https primary, even with the fork switch", () => {
    expect(
      variables(
        parseEnv({
          SOLANA_RPC_URL: PRIMARY,
          SOLANA_RPC_FALLBACK_URL: "http://127.0.0.1:18902",
          AROMA_V1_TEST_FORK_GENESIS: FORK,
        }),
      ),
    ).toContain("SOLANA_RPC_FALLBACK_URL");
  });

  it("loopback is accepted only for the declared E2E fork", () => {
    expect(
      parseEnv({
        SOLANA_RPC_URL: "http://127.0.0.1:18899",
        SOLANA_RPC_FALLBACK_URL: "http://127.0.0.1:18898",
        AROMA_V1_TEST_FORK_GENESIS: FORK,
      }).ok,
    ).toBe(true);
  });
});

describe("check:prod-env", () => {
  const base = { SOLANA_RPC_URL: PRIMARY };
  const finding = (env: Record<string, string>) =>
    staticFindings(env).filter((f) => f.name === "SOLANA_RPC_FALLBACK_URL");

  it("is recommended: missing is a warning, not a failure", () => {
    expect(finding(base).map((f) => f.status)).toContain("warning");
  });

  it.each([
    "https://api.devnet.solana.com",
    "https://my-devnet.example-rpc.com",
    "https://api.testnet.solana.com",
  ])("refuses a non-mainnet fallback (%s)", (url) => {
    expect(
      finding({ ...base, SOLANA_RPC_FALLBACK_URL: url }).map((f) => f.status),
    ).toContain("forbidden");
  });

  it("warns when the fallback is on the primary's host (no provider redundancy)", () => {
    expect(
      finding({
        ...base,
        SOLANA_RPC_FALLBACK_URL:
          "https://mainnet.helius-rpc.com/?api-key=other",
      }).map((f) => f.detail),
    ).toContain(
      "same host as SOLANA_RPC_URL; failover does not cover a provider outage",
    );
  });

  it("checks the fallback's genesis on its own (read-only)", async () => {
    const fetch = async (url: string) =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: url.includes("rpcpool") ? FORK : MAINNET_GENESIS,
      });
    const findings = await genesisFindings(
      {
        SOLANA_RPC_URL: PRIMARY,
        SOLANA_RPC_FALLBACK_URL: "https://aroma.mainnet.rpcpool.com/k",
      },
      fetch,
    );
    expect(findings).toContainEqual({
      name: "SOLANA_RPC_FALLBACK_URL",
      status: "invalid",
      detail: "genesis is NOT mainnet-beta",
    });
    expect(findings).toContainEqual({
      name: "SOLANA_RPC_URL",
      status: "ok",
      detail: "genesis is mainnet-beta",
    });
  });
});

describe("a value that is not a URL is reported, never thrown", () => {
  it.each(["SOLANA_RPC_URL", "SOLANA_RPC_FALLBACK_URL"])("%s", (name) => {
    expect(variables(parseEnv({ [name]: "rpc.example.test" }))).toContain(name);
  });
});
