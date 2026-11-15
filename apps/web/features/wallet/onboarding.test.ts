import { describe, expect, it } from "vitest";
import { newAccountsLamports, walletBrowseLinks } from "./onboarding";

describe("wallet onboarding helpers", () => {
  it("SOL for new token accounts: exact lamports from the one constant", () => {
    expect(newAccountsLamports(1)).toBe(2_000_000n);
    expect(newAccountsLamports(5)).toBe(10_000_000n);
    expect(newAccountsLamports(0)).toBe(0n);
  });

  it("browse links carry only the page and its origin, URL-encoded", () => {
    const links = walletBrowseLinks("https://beta.aroma.example/get-started");
    expect(links.map((l) => l.name)).toEqual([
      "Phantom",
      "Solflare",
      "Backpack",
    ]);
    for (const link of links) {
      const url = new URL(link.href);
      expect(url.protocol).toBe("https:");
      expect([...url.searchParams.keys()]).toEqual(["ref"]);
      expect(url.searchParams.get("ref")).toBe("https://beta.aroma.example");
    }
  });
});
