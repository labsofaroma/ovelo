/** Admin access, one-time initialization, config validation, and the mainnet build. */
import { describe, expect, test } from "vitest";
import { generateKeyPairSigner } from "@solana/kit";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";
import { Env, MAINNET_SO } from "./harness";
import { configParams, DEFAULT, errorCode, World } from "./world";

describe("initialize_config", () => {
  test("only the upgrade authority, read from ProgramData, can initialize", async () => {
    const authority = await generateKeyPairSigner();
    const env = await Env.create(authority.address);
    const stranger = await env.signer();
    const params = configParams({
      admin: stranger.address,
      keeper: null,
      usd: stranger.address,
      treasury: stranger.address,
      feeRecipient: DEFAULT,
      feeBps: 0,
      window: 1,
      maxInstallment: 1n,
    });
    const r = await env.trySend(stranger, [
      await v1.buildInitializeConfigInstruction({
        authority: stranger,
        params,
      }),
    ]);
    expect(errorCode(r.logs)).toBe("NotUpgradeAuthority");
  });

  test("a program with no upgrade authority cannot be initialized", async () => {
    const env = await Env.create(null);
    const someone = await env.signer();
    const params = configParams({
      admin: someone.address,
      keeper: null,
      usd: someone.address,
      treasury: someone.address,
      feeRecipient: DEFAULT,
      feeBps: 0,
      window: 1,
      maxInstallment: 1n,
    });
    const r = await env.trySend(someone, [
      await v1.buildInitializeConfigInstruction({ authority: someone, params }),
    ]);
    expect(errorCode(r.logs)).toBe("NotUpgradeAuthority");
  });

  test("initialization happens once", async () => {
    const w = await World.create({ stocks: 0 });
    const again = await w.env.trySend(w.admin, [
      await v1.buildInitializeConfigInstruction({
        authority: w.admin,
        params: w.params,
      }),
    ]);
    expect(again.ok).toBe(false);
    expect(again.logs.join("\n")).toMatch(/already in use/);
  });

  test("out-of-range values are refused", async () => {
    const authority = await generateKeyPairSigner();
    const env = await Env.create(authority.address);
    env.svm.airdrop(authority.address, 10_000_000_000n as never);
    const base = configParams({
      admin: authority.address,
      keeper: null,
      usd: authority.address,
      treasury: authority.address,
      feeRecipient: DEFAULT,
      feeBps: 0,
      window: 1,
      maxInstallment: 1n,
    });
    for (const bad of [
      { maxSlippageBps: 2_001 },
      { catchUpWindowPeriods: 5 },
      { protocolFeeBps: 10 },
      { maxOracleStalenessS: 0 },
    ]) {
      const r = await env.trySend(authority, [
        await v1.buildInitializeConfigInstruction({
          authority,
          params: { ...base, ...bad },
        }),
      ]);
      expect(errorCode(r.logs), JSON.stringify(bad)).toBe("InvalidConfig");
    }
  });
});

describe("admin-only instructions", () => {
  test("a non-admin cannot update the config, pause, register or disable assets", async () => {
    const w = await World.create({ stocks: 1 });
    const intruder = await w.env.signer();
    const attempts = [
      await v1.buildUpdateConfigInstruction(intruder, {
        ...w.params,
        admin: intruder.address,
      }),
      await v1.buildSetPausedInstruction(intruder, true),
      await v1.buildSetAssetEnabledInstruction(
        intruder,
        w.stocks[0]!.mint,
        false,
      ),
    ];
    for (const ix of attempts)
      expect(errorCode((await w.env.trySend(intruder, [ix])).logs)).toBe(
        "NotAdmin",
      );
    const mint = await w.mockMint(1);
    const register = await v1.buildRegisterAssetInstruction({
      admin: intruder,
      mint,
      tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
      pythFeedId: new Uint8Array(32).fill(1),
    });
    expect(errorCode((await w.env.trySend(intruder, [register])).logs)).toBe(
      "NotAdmin",
    );
  });

  test("the admin can switch to permissionless execution and hand over admin", async () => {
    const w = await World.create({ stocks: 1 });
    const next = await w.env.signer();
    await w.env.send(w.admin, [
      await v1.buildUpdateConfigInstruction(w.admin, {
        ...w.params,
        keeperAuthority: null,
        admin: next.address,
      }),
    ]);
    const config = v1.decodeConfigAccount(
      w.env.data(await v1.findConfigPda())!,
    );
    expect(config.admin).toBe(next.address);
    expect(config.keeperAuthority).toEqual({ __option: "None" });
    expect(
      errorCode(
        (
          await w.env.trySend(w.admin, [
            await v1.buildSetPausedInstruction(w.admin, true),
          ])
        ).logs,
      ),
    ).toBe("NotAdmin");
    const plan = await w.createPlan();
    const anyone = await w.env.signer();
    expect((await w.execute(plan, 0, 1, { keeper: anyone })).ok).toBe(true);
  });

  test("an asset registers once", async () => {
    const w = await World.create({ stocks: 1 });
    const r = await w.register(w.stocks[0]!.mint, w.stocks[0]!.feedId);
    expect(r.ok).toBe(false);
    expect(r.logs.join("\n")).toMatch(/already in use/);
  });
});

describe("mainnet build (default features)", () => {
  test("plans can be created and closed, but execution fails closed until M8", async () => {
    const w = await World.create({ stocks: 1, soPath: MAINNET_SO });
    const plan = await w.createPlan();
    const r = await w.execute(plan, 0, 1);
    expect(errorCode(r.logs)).toBe("MainnetExecutionUnavailable");
    expect(r.logs.some((l) => l.includes("devnet-mock"))).toBe(false);
    const close = await w.env.trySend(
      w.owner,
      await v1.buildCloseAndRevokeInstructions({
        owner: w.owner,
        planAddress: plan,
        plan: w.plan(plan),
        revokeAuthority: true,
      }),
    );
    expect(close.ok, close.logs.join("\n")).toBe(true);
  });
});
