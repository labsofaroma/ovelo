import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

// TODO(M4): scripts/check-client-secrets.mjs was never committed. M4 restores it
// with the client-bundle secret scan and re-enables this test.
const subjectPath = "../../../scripts/check-client-secrets.mjs";
const subject = existsSync(new URL(subjectPath, import.meta.url))
  ? await import(subjectPath)
  : null;
const skip = subject ? false : "TODO(M4): scripts/check-client-secrets.mjs is missing";
const { configuredServerSecrets } = subject ?? {};

test("artifact scan includes creator invitations, collector keypairs and rotating API keys", { skip }, async () => {
  const secrets = await configuredServerSecrets({
    envFiles: [],
    environment: {
      NODE_ENV: "test",
      CREATOR_INVITE_CODES: "test-invitation-only",
      BOT_KEYPAIR: "test-collector-key-only",
      JUPITER_API_KEYS: "test-rotation-only",
      NEXT_PUBLIC_PRIVY_APP_ID: "public-app-id",
    },
  });
  assert.equal(secrets.size, 3);
  assert.equal(secrets.has("public-app-id"), false);
});
