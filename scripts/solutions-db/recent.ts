import "dotenv/config";
import { createPool } from "./lib/db";
import { buildRecentQuery } from "./lib/query-builder";
import { parseRecentArgs } from "./lib/recent-args";

function fmtDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function main() {
  const url = process.env.SOLUTIONS_DB_READONLY_URL;
  if (!url) {
    console.error("SOLUTIONS_DB_READONLY_URL not set");
    process.exit(1);
  }
  const { filters, k } = ((): ReturnType<typeof parseRecentArgs> => {
    try {
      return parseRecentArgs(process.argv.slice(2));
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  })();
  const { sql, params } = buildRecentQuery(filters, k);
  const pool = createPool(url);
  try {
    const r = await pool.query(sql, params);
    if (r.rows.length === 0) {
      console.log("No solutions match.");
      return;
    }
    for (const row of r.rows) {
      const sev = row.severity ? ` [${row.severity}]` : "";
      console.log(
        `${fmtDate(row.created)}  ${row.track}/${row.category}${sev}  ${row.title}`,
      );
      console.log(
        `    docs/solutions/${String(row.source_path).replace(/^docs\/solutions\//, "")}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
