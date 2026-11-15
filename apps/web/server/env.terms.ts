import { z } from "zod";
import {
  CURRENT_TERMS_VERSION,
  termsVersion,
} from "../features/compliance/terms";
import { deployEnvOf, productionRules } from "./platform";

/**
 * Launch gate for counsel's texts (COMPLIANCE.md §4). Under the production rules the selected
 * terms version must be counsel's final text (`final: true` in features/compliance/terms.ts).
 * A private beta may run on the placeholder only when the owner says so explicitly with
 * AROMA_ALLOW_PLACEHOLDER_TERMS=true; production refuses that switch outright.
 */
export const termsShape = {
  AROMA_ALLOW_PLACEHOLDER_TERMS: z.enum(["true", "false"]).optional(),
};

type Ctx = {
  addIssue(issue: { code: "custom"; path: string[]; message: string }): void;
};

export function termsRules(
  env: Readonly<Record<string, unknown>>,
  ctx: Ctx,
): void {
  // `next build` is not a deployment (server/platform.ts); the runtime boot checks again.
  if (env.NEXT_PHASE === "phase-production-build") return;
  if (!productionRules(env)) return;
  const allow = env.AROMA_ALLOW_PLACEHOLDER_TERMS === "true";
  const deployEnv = deployEnvOf(env);
  if (allow && deployEnv !== "beta")
    ctx.addIssue({
      code: "custom",
      path: ["AROMA_ALLOW_PLACEHOLDER_TERMS"],
      message: "is allowed only in a beta deployment",
    });
  const selected =
    typeof env.AROMA_TERMS_VERSION === "string" && env.AROMA_TERMS_VERSION
      ? env.AROMA_TERMS_VERSION
      : CURRENT_TERMS_VERSION;
  const terms = termsVersion(selected);
  // An unknown version is reported by the compliance policy; only finality is checked here.
  if (terms && !terms.final && !(allow && deployEnv === "beta"))
    ctx.addIssue({
      code: "custom",
      path: ["AROMA_TERMS_VERSION"],
      message:
        "selects placeholder terms; production needs counsel's final text (a beta may set AROMA_ALLOW_PLACEHOLDER_TERMS=true)",
    });
}
