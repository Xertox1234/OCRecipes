import "dotenv/config";
import { createPool } from "./lib/db";
import { buildRecentQuery, type RecentFilters } from "./lib/query-builder";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv: string[]): { filters: RecentFilters; k: number } {
  const args = argv.filter((a) => a !== "--");
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const filters: RecentFilters = {};
  const days = get("--days");
  if (days !== undefined) {
    const n = Number(days);
    if (!Number.isFinite(n)) fail(`--days must be a number (got "${days}")`);
    filters.days = n;
  }
  const track = get("--track");
  if (track !== undefined) {
    if (track !== "bug" && track !== "knowledge")
      fail(`--track must be "bug" or "knowledge" (got "${track}")`);
    filters.track = track;
  }
  const category = get("--category");
  if (category) filters.category = category;
  const limit = get("--limit");
  let k = 20;
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isFinite(n)) fail(`--limit must be a number (got "${limit}")`);
    k = n;
  }
  return { filters, k };
}

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
  const { filters, k } = parseArgs(process.argv.slice(2));
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
