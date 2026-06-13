/**
 * Standalone integration check (NOT a vitest test — avoids import-time DB connect in CI).
 * Usage: tsx scripts/solutions-db/integration-check.ts
 * Requires SOLUTIONS_DATABASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY.
 */
import "dotenv/config";
import { createPool, toVectorLiteral } from "./lib/db";
import { embedBatch } from "./lib/embeddings";

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("FAIL: SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);

  const {
    rows: [counts],
  } = await pool.query(
    "SELECT count(*) AS total, count(embedding) AS embedded FROM solutions",
  );
  if (Number(counts.total) === 0) {
    console.error("FAIL: solutions table is empty — run solutions:db:ingest");
    process.exit(1);
  }
  console.log(`OK: ${counts.total} rows, ${counts.embedded} embedded.`);

  const [vec] = await embedBatch([
    "array index returns undefined on negative index",
  ]);
  const { rows } = await pool.query(
    `SELECT source_path, 1 - (embedding <=> $1::vector) AS similarity
       FROM solutions WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 3`,
    [toVectorLiteral(vec)],
  );
  if (rows.length === 0) {
    console.error("FAIL: semantic search returned no rows");
    process.exit(1);
  }
  if (typeof rows[0].similarity !== "number") {
    console.error("FAIL: missing similarity score");
    process.exit(1);
  }
  console.log(
    `OK: top match ${rows[0].source_path} (sim ${Number(rows[0].similarity).toFixed(3)}).`,
  );

  await pool.end();
  console.log("Integration check PASSED.");
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
