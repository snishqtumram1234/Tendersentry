// Short-lived signed tokens that carry in-progress login state between steps
// (password verified → MFA → organisation selection), spec §6.4. Never touch the database;
// just prevent a client from skipping a step. 10 minutes is enough for a human to enter an OTP.
import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config.js";
import type { PortalType } from "@prisma/client";

const secret = new TextEncoder().encode(config.SESSION_JWT_SECRET + ":challenge");

export interface ChallengePayload {
  userId: string;
  portal: PortalType;
  mfaVerified: boolean;
}

export async function signChallenge(payload: ChallengePayload): Promise<string> {
  return new SignJWT({ ...payload }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
}

export async function verifyChallenge(token: string): Promise<ChallengePayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as ChallengePayload;
}
