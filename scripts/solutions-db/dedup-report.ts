/**
 * Non-destructive dedup report. Usage: tsx scripts/solutions-db/dedup-report.ts [--threshold=0.88]
 * Writes docs/solutions/_manifests/<YYYY-MM-DD>-dedup-report.md
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "./lib/db";
import { clusterByPairs } from "./lib/dedup";

const REPO_ROOT = join(__dirname, "..", "..");

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
  const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.88;
  const pool = createPool(url);

  const exact = (
    await pool.query(
      "SELECT array_agg(source_path ORDER BY source_path) AS paths FROM solutions GROUP BY content_hash HAVING count(*) > 1",
    )
  ).rows;

  const pairRows = (
    await pool.query(
      `SELECT a.source_path AS a, b.source_path AS b, 1 - (a.embedding <=> b.embedding) AS sim
       FROM solutions a JOIN solutions b ON a.id < b.id
      WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) < $1
      ORDER BY sim DESC`,
      [1 - threshold],
    )
  ).rows as { a: string; b: string; sim: number }[];

  const simByPair = new Map(
    pairRows.map((p) => [`${p.a}|${p.b}`, Number(p.sim)]),
  );
  const clusters = clusterByPairs(
    pairRows.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim) })),
  );

  const date = new Date().toISOString().slice(0, 10);
  let md = `# Dedup report — ${date}\n\nThreshold: cosine ≥ ${threshold}. Non-destructive: nothing was merged.\n\n`;
  md += `## Exact duplicates (identical content hash)\n\n`;
  md += exact.length
    ? exact.map((e) => `- ${e.paths.join("\n  - ")}`).join("\n") + "\n"
    : "_none_\n";
  md += `\n## Near-duplicate clusters (${clusters.length})\n\n`;
  for (const cluster of clusters) {
    md += `### Cluster (${cluster.length})\n`;
    for (const path of cluster) md += `- ${path}\n`;
    const sims = cluster.flatMap((a, i) =>
      cluster
        .slice(i + 1)
        .map((b) => simByPair.get(`${a}|${b}`) ?? simByPair.get(`${b}|${a}`))
        .filter((s): s is number => s !== undefined),
    );
    if (sims.length)
      md += `_pairwise similarity: ${Math.min(...sims).toFixed(3)}–${Math.max(...sims).toFixed(3)}_\n`;
    md += `_suggested action: review for merge / keep-distinct / add \`## See Also\` link_\n\n`;
  }

  const outPath = join(
    REPO_ROOT,
    "docs",
    "solutions",
    "_manifests",
    `${date}-dedup-report.md`,
  );
  writeFileSync(outPath, md, "utf8");
  console.log(
    `Wrote ${outPath}: ${exact.length} exact groups, ${clusters.length} near clusters.`,
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
