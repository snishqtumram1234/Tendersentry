// Password hashing (argon2id) and AES-GCM encryption for MFA secrets / provider credentials
// (spec §6.4, §24). APP_ENCRYPTION_KEY is a 32-byte base64 key.
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { config } from "../config.js";

const ARGON2_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

const encKey = Buffer.from(config.APP_ENCRYPTION_KEY, "base64");
if (encKey.length !== 32) {
  throw new Error(`APP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${encKey.length})`);
}

/** AES-256-GCM encrypt; returns base64(iv || authTag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
