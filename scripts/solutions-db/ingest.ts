/**
 * Ingest docs/solutions/ markdown into ocrecipes_solutions (idempotent).
 * Usage: tsx scripts/solutions-db/ingest.ts [--prune]
 * Requires: SOLUTIONS_DATABASE_URL (owner/write), AI_INTEGRATIONS_OPENAI_API_KEY.
 */
import "dotenv/config";
import { createPool } from "./lib/db";
import { listSolutionFiles, parseFile } from "./lib/files";
import { upsertSolutions } from "./lib/upsert";

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);
  const parsed = listSolutionFiles().map((f) => parseFile(f));
  const { embedded } = await upsertSolutions(pool, parsed);

  if (process.argv.includes("--prune")) {
    const keep = parsed.map((p) => p.sourcePath);
    const del = await pool.query(
      "DELETE FROM solutions WHERE source_path <> ALL($1) RETURNING source_path",
      [keep],
    );
    console.log(`Pruned ${del.rowCount} rows with no source file.`);
  }
  const warned = parsed.filter((p) => p.warnings.length).length;
  console.log(
    `Ingested ${parsed.length} files; embedded ${embedded}; ${warned} files had warnings.`,
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
