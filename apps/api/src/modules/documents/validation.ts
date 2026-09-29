// File validation (spec §24): extension allow-list, MIME sniff by magic bytes (never trust the
// client-declared content-type alone), size cap, and a heuristic reject of encrypted PDFs.
// Deviation (docs/PROGRESS.md): full PDF structure parsing (page count, embedded-object scanning)
// is deferred to the Python engine document pipeline (spec §9.1, Phase 1); this is the upload-time
// gate only.
import { Errors } from "../../lib/errors.js";
import { config } from "../../config.js";

export const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

const EXT_BY_MIME: Record<AllowedMime, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

/** Heuristic: an `/Encrypt` dictionary reference anywhere in a PDF's trailer means it's encrypted. */
function looksEncryptedPdf(buf: Buffer): boolean {
  // Encryption dictionaries live near the end of the file; scanning the whole buffer is simplest
  // and cheap enough at the FILE_MAX_MB sizes this gate operates at.
  return buf.includes("/Encrypt");
}

export interface ValidatedFile {
  mime: AllowedMime;
  sizeBytes: number;
}

export function validateUploadedFile(originalFilename: string, buffer: Buffer): ValidatedFile {
  const maxBytes = config.FILE_MAX_MB * 1024 * 1024;
  if (buffer.length === 0) throw Errors.validation("The uploaded file is empty.");
  if (buffer.length > maxBytes) throw Errors.validation(`File exceeds the ${config.FILE_MAX_MB}MB limit.`, { maxMb: config.FILE_MAX_MB });

  const ext = originalFilename.toLowerCase().slice(originalFilename.lastIndexOf("."));
  const mime = sniffMime(buffer);
  if (!mime) throw Errors.validation("File type not recognised. Allowed: PDF, PNG, JPEG.");
  if (!EXT_BY_MIME[mime].includes(ext)) {
    throw Errors.validation("File extension does not match its actual content.", { declaredExt: ext, detectedMime: mime });
  }
  if (mime === "application/pdf" && looksEncryptedPdf(buffer)) {
    throw Errors.validation("Encrypted PDFs are not accepted. Please upload an unencrypted copy.");
  }

  return { mime, sizeBytes: buffer.length };
}
