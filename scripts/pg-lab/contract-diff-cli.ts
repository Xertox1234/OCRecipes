#!/usr/bin/env tsx
/**
 * scripts/pg-lab/contract-diff-cli.ts — the shape-comparison logic behind
 * scripts/pg-lab/contract-diff.sh. Kept as a thin CLI over the pure functions in
 * server/lib/contract-shape.ts so the actual diffing logic is covered by ordinary
 * Vitest unit tests rather than embedded SQL/awk (see contract-shape.test.ts).
 *
 * Reads a single JSON object from stdin:
 *   { "base": SnapshotRow[], "feature": SnapshotRow[] }
 * where SnapshotRow = { route_pattern, method, status, shape, sample_count }.
 *
 * Prints a human-readable report to stdout and exits 1 if any route was added,
 * removed, or had an added/removed/retyped key; exits 0 otherwise.
 */
import { diffRouteShapes, type Shape } from "../../server/lib/contract-shape";

export interface SnapshotRow {
  route_pattern: string;
  method: string;
  status: number;
  shape: Shape;
  sample_count: number;
}

export interface DiffInput {
  base: SnapshotRow[];
  feature: SnapshotRow[];
}

// Route identity includes status -- matching dev.contract_snapshots' own unique key
// (branch, route_pattern, method, status). A narrower method+route_pattern-only key
// would treat "same route, different status across branches" as present-on-both-sides
// (so it's absent from added/removed) while ALSO missing the keyDiffs lookup below
// (whose key includes status) -- silently dropping a route/status contract change
// entirely. Keying by the full tuple everywhere avoids that gap.
function routeKey(
  row: Pick<SnapshotRow, "route_pattern" | "method" | "status">,
): string {
  return `${row.method} ${row.route_pattern} [${row.status}]`;
}

export interface DiffReport {
  addedRoutes: string[];
  removedRoutes: string[];
  keyDiffs: {
    route: string;
    added: string[];
    removed: string[];
    retyped: string[];
  }[];
  baseSampleCount: number;
  featureSampleCount: number;
  hasDifferences: boolean;
}

/** Pure: builds the full diff report from two branches' stored snapshot rows. */
export function buildDiffReport(input: DiffInput): DiffReport {
  const baseKeys = new Set(input.base.map(routeKey));
  const featureKeys = new Set(input.feature.map(routeKey));

  const addedRoutes = [...featureKeys].filter((k) => !baseKeys.has(k)).sort();
  const removedRoutes = [...baseKeys].filter((k) => !featureKeys.has(k)).sort();

  const baseByKey = new Map(input.base.map((row) => [routeKey(row), row]));
  const keyDiffs: DiffReport["keyDiffs"] = [];
  for (const featureRow of input.feature) {
    const key = routeKey(featureRow);
    const baseRow = baseByKey.get(key);
    if (!baseRow) continue; // route/method/status only on feature — already in addedRoutes
    const diff = diffRouteShapes(baseRow.shape, featureRow.shape);
    if (diff.added.length || diff.removed.length || diff.retyped.length) {
      keyDiffs.push({ route: key, ...diff });
    }
  }

  const baseSampleCount = input.base.reduce(
    (sum, r) => sum + r.sample_count,
    0,
  );
  const featureSampleCount = input.feature.reduce(
    (sum, r) => sum + r.sample_count,
    0,
  );

  return {
    addedRoutes,
    removedRoutes,
    keyDiffs,
    baseSampleCount,
    featureSampleCount,
    hasDifferences:
      addedRoutes.length > 0 || removedRoutes.length > 0 || keyDiffs.length > 0,
  };
}

export function formatReport(report: DiffReport): string {
  const lines: string[] = [];

  lines.push(
    `SAMPLES: base=${report.baseSampleCount} feature=${report.featureSampleCount}` +
      (report.baseSampleCount === 0 || report.featureSampleCount === 0
        ? "  (WARNING: one side has zero recorded traffic — this is 'no data', not 'no diff')"
        : ""),
  );

  if (report.addedRoutes.length) {
    lines.push("ROUTES ADDED:");
    for (const r of report.addedRoutes) lines.push(`  + ${r}`);
  }
  if (report.removedRoutes.length) {
    lines.push("ROUTES REMOVED:");
    for (const r of report.removedRoutes) lines.push(`  - ${r}`);
  }
  if (report.keyDiffs.length) {
    lines.push("KEY DIFFS:");
    for (const d of report.keyDiffs) {
      lines.push(`  ${d.route}:`);
      for (const k of d.added) lines.push(`    + ${k}`);
      for (const k of d.removed) lines.push(`    - ${k}`);
      for (const k of d.retyped) lines.push(`    ~ ${k}`);
    }
  }
  if (!report.hasDifferences) {
    lines.push("no differences");
  }

  return lines.join("\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<number> {
  const raw = await readStdin();
  let input: DiffInput;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Partial<DiffInput>).base) ||
      !Array.isArray((parsed as Partial<DiffInput>).feature)
    ) {
      throw new Error('expected { "base": [...], "feature": [...] }');
    }
    input = parsed as DiffInput;
  } catch (err) {
    process.stderr.write(
      `contract-diff-cli: invalid JSON on stdin: ${String(err)}\n`,
    );
    return 1;
  }
  const report = buildDiffReport(input);
  process.stdout.write(formatReport(report) + "\n");
  return report.hasDifferences ? 1 : 0;
}

// Direct-invocation guard (matches the repo idiom in scripts/lib/path-domains.ts).
if (process.argv[1]?.endsWith("contract-diff-cli.ts")) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`contract-diff-cli: ${String(err)}\n`);
      process.exitCode = 1;
    });
}
