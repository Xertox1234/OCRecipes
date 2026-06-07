/**
 * Centralized image persistence.
 *
 * - When R2 is configured (all R2_* env vars present) → upload to Cloudflare R2
 *   and return an ABSOLUTE CDN URL: `${R2_PUBLIC_BASE_URL}/<key>`.
 * - Otherwise → write to local disk under uploads/<prefix>/ and return a
 *   RELATIVE path `/api/<prefix>/<filename>` (legacy dev/test behavior).
 *
 * The client's resolveImageUrl() passes absolute URLs through unchanged and
 * prepends the API base to relative ones, so both modes are transparent to it.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — matches prior behavior

type Ext = "png" | "jpg" | "jpeg" | "webp";
const CONTENT_TYPE: Record<Ext, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket ||
    !publicBaseUrl
  ) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function isR2Configured(): boolean {
  return readR2Config() !== null;
}

let cachedClient: S3Client | null = null;
function client(cfg: R2Config): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return cachedClient;
}

function assertSize(buffer: Buffer): void {
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Image too large: ${buffer.length} bytes (max ${MAX_IMAGE_SIZE_BYTES})`,
    );
  }
}

function publicUrl(cfg: R2Config, key: string): string {
  return `${cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`;
}

async function putToDisk(
  prefix: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const dir = path.join(UPLOADS_ROOT, prefix);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, filename), buffer);
  return `/api/${prefix}/${filename}`;
}

async function putToR2(
  cfg: R2Config,
  key: string,
  buffer: Buffer,
  ext: Ext,
): Promise<string> {
  await client(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: CONTENT_TYPE[ext],
    }),
  );
  return publicUrl(cfg, key);
}

/** Persist a generated recipe image (PNG). Returns the stored URL. */
export async function saveRecipeImage(buffer: Buffer): Promise<string> {
  assertSize(buffer);
  const filename = `recipe-${crypto.randomUUID()}.png`;
  const cfg = readR2Config();
  if (cfg) return putToR2(cfg, `recipe-images/${filename}`, buffer, "png");
  return putToDisk("recipe-images", filename, buffer);
}

/** Persist a user avatar. Returns the stored URL. */
export async function saveAvatar(
  buffer: Buffer,
  ext: "jpg" | "png" | "webp",
  userId: string,
): Promise<string> {
  assertSize(buffer);
  const filename = `${userId}-${Date.now()}.${ext}`;
  const cfg = readR2Config();
  if (cfg) return putToR2(cfg, `avatars/${filename}`, buffer, ext);
  return putToDisk("avatars", filename, buffer);
}

/**
 * Delete a previously stored image by its stored URL. No-op on null/unknown.
 * Handles both R2 absolute URLs and legacy relative disk paths.
 */
export async function deleteImage(
  url: string | null | undefined,
): Promise<void> {
  if (!url) return;
  const cfg = readR2Config();
  if (cfg) {
    const normalizedBase = cfg.publicBaseUrl.replace(/\/$/, "");
    if (url.startsWith(normalizedBase + "/")) {
      const key = url.slice(normalizedBase.length + 1);
      await client(cfg).send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
      return;
    }
  }
  // Legacy disk paths: /api/avatars/<f> or /api/recipe-images/<f>
  for (const prefix of ["avatars", "recipe-images"]) {
    if (url.startsWith(`/api/${prefix}/`)) {
      const safe = path.basename(url); // prevents traversal
      await fs.promises
        .unlink(path.join(UPLOADS_ROOT, prefix, safe))
        .catch(() => {});
      return;
    }
  }
}
