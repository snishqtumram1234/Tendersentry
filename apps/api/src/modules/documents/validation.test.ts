// Unit tests for the upload-time file gate (spec §24): content sniffing, extension mismatch,
// encrypted-PDF heuristic, size cap. No I/O — pure buffer manipulation.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validateUploadedFile } from "./validation.js";

function makePdf(body = "hello"): Buffer {
  return Buffer.from(`%PDF-1.4\n${body}\n%%EOF`);
}

function makePng(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
}

function makeJpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);
}

describe("validateUploadedFile", () => {
  it("accepts a real PDF with a .pdf extension", () => {
    expect(validateUploadedFile("tender.pdf", makePdf()).mime).toBe("application/pdf");
  });

  it("accepts a real PNG with a .png extension", () => {
    expect(validateUploadedFile("scan.png", makePng()).mime).toBe("image/png");
  });

  it("accepts a real JPEG with .jpg or .jpeg", () => {
    expect(validateUploadedFile("photo.jpg", makeJpeg()).mime).toBe("image/jpeg");
    expect(validateUploadedFile("photo.jpeg", makeJpeg()).mime).toBe("image/jpeg");
  });

  it("rejects a file whose content doesn't match its extension", () => {
    expect(() => validateUploadedFile("fake.png", Buffer.from("just some text"))).toThrow(/not recognised/);
  });

  it("rejects a real PDF wrongly labelled as .png (content/extension mismatch)", () => {
    expect(() => validateUploadedFile("mislabeled.png", makePdf())).toThrow(/does not match/);
  });

  it("rejects an empty file", () => {
    expect(() => validateUploadedFile("empty.pdf", Buffer.alloc(0))).toThrow(/empty/);
  });

  it("rejects a PDF containing an /Encrypt marker", () => {
    const encrypted = Buffer.from("%PDF-1.4\n1 0 obj<< /Encrypt 2 0 R >>endobj\ntrailer<< /Encrypt 2 0 R >>\n%%EOF");
    expect(() => validateUploadedFile("secret.pdf", encrypted)).toThrow(/Encrypted PDFs/);
  });

  it("accepts an unencrypted PDF that happens to mention 'Encrypt' nowhere", () => {
    expect(() => validateUploadedFile("plain.pdf", makePdf("no such thing here"))).not.toThrow();
  });

  describe("size limit", () => {
    const originalEnv = process.env.FILE_MAX_MB;
    beforeEach(() => {
      process.env.FILE_MAX_MB = "1"; // note: config.ts reads this at import time, so this only
      // demonstrates the intent; the real limit test below uses the already-loaded config value.
    });
    afterEach(() => {
      process.env.FILE_MAX_MB = originalEnv;
    });

    it("rejects a file larger than FILE_MAX_MB", async () => {
      const { config } = await import("../../config.js");
      const tooBig = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(config.FILE_MAX_MB * 1024 * 1024 + 1, 0x41)]);
      expect(() => validateUploadedFile("big.pdf", tooBig)).toThrow(/exceeds/);
    });
  });
});
