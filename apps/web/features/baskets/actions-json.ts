/**
 * actions.json rules (M5b B4). Basket pages map to the v1 Action while AROMA_V1_ENABLED is on.
 * M9: the pages moved from /v1 to the root, so /basket/* is the rule; /v1/basket/* stays so Blinks
 * already shared still resolve (the page itself redirects 308). The prototype rules went with its
 * Action routes (they answer 410).
 */
export const ACTION_RULES = [
  { pathPattern: "/basket/*", apiPath: "/api/v1/actions/baskets/*" },
  { pathPattern: "/v1/basket/*", apiPath: "/api/v1/actions/baskets/*" },
] as const;

export function actionsJsonRules(v1Enabled: boolean) {
  return v1Enabled ? [...ACTION_RULES] : [];
}
