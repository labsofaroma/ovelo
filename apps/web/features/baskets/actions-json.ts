/**
 * actions.json rules (M5b B4). /v1/basket/* maps to /api/v1/actions/baskets/* only while
 * AROMA_V1_ENABLED is on; the prototype rules are unchanged and keep their order. M7: /basket/*
 * moves to the v1 Action and the prototype rules are deleted (docs/M4-DEPLOY.md, M5 section).
 */
export const V1_ACTION_RULE = {
  pathPattern: "/v1/basket/*",
  apiPath: "/api/v1/actions/baskets/*",
} as const;

export const PROTOTYPE_ACTION_RULES = [
  { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
  { pathPattern: "/basket/*", apiPath: "/api/actions/buy-baskets/*" },
  { pathPattern: "/baskets/*", apiPath: "/api/actions/buy-baskets/*" },
] as const;

export function actionsJsonRules(v1Enabled: boolean) {
  return [...(v1Enabled ? [V1_ACTION_RULE] : []), ...PROTOTYPE_ACTION_RULES];
}
