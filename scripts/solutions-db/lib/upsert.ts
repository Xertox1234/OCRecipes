import type { Pool } from "pg";
import { toVectorLiteral } from "./db";
import type { ParsedSolution } from "./parse";
import { buildEmbeddingText, embedBatch, EMBED_MODEL } from "./embeddings";

/** Upsert solutions; (re-)embed only rows whose content_hash changed or that lack an embedding. */
export async function upsertSolutions(
  pool: Pool,
  parsed: ParsedSolution[],
): Promise<{ embedded: number }> {
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
          applies_to, created, last_updated, body, sections, content_hash, warnings, extra_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)
       ON CONFLICT (source_path) DO UPDATE SET
         slug=EXCLUDED.slug, title=EXCLUDED.title, track=EXCLUDED.track, category=EXCLUDED.category,
         module=EXCLUDED.module, severity=EXCLUDED.severity, tags=EXCLUDED.tags, symptoms=EXCLUDED.symptoms,
         applies_to=EXCLUDED.applies_to, created=EXCLUDED.created, last_updated=EXCLUDED.last_updated,
         body=EXCLUDED.body, sections=EXCLUDED.sections, content_hash=EXCLUDED.content_hash,
         warnings=EXCLUDED.warnings, extra_fields=EXCLUDED.extra_fields, ingested_at=now()`,
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
        JSON.stringify(p.extraFields),
      ],
    );
  }
  for (const [path, vec] of embByPath) {
    await pool.query(
      "UPDATE solutions SET embedding=$1::vector, embedding_model=$2 WHERE source_path=$3",
      [toVectorLiteral(vec), EMBED_MODEL, path],
    );
  }
  return { embedded: embByPath.size };
}
