/**
 * Prints a fresh VAPID key pair for web push (M11). Run by the owner, once per deployment:
 *   pnpm --filter @aroma/web notify:vapid
 * Put the values in the deployment's environment (never in git). Rotating them invalidates
 * every browser subscription: users turn push on again.
 */
import { generateVapidKeys } from "../features/notifications/server/channels/webpush";

const keys = generateVapidKeys();
process.stdout.write(
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,
);
