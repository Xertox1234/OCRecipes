/**
 * Read-only MCP server over ocrecipes_solutions.
 * Launched via .mcp.json. Requires SOLUTIONS_DB_READONLY_URL + AI_INTEGRATIONS_OPENAI_API_KEY.
 * NOTE: stdout is the JSON-RPC transport — log ONLY with console.error.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPool, toVectorLiteral } from "./lib/db";
import { embedBatch } from "./lib/embeddings";
import { isReadOnlyQuery } from "./lib/sql-guard";
import { matchesAnyGlob } from "./lib/globs";

if (!process.env.SOLUTIONS_DB_READONLY_URL) {
  console.error("SOLUTIONS_DB_READONLY_URL not set");
  process.exit(1);
}
const pool = createPool(process.env.SOLUTIONS_DB_READONLY_URL);
const server = new McpServer({ name: "solutions-db", version: "1.0.0" });

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});

async function embedQuery(q: string): Promise<number[]> {
  const [v] = await embedBatch([q]);
  return v;
}

server.registerTool(
  "search_solutions",
  {
    description: "Semantic search over solutions; optional structured filters.",
    inputSchema: {
      query: z.string(),
      k: z.number().int().positive().max(50).default(8),
      track: z.enum(["bug", "knowledge"]).optional(),
      category: z.string().optional(),
      module: z.string().optional(),
      tags: z.array(z.string()).optional(),
      severity: z.string().optional(),
    },
  },
  async (args) => {
    const vec = await embedQuery(args.query);
    const where = ["embedding IS NOT NULL"];
    const params: unknown[] = [toVectorLiteral(vec)];
    let i = 2;
    if (args.track) {
      where.push(`track = $${i++}`);
      params.push(args.track);
    }
    if (args.category) {
      where.push(`category = $${i++}`);
      params.push(args.category);
    }
    if (args.module) {
      where.push(`module = $${i++}`);
      params.push(args.module);
    }
    if (args.severity) {
      where.push(`severity = $${i++}`);
      params.push(args.severity);
    }
    if (args.tags?.length) {
      where.push(`tags && $${i++}`);
      params.push(args.tags);
    }
    const kIdx = i;
    params.push(args.k);
    const r = await pool.query(
      `SELECT source_path, slug, title, category, track,
              1 - (embedding <=> $1::vector) AS similarity, left(body, 300) AS snippet
         FROM solutions WHERE ${where.join(" AND ")}
         ORDER BY embedding <=> $1::vector LIMIT $${kIdx}`,
      params,
    );
    return text(r.rows);
  },
);

server.registerTool(
  "get_solution",
  {
    description: "Fetch a full solution by slug or source_path.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const r = await pool.query(
      "SELECT * FROM solutions WHERE source_path = $1 OR slug = $1 ORDER BY created DESC",
      [id],
    );
    return text(r.rows);
  },
);

server.registerTool(
  "related_solutions",
  {
    description: "Nearest semantic neighbours of an existing solution.",
    inputSchema: {
      slug: z.string(),
      k: z.number().int().positive().max(50).default(5),
    },
  },
  async ({ slug, k }) => {
    const r = await pool.query(
      `SELECT b.source_path, b.title, b.category, 1 - (a.embedding <=> b.embedding) AS similarity
         FROM solutions a JOIN solutions b ON b.id <> a.id
        WHERE (a.source_path = $1 OR a.slug = $1) AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        ORDER BY a.embedding <=> b.embedding LIMIT $2`,
      [slug, k],
    );
    return text(r.rows);
  },
);

server.registerTool(
  "find_by_applies_to",
  {
    description:
      "Solutions whose applies_to globs match a repo-relative file path (previews the inject hook).",
    inputSchema: { file_path: z.string() },
  },
  async ({ file_path }) => {
    const r = await pool.query(
      "SELECT source_path, title, applies_to, created FROM solutions WHERE cardinality(applies_to) > 0 ORDER BY created DESC",
    );
    return text(
      r.rows.filter((row) =>
        matchesAnyGlob(file_path, row.applies_to as string[]),
      ),
    );
  },
);

server.registerTool(
  "find_duplicates",
  {
    description: "Near-duplicate pairs above a cosine threshold.",
    inputSchema: {
      threshold: z.number().min(0).max(1).default(0.88),
      category: z.string().optional(),
    },
  },
  async ({ threshold, category }) => {
    const params: unknown[] = [1 - threshold];
    let catClause = "";
    if (category) {
      catClause = "AND a.category = $2 AND b.category = $2";
      params.push(category);
    }
    const r = await pool.query(
      `SELECT a.source_path AS a, b.source_path AS b, 1 - (a.embedding <=> b.embedding) AS sim
         FROM solutions a JOIN solutions b ON a.id < b.id
        WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
          AND (a.embedding <=> b.embedding) < $1 ${catClause}
        ORDER BY sim DESC LIMIT 200`,
      params,
    );
    return text(r.rows);
  },
);

server.registerTool(
  "stats",
  {
    description: "Corpus overview counts.",
    inputSchema: {},
  },
  async () => {
    const totals = (
      await pool.query(
        `SELECT count(*)::int AS total,
                count(embedding)::int AS embedded,
                count(*) FILTER (WHERE cardinality(warnings) > 0)::int AS with_warnings,
                min(created) AS oldest, max(created) AS newest
           FROM solutions`,
      )
    ).rows[0];
    const byCategory = (
      await pool.query(
        "SELECT category, count(*)::int AS n FROM solutions GROUP BY category ORDER BY category",
      )
    ).rows;
    const byTrack = (
      await pool.query(
        "SELECT track, count(*)::int AS n FROM solutions GROUP BY track",
      )
    ).rows;
    const bySeverity = (
      await pool.query(
        "SELECT severity, count(*)::int AS n FROM solutions GROUP BY severity ORDER BY n DESC",
      )
    ).rows;
    return text({ ...totals, byCategory, byTrack, bySeverity });
  },
);

server.registerTool(
  "sql",
  {
    description: "Run a single read-only SELECT/WITH query.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    if (!isReadOnlyQuery(query)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Rejected: only a single read-only SELECT/WITH query is allowed.",
          },
        ],
        isError: true,
      };
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const r = await client.query(query);
      return text(r.rows.slice(0, 200));
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* no active transaction — ignore */
      }
      client.release();
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("solutions-db MCP server connected (stdio).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
