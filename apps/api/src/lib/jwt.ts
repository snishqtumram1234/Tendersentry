// Access-token JWTs (spec §6.4): short-lived, httpOnly cookie, carries the resolved session context.
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import type { Role } from "@prisma/client";

const secret = new TextEncoder().encode(config.SESSION_JWT_SECRET);

export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // session id
  portal: "GOVERNMENT" | "BIDDER" | "PLATFORM";
  orgId: string | null;
  roles: Role[];
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${config.SESSION_TTL_MINUTES}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as AccessTokenPayload;
}
