/**
 * Ingest docs/solutions/ markdown into ocrecipes_solutions (idempotent).
 * Usage: tsx scripts/solutions-db/ingest.ts [--prune]
 * Requires: SOLUTIONS_DATABASE_URL (owner/write), AI_INTEGRATIONS_OPENAI_API_KEY.
 */
import "dotenv/config";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createPool, toVectorLiteral } from "./lib/db";
import { parseSolution, type ParsedSolution } from "./lib/parse";
import { buildEmbeddingText, embedBatch, EMBED_MODEL } from "./lib/embeddings";

const REPO_ROOT = join(__dirname, "..", "..");
const SOLUTIONS_ROOT = join(REPO_ROOT, "docs", "solutions");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_manifests") continue;
      out.push(...walk(join(dir, entry.name)));
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function parseFile(absPath: string): ParsedSolution {
  const raw = readFileSync(absPath, "utf8");
  const mtimeISO = statSync(absPath).mtime.toISOString().slice(0, 10);
  return parseSolution(raw, relative(SOLUTIONS_ROOT, absPath), mtimeISO);
}

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const pool = createPool(url);
  const parsed = walk(SOLUTIONS_ROOT).map(parseFile);

  const existing = new Map<
    string,
    { content_hash: string; has_embedding: boolean }
  >();
  for (const r of (
    await pool.query(
      "SELECT source_path, content_hash, (embedding IS NOT NULL) AS has_embedding FROM solutions",
    )
  ).rows) {
    existing.set(r.source_path, {
      content_hash: r.content_hash,
      has_embedding: r.has_embedding,
    });
  }

  const needEmbed = parsed.filter((p) => {
    const e = existing.get(p.sourcePath);
    return !e || e.content_hash !== p.contentHash || !e.has_embedding;
  });
  const vectors = needEmbed.length
    ? await embedBatch(
        needEmbed.map((p) => buildEmbeddingText(p.title, p.body)),
      )
    : [];
  const embByPath = new Map<string, number[]>();
  needEmbed.forEach((p, i) => embByPath.set(p.sourcePath, vectors[i]));

  for (const p of parsed) {
    await pool.query(
      `INSERT INTO solutions
         (source_path, slug, title, track, category, module, severity, tags, symptoms,
          applies_to, created, last_updated, body, sections, content_hash, warnings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
       ON CONFLICT (source_path) DO UPDATE SET
         slug=EXCLUDED.slug, title=EXCLUDED.title, track=EXCLUDED.track, category=EXCLUDED.category,
         module=EXCLUDED.module, severity=EXCLUDED.severity, tags=EXCLUDED.tags, symptoms=EXCLUDED.symptoms,
         applies_to=EXCLUDED.applies_to, created=EXCLUDED.created, last_updated=EXCLUDED.last_updated,
         body=EXCLUDED.body, sections=EXCLUDED.sections, content_hash=EXCLUDED.content_hash,
         warnings=EXCLUDED.warnings, ingested_at=now()`,
      [
        p.sourcePath,
        p.slug,
        p.title,
        p.track,
        p.category,
        p.module,
        p.severity,
        p.tags,
        p.symptoms,
        p.appliesTo,
        p.created,
        p.lastUpdated,
        p.body,
        JSON.stringify(p.sections),
        p.contentHash,
        p.warnings,
      ],
    );
  }
  for (const [path, vec] of embByPath) {
    await pool.query(
      "UPDATE solutions SET embedding=$1::vector, embedding_model=$2 WHERE source_path=$3",
      [toVectorLiteral(vec), EMBED_MODEL, path],
    );
  }
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
    `Ingested ${parsed.length} files; embedded ${embByPath.size}; ${warned} files had warnings.`,
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
