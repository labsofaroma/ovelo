/**
 * Phase A private beta configuration (REWRITE-PLAN §7.3 W2). Pure and edge-safe: middleware, the
 * route handlers and the UI's server components read the same answer.
 *
 * - `OVELO_BETA_GATE=on|off`. Unset means ON in production (`NODE_ENV` is `production`, which
 *   includes a local `next start`, or the production rules of server/platform.ts apply) and off in development and tests. Phase B
 *   switches it off by setting `off` explicitly; it never turns off by accident.
 * - `OVELO_BETA_WALLETS`: optional comma-separated allowlist (validated at boot).
 * - Anything unreadable fails CLOSED: the gate is on and the allowlist is empty.
 */
import { productionRules } from "@/server/platform";

type Env = Record<string, string | undefined>;

export type BetaConfig = {
  gate: boolean;
  wallets: ReadonlySet<string>;
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function betaGateOn(env: Env): boolean {
  const value = env.OVELO_BETA_GATE?.trim();
  if (value === "off") return false;
  if (value === "on") return true;
  if (value) return true; // an invalid value fails closed (boot refuses it as well)
  return env.NODE_ENV?.trim() === "production" || productionRules(env);
}

export function betaConfig(env: Env): BetaConfig {
  const gate = betaGateOn(env);
  const raw = env.OVELO_BETA_WALLETS?.trim();
  if (!raw) return { gate, wallets: new Set() };
  const parts = raw.split(",").map((part) => part.trim());
  // A malformed allowlist grants nothing (boot refuses it; this is the runtime backstop).
  if (!parts.every((part) => BASE58.test(part)))
    return { gate, wallets: new Set() };
  return { gate, wallets: new Set(parts) };
}
