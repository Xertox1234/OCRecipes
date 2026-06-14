import "dotenv/config";
import { createPool } from "./lib/db";
import { listSolutionFiles, parseFile } from "./lib/files";
import { compareParity, type ParityRow } from "./lib/parity";

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);
  const diskHashes = new Map<string, string>();
  for (const f of listSolutionFiles()) {
    const p = parseFile(f);
    diskHashes.set(p.sourcePath, p.contentHash);
  }
  const dbRows: ParityRow[] = (
    await pool.query(
      "SELECT source_path, content_hash, (embedding IS NOT NULL) AS has_embedding FROM solutions",
    )
  ).rows;
  await pool.end();

  const result = compareParity(diskHashes, dbRows);
  console.log(
    `parity: disk=${result.counts.disk} db=${result.counts.db} nullEmbeddings=${result.counts.nullEmbeddings}`,
  );
  if (!result.ok) {
    console.error(`PARITY FAILED (${result.failures.length}):`);
    for (const f of result.failures.slice(0, 50)) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PARITY OK — DB == disk (content-verified).");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
