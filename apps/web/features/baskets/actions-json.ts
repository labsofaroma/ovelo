/**
 * actions.json rules (M5b B4). /v1/basket/* maps to the v1 Action only while AROMA_V1_ENABLED is
 * on. M9 Step 3: the prototype rules are gone with the prototype's Action routes (they answer 410).
 */
export const V1_ACTION_RULE = {
  pathPattern: "/v1/basket/*",
  apiPath: "/api/v1/actions/baskets/*",
} as const;

export function actionsJsonRules(v1Enabled: boolean) {
  return v1Enabled ? [V1_ACTION_RULE] : [];
}
