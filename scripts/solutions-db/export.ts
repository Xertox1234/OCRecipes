import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createPool } from "./lib/db";
import { SOLUTIONS_ROOT } from "./lib/files";
import { serializeSolution } from "./lib/serialize";
import { parseSolution, type ProjectionInput } from "./lib/parse";

/** Map a DB row (snake_case, jsonb extra_fields, text[] arrays) to a ProjectionInput. */
function rowToProjection(r: Record<string, unknown>): ProjectionInput {
  return {
    title: r.title as string,
    track: r.track as ProjectionInput["track"],
    category: r.category as ProjectionInput["category"],
    module: (r.module as string | null) ?? null,
    severity: (r.severity as string | null) ?? null,
    tags: (r.tags as string[]) ?? [],
    symptoms: (r.symptoms as string[]) ?? [],
    appliesTo: (r.applies_to as string[]) ?? [],
    created: r.created as string,
    lastUpdated: (r.last_updated as string | null) ?? null,
    extraFields: (r.extra_fields as Record<string, unknown>) ?? {},
    body: r.body as string,
  };
}

// to_char keeps DATE columns as clean 'YYYY-MM-DD' strings (avoids node-pg's Date tz drift).
const SELECT_ALL = `
  SELECT source_path, title, track, category, module, severity, tags, symptoms, applies_to,
         to_char(created,'YYYY-MM-DD') AS created,
         to_char(last_updated,'YYYY-MM-DD') AS last_updated,
         body, extra_fields, content_hash
  FROM solutions`;

async function main() {
  const url = process.env.SOLUTIONS_DATABASE_URL;
  if (!url) {
    console.error("SOLUTIONS_DATABASE_URL not set");
    process.exit(1);
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const pool = createPool(url);

  if (args.includes("--verify")) {
    // Gate B: in-memory round-trip across ALL rows vs the STORED content_hash. Does NOT touch disk.
    const rows = (await pool.query(SELECT_ALL)).rows;
    await pool.end();
    const mismatches: string[] = [];
    for (const r of rows) {
      const md = serializeSolution(rowToProjection(r));
      const reparsed = parseSolution(md, r.source_path, r.created);
      if (reparsed.contentHash !== r.content_hash)
        mismatches.push(r.source_path);
    }
    if (mismatches.length) {
      console.error(`ROUND-TRIP FAILED for ${mismatches.length} rows:`);
      for (const m of mismatches.slice(0, 50)) console.error(`  - ${m}`);
      process.exit(1);
    }
    console.log(
      `ROUND-TRIP OK — all ${rows.length} rows serialize→parse to the stored hash.`,
    );
    return;
  }

  const all = args.includes("--all");
  const single = args.find((a) => !a.startsWith("--"));
  if (!all && !single) {
    console.error("usage: export.ts (--all | <source_path>) | --verify");
    process.exit(1);
  }
  const where = all ? "" : " WHERE source_path = $1";
  const params = all ? [] : [single];
  const rows = (await pool.query(SELECT_ALL + where, params)).rows;
  await pool.end();
  for (const r of rows) {
    const md = serializeSolution(rowToProjection(r));
    const abs = join(SOLUTIONS_ROOT, r.source_path as string);
    if (!resolve(abs).startsWith(resolve(SOLUTIONS_ROOT) + "/")) {
      console.error(
        `refusing to write outside solutions root: ${r.source_path}`,
      );
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, md, "utf8");
  }
  console.log(`Exported ${rows.length} file(s).`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
