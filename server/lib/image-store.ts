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

/**
 * Filename overrides are interpolated into R2 keys and disk paths — reject
 * anything that could escape the prefix (`/`, `\`) or traverse (`..`) so a
 * future caller can't turn the override into a key-injection/path-traversal
 * vector. Single-segment safe charset only.
 */
function assertSafeFilenameOverride(filename: string): void {
  if (
    !/^[A-Za-z0-9._-]+$/.test(filename) ||
    filename.includes("..") ||
    /^\.+$/.test(filename)
  ) {
    throw new Error(`Unsafe filename override: ${filename}`);
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

/**
 * Persist a recipe image. Returns the stored URL.
 * AI-generated images are PNG (the default); pass `ext` when migrating
 * legacy disk images so JPEG/WebP bytes aren't stored as `image/png`.
 *
 * `filenameOverride` is for one-shot migration scripts ONLY: a deterministic
 * filename makes re-runs idempotent (same-key PUT overwrites instead of
 * orphaning the prior object). Runtime traffic must keep the random default.
 */
export async function saveRecipeImage(
  buffer: Buffer,
  ext: Ext = "png",
  filenameOverride?: string,
): Promise<string> {
  assertSize(buffer);
  if (filenameOverride) assertSafeFilenameOverride(filenameOverride);
  const filename = filenameOverride ?? `recipe-${crypto.randomUUID()}.${ext}`;
  const cfg = readR2Config();
  if (cfg) return putToR2(cfg, `recipe-images/${filename}`, buffer, ext);
  return putToDisk("recipe-images", filename, buffer);
}

/**
 * Persist a user avatar. Returns the stored URL.
 *
 * `filenameOverride` is for one-shot migration scripts ONLY (idempotent
 * re-runs); it must be non-reversible (e.g. hash-derived) — see the key
 * comment below. Runtime traffic must keep the random default.
 */
export async function saveAvatar(
  buffer: Buffer,
  ext: "jpg" | "png" | "webp",
  filenameOverride?: string,
): Promise<string> {
  assertSize(buffer);
  if (filenameOverride) assertSafeFilenameOverride(filenameOverride);
  // Random key (not userId + timestamp): avatar URLs live on a public CDN,
  // so the key must not leak the user's UUID or be guessable, and two
  // same-millisecond uploads must not silently overwrite each other.
  const filename = filenameOverride ?? `${crypto.randomUUID()}.${ext}`;
  const cfg = readR2Config();
  if (cfg) return putToR2(cfg, `avatars/${filename}`, buffer, ext);
  return putToDisk("avatars", filename, buffer);
}

/** Kind of stored image — maps to the key prefix the delete is scoped to. */
export type ImageKind = "avatar" | "recipe";

const KIND_PREFIX: Record<ImageKind, string> = {
  avatar: "avatars",
  recipe: "recipe-images",
};

/**
 * Delete a previously stored image by its stored URL. No-op on null/unknown.
 * Handles both R2 absolute URLs and legacy relative disk paths.
 *
 * `kind` scopes the deletion to the matching key prefix (`avatars/` or
 * `recipe-images/`). The AWS SDK provides no key-prefix enforcement, and
 * some image URLs (meal-plan recipes) are client-suppliable — without this
 * guard, a crafted URL could delete an arbitrary bucket object (IDOR).
 * A URL whose derived key does not start with the expected prefix is a
 * silent no-op, consistent with the unknown-URL behavior.
 */
export async function deleteImage(
  url: string | null | undefined,
  kind: ImageKind,
): Promise<void> {
  if (!url) return;
  const prefix = KIND_PREFIX[kind];
  const cfg = readR2Config();
  if (cfg) {
    const normalizedBase = cfg.publicBaseUrl.replace(/\/$/, "");
    if (url.startsWith(normalizedBase + "/")) {
      const key = url.slice(normalizedBase.length + 1);
      // Prefix guard: only delete objects of the expected kind.
      if (!key.startsWith(`${prefix}/`)) return;
      await client(cfg).send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
      return;
    }
  }
  // Legacy disk path for this kind: /api/<prefix>/<f>
  if (url.startsWith(`/api/${prefix}/`)) {
    const safe = path.basename(url); // prevents traversal
    await fs.promises
      .unlink(path.join(UPLOADS_ROOT, prefix, safe))
      .catch(() => {});
  }
}
