// Phase H fix: the NEXT_PUBLIC_* values the browser bundle was built with travel inside the image
// (deploy/public-env.json, written by build-app.sh), and the entry point applies them to
// process.env before Next starts. Next inlines NEXT_PUBLIC_* into the bundle at build time, but
// server code (the CSP's connect-src, server/csp.ts) reads them at request time; without this the
// runtime stage (a fresh FROM) would not have them, and the CSP would block the bundle's own RPC,
// WebSocket and Sentry origins. The baked value wins over the env file: it is what the bundle
// calls. Public values only: the file holds nothing but NEXT_PUBLIC_* keys.

const PUBLIC = /^NEXT_PUBLIC_[A-Z0-9_]+$/;

/** The NEXT_PUBLIC_* entries of an environment, sorted (written at build time). */
export function publicEnvOf(env) {
  return Object.fromEntries(
    Object.keys(env)
      .filter((key) => PUBLIC.test(key) && typeof env[key] === "string")
      .sort()
      .map((key) => [key, env[key]]),
  );
}

/**
 * Apply the baked values to `env` in place. Returns the names whose runtime value differed (a
 * value set in the env file that the bundle does not use); values are never returned.
 */
export function applyPublicEnv(env, baked) {
  const overridden = [];
  for (const [key, value] of Object.entries(baked)) {
    if (!PUBLIC.test(key) || typeof value !== "string") continue;
    if (env[key] !== undefined && env[key] !== value) overridden.push(key);
    env[key] = value;
  }
  return overridden;
}
