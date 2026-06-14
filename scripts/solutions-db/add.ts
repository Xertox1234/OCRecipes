import "dotenv/config";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
import { createPool, toVectorLiteral } from "./lib/db";
import { SOLUTIONS_ROOT } from "./lib/files";
import { parseSolution } from "./lib/parse";
import { buildEmbeddingText, embedBatch } from "./lib/embeddings";
import { upsertSolutions } from "./lib/upsert";
import { serializeSolution } from "./lib/serialize";

const NEAR_DUP_THRESHOLD = 0.88;

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error("usage: add.ts <path-to-markdown> [--dry-run]");
    process.exit(1);
  }
  const abs = isAbsolute(fileArg) ? fileArg : join(process.cwd(), fileArg);
  const sourcePath = relative(SOLUTIONS_ROOT, abs);
  const raw = readFileSync(abs, "utf8");
  const mtimeISO = statSync(abs).mtime.toISOString().slice(0, 10);
  const parsed = parseSolution(raw, sourcePath, mtimeISO);

  for (const w of parsed.warnings) console.error(`warning: ${w}`);

  const pool = createPool(url);

  // Near-dup check (advisory): embed the new content, find cosine neighbors >= threshold.
  const [vec] = await embedBatch([
    buildEmbeddingText(parsed.title, parsed.body),
  ]);
  const neighbors = (
    await pool.query(
      `SELECT source_path, 1 - (embedding <=> $1::vector) AS sim
       FROM solutions
       WHERE embedding IS NOT NULL AND source_path <> $2
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 5`,
      [toVectorLiteral(vec), sourcePath],
    )
  ).rows as { source_path: string; sim: number }[];
  for (const n of neighbors) {
    if (Number(n.sim) >= NEAR_DUP_THRESHOLD) {
      console.error(
        `near-duplicate: ${n.source_path} (cosine ${Number(n.sim).toFixed(3)})`,
      );
    }
  }

  if (dryRun) {
    console.log("dry-run: not written.");
    await pool.end();
    return;
  }

  await upsertSolutions(pool, [parsed]);

  // Export the canonical mirror for this row so disk matches the DB.
  const row = (
    await pool.query(
      `SELECT title, track, category, module, severity, tags, symptoms, applies_to,
              to_char(created,'YYYY-MM-DD') AS created,
              to_char(last_updated,'YYYY-MM-DD') AS last_updated, body, extra_fields
       FROM solutions WHERE source_path = $1`,
      [sourcePath],
    )
  ).rows[0];
  if (!resolve(abs).startsWith(resolve(SOLUTIONS_ROOT) + "/")) {
    console.error(`refusing to write outside solutions root: ${sourcePath}`);
    process.exit(1);
  }
  writeFileSync(
    abs,
    serializeSolution({
      title: row.title,
      track: row.track,
      category: row.category,
      module: row.module ?? null,
      severity: row.severity ?? null,
      tags: row.tags ?? [],
      symptoms: row.symptoms ?? [],
      appliesTo: row.applies_to ?? [],
      created: row.created,
      lastUpdated: row.last_updated ?? null,
      extraFields: row.extra_fields ?? {},
      body: row.body,
    }),
    "utf8",
  );
  await pool.end();
  console.log(`Added ${sourcePath} to the DB and exported its mirror.`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
