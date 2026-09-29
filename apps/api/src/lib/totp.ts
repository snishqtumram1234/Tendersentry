// TOTP MFA (spec §6.4). Demo accounts may additionally accept DEMO_OTP when DEMO_MODE=true.
import { generateSecret as genSecret, generateURI, verify as verifyOtp } from "otplib";
import { config } from "../config.js";

export function generateSecret(): string {
  return genSecret();
}

export function otpauthUrl(secret: string, email: string): string {
  return generateURI({ issuer: "TenderSentry", label: email, secret });
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  try {
    const result = await verifyOtp({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

/** Accepts a real TOTP code, or the demo OTP for demo accounts in demo mode (spec §6.4). */
export async function verifyMfaCode(secret: string, code: string, isDemoAccount: boolean): Promise<boolean> {
  if (isDemoAccount && config.DEMO_MODE && code === config.DEMO_OTP) return true;
  return verifyTotp(secret, code);
}
