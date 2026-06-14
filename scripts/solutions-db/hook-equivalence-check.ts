/**
 * Gate C — Hook equivalence check (SP2 Task 10).
 * Verifies that the DB-backed injection path emits the SAME solution references
 * as the markdown-fallback path across representative edited paths.
 *
 * Usage: npx tsx scripts/solutions-db/hook-equivalence-check.ts
 * Requires SOLUTIONS_DB_READONLY_URL in .env (loaded via dotenv/config).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const HOOK = join(REPO_ROOT, ".claude", "hooks", "inject-patterns.sh");
const SPILL = "/tmp/ocrecipes-injection-context.md";

// One representative edited path per domain-cluster (covers the domain-map rows).
const PROBES: string[] = [
  "server/routes/recipes.ts",
  "server/storage/cookbooks.ts",
  "server/middleware/auth.ts",
  "server/services/photo-analysis.ts",
  "client/screens/HomeScreen.tsx",
  "client/components/Button.tsx",
  "client/hooks/useThing.ts",
  "client/lib/format.ts",
  "shared/schema.ts",
  "evals/runner.ts",
  "client/components/__tests__/Button.test.tsx",
];

function solutionRefs(filePath: string, source: "db" | "markdown"): string {
  const event = JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: join(REPO_ROOT, filePath) },
    session_id: "",
  });
  const out = execFileSync("bash", [HOOK], {
    input: event,
    env: { ...process.env, PATTERN_INJECT_SOURCE: source },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
  // When the hook spills, additionalContext is truncated — read the full spill file.
  const full =
    ctx.includes("[TRUNCATED") && existsSync(SPILL)
      ? readFileSync(SPILL, "utf8")
      : ctx;
  return full
    .split("\n")
    .filter((l) => l.startsWith("- docs/solutions/"))
    .sort()
    .join("\n");
}

let failures = 0;
for (const probe of PROBES) {
  const md = solutionRefs(probe, "markdown");
  const db = solutionRefs(probe, "db");
  const mdLines = md.split("\n").filter(Boolean);
  const dbLines = db.split("\n").filter(Boolean);
  if (md !== db) {
    failures++;
    const onlyMd = mdLines.filter((l) => !dbLines.includes(l));
    const onlyDb = dbLines.filter((l) => !mdLines.includes(l));
    console.error(
      `MISMATCH for ${probe} (md=${mdLines.length} db=${dbLines.length}):`,
    );
    if (onlyMd.length)
      console.error(
        "  markdown-only:\n" + onlyMd.map((l) => "    " + l).join("\n"),
      );
    if (onlyDb.length)
      console.error("  db-only:\n" + onlyDb.map((l) => "    " + l).join("\n"));
  } else {
    console.log(`ok: ${probe} (${dbLines.length} refs match)`);
  }
}
if (failures) {
  console.error(
    `\nGATE C FAILED: ${failures}/${PROBES.length} probes diverged.`,
  );
  process.exit(1);
}
console.log(
  `\nGATE C OK — db and markdown paths agree across all ${PROBES.length} probes.`,
);
