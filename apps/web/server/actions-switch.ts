import { AppError } from "./errors";
import { productionRules } from "./platform";

/**
 * Solana Actions (Blinks) switch. A Blink client may fetch the Action POST through its own
 * servers, so the location the compliance gate sees can be the client's, not the user's. Until
 * counsel accepts that, Actions are OFF under the production rules unless OVELO_ACTIONS=on is
 * set explicitly; elsewhere (development, tests, previews) they default on. OVELO_ACTIONS=off
 * always turns them off. The confirm callback stays open so receipts still record.
 */
export function actionsOff(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = env.OVELO_ACTIONS?.trim().toLowerCase();
  if (value === "off") return true;
  if (value === "on") return false;
  return productionRules(env);
}

export const ACTIONS_OFF_MESSAGE =
  "Buying through a Blink is not available. Open the basket on the site to buy it. Nothing was quoted.";

export function assertActionsOpen(
  env?: Readonly<Record<string, string | undefined>>,
): void {
  if (actionsOff(env))
    throw new AppError("TRADING_UNAVAILABLE", {
      publicMessage: ACTIONS_OFF_MESSAGE,
      detail: "Solana Actions are off (OVELO_ACTIONS)",
    });
}
