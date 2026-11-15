/**
 * Phase H: a local `next start` (NODE_ENV=production) must say what it is, or the boot refuses it
 * (server/platform.ts). Every E2E and smoke server runs as a self-host development deployment:
 * the production rules are off, so the opt-in test switches can apply.
 */
export const LOCAL_START = {
  AROMA_PLATFORM: "selfhost",
  AROMA_DEPLOY_ENV: "development",
} as const;
