// Shared internal-only client for calling the engine (spec §4.1): X-Engine-Token auth, the §4.5
// error shape passed straight through. Used by modules/documents/processing.ts (Phase 1) and
// modules/tenders (Phase 2).
import { config } from "../config.js";

export class EngineError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function callEngine<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Engine-Token": config.ENGINE_TOKEN },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as T | { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string } })?.error;
    throw new EngineError(res.status, err?.code ?? "ENGINE_ERROR", err?.message ?? `Engine returned ${res.status}`);
  }
  return parsed as T;
}
