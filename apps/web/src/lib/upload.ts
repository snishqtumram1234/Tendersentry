// Shared multipart upload helper — the JSON `api()` client can't send FormData, so every
// file-upload screen (documents, vault, verification captures) needs this instead.
import { ApiError, type ApiErrorBody } from "./api";

function readCsrf(): string | null {
  const match = document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const csrf = readCsrf();
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    headers: csrf ? { "x-csrf-token": csrf } : {},
    body: form,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : undefined;
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  return data as T;
}
