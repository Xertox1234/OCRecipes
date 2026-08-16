#!/usr/bin/env tsx
/**
 * Coverage Ratchet
 *
 * Reads coverage/coverage-final.json (Istanbul v8 format produced by
 * `npm run test:coverage`), computes actual line/statement/function/branch
 * percentages, and compares them to the thresholds in vitest.config.ts.
 *
 * Proposed thresholds are floor(actual) - buffer, where buffer defaults to 4
 * (matching the established gap in vitest.config.ts). A threshold is only
 * raised, never lowered: proposed = max(current, floor(actual) - buffer).
 *
 * Usage:
 *   tsx scripts/coverage-ratchet.ts                    # print report
 *   tsx scripts/coverage-ratchet.ts --apply            # update vitest.config.ts
 *   tsx scripts/coverage-ratchet.ts --buffer 3         # tighter buffer
 *   tsx scripts/coverage-ratchet.ts --coverage-file coverage/coverage-final.json
 *   tsx scripts/coverage-ratchet.ts --config-file vitest.config.ts
 *
 * Exit codes:
 *   0  all metrics are at or above their thresholds (coverage is passing)
 *   1  one or more metrics are below threshold, or --apply would raise a threshold
 *      (use this to optionally gate on "thresholds need updating")
 *   2  usage / file-not-found error
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ───────────────────────────────────────────────────────────────────

interface IstanbulLocation {
  start: { line: number; column: number | null };
  end: { line: number; column: number | null };
}

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, IstanbulLocation>;
  fnMap: Record<string, { name: string; loc: IstanbulLocation }>;
  branchMap: Record<
    string,
    { type: string; locations: IstanbulLocation[]; line: number }
  >;
  s: Record<string, number>; // statement hit counts
  f: Record<string, number>; // function hit counts
  b: Record<string, number[]>; // branch hit counts (array per branch point)
  meta?: unknown;
}

type CoverageFinal = Record<string, IstanbulFileCoverage>;

interface Totals {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

interface Thresholds {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const ESC = "\x1b[";
const c = {
  red: ESC + "31m",
  yellow: ESC + "33m",
  green: ESC + "32m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
  bold: ESC + "1m",
  dim: ESC + "2m",
};

function green(s: string): string {
  return c.green + s + c.reset;
}
function red(s: string): string {
  return c.red + s + c.reset;
}
function yellow(s: string): string {
  return c.yellow + s + c.reset;
}
function bold(s: string): string {
  return c.bold + s + c.reset;
}
function dim(s: string): string {
  return c.dim + s + c.reset;
}

// ─── Coverage computation ─────────────────────────────────────────────────────

export function computeTotals(data: CoverageFinal): Totals {
  let totalLines = 0;
  let coveredLines = 0;
  let totalStmts = 0;
  let coveredStmts = 0;
  let totalFns = 0;
  let coveredFns = 0;
  let totalBranches = 0;
  let coveredBranches = 0;

  for (const entry of Object.values(data)) {
    // Statements
    for (const count of Object.values(entry.s)) {
      totalStmts++;
      if (count > 0) coveredStmts++;
    }

    // Functions
    for (const count of Object.values(entry.f)) {
      totalFns++;
      if (count > 0) coveredFns++;
    }

    // Branches — each branch point has an array of per-branch counts
    for (const counts of Object.values(entry.b)) {
      for (const count of counts) {
        totalBranches++;
        if (count > 0) coveredBranches++;
      }
    }

    // Lines — derive from statementMap: a line is covered if any statement
    // starting on that line has a positive hit count
    const lineHits = new Map<number, boolean>();
    for (const [key, loc] of Object.entries(entry.statementMap)) {
      const line = loc.start.line;
      const hit = (entry.s[key] ?? 0) > 0;
      lineHits.set(line, (lineHits.get(line) ?? false) || hit);
    }
    totalLines += lineHits.size;
    coveredLines += Array.from(lineHits.values()).filter(Boolean).length;
  }

  const pct = (covered: number, total: number): number =>
    total === 0 ? 100 : (covered / total) * 100;

  return {
    lines: pct(coveredLines, totalLines),
    statements: pct(coveredStmts, totalStmts),
    functions: pct(coveredFns, totalFns),
    branches: pct(coveredBranches, totalBranches),
  };
}

// ─── vitest.config.ts threshold parsing and patching ─────────────────────────

const DEFAULT_CONFIG = path.resolve(scriptDir, "../vitest.config.ts");

/**
 * Isolate the COMPLETE `thresholds: { ... }` block by brace counting.
 * Whole-file `metric:\s*(\d+)` regexes with first-match semantics were
 * silently retargeted by any earlier `lines: NN` mention (a baseline comment,
 * a per-glob thresholds addition) — for both the read AND the patch. A
 * non-greedy regex is not enough either: it ends at the FIRST `}`, truncating
 * before the flat metrics whenever a per-glob sub-object precedes them.
 * (Assumes no brace characters inside string literals within the block —
 * true for any plausible thresholds config.)
 */
function locateThresholdsBlock(
  source: string,
  configFile: string,
): { start: number; end: number; block: string } {
  const startMatch = source.match(/thresholds:\s*\{/);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(
      `Could not find a thresholds: { ... } block in ${configFile}`,
    );
  }
  let depth = 0;
  for (
    let i = startMatch.index + startMatch[0].length - 1;
    i < source.length;
    i++
  ) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        const end = i + 1;
        return {
          start: startMatch.index,
          end,
          block: source.slice(startMatch.index, end),
        };
      }
    }
  }
  throw new Error(`Unbalanced thresholds: { ... } block in ${configFile}`);
}

/**
 * Blank the contents of nested sub-objects (per-glob thresholds) with spaces,
 * preserving length and indices, so metric regexes only ever match the
 * block's own top-level keys — for the read AND the patch.
 */
function maskNestedObjects(block: string): string {
  let depth = 0;
  let out = "";
  for (const ch of block) {
    if (ch === "{") {
      depth++;
      out += depth > 1 ? " " : ch;
    } else if (ch === "}") {
      out += depth > 1 ? " " : ch;
      depth--;
    } else {
      out += depth > 1 && ch !== "\n" ? " " : ch;
    }
  }
  return out;
}

export function readCurrentThresholds(configFile: string): Thresholds {
  const source = fs.readFileSync(configFile, "utf8");
  const { block } = locateThresholdsBlock(source, configFile);
  const masked = maskNestedObjects(block);
  const extract = (metric: string): number => {
    const match = masked.match(new RegExp(`\\b${metric}:\\s*(\\d+)`));
    if (!match)
      throw new Error(
        `Could not parse threshold for "${metric}" in ${configFile}`,
      );
    return parseInt(match[1], 10);
  };
  return {
    lines: extract("lines"),
    statements: extract("statements"),
    functions: extract("functions"),
    branches: extract("branches"),
  };
}

export function applyThresholds(
  proposed: Thresholds,
  configFile: string,
): void {
  const source = fs.readFileSync(configFile, "utf8");
  const { start, end, block } = locateThresholdsBlock(source, configFile);
  let patched = block;
  const patchMetric = (metric: string, value: number): void => {
    // Match on the masked copy (indices are length-preserving), splice into
    // the real block — a nested per-glob metric can never be the target.
    const match = maskNestedObjects(patched).match(
      new RegExp(`(\\b${metric}:\\s*)(\\d+)`),
    );
    if (!match || match.index === undefined) return;
    const at = match.index + match[1].length;
    patched =
      patched.slice(0, at) +
      String(value) +
      patched.slice(at + match[2].length);
  };
  patchMetric("lines", proposed.lines);
  patchMetric("statements", proposed.statements);
  patchMetric("functions", proposed.functions);
  patchMetric("branches", proposed.branches);
  fs.writeFileSync(
    configFile,
    source.slice(0, start) + patched + source.slice(end),
    "utf8",
  );
}

export function proposeThresholds(
  current: Thresholds,
  actual: Totals,
  buffer: number,
): Thresholds {
  const propose = (metric: keyof Thresholds): number =>
    Math.max(current[metric], Math.floor(actual[metric]) - buffer);
  return {
    lines: propose("lines"),
    statements: propose("statements"),
    functions: propose("functions"),
    branches: propose("branches"),
  };
}

// ─── CLI argument parsing ─────────────────────────────────────────────────────

export type ParsedArgs =
  | {
      kind: "ok";
      coverageFile: string;
      configFile: string;
      buffer: number;
      applyMode: boolean;
    }
  | { kind: "help" }
  | { kind: "error"; message: string };

const HELP_TEXT = [
  "Usage: tsx scripts/coverage-ratchet.ts [options]",
  "",
  "Options:",
  "  --apply                  Update vitest.config.ts with proposed thresholds",
  "  --buffer N               Buffer below actual (default: 4)",
  "  --coverage-file PATH     Path to coverage-final.json",
  "  --config-file PATH       Path to the vitest config to read/patch",
  "  --help                   Show this message",
].join("\n");

export function parseArgs(args: string[]): ParsedArgs {
  let coverageFile = path.resolve(scriptDir, "../coverage/coverage-final.json");
  let configFile = DEFAULT_CONFIG;
  let buffer = 4;
  let applyMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") {
      applyMode = true;
    } else if (args[i] === "--coverage-file" && args[i + 1]) {
      coverageFile = path.resolve(args[++i]);
    } else if (args[i] === "--config-file" && args[i + 1]) {
      configFile = path.resolve(args[++i]);
    } else if (args[i] === "--buffer" && args[i + 1]) {
      buffer = parseInt(args[++i], 10);
      if (isNaN(buffer) || buffer < 0) {
        return {
          kind: "error",
          message: "--buffer must be a non-negative integer",
        };
      }
    } else if (args[i] === "--help") {
      return { kind: "help" };
    } else {
      // A typo like `--aply` must not silently run in report-only mode.
      return {
        kind: "error",
        message: `Unknown argument: ${args[i]} (see --help)`,
      };
    }
  }

  return { kind: "ok", coverageFile, configFile, buffer, applyMode };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function main(args: string[]): number {
  const parsed = parseArgs(args);
  if (parsed.kind === "help") {
    console.log(HELP_TEXT);
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(parsed.message);
    return 2;
  }
  const { coverageFile, configFile, buffer, applyMode } = parsed;

  if (!fs.existsSync(coverageFile)) {
    console.error(
      red(`Coverage file not found: ${coverageFile}`) +
        "\nRun " +
        bold("npm run test:coverage") +
        " first.",
    );
    return 2;
  }

  if (!fs.existsSync(configFile)) {
    console.error(red(`Config file not found: ${configFile}`));
    return 2;
  }

  const data: CoverageFinal = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
  const actual = computeTotals(data);
  let current: Thresholds;
  try {
    current = readCurrentThresholds(configFile);
  } catch (err) {
    // A malformed config is a usage error (exit 2), never the
    // "coverage is failing" exit 1 an uncaught throw would produce.
    console.error(red(err instanceof Error ? err.message : String(err)));
    return 2;
  }
  const proposed = proposeThresholds(current, actual, buffer);

  // ─── Report ───────────────────────────────────────────────────────────────

  const METRICS: (keyof Thresholds)[] = [
    "lines",
    "statements",
    "functions",
    "branches",
  ];

  const col = {
    metric: 12,
    actual: 10,
    threshold: 12,
    status: 8,
    proposed: 10,
  };

  const pad = (s: string, n: number): string => s.padEnd(n);
  const lpad = (s: string, n: number): string => s.padStart(n);

  console.log(
    "\n" +
      bold("Coverage Ratchet") +
      dim(` — buffer: ${buffer} points below actual\n`),
  );

  const header =
    pad("Metric", col.metric) +
    lpad("Actual", col.actual) +
    lpad("Threshold", col.threshold) +
    lpad("Status", col.status) +
    lpad("Proposed", col.proposed);
  console.log(dim(header));
  console.log(
    dim(
      "─".repeat(
        col.metric + col.actual + col.threshold + col.status + col.proposed,
      ),
    ),
  );

  let allPassing = true;
  let anyRaise = false;

  for (const metric of METRICS) {
    const act = actual[metric];
    const thr = current[metric];
    const prop = proposed[metric];
    const passing = act >= thr;
    const willRaise = prop > thr;

    if (!passing) allPassing = false;
    if (willRaise) anyRaise = true;

    const statusStr = passing ? green("✓ pass") : red("✗ FAIL");
    const propStr = willRaise ? yellow(String(prop)) : dim(String(prop));

    console.log(
      pad(metric, col.metric) +
        lpad(act.toFixed(2) + "%", col.actual) +
        lpad(thr + "%", col.threshold) +
        lpad(statusStr, col.status + 9) + // +9 for ANSI escape codes
        lpad(propStr, col.proposed + (willRaise ? 9 : 4)),
    );
  }

  console.log();

  if (!allPassing) {
    console.error(
      red("One or more metrics are below their thresholds.") +
        " Run " +
        bold("npm run test:coverage") +
        " to see the full report.",
    );
  }

  if (!anyRaise) {
    console.log(
      dim(
        "No threshold updates needed — all proposed values match current thresholds.",
      ),
    );
  } else if (!applyMode) {
    console.log(
      yellow("Proposed thresholds are higher than current.") +
        " Run with " +
        bold("--apply") +
        " to update vitest.config.ts.",
    );
  } else {
    applyThresholds(proposed, configFile);
    console.log(green("✓ vitest.config.ts updated with proposed thresholds."));
    console.log(
      dim(
        "Remember to update the baseline comment in vitest.config.ts " +
          "with today's date and measured values.",
      ),
    );
  }

  console.log();

  // Exit 1 if any threshold would be raised (useful for CI "should I ratchet?")
  // or if coverage is failing.
  if (!allPassing || (anyRaise && !applyMode)) {
    return 1;
  }
  return 0;
}

// Only run the CLI when invoked directly — importing this module (e.g. from
// the test suite) must not read the real config or call process.exit.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
