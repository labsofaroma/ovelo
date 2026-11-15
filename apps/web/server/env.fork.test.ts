import { describe, expect, it } from "vitest";
import { BASE_ENV } from "@/server/test/base-env";
import { parseEnv } from "./env.schema";

/** M4: rules for the E2E local-fork switches and trade-key rotation. */
const variables = (result: ReturnType<typeof parseEnv>) =>
  result.ok ? [] : result.error.issues.map((issue) => issue.variable);

describe("env schema (M4)", () => {
  it("SOLANA_RPC_URL must be https unless it is loopback AND a fork genesis is declared", () => {
    expect(
      variables(
        parseEnv({ ...BASE_ENV, SOLANA_RPC_URL: "http://127.0.0.1:8899" }),
      ),
    ).toContain("SOLANA_RPC_URL");
    expect(
      parseEnv({
        ...BASE_ENV,
        SOLANA_RPC_URL: "http://127.0.0.1:8899",
        OVELO_V1_TEST_FORK_GENESIS:
          "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      }).ok,
    ).toBe(true);
    expect(
      variables(
        parseEnv({
          ...BASE_ENV,
          SOLANA_RPC_URL: "http://rpc.example.test",
          OVELO_V1_TEST_FORK_GENESIS:
            "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
        }),
      ),
    ).toContain("SOLANA_RPC_URL");
    expect(
      variables(
        parseEnv({
          ...BASE_ENV,
          SOLANA_RPC_URL: "https://u:p@rpc.example.test",
        }),
      ),
    ).toContain("SOLANA_RPC_URL");
  });

  it("every E2E switch is rejected on a Vercel production deployment", () => {
    const issues = variables(
      parseEnv({
        ...BASE_ENV,
        VERCEL_ENV: "production",
        OVELO_V1_TEST_FORK_GENESIS:
          "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
        OVELO_V1_TEST_JUPITER_URL: "http://127.0.0.1:4010",
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        "OVELO_V1_TEST_FORK_GENESIS",
        "OVELO_V1_TEST_JUPITER_URL",
      ]),
    );
    expect(
      variables(
        parseEnv({
          ...BASE_ENV,
          OVELO_V1_TEST_JUPITER_URL: "https://api.jup.ag",
        }),
      ),
    ).toContain("OVELO_V1_TEST_JUPITER_URL");
  });

  it("the previous trade secret must differ from the current one and be 32+ chars", () => {
    const secret = "a-trade-secret-that-is-at-least-32-characters";
    expect(
      variables(
        parseEnv({
          ...BASE_ENV,
          OVELO_TRADE_SECRET: secret,
          OVELO_TRADE_SECRET_PREVIOUS: secret,
        }),
      ),
    ).toContain("OVELO_TRADE_SECRET_PREVIOUS");
    expect(
      variables(
        parseEnv({ ...BASE_ENV, OVELO_TRADE_SECRET_PREVIOUS: "short" }),
      ),
    ).toContain("OVELO_TRADE_SECRET_PREVIOUS");
    expect(
      variables(parseEnv({ ...BASE_ENV, JITO_MAX_TIP_LAMPORTS: "999" })),
    ).toContain("JITO_MAX_TIP_LAMPORTS");
  });
});
