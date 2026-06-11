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
 *   MIGRATE_CONCURRENCY=8 npx tsx server/scripts/migrate-images-to-r2.ts
 *     # bounded per-row upload concurrency (default 5, clamped to [1, 10])
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
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

/**
 * Bounded concurrency for per-row uploads (mirrors SEED_CONCURRENCY in
 * seed-recipes.ts). Clamped to [1, 10] to guard against negative/absurd
 * inputs — p-limit throws on non-positive concurrency.
 */
const MIGRATE_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.MIGRATE_CONCURRENCY) || 5),
);

// Fail loudly on unrecognized flags — a typo like `--dryrun` would
// otherwise silently APPLY the migration.
const unknownFlags = process.argv.slice(2).filter((a) => a !== "--dry-run");
if (unknownFlags.length > 0) {
  console.error(`Unknown argument(s): ${unknownFlags.join(", ")}`);
  console.error(
    "Usage: npx tsx server/scripts/migrate-images-to-r2.ts [--dry-run]",
  );
  process.exit(2);
}

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

type UploadResult =
  | { status: "uploaded"; url: string }
  | { status: "wouldMigrate" }
  | { status: "missing" };

/**
 * Upload one row's image with a DETERMINISTIC key (`<keyStem>.<ext>`) so
 * re-runs are idempotent: if the upload succeeded but the DB UPDATE failed,
 * the retry PUTs the same key and overwrites instead of orphaning the first
 * object (runtime saveRecipeImage/saveAvatar keep their random keys).
 *
 * `keyStemFor` receives the file bytes so avatar stems can mix in a content
 * hash (see avatarKeyStem); recipe stems ignore the argument.
 */
async function uploadOne(
  relativeUrl: string,
  kind: "recipe" | "avatar",
  keyStemFor: (buffer: Buffer) => string,
): Promise<UploadResult> {
  const diskPath = diskPathFor(relativeUrl);
  if (!diskPath || !fs.existsSync(diskPath)) {
    console.log(`  MISSING on disk: ${relativeUrl}`);
    return { status: "missing" };
  }
  if (DRY_RUN) {
    console.log(`  [dry-run] would upload ${relativeUrl}`);
    return { status: "wouldMigrate" };
  }
  const buffer = await fs.promises.readFile(diskPath);
  // Legacy disk recipe images can be jpg/webp — pass the real extension
  // so the R2 object isn't stored with an image/png ContentType.
  const ext = extOf(diskPath);
  const filename = `${keyStemFor(buffer)}.${ext}`;
  if (kind === "recipe") {
    return {
      status: "uploaded",
      url: await saveRecipeImage(buffer, ext, filename),
    };
  }
  return {
    status: "uploaded",
    url: await saveAvatar(buffer, ext, filename),
  };
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic avatar key stem that is NOT forward-computable from the user
 * id alone: avatar keys live on a public CDN and must not be guessable (see
 * saveAvatar) — and user ids ARE exposed cross-user (community recipes return
 * `authorId`), so a bare hash of the id would let anyone derive another
 * user's avatar URL. Mixing in the image content hash keeps the stem stable
 * across re-runs (same disk file → same key) while requiring the avatar bytes
 * themselves to compute it; including the user id prevents two users with
 * identical images from sharing one object (whose deletion would break the
 * other's URL).
 */
function avatarKeyStem(userId: string, buffer: Buffer): string {
  const digest = sha256Hex(`${userId}:${sha256Hex(buffer)}`).slice(0, 32);
  return `avatar-migrated-${digest}`;
}

type MigrationCounts = {
  migrated: number;
  wouldMigrate: number;
  missing: number;
  failed: number;
};

async function migrateRecipeTable(
  label: string,
  table: typeof communityRecipes | typeof mealPlanRecipes,
) {
  const rows = await db
    .select({ id: table.id, imageUrl: table.imageUrl })
    .from(table)
    .where(like(table.imageUrl, "/api/recipe-images/%"));
  console.log(`\n${label}: ${rows.length} row(s) to migrate`);
  const limit = pLimit(MIGRATE_CONCURRENCY);
  // The try/catch lives INSIDE each limited task so one row's failure is
  // isolated and cannot reject the surrounding Promise.all.
  const outcomes = await Promise.all(
    rows.map((row) =>
      limit(async (): Promise<keyof MigrationCounts> => {
        try {
          // `label` is part of the deterministic key — it must stay stable
          // across runs or re-run idempotency breaks (re-uploads under new
          // keys, orphaning the old objects).
          const result = await uploadOne(
            row.imageUrl!,
            "recipe",
            () => `recipe-migrated-${label}-${row.id}`,
          );
          if (result.status === "uploaded") {
            await db
              .update(table)
              .set({ imageUrl: result.url })
              .where(eq(table.id, row.id));
            console.log(`  [${row.id}] -> ${result.url}`);
            return "migrated";
          }
          return result.status === "wouldMigrate" ? "wouldMigrate" : "missing";
        } catch (err) {
          console.error(`  [${row.id}] FAILED:`, err);
          return "failed";
        }
      }),
    ),
  );
  const counts: MigrationCounts = {
    migrated: 0,
    wouldMigrate: 0,
    missing: 0,
    failed: 0,
  };
  for (const outcome of outcomes) counts[outcome]++;
  console.log(
    `${label}: migrated ${counts.migrated}, wouldMigrate ${counts.wouldMigrate}, missing ${counts.missing}, failed ${counts.failed}`,
  );
  return counts;
}

async function migrateAvatars() {
  const rows = await db
    .select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users)
    .where(like(users.avatarUrl, "/api/avatars/%"));
  console.log(`\nusers.avatarUrl: ${rows.length} row(s) to migrate`);
  const limit = pLimit(MIGRATE_CONCURRENCY);
  // The try/catch lives INSIDE each limited task so one row's failure is
  // isolated and cannot reject the surrounding Promise.all.
  const outcomes = await Promise.all(
    rows.map((row) =>
      limit(async (): Promise<keyof MigrationCounts> => {
        try {
          const result = await uploadOne(row.avatarUrl!, "avatar", (buffer) =>
            avatarKeyStem(row.id, buffer),
          );
          if (result.status === "uploaded") {
            await db
              .update(users)
              .set({ avatarUrl: result.url })
              .where(eq(users.id, row.id));
            console.log(`  [${row.id}] -> ${result.url}`);
            return "migrated";
          }
          return result.status === "wouldMigrate" ? "wouldMigrate" : "missing";
        } catch (err) {
          console.error(`  [${row.id}] FAILED:`, err);
          return "failed";
        }
      }),
    ),
  );
  const counts: MigrationCounts = {
    migrated: 0,
    wouldMigrate: 0,
    missing: 0,
    failed: 0,
  };
  for (const outcome of outcomes) counts[outcome]++;
  console.log(
    `users.avatarUrl: migrated ${counts.migrated}, wouldMigrate ${counts.wouldMigrate}, missing ${counts.missing}, failed ${counts.failed}`,
  );
  return counts;
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
  if (!fs.existsSync(UPLOADS_ROOT)) {
    console.warn(
      `WARNING: ${UPLOADS_ROOT} not found — every row will report MISSING. ` +
        `Run this on the machine that holds the original uploads/ tree.`,
    );
  }
  const a = await migrateRecipeTable("communityRecipes", communityRecipes);
  const b = await migrateRecipeTable("mealPlanRecipes", mealPlanRecipes);
  const c = await migrateAvatars();
  const migrated = a.migrated + b.migrated + c.migrated;
  const wouldMigrate = a.wouldMigrate + b.wouldMigrate + c.wouldMigrate;
  const missing = a.missing + b.missing + c.missing;
  const failed = a.failed + b.failed + c.failed;
  console.log(
    `\n=== Done. migrated=${migrated}, wouldMigrate=${wouldMigrate}, missing=${missing}, failed=${failed} ===`,
  );
  await pool.end();
  // Partial failure must be visible to operators/pipelines via exit code —
  // a 0 here would read as "fully migrated".
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  void pool.end().then(() => process.exit(1));
});
