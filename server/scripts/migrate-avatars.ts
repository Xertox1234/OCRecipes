/* eslint-disable no-console */
/**
 * DEPRECATED (2026-06): one-shot legacy migration that writes images to LOCAL DISK
 * and stores relative `/api/...` URLs. Superseded by Cloudflare R2 storage. Do NOT
 * run after the R2 deployment — it would reintroduce ephemeral disk paths. Use
 * `npm run migrate:images-r2` (server/scripts/migrate-images-to-r2.ts) instead.
 * Kept for historical reference only.
 */
/**
 * Migration script: converts existing base64 avatar data URLs stored in the
 * users table into files on disk under uploads/avatars/.
 *
 * Usage: npx tsx server/scripts/migrate-avatars.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import { users } from "@shared/schema";
import { eq, like } from "drizzle-orm";

const AVATAR_DIR = path.resolve(process.cwd(), "uploads/avatars");
const BATCH_SIZE = 50;

/** Map MIME subtype to file extension. */
function mimeToExt(mime: string): string {
  const subtype = mime.split("/")[1];
  if (subtype === "jpeg") return "jpg";
  if (subtype === "png") return "png";
  if (subtype === "webp") return "webp";
  return "jpg"; // fallback
}

async function main() {
  // DEPRECATED runtime guard — running this post-R2 rewrites rows back to
  // ephemeral disk paths (silent image loss on the next redeploy).
  if (process.env.ALLOW_DEPRECATED_DISK_MIGRATION !== "1") {
    console.error(
      "This script is deprecated (writes local-disk URLs, superseded by R2). " +
        "Use `npm run migrate:images-r2` instead. Set " +
        "ALLOW_DEPRECATED_DISK_MIGRATION=1 to override.",
    );
    process.exit(1);
  }

  // The override must never run against production — it rewrites rows to
  // ephemeral disk paths (silent image loss on the next redeploy).
  if (process.env.NODE_ENV === "production") {
    console.error(
      "REFUSING: ALLOW_DEPRECATED_DISK_MIGRATION=1 is set but NODE_ENV is " +
        '"production". This deprecated disk migration must not run in production.',
    );
    process.exit(1);
  }

  // Loud banner so a value left behind in .env can't silently re-enable
  // this deprecated script.
  console.warn(
    "\n" +
      "############################################################\n" +
      "# WARNING: OVERRIDE ACTIVE                                 #\n" +
      "# ALLOW_DEPRECATED_DISK_MIGRATION=1 — running a DEPRECATED #\n" +
      "# disk migration that writes local-disk URLs. If you did   #\n" +
      "# not set this intentionally for THIS run, abort now and   #\n" +
      "# remove the variable from your .env.                      #\n" +
      "############################################################\n",
  );

  console.log("=== Migrate Base64 Avatars to Disk ===\n");

  // Ensure output directory exists
  if (!fs.existsSync(AVATAR_DIR)) {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    console.log(`Created directory: ${AVATAR_DIR}`);
  }

  // Fetch all users with base64 avatar data URLs
  const rows = await db
    .select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users)
    .where(like(users.avatarUrl, "data:image/%"));

  console.log(`Found ${rows.length} user(s) with base64 avatars.\n`);

  if (rows.length === 0) {
    await pool.end();
    return;
  }

  let migrated = 0;
  let skipped = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} users)...`);

    for (const row of batch) {
      try {
        const dataUrl = row.avatarUrl!;

        // Parse data URL: data:image/png;base64,<data>
        const match = dataUrl.match(
          /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/,
        );
        if (!match) {
          console.log(`  [${row.id}] Skipped: unrecognized data URL format`);
          skipped++;
          continue;
        }

        const mimeType = match[1];
        const base64Data = match[2];
        const ext = mimeToExt(mimeType);
        const filename = `${row.id}-${Date.now()}.${ext}`;
        const filepath = path.join(AVATAR_DIR, filename);

        // Decode and write file
        const buffer = Buffer.from(base64Data, "base64");
        fs.writeFileSync(filepath, buffer);

        // Update DB
        const newUrl = `/api/avatars/${filename}`;
        await db
          .update(users)
          .set({ avatarUrl: newUrl })
          .where(eq(users.id, row.id));

        migrated++;
        console.log(`  [${row.id}] -> ${newUrl} (${buffer.length} bytes)`);
      } catch (err) {
        skipped++;
        console.error(`  [${row.id}] FAILED:`, err);
      }
    }
  }

  console.log(
    `\n=== Done! Migrated: ${migrated}, Skipped/Failed: ${skipped} ===`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  void pool.end().then(() => process.exit(1));
});
