/* eslint-disable no-console */
/**
 * Backfill script: populates the barcodeNutrition table from existing
 * scannedItems rows that have barcodes. Deduplicates by barcode
 * (first occurrence wins) and strips all user-identifying data.
 *
 * Usage: npx tsx server/scripts/backfill-barcode-nutrition.ts
 */
import "dotenv/config";
import { db, pool } from "../db";
import { scannedItems, barcodeNutrition } from "@shared/schema";
import { isNotNull } from "drizzle-orm";

async function main() {
  console.log("Starting barcodeNutrition backfill...");

  // Query distinct barcodes from scannedItems with nutrition data.
  // Uses DISTINCT ON to pick one row per barcode (most recent scan).
  const rows = await db
    .select({
      barcode: scannedItems.barcode,
      productName: scannedItems.productName,
      brandName: scannedItems.brandName,
      servingSize: scannedItems.servingSize,
      calories: scannedItems.calories,
      protein: scannedItems.protein,
      carbs: scannedItems.carbs,
      fat: scannedItems.fat,
      sourceType: scannedItems.sourceType,
    })
    .from(scannedItems)
    .where(isNotNull(scannedItems.barcode))
    .groupBy(
      scannedItems.barcode,
      scannedItems.productName,
      scannedItems.brandName,
      scannedItems.servingSize,
      scannedItems.calories,
      scannedItems.protein,
      scannedItems.carbs,
      scannedItems.fat,
      scannedItems.sourceType,
    );

  console.log(`Found ${rows.length} scanned items with barcodes`);

  // Deduplicate by barcode (first row wins)
  const seen = new Set<string>();
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.barcode || seen.has(row.barcode)) {
      skipped++;
      continue;
    }
    seen.add(row.barcode);

    try {
      await db
        .insert(barcodeNutrition)
        .values({
          barcode: row.barcode,
          productName: row.productName ?? null,
          brandName: row.brandName ?? null,
          servingSize: row.servingSize ?? null,
          calories: row.calories ?? null,
          protein: row.protein ?? null,
          carbs: row.carbs ?? null,
          fat: row.fat ?? null,
          source: row.sourceType ?? "barcode",
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.error(`Failed to insert barcode ${row.barcode}:`, err);
    }
  }

  console.log(
    `Backfill complete: ${inserted} inserted, ${skipped} duplicates skipped`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
