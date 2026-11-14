import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { COMMITTED_IDL, generatedDrift } from "../../scripts/codama.mjs";

/** AGENTS.md rule 6: the generated client must be exactly what Codama renders from the IDL. */
describe("Codama drift", () => {
  test("the committed client matches a fresh render of the committed IDL", async () => {
    expect(await generatedDrift()).toEqual([]);
  });

  test("a changed IDL is detected as drift", async () => {
    const idl = JSON.parse(
      fs.readFileSync(COMMITTED_IDL as string, "utf8"),
    ) as {
      instructions: { name: string; args: { name: string }[] }[];
    };
    const execute = idl.instructions.find(
      (ix) => ix.name === "execute_installment",
    )!;
    execute.args[0]!.name = "period_index";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aroma-idl-"));
    const changed = path.join(tmp, "aroma_guard.json");
    fs.writeFileSync(changed, JSON.stringify(idl));
    try {
      const drift = (await generatedDrift(changed)) as string[];
      expect(drift).toContain(
        path.join("instructions", "executeInstallment.ts"),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
