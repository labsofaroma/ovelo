/**
 * Read-only audit of an Aroma Guard v1 devnet deployment. Uses only `READ_METHODS`; it never signs
 * and never sends a transaction.
 */
import { getAddressDecoder, getBase58Decoder, type Address } from "@solana/kit";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";
import { GENESIS } from "./cluster";
import { readOnly, type JsonRpc } from "./jsonrpc";
import { parseMintFacts } from "./provision";
import { DEVNET_DECISIONS, NULL_KEY } from "./devnet-config";

type Info = {
  owner: string;
  executable: boolean;
  data: [string, string];
} | null;
const bytes = (info: NonNullable<Info>) =>
  Uint8Array.from(Buffer.from(info.data[0], "base64"));
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export type AuditExpectations = {
  programId: Address;
  deployer: Address;
  keeper: Address;
  testUsd: Address | null;
};
export type AuditReport = {
  network: "devnet";
  programId: Address;
  upgradeAuthority: Address | null;
  checks: Record<string, boolean>;
  issues: string[];
  assets: {
    mint: Address;
    enabled: boolean;
    feedId: string;
    mintAuthorityIsPda: boolean;
  }[];
  transactionsSubmitted: 0;
  passed: boolean;
};

export async function auditDevnet(
  rawRpc: JsonRpc,
  expect: AuditExpectations,
): Promise<AuditReport> {
  const rpc = readOnly(rawRpc);
  if ((await rpc<string>("getGenesisHash")) !== GENESIS.devnet)
    throw new Error("Refusing to audit a non-devnet cluster.");
  const issues: string[] = [];
  const check = (name: string, ok: boolean, issue: string, applies = true) => {
    if (!ok && applies) issues.push(issue);
    return [name, ok] as const;
  };
  const get = async (a: Address) =>
    (await rpc<{ value: Info }>("getAccountInfo", [a, { encoding: "base64" }]))
      .value;

  const program = await get(expect.programId);
  const programDataAddress =
    program && program.owner === LOADER
      ? getAddressDecoder().decode(bytes(program).subarray(4, 36))
      : null;
  const programData = programDataAddress ? await get(programDataAddress) : null;
  const pd = programData ? bytes(programData) : null;
  const upgradeAuthority =
    pd && pd[12] === 1 ? getAddressDecoder().decode(pd.subarray(13, 45)) : null;

  const configInfo = await get(await v1.findConfigPda());
  const config = configInfo ? v1.decodeConfigAccount(bytes(configInfo)) : null;
  const funding = config
    ? config.allowedFundingMints.filter((m) => m !== NULL_KEY)
    : [];
  const keeper =
    config && config.keeperAuthority.__option === "Some"
      ? config.keeperAuthority.value
      : null;

  const usdInfo = expect.testUsd ? await get(expect.testUsd) : null;
  const usd =
    usdInfo && expect.testUsd
      ? parseMintFacts(usdInfo.owner as Address, bytes(usdInfo))
      : null;

  const discriminator = getBase58Decoder().decode(
    v1.getAssetDiscriminatorBytes(),
  );
  const assetAccounts = await rpc<
    { pubkey: string; account: NonNullable<Info> }[]
  >("getProgramAccounts", [
    expect.programId,
    {
      encoding: "base64",
      filters: [{ memcmp: { offset: 0, bytes: discriminator } }],
    },
  ]);
  const assets: AuditReport["assets"] = [];
  for (const { account } of assetAccounts) {
    const asset = v1.decodeAssetAccount(bytes(account));
    const mintInfo = await get(asset.mint);
    const facts = mintInfo
      ? parseMintFacts(mintInfo.owner as Address, bytes(mintInfo))
      : null;
    const pda = await v1.findMockMintAuthorityPda(asset.mint);
    assets.push({
      mint: asset.mint,
      enabled: asset.enabled,
      feedId: Buffer.from(asset.pythFeedId).toString("hex"),
      mintAuthorityIsPda:
        facts?.mintAuthority === pda && facts.freezeAuthority === null,
    });
  }

  const checks = Object.fromEntries([
    check(
      "programDeployed",
      program?.executable === true && program.owner === LOADER,
      "program is missing or not an upgradeable program",
    ),
    check(
      "upgradeAuthorityIsDeployer",
      upgradeAuthority === expect.deployer,
      `upgrade authority is ${upgradeAuthority ?? "none"}, expected the deployer ${expect.deployer}`,
    ),
    check("configInitialized", config !== null, "config is not initialized"),
    check(
      "configAdminIsDeployer",
      config?.admin === expect.deployer,
      `config admin is ${config?.admin ?? "missing"}`,
      config !== null,
    ),
    check(
      "keeperIsDevnetKeeper",
      keeper === expect.keeper,
      `keeper is ${keeper ?? "anyone"}, expected ${expect.keeper}`,
      config !== null,
    ),
    check(
      "notPaused",
      config?.paused === false,
      "config is paused",
      config !== null,
    ),
    check(
      "decisions",
      !!config &&
        config.protocolFeeBps === DEVNET_DECISIONS.protocolFeeBps &&
        config.catchUpWindowPeriods === DEVNET_DECISIONS.catchUpWindowPeriods,
      "fee or catch-up window differ from the M6 decisions",
      config !== null,
    ),
    check(
      "noForeignFundingMint",
      funding.length === 1 && funding[0] === expect.testUsd,
      `funding allow-list is [${funding.join(", ")}], expected only the test USD`,
      config !== null,
    ),
    check(
      "testUsdAuthorityIsDeployer",
      usd?.mintAuthority === expect.deployer &&
        usd.freezeAuthority === null &&
        usd.decimals === 6,
      "test USD mint authority, freeze authority or decimals unexpected",
    ),
    check("assetsRegistered", assets.length >= 1, "no assets registered"),
    check(
      "everyAssetMintAuthorityIsItsPda",
      assets.every((a) => a.mintAuthorityIsPda),
      "an asset's mint authority is not its mock PDA (or it has a freeze authority)",
    ),
  ]);
  return {
    network: "devnet",
    programId: expect.programId,
    upgradeAuthority,
    checks,
    issues,
    assets,
    transactionsSubmitted: 0,
    passed: issues.length === 0,
  };
}
