# Phase 1 — Railway + Cloudflare Deployment (Infra Spine + R2 Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up OCRecipes' Express API + managed Postgres on Railway behind a Cloudflare-managed domain, with all user/generated images moved off the ephemeral filesystem into Cloudflare R2 — so the first deploy is durable and reproducible.

**Architecture:** A new `server/lib/image-store.ts` becomes the single image-persistence chokepoint: it writes to R2 when R2 env vars are present, and falls back to local disk otherwise (preserving dev/test behavior). The three existing write paths (two `saveImageBuffer` duplicates + the avatar write) delegate to it. A backfill script (cloning the existing `migrate-recipe-images.ts` pattern) pushes pre-existing disk images to R2 and rewrites their stored URLs to absolute CDN URLs. The client needs no change — `resolveImageUrl()` already passes absolute URLs through. The infra is provisioned via a `railway.json` (Nixpacks) plus an ordered Cloudflare/Railway/DNS runbook.

**Tech Stack:** Express 5, Drizzle ORM + `pg`, Vitest, `@aws-sdk/client-s3` (R2 is S3-compatible), Railway (Nixpacks), Cloudflare (DNS + R2), Expo (web build deferred to Phase 2).

**Spec:** `docs/superpowers/specs/2026-06-07-railway-cloudflare-deployment-design.md`

---

## File Structure

**Code (Part A):**

- Create: `server/lib/image-store.ts` — R2-or-disk image persistence chokepoint (`saveRecipeImage`, `saveAvatar`, `deleteImage`, `isR2Configured`).
- Create: `server/lib/__tests__/image-store.test.ts` — unit tests (R2 mode mocked, disk fallback, delete, config detection).
- Modify: `server/lib/env.ts` — add optional R2 vars + a production guard that fails closed if R2 is unconfigured in production.
- Modify: `server/services/recipe-generation.ts:28-29,360-372` — delegate local `saveImageBuffer` to `saveRecipeImage`; drop the import-time `mkdirSync`.
- Modify: `server/lib/runware.ts:178-193` — delegate exported `saveImageBuffer` to `saveRecipeImage`; drop the unused `IMAGES_DIR`.
- Modify: `server/routes/auth.ts:35-42,308-323` (+ avatar DELETE handler) — use `saveAvatar` / `deleteImage`; remove the local `AVATAR_DIR` + `deleteOldAvatarFile`.
- Modify: `client/lib/__tests__/query-client.test.ts` (or create if absent) — regression test that `resolveImageUrl` passes an absolute R2 URL through unchanged.
- Create: `server/scripts/migrate-images-to-r2.ts` — one-shot backfill of disk images → R2 + DB URL rewrite.

**Config / infra (Parts B–C):**

- Create: `railway.json` — Nixpacks build/start/healthcheck, single replica.
- Create: `.nvmrc` — pin Node 24 for reproducible Railway builds.
- Runbook (no repo file): Cloudflare account/zone, R2 bucket + custom domain, Railway project + Postgres + secrets, `db:push`, deploy, run backfill, nameserver cutover.

---

# PART A — R2 image migration (code, TDD)

### Task 1: `image-store.ts` chokepoint

**Files:**

- Create: `server/lib/image-store.ts`
- Create: `server/lib/__tests__/image-store.test.ts`

- [ ] **Step 1: Add the R2 client dependency**

Run: `npm install @aws-sdk/client-s3`
Expected: `@aws-sdk/client-s3` added to `dependencies` in `package.json`; `npm ci` style lockfile updated.

- [ ] **Step 2: Write the failing tests**

Create `server/lib/__tests__/image-store.test.ts`. These use the project's env-dependent-module pattern: set `process.env` then dynamically import the module so module-scope config/client are re-read.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn((input) => ({ __cmd: "Put", input })),
  DeleteObjectCommand: vi.fn((input) => ({ __cmd: "Delete", input })),
}));

const R2_ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "ak",
  R2_SECRET_ACCESS_KEY: "sk",
  R2_BUCKET: "ocrecipes-images",
  R2_PUBLIC_BASE_URL: "https://img.example.com",
};

function setR2Env(on: boolean) {
  for (const k of Object.keys(R2_ENV)) delete process.env[k];
  if (on) Object.assign(process.env, R2_ENV);
}

async function load() {
  vi.resetModules();
  return await import("../image-store");
}

describe("image-store", () => {
  beforeEach(() => sendMock.mockReset().mockResolvedValue({}));
  afterEach(() => setR2Env(false));

  it("isR2Configured is false when any R2 var is missing", async () => {
    setR2Env(true);
    delete process.env.R2_BUCKET;
    const { isR2Configured } = await load();
    expect(isR2Configured()).toBe(false);
  });

  it("isR2Configured is true when all R2 vars are present", async () => {
    setR2Env(true);
    const { isR2Configured } = await load();
    expect(isR2Configured()).toBe(true);
  });

  it("saveRecipeImage uploads to R2 and returns an absolute CDN URL", async () => {
    setR2Env(true);
    const { saveRecipeImage } = await load();
    const url = await saveRecipeImage(Buffer.from("png-bytes"));
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__cmd).toBe("Put");
    expect(cmd.input.Bucket).toBe("ocrecipes-images");
    expect(cmd.input.Key).toMatch(/^recipe-images\/recipe-[0-9a-f-]+\.png$/);
    expect(cmd.input.ContentType).toBe("image/png");
    expect(url).toMatch(
      /^https:\/\/img\.example\.com\/recipe-images\/recipe-[0-9a-f-]+\.png$/,
    );
  });

  it("saveAvatar uploads under avatars/ with the given extension", async () => {
    setR2Env(true);
    const { saveAvatar } = await load();
    const url = await saveAvatar(Buffer.from("jpg-bytes"), "jpg", "user-42");
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input.Key).toMatch(/^avatars\/user-42-\d+\.jpg$/);
    expect(cmd.input.ContentType).toBe("image/jpeg");
    expect(url).toMatch(
      /^https:\/\/img\.example\.com\/avatars\/user-42-\d+\.jpg$/,
    );
  });

  it("deleteImage sends a DeleteObjectCommand for an R2 URL", async () => {
    setR2Env(true);
    const { deleteImage } = await load();
    await deleteImage("https://img.example.com/avatars/user-42-1.jpg");
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__cmd).toBe("Delete");
    expect(cmd.input.Key).toBe("avatars/user-42-1.jpg");
  });

  it("rejects oversized recipe images", async () => {
    setR2Env(true);
    const { saveRecipeImage } = await load();
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(saveRecipeImage(tooBig)).rejects.toThrow(/too large/i);
  });

  it("disk fallback returns a relative path when R2 is unconfigured", async () => {
    setR2Env(false);
    const fsp = await import("node:fs");
    vi.spyOn(fsp.default.promises, "mkdir").mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(fsp.default.promises, "writeFile").mockResolvedValue(
      undefined as never,
    );
    const { saveRecipeImage } = await load();
    const url = await saveRecipeImage(Buffer.from("png-bytes"));
    expect(url).toMatch(/^\/api\/recipe-images\/recipe-[0-9a-f-]+\.png$/);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run server/lib/__tests__/image-store.test.ts`
Expected: FAIL — `Cannot find module '../image-store'`.

- [ ] **Step 4: Implement `server/lib/image-store.ts`**

```ts
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
  if (cfg && url.startsWith(cfg.publicBaseUrl.replace(/\/$/, ""))) {
    const key = url.slice(cfg.publicBaseUrl.replace(/\/$/, "").length + 1);
    await client(cfg).send(
      new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    return;
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

/** Test-only: drop the cached S3 client so env changes take effect. */
export function __resetImageStoreForTests(): void {
  cachedClient = null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/lib/__tests__/image-store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add server/lib/image-store.ts server/lib/__tests__/image-store.test.ts package.json package-lock.json
git commit -m "feat(storage): add R2-or-disk image-store chokepoint"
```

---

### Task 2: Register R2 env vars + production fail-closed guard

**Files:**

- Modify: `server/lib/env.ts:11-59` (schema), `:82-114` (warnings/guards)
- Test: `server/lib/__tests__/env.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/extend `server/lib/__tests__/env.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const BASE = {
  DATABASE_URL: "postgres://localhost/test",
  JWT_SECRET: "x".repeat(32),
};

async function load() {
  vi.resetModules();
  return await import("../env");
}

describe("validateEnv R2 production guard", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
  });
  afterEach(() => {
    process.env = saved;
  });

  it("throws in production when R2 is not configured", async () => {
    process.env.NODE_ENV = "production";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(/R2.*production/i);
  });

  it("passes in production when all R2 vars are set", async () => {
    process.env.NODE_ENV = "production";
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
      R2_PUBLIC_BASE_URL: "https://img.example.com",
    });
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });

  it("does not require R2 outside production", async () => {
    process.env.NODE_ENV = "development";
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/lib/__tests__/env.test.ts`
Expected: FAIL — production case does not throw yet.

- [ ] **Step 3: Add the schema fields**

In `server/lib/env.ts`, add to the `envSchema` object (after the `RUNWARE_API_KEY` line, near `:28`):

```ts
  // Cloudflare R2 image storage (required in production — see guard below)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
```

- [ ] **Step 4: Add the production guard**

In `validateEnv()`, after the `RECEIPT_VALIDATION_STUB` guard block (near `:114`), add:

```ts
const r2Configured =
  validated.R2_ACCOUNT_ID &&
  validated.R2_ACCESS_KEY_ID &&
  validated.R2_SECRET_ACCESS_KEY &&
  validated.R2_BUCKET &&
  validated.R2_PUBLIC_BASE_URL;
if (!r2Configured) {
  if (validated.NODE_ENV === "production") {
    throw new Error(
      "R2 image storage is not configured but NODE_ENV=production — " +
        "uploaded images would be written to Railway's ephemeral disk and " +
        "lost on every redeploy. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.",
    );
  }
  warnings.push("R2 not configured — images stored on local (ephemeral) disk");
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run server/lib/__tests__/env.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/env.ts server/lib/__tests__/env.test.ts
git commit -m "feat(env): require R2 config in production, warn in dev"
```

---

### Task 3: Route recipe-image writes through image-store

**Files:**

- Modify: `server/services/recipe-generation.ts:28-29,360-372`
- Modify: `server/lib/runware.ts:178-193`

- [ ] **Step 1: Update `recipe-generation.ts`**

Add the import near the other lib imports (after line 20):

```ts
import { saveRecipeImage } from "../lib/image-store";
```

Delete the import-time mkdir (lines 28-29):

```ts
// DELETE these two lines:
const RECIPE_IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");
fs.mkdirSync(RECIPE_IMAGES_DIR, { recursive: true });
```

Replace the local `saveImageBuffer` (lines 360-372) with a thin delegate (keeps all call sites unchanged):

```ts
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

async function saveImageBuffer(buffer: Buffer): Promise<string> {
  return saveRecipeImage(buffer);
}
```

> After this, `fs`, `path`, and possibly `crypto` may be unused in this file. Run lint (Step 3) and remove any now-unused imports it flags.

- [ ] **Step 2: Update `runware.ts`**

Add the import near the top of the file (with the other relative imports):

```ts
import { saveRecipeImage } from "./image-store";
```

Replace the `IMAGES_DIR` const + `saveImageBuffer` body (lines 178-193) with:

```ts
const MAX_IMAGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Persist a generated image Buffer (delegates to the image-store, which writes
 * to R2 in production and disk in dev). Returns the stored URL.
 */
export async function saveImageBuffer(buffer: Buffer): Promise<string> {
  return saveRecipeImage(buffer);
}
```

> If `path` / `fs` become unused in `runware.ts`, remove those imports (lint will flag).

- [ ] **Step 3: Run lint + the affected service tests**

Run: `npx vitest run server/services/__tests__/recipe-generation.test.ts && env ESLINT_NO_TYPE_AWARE=1 npx eslint server/services/recipe-generation.ts server/lib/runware.ts`
Expected: tests PASS; eslint clean (fix any unused-import errors it reports).

- [ ] **Step 4: Commit**

```bash
git add server/services/recipe-generation.ts server/lib/runware.ts
git commit -m "refactor(images): route recipe-image writes through image-store"
```

---

### Task 4: Route avatar write/delete through image-store

**Files:**

- Modify: `server/routes/auth.ts:35-42` (remove local dir + helper), `:308-323` (write path), avatar DELETE handler (replace `deleteOldAvatarFile`)

- [ ] **Step 1: Inspect the avatar DELETE handler**

Run: `sed -n '338,380p' server/routes/auth.ts`
Expected: locate every call to `deleteOldAvatarFile(...)` (the upload handler at ~313 and the delete handler below ~339).

- [ ] **Step 2: Add the import + remove the local disk helpers**

Add near the other relative imports (after line 32):

```ts
import { saveAvatar, deleteImage } from "../lib/image-store";
```

Delete the `AVATAR_DIR` const + `mkdirSync` + `deleteOldAvatarFile` (lines 35-42):

```ts
// DELETE these lines:
const AVATAR_DIR = path.resolve(process.cwd(), "uploads/avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function deleteOldAvatarFile(avatarUrl: string | null | undefined): void {
  if (!avatarUrl?.startsWith("/api/avatars/")) return;
  const safeName = path.basename(avatarUrl);
  fs.unlink(path.join(AVATAR_DIR, safeName), () => {});
}
```

- [ ] **Step 3: Update the avatar upload handler (lines 308-323)**

Replace the filename/filepath/write block:

```ts
// Old avatar (if any) is removed from storage after the new one lands.
const currentUser = await storage.getUser(req.userId);
const avatarUrl = await saveAvatar(req.file.buffer, ext, req.userId);

const user = await storage.updateUser(req.userId, { avatarUrl });

if (!user) {
  await deleteImage(avatarUrl); // roll back the just-uploaded object
  return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
}

await deleteImage(currentUser?.avatarUrl); // best-effort cleanup
res.json({ avatarUrl: user.avatarUrl });
```

- [ ] **Step 4: Update the avatar DELETE handler**

Replace its `deleteOldAvatarFile(<x>)` call with `await deleteImage(<x>)` (use the same argument the handler currently passes — typically the user's current `avatarUrl`).

- [ ] **Step 5: Remove now-unused `fs` / `path` imports if lint flags them, then run tests**

Run: `npx vitest run server/routes/__tests__/auth.test.ts && env ESLINT_NO_TYPE_AWARE=1 npx eslint server/routes/auth.ts`
Expected: PASS + clean. (If there is no `auth.test.ts`, run the avatar route test file that exists; locate with `grep -rl "avatar" server/routes/__tests__`.)

- [ ] **Step 6: Commit**

```bash
git add server/routes/auth.ts
git commit -m "refactor(images): route avatar write/delete through image-store"
```

---

### Task 5: Lock client passthrough of absolute image URLs (regression test only)

**Files:**

- Modify/Create: `client/lib/__tests__/query-client.test.ts`

No production change — `resolveImageUrl` (`client/lib/query-client.ts:223`) already returns `http(s)`/`data:` URLs unchanged. This test prevents a future refactor from re-breaking R2 URLs.

- [ ] **Step 1: Add the test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveImageUrl } from "@/lib/query-client";

describe("resolveImageUrl", () => {
  it("returns absolute R2/CDN URLs unchanged", () => {
    const url = "https://img.example.com/recipe-images/recipe-abc.png";
    expect(resolveImageUrl(url)).toBe(url);
  });
  it("passes data: URLs through unchanged", () => {
    expect(resolveImageUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });
  it("returns null for nullish input", () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run client/lib/__tests__/query-client.test.ts`
Expected: PASS. (If `query-client.ts` has import-time side effects that break a node-env import, instead extract no test and rely on existing coverage — verify first with the run; the `@vitest-environment node` pragma usually suffices.)

- [ ] **Step 3: Commit**

```bash
git add client/lib/__tests__/query-client.test.ts
git commit -m "test(client): lock resolveImageUrl passthrough of absolute URLs"
```

---

### Task 6: Backfill script — disk images → R2

**Files:**

- Create: `server/scripts/migrate-images-to-r2.ts`

Clones the structure of `server/scripts/migrate-recipe-images.ts`. Selects rows whose stored URL is a legacy relative `/api/...` path, reads the file from local disk, uploads via the image-store, and rewrites the column to the absolute CDN URL. Idempotent (skips already-absolute URLs); supports `--dry-run`. **Must run while the disk files still exist** (i.e., from the machine/volume that holds `uploads/`, before the first ephemeral wipe).

- [ ] **Step 1: Write the script**

```ts
/* eslint-disable no-console */
/**
 * One-shot backfill: upload existing on-disk images to Cloudflare R2 and
 * rewrite their stored URLs (relative `/api/...`) to absolute CDN URLs.
 *
 * Covers communityRecipes.imageUrl, mealPlanRecipes.imageUrl, users.avatarUrl.
 * Requires R2_* env vars set and the local `uploads/` tree present.
 *
 * Usage:
 *   npx tsx server/scripts/migrate-images-to-r2.ts            # apply
 *   npx tsx server/scripts/migrate-images-to-r2.ts --dry-run  # preview only
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import { communityRecipes, mealPlanRecipes, users } from "@shared/schema";
import { eq, like } from "drizzle-orm";
import {
  isR2Configured,
  saveRecipeImage,
  saveAvatar,
} from "../lib/image-store";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const DRY_RUN = process.argv.includes("--dry-run");

function diskPathFor(relativeUrl: string): string | null {
  // /api/recipe-images/<f> -> uploads/recipe-images/<f>; same for avatars
  const m = relativeUrl.match(/^\/api\/(recipe-images|avatars)\/(.+)$/);
  if (!m) return null;
  return path.join(UPLOADS_ROOT, m[1], path.basename(m[2]));
}

function extOf(file: string): "jpg" | "png" | "webp" {
  const e = path.extname(file).slice(1).toLowerCase();
  if (e === "png") return "png";
  if (e === "webp") return "webp";
  return "jpg";
}

async function uploadOne(
  relativeUrl: string,
  kind: "recipe" | "avatar",
  userId?: string,
): Promise<string | null> {
  const diskPath = diskPathFor(relativeUrl);
  if (!diskPath || !fs.existsSync(diskPath)) {
    console.log(`  MISSING on disk: ${relativeUrl}`);
    return null;
  }
  if (DRY_RUN) {
    console.log(`  [dry-run] would upload ${relativeUrl}`);
    return null;
  }
  const buffer = await fs.promises.readFile(diskPath);
  return kind === "recipe"
    ? saveRecipeImage(buffer)
    : saveAvatar(buffer, extOf(diskPath), userId ?? "user");
}

async function migrateRecipeTable(
  label: string,
  table: typeof communityRecipes | typeof mealPlanRecipes,
) {
  const rows = await db
    .select({ id: table.id, imageUrl: table.imageUrl })
    .from(table)
    .where(like(table.imageUrl, "/api/recipe-images/%"));
  console.log(`\n${label}: ${rows.length} row(s) to migrate`);
  let done = 0;
  for (const row of rows) {
    const newUrl = await uploadOne(row.imageUrl!, "recipe");
    if (newUrl) {
      await db
        .update(table)
        .set({ imageUrl: newUrl })
        .where(eq(table.id, row.id));
      done++;
      console.log(`  [${row.id}] -> ${newUrl}`);
    }
  }
  return done;
}

async function migrateAvatars() {
  const rows = await db
    .select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users)
    .where(like(users.avatarUrl, "/api/avatars/%"));
  console.log(`\nusers.avatarUrl: ${rows.length} row(s) to migrate`);
  let done = 0;
  for (const row of rows) {
    const newUrl = await uploadOne(row.avatarUrl!, "avatar", row.id);
    if (newUrl) {
      await db
        .update(users)
        .set({ avatarUrl: newUrl })
        .where(eq(users.id, row.id));
      done++;
      console.log(`  [${row.id}] -> ${newUrl}`);
    }
  }
  return done;
}

async function main() {
  console.log(
    `=== Migrate disk images to R2 ${DRY_RUN ? "(dry-run)" : ""} ===`,
  );
  if (!DRY_RUN && !isR2Configured()) {
    throw new Error(
      "R2 is not configured — set R2_* env vars before applying.",
    );
  }
  const a = await migrateRecipeTable("communityRecipes", communityRecipes);
  const b = await migrateRecipeTable("mealPlanRecipes", mealPlanRecipes);
  const c = await migrateAvatars();
  console.log(`\n=== Done. recipes=${a + b}, avatars=${c} ===`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  void pool.end().then(() => process.exit(1));
});
```

> Before running, confirm `mealPlanRecipes` is a table with an `imageUrl` column (grep showed `mealPlanRecipes.imageUrl`). If any selected table lacks the column at implementation time, drop that block — don't invent columns.

- [ ] **Step 2: Type-check the script**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep migrate-images-to-r2 || echo "no type errors in script"`
Expected: `no type errors in script`.

- [ ] **Step 3: Add an npm script + commit**

Add to `package.json` `scripts`:

```json
"migrate:images-r2": "tsx server/scripts/migrate-images-to-r2.ts",
```

```bash
git add server/scripts/migrate-images-to-r2.ts package.json
git commit -m "feat(scripts): backfill disk images to R2"
```

---

# PART B — Railway build config

### Task 7: `railway.json` + Node pin

**Files:**

- Create: `railway.json`
- Create: `.nvmrc`

- [ ] **Step 1: Create `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run server:build"
  },
  "deploy": {
    "startCommand": "npm run server:prod",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

- [ ] **Step 2: Create `.nvmrc`** (Nixpacks reads this to pin the Node version; matches CI's Node 24)

```
24
```

- [ ] **Step 3: Verify the production build works locally**

Run: `npm run server:build && test -f server_dist/index.js && echo "build OK"`
Expected: `build OK`. (This proves the esbuild bundle that Railway's `startCommand` runs.)

- [ ] **Step 4: Commit**

```bash
git add railway.json .nvmrc
git commit -m "chore(deploy): add Railway Nixpacks config + Node pin"
```

---

# PART C — Infra runbook (operator steps, run in order)

These are console/CLI actions, not code. Each has an explicit verification. **Do them in this order** — the sequencing prevents the two irreversible failure modes (image loss on first deploy; DNS resolution gap during nameserver cutover). Where the user has connected Cloudflare MCP / `wrangler`, the agent can perform the R2 and DNS steps directly; otherwise they're dashboard actions.

- [ ] **C1. Cloudflare zone, records first (no nameserver switch yet).** Create a Cloudflare account; add `<domain>` as a zone. In the new zone, **recreate every DNS record currently live at Hostinger** (so nothing breaks when NS flips). Do **not** change nameservers yet.
  - Verify: Cloudflare's zone "DNS records" matches the current Hostinger set.

- [ ] **C2. R2 bucket + public custom domain.** Create R2 bucket `ocrecipes-images`. Attach a **custom domain** `img.<domain>` (R2 → Settings → Public access → Custom Domains) so the CDN fronts it with zero egress. Create an R2 **API token** (Object Read & Write) → capture Account ID, Access Key ID, Secret Access Key.
  - Verify: uploading a test object and fetching `https://img.<domain>/<key>` returns 200.

- [ ] **C3. Railway project: app service.** Create a Railway project; connect the GitHub repo. Railway picks up `railway.json` (Nixpacks). Set the service root to the repo root.
  - Verify: first build logs show `npm run server:build` running and **`sharp`/`bcrypt` compiling without error** (the Nixpacks-vs-Dockerfile checkpoint — if they fail here, switch `builder` to a Dockerfile; see spec risk #1).

- [ ] **C4. Railway managed Postgres.** Add the PostgreSQL plugin to the same project; rely on private networking. Railway injects `DATABASE_URL` into the app service.
  - Verify: `DATABASE_URL` is present in the app service variables.

- [ ] **C5. Set all secrets on the Railway app service** (see spec §1e). Required: `JWT_SECRET` (≥32 chars), `NODE_ENV=production`, `EXPO_PUBLIC_DOMAIN=https://api.<domain>`, and the five `R2_*` vars from C2 (`R2_PUBLIC_BASE_URL=https://img.<domain>`). Add optional AI/data/push/IAP keys as available.
  - Verify: a deploy boots past `validateEnv()` — i.e., the R2 production guard (Task 2) does **not** throw, proving R2 is wired.

- [ ] **C6. Push the schema.** From a machine with the Railway `DATABASE_URL` exported: `psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"` then `npm run db:push`.
  - Verify: `psql "$DATABASE_URL" -c "\dt"` lists the app tables.

- [ ] **C7. First deploy + image backfill.** Deploy the app. If there is pre-existing image data on a dev/local `uploads/` tree, run the backfill **from that machine** with the R2 env vars set: `npm run migrate:images-r2 -- --dry-run` then `npm run migrate:images-r2`.
  - Verify: `https://api.<domain>/api/health` → `{"status":"ok"}`; backfill reports 0 missing; spot-check an image now resolves via `img.<domain>`.

- [ ] **C8. Point `api.<domain>` at Railway.** Generate the Railway public domain (or custom domain); add a **proxied CNAME** `api` → the Railway target in Cloudflare.
  - Verify: `curl -s https://api.<domain>/api/health` returns `{"status":"ok"}` through Cloudflare.

- [ ] **C9. Nameserver cutover.** At **Hostinger**, change the domain's nameservers to the two Cloudflare assigned (C1). Keep registration at Hostinger.
  - Verify: `dig NS <domain>` shows Cloudflare nameservers (allow up to ~24h); `api.<domain>` and `img.<domain>` resolve.

- [ ] **C10. Acceptance pass (spec §1g).** Confirm: redeploy does **not** lose images; new avatar upload + new recipe-image generation land in R2; backfill shows 0 remaining relative rows; a dev build of the mobile app pointed at `api.<domain>` logs in, scans, and loads images. Once 0 relative rows remain, file a follow-up to remove the Express `/api/recipe-images` + `/api/avatars` static fallback routes (`server/index.ts:179-198`).

---

## Out of scope (Phase 2 / later)

- Web frontend (`expo export -p web` + native-dep spike + Workers Static Assets) — separate plan after the feasibility spike.
- Resend/email, mobile EAS submission, Redis/multi-instance, edge-proxy Worker, Verified-Product-API Worker.

---

## Self-Review

**1. Spec coverage** — every Phase 1 spec item maps to a task:

- Railway app (Nixpacks/railway.json, health, single replica, PORT) → Task 7, C3, C5.
- Railway managed Postgres + pg_trgm + db:push → C4, C6.
- R2 migration (3 write sites, backfill, client guard, env) → Tasks 1–6.
- Cloudflare account/DNS/R2 custom domain → C1, C2.
- Secrets list + CORS via `EXPO_PUBLIC_DOMAIN` → C5.
- Nameserver cutover ordering + record pre-creation → C1, C8, C9.
- Acceptance criteria → C7, C10.
- Static-route removal follow-up → C10.

**2. Placeholder scan** — `<domain>` is an intentional operator fill-in (the only one), flagged as such. No "TBD"/"add error handling"/"similar to" placeholders; every code step shows full code.

**3. Type/name consistency** — `saveRecipeImage`/`saveAvatar`/`deleteImage`/`isR2Configured` are defined in Task 1 and used identically in Tasks 3, 4, 6. `R2_*` env names match across Task 1 (`readR2Config`), Task 2 (schema + guard), and C5 (operator secrets). Disk-fallback URL shape `/api/<prefix>/<filename>` matches the existing Express static routes and the backfill's `diskPathFor` regex.

**Open implementation-time checks flagged inline:** unused-import cleanup after the delegations (lint-gated); confirm `mealPlanRecipes.imageUrl` exists before including that backfill block; confirm the avatar route test filename; confirm `query-client.ts` imports cleanly under `@vitest-environment node`.
