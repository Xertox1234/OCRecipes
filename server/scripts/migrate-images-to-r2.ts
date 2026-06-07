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
