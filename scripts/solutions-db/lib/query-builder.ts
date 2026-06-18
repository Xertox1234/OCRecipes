// Pure SQL/param assembly for the read-only MCP server tools. Extracted from
// mcp-server.ts so the most bug-prone part — the running `$n` placeholder
// indexing — is unit-testable without a DB or an API key. These functions
// construct NO pool/client/embedder: the handler still owns embedQuery +
// pool.query; only the WHERE/param string assembly lives here.

/** Optional structured filters for `search_solutions`, in placeholder order. */
export interface SearchFilters {
  track?: "bug" | "knowledge";
  category?: string;
  module?: string;
  severity?: string;
  tags?: string[];
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Build the `search_solutions` SELECT with running `$n` placeholders.
 *
 * `$1` is reserved for the already-computed embedding vector literal (reused in
 * the SELECT similarity expression AND the ORDER BY). Optional filters take
 * `$2..$n` in fixed order (track, category, module, severity, tags); `tags` uses
 * the array-containment operator `&&` and is omitted entirely for an empty/
 * absent array. `LIMIT` takes the next free index.
 */
export function buildSearchQuery(
  vectorLiteral: string,
  filters: SearchFilters,
  k: number,
): BuiltQuery {
  const where = ["embedding IS NOT NULL"];
  const params: unknown[] = [vectorLiteral];
  let i = 2;
  if (filters.track) {
    where.push(`track = $${i++}`);
    params.push(filters.track);
  }
  if (filters.category) {
    where.push(`category = $${i++}`);
    params.push(filters.category);
  }
  if (filters.module) {
    where.push(`module = $${i++}`);
    params.push(filters.module);
  }
  if (filters.severity) {
    where.push(`severity = $${i++}`);
    params.push(filters.severity);
  }
  if (filters.tags?.length) {
    where.push(`tags && $${i++}`);
    params.push(filters.tags);
  }
  const kIdx = i;
  params.push(k);
  const sql = `SELECT source_path, slug, title, category, track,
              1 - (embedding <=> $1::vector) AS similarity, left(body, 300) AS snippet
         FROM solutions WHERE ${where.join(" AND ")}
         ORDER BY embedding <=> $1::vector LIMIT $${kIdx}`;
  return { sql, params };
}

export interface BuiltCategoryClause {
  /** SQL fragment to append after the cosine-distance predicate (may be ""). */
  catClause: string;
  /** The category param, if any, to append after the threshold param. */
  params: unknown[];
}

/**
 * Build the optional `AND a.category = $2 AND b.category = $2` clause for
 * `find_duplicates`. The handler reserves `$1` for `1 - threshold`; when a
 * category is given it occupies `$2` (referenced twice). Omitted → no clause,
 * no extra param.
 */
export function buildDuplicatesCategoryClause(
  category: string | undefined,
): BuiltCategoryClause {
  if (!category) return { catClause: "", params: [] };
  return {
    catClause: "AND a.category = $2 AND b.category = $2",
    params: [category],
  };
}
