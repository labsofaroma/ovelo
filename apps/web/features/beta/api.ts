import { call, post } from "../compliance/api";
import {
  betaChallengeResponseSchema,
  betaRedeemResponseSchema,
  betaStatusSchema,
  type BetaStatus,
} from "./schema";

/** Client fetchers for /api/v1/beta/* (zod-parsed; errors carry the server's `{ code, message }`). */
export const betaApi = {
  status: (wallet: string | null): Promise<BetaStatus> =>
    call(
      `/api/v1/beta/status${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`,
      (b) => betaStatusSchema.parse(b),
    ),
  challenge: (wallet: string, code: string) =>
    call(
      "/api/v1/beta/challenge",
      (b) => betaChallengeResponseSchema.parse(b),
      post({ wallet, code }),
    ),
  redeem: (body: {
    wallet: string;
    code: string;
    nonce: string;
    signature: string;
  }) =>
    call(
      "/api/v1/beta/redeem",
      (b) => betaRedeemResponseSchema.parse(b),
      post(body),
    ),
};
