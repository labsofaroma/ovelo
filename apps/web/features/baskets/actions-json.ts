/**
 * The actions.json rule for v1 baskets (M5b B4): /v1/basket/* maps to /api/v1/actions/baskets/*
 * only while AROMA_V1_ENABLED is on; the prototype rules are unchanged. M7: /basket/* moves to
 * the v1 Action and the prototype rules are deleted (docs/M4-DEPLOY.md, M5 section).
 */
export const V1_ACTION_RULE = {
  pathPattern: "/v1/basket/*",
  apiPath: "/api/v1/actions/baskets/*",
} as const;
