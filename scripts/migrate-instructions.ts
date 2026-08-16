/**
 * One-time migration: Convert `instructions` column from text to JSONB string[]
 * on both community_recipes and meal_plan_recipes tables.
 *
 * Polarity: no --dry-run/--commit pair — this script has NO preview mode and
 * always runs live on invocation (backup tables + ALTER TABLE column-type
 * changes can't be meaningfully "previewed" without a preview-aware verifier
 * too). Safety comes primarily from the --force-rerun guard below (refuses
 * to destroy an existing rollback point) plus the pre-ALTER verification
 * step, which aborts before the destructive column-type change if any row
 * fails to parse as a valid JSON array.
 *
 * Run BEFORE changing the Drizzle schema:
 *   npx tsx scripts/migrate-instructions.ts
 *   npx tsx scripts/migrate-instructions.ts --force-rerun  # re-run despite existing backups
 *
 * This script:
 * 0. Refuses a re-run while backup tables exist (they are the rollback point
 *    and step 1 would DROP them) unless --force-rerun is passed
 * 1. Creates backup tables for rollback
 * 2. Parses text instructions into string[] (JSON arrays)
 * 3. Backfills NULL rows to '[]'
 * 4. Verifies all rows contain valid JSON arrays
 * 5. ALTERs the column type from text to jsonb
 */

import pg from "pg";
import {
  parseTextToSteps,
  evaluateRerunGuard,
} from "./migrate-instructions-utils";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const FORCE_RERUN = process.argv.includes("--force-rerun");

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function migrate() {
  const client = await pool.connect();

  try {
    // Step 0: refuse a re-run that would destroy the previous rollback point —
    // step 1 DROPs the backup tables, so without this guard a second run
    // silently discarded the only rollback while the error handler still
    // claimed "Backup tables exist for rollback."
    const backupProbe = await client.query(
      "SELECT to_regclass('public.community_recipes_instructions_backup') AS cr, " +
        "to_regclass('public.meal_plan_recipes_instructions_backup') AS mr",
    );
    const rerunGuard = evaluateRerunGuard({
      backupsExist:
        Boolean(backupProbe.rows[0]?.cr) || Boolean(backupProbe.rows[0]?.mr),
      force: FORCE_RERUN,
    });
    if (rerunGuard.refuse) {
      console.error(rerunGuard.reason);
      process.exit(1);
    }

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

void migrate();
