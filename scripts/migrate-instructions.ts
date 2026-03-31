/**
 * One-time migration: Convert `instructions` column from text to JSONB string[]
 * on both community_recipes and meal_plan_recipes tables.
 *
 * Run BEFORE changing the Drizzle schema:
 *   npx tsx scripts/migrate-instructions.ts
 *
 * This script:
 * 1. Creates backup tables for rollback
 * 2. Parses text instructions into string[] (JSON arrays)
 * 3. Backfills NULL rows to '[]'
 * 4. Verifies all rows contain valid JSON arrays
 * 5. ALTERs the column type from text to jsonb
 */

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

function parseTextToSteps(text: string): string[] {
  if (!text || !text.trim()) return [];

  // Strip HTML tags (Spoonacular / imported recipes)
  let cleaned = text.replace(/<[^>]*>/g, "").trim();
  if (!cleaned) return [];

  // Try splitting on numbered patterns: "1. ", "1) ", "Step 1:", "Step 1 -"
  const numberedPattern = /(?:^|\n)\s*(?:step\s+)?\d+[\.\)\:\-]\s*/i;
  if (numberedPattern.test(cleaned)) {
    const steps = cleaned
      .split(/\n\s*(?:(?:step\s+)?\d+[\.\)\:\-]\s*)/i)
      .map((s) => s.replace(/^(?:step\s+)?\d+[\.\)\:\-]\s*/i, "").trim())
      .filter((s) => s.length > 0);
    if (steps.length > 1) return steps;
  }

  // Try splitting on double newlines (paragraph-style)
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (paragraphs.length > 1) return paragraphs;

  // Fall back to single newlines
  const lines = cleaned
    .split(/\n/)
    .map((s) => s.replace(/^[-*•]\s*/, "").trim()) // strip bullet markers
    .filter((s) => s.length > 0);
  if (lines.length > 1) return lines;

  // Single block of text — return as one step
  return [cleaned];
}

async function migrate() {
  const client = await pool.connect();

  try {
    // Step 1: Create backup tables
    console.log("Creating backup tables...");
    await client.query(`
      DROP TABLE IF EXISTS community_recipes_instructions_backup;
      CREATE TABLE community_recipes_instructions_backup AS
      SELECT id, instructions FROM community_recipes;
    `);
    await client.query(`
      DROP TABLE IF EXISTS meal_plan_recipes_instructions_backup;
      CREATE TABLE meal_plan_recipes_instructions_backup AS
      SELECT id, instructions FROM meal_plan_recipes;
    `);
    console.log("  Backups created.");

    // Step 2: Convert community_recipes instructions to JSON
    console.log("Migrating community_recipes...");
    const crRows = await client.query(
      "SELECT id, instructions FROM community_recipes WHERE instructions IS NOT NULL",
    );
    let crConverted = 0;
    let crSingleStep = 0;
    for (const row of crRows.rows) {
      const steps = parseTextToSteps(row.instructions);
      if (steps.length <= 1) crSingleStep++;
      await client.query(
        "UPDATE community_recipes SET instructions = $1 WHERE id = $2",
        [JSON.stringify(steps), row.id],
      );
      crConverted++;
    }
    console.log(
      `  Converted ${crConverted} rows (${crSingleStep} single-step, flagged for review)`,
    );

    // Step 3: Convert meal_plan_recipes instructions to JSON
    console.log("Migrating meal_plan_recipes...");
    const mrNonNull = await client.query(
      "SELECT id, instructions FROM meal_plan_recipes WHERE instructions IS NOT NULL",
    );
    let mrConverted = 0;
    let mrSingleStep = 0;
    for (const row of mrNonNull.rows) {
      const steps = parseTextToSteps(row.instructions);
      if (steps.length <= 1) mrSingleStep++;
      await client.query(
        "UPDATE meal_plan_recipes SET instructions = $1 WHERE id = $2",
        [JSON.stringify(steps), row.id],
      );
      mrConverted++;
    }
    console.log(
      `  Converted ${mrConverted} non-null rows (${mrSingleStep} single-step)`,
    );

    // Step 4: Backfill NULLs to '[]'
    const nullResult = await client.query(
      "UPDATE meal_plan_recipes SET instructions = '[]' WHERE instructions IS NULL",
    );
    console.log(`  Backfilled ${nullResult.rowCount} NULL rows to '[]'`);

    // Step 5: Verify all rows contain valid JSON arrays
    console.log("Verifying...");
    const crInvalid = await client.query(`
      SELECT COUNT(*) as count FROM community_recipes
      WHERE jsonb_typeof(instructions::jsonb) != 'array'
    `);
    const mrInvalid = await client.query(`
      SELECT COUNT(*) as count FROM meal_plan_recipes
      WHERE jsonb_typeof(instructions::jsonb) != 'array'
    `);
    const crNulls = await client.query(
      "SELECT COUNT(*) as count FROM community_recipes WHERE instructions IS NULL",
    );
    const mrNulls = await client.query(
      "SELECT COUNT(*) as count FROM meal_plan_recipes WHERE instructions IS NULL",
    );

    if (
      parseInt(crInvalid.rows[0].count) > 0 ||
      parseInt(mrInvalid.rows[0].count) > 0
    ) {
      console.error("VERIFICATION FAILED: Non-array JSON found!");
      console.error(`  community_recipes invalid: ${crInvalid.rows[0].count}`);
      console.error(`  meal_plan_recipes invalid: ${mrInvalid.rows[0].count}`);
      console.error(
        "Aborting column type change. Data is still text with JSON values.",
      );
      process.exit(1);
    }
    if (
      parseInt(crNulls.rows[0].count) > 0 ||
      parseInt(mrNulls.rows[0].count) > 0
    ) {
      console.error("VERIFICATION FAILED: NULL values remain!");
      process.exit(1);
    }
    console.log("  All rows verified as valid JSON arrays with no NULLs.");

    // Step 6: ALTER column types
    console.log("Altering column types to jsonb...");
    await client.query(`
      ALTER TABLE community_recipes
        ALTER COLUMN instructions TYPE jsonb USING instructions::jsonb;
    `);
    await client.query(`
      ALTER TABLE meal_plan_recipes
        ALTER COLUMN instructions TYPE jsonb USING instructions::jsonb;
    `);
    await client.query(`
      ALTER TABLE meal_plan_recipes
        ALTER COLUMN instructions SET NOT NULL;
    `);
    await client.query(`
      ALTER TABLE meal_plan_recipes
        ALTER COLUMN instructions SET DEFAULT '[]'::jsonb;
    `);
    console.log("  Column types changed to jsonb.");

    // Final verification
    const finalCheck = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE column_name = 'instructions'
      AND table_name IN ('community_recipes', 'meal_plan_recipes')
    `);
    finalCheck.rows.forEach((r: { table_name: string; data_type: string }) =>
      console.log(`  ${r.table_name}.instructions: ${r.data_type}`),
    );

    console.log("\nMigration complete!");
  } catch (err) {
    console.error("Migration failed:", err);
    console.error("Backup tables exist for rollback.");
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
