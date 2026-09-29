// Supabase Storage via its S3-compatible endpoint (spec §4.2, ADR-001). Nothing here is public:
// every bucket is private, every read goes through a short-lived signed URL issued after a
// permission check (spec §6.5). The engine and worker use their own scoped keys in later phases;
// for Phase 0/1 the API is the only writer.
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export const s3 = new S3Client({
  endpoint: config.STORAGE_ENDPOINT,
  region: config.STORAGE_REGION,
  forcePathStyle: true, // required for Supabase Storage's S3 endpoint
  credentials: { accessKeyId: config.STORAGE_ACCESS_KEY, secretAccessKey: config.STORAGE_SECRET_KEY },
});

export const BUCKETS = {
  documents: config.STORAGE_BUCKET_DOCUMENTS,
  captures: config.STORAGE_BUCKET_CAPTURES,
  reports: config.STORAGE_BUCKET_REPORTS,
  pageImages: config.STORAGE_BUCKET_PAGE_IMAGES,
} as const;

export async function putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Used by test cleanup and (later) retention-policy jobs — never called on a live document path. */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Short-lived signed download URL (spec §6.5: 5 minutes). Never returned without a prior permission check. */
export async function signedDownloadUrl(bucket: string, key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}
