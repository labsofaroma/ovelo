import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.schema";

/** M4: rules for the E2E local-fork switches and trade-key rotation. */
const variables = (result: ReturnType<typeof parseEnv>) =>
  result.ok ? [] : result.error.issues.map((issue) => issue.variable);

describe("env schema (M4)", () => {
  it("SOLANA_RPC_URL must be https unless it is loopback AND a fork genesis is declared", () => {
    expect(
      variables(parseEnv({ SOLANA_RPC_URL: "http://127.0.0.1:8899" })),
    ).toContain("SOLANA_RPC_URL");
    expect(
      parseEnv({
        SOLANA_RPC_URL: "http://127.0.0.1:8899",
        AROMA_V1_TEST_FORK_GENESIS:
          "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      }).ok,
    ).toBe(true);
    expect(
      variables(
        parseEnv({
          SOLANA_RPC_URL: "http://rpc.example.test",
          AROMA_V1_TEST_FORK_GENESIS:
            "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
        }),
      ),
    ).toContain("SOLANA_RPC_URL");
    expect(
      variables(parseEnv({ SOLANA_RPC_URL: "https://u:p@rpc.example.test" })),
    ).toContain("SOLANA_RPC_URL");
  });

  it("every E2E switch is rejected on a Vercel production deployment", () => {
    const issues = variables(
      parseEnv({
        VERCEL_ENV: "production",
        AROMA_V1_TEST_FORK_GENESIS:
          "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
        AROMA_V1_TEST_JUPITER_URL: "http://127.0.0.1:4010",
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        "AROMA_V1_TEST_FORK_GENESIS",
        "AROMA_V1_TEST_JUPITER_URL",
      ]),
    );
    expect(
      variables(parseEnv({ AROMA_V1_TEST_JUPITER_URL: "https://api.jup.ag" })),
    ).toContain("AROMA_V1_TEST_JUPITER_URL");
  });

  it("the previous trade secret must differ from the current one and be 32+ chars", () => {
    const secret = "a-trade-secret-that-is-at-least-32-characters";
    expect(
      variables(
        parseEnv({
          AROMA_TRADE_SECRET: secret,
          AROMA_TRADE_SECRET_PREVIOUS: secret,
        }),
      ),
    ).toContain("AROMA_TRADE_SECRET_PREVIOUS");
    expect(
      variables(parseEnv({ AROMA_TRADE_SECRET_PREVIOUS: "short" })),
    ).toContain("AROMA_TRADE_SECRET_PREVIOUS");
    expect(variables(parseEnv({ JITO_MAX_TIP_LAMPORTS: "999" }))).toContain(
      "JITO_MAX_TIP_LAMPORTS",
    );
  });
});
