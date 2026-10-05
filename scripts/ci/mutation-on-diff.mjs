// @ts-check
/**
 * Lane F: advisory mutation-on-diff. Pure functions (unit-tested) + an
 * orchestrator that runs `npm run mutation:explore` per eligible changed file
 * with a JSON reporter, then writes a step summary. Never red on score; exits
 * 1 only when the harness itself failed for a module.
 *
 *   node scripts/ci/mutation-on-diff.mjs [--select-only] <changed-files.txt>
 *
 * --select-only does the selection and nothing else: it sets the `run` step
 * output (true when a module is eligible) and, when none is, writes the "No
 * eligible changed modules" summary itself. The workflow runs it before
 * setup-node and `npm ci` and skips the install and the run on `run=false`, so
 * it imports only Node built-ins and stryker.targets.mjs and works on a
 * checkout with no node_modules.
 *
 * The changed-file list comes from a FILE, not an env var: every process this
 * spawns inherits the env, and one oversized variable makes exec fail with
 * E2BIG on Linux.
 *
 * Exclusions come from stryker.targets.mjs (isHardExclusion /
 * isApprovedExclusion) and mutation:explore re-enforces them — there is no
 * second regex here.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MUTATION_TARGETS,
  isApprovedExclusion,
  isHardExclusion,
} from "../../stryker.targets.mjs";

const ELIGIBLE_DIRS = [
  "server/lib/",
  "server/services/",
  "shared/lib/",
  "client/lib/",
];
export const MAX_FILES = 6;

/** @param {string} file */
function isCandidate(file) {
  if (!file.endsWith(".ts")) return false;
  if (file.endsWith(".d.ts") || file.endsWith(".test.ts")) return false;
  if (file.split("/").includes("__tests__")) return false;
  const inRoot = ELIGIBLE_DIRS.some((d) => file.startsWith(d));
  const isClientUtils =
    file.startsWith("client/") && file.endsWith("-utils.ts");
  return inRoot || isClientUtils;
}

/** @param {string} file */
function coLocatedTest(file) {
  return join(
    dirname(file),
    "__tests__",
    basename(file).replace(/\.ts$/, ".test.ts"),
  );
}

/**
 * Sort a PR's changed files into what mutation-on-diff runs and why the rest
 * is not run. Registered targets are skipped first (their required gates
 * cover them), then Hard-Exclusions without a human approval.
 *
 * @param {string[]} changedFiles
 * @param {{ isHardExclusion: (p: string) => boolean, isApprovedExclusion: (p: string) => boolean, registeredMutatePaths: Set<string>, exists: (p: string) => boolean, max?: number }} deps
 */
export function selectEligible(changedFiles, deps) {
  const max = deps.max ?? MAX_FILES;
  /** @type {{ file: string, test: string }[]} */
  const eligible = [];
  /** @type {string[]} */ const untested = [];
  /** @type {string[]} */ const skippedRegistered = [];
  /** @type {string[]} */ const excluded = [];
  /** @type {string[]} */ const overflow = [];

  for (const file of [...new Set(changedFiles)].sort()) {
    // A module the PR deleted has nothing to mutate.
    if (!isCandidate(file) || !deps.exists(file)) continue;
    if (deps.registeredMutatePaths.has(file)) {
      skippedRegistered.push(file);
      continue;
    }
    if (deps.isHardExclusion(file) && !deps.isApprovedExclusion(file)) {
      excluded.push(file);
      continue;
    }
    const test = coLocatedTest(file);
    if (!deps.exists(test)) {
      untested.push(file);
      continue;
    }
    if (eligible.length >= max) {
      overflow.push(file);
      continue;
    }
    eligible.push({ file, test });
  }
  return { eligible, untested, skippedRegistered, excluded, overflow };
}

/**
 * A mutant's position in Stryker's report: 1-based lines and columns, end
 * column exclusive.
 * @typedef {{ start: { line: number, column?: number }, end?: { line: number, column?: number } }} Location
 */

/**
 * The code a mutant replaced, sliced from the report's source; "?" when the
 * report lacks the source or the columns.
 *
 * @param {string | undefined} source
 * @param {Location | undefined} loc
 */
function originalCode(source, loc) {
  const startCol = loc?.start.column;
  const endCol = loc?.end?.column;
  if (source === undefined || !loc?.end || !startCol || !endCol) return "?";
  const lines = source.split("\n").slice(loc.start.line - 1, loc.end.line);
  if (lines.length === 0) return "?";
  const last = lines.length - 1;
  lines[last] = lines[last].slice(0, endCol - 1);
  lines[0] = lines[0].slice(startCol - 1);
  return lines.join("\n");
}

/**
 * Stryker's score: detected (killed + timeout) over detected + undetected
 * (survived + noCoverage); 0 when nothing is detectable.
 *
 * @param {{ files: Record<string, { source?: string, mutants: Array<{ status: string, mutatorName?: string, replacement?: string, location?: Location }> }> }} report
 */
export function scoreFromReport(report) {
  let killed = 0,
    timeout = 0,
    survived = 0,
    noCoverage = 0,
    ignored = 0,
    errors = 0,
    total = 0;
  /** @type {{ file: string, line: number, mutator: string, original: string, replacement: string }[]} */
  const survivors = [];
  for (const [file, entry] of Object.entries(report.files ?? {})) {
    for (const m of entry.mutants ?? []) {
      total += 1;
      switch (m.status) {
        case "Killed":
          killed += 1;
          break;
        case "Timeout":
          timeout += 1;
          break;
        case "Survived":
          survived += 1;
          break;
        case "NoCoverage":
          noCoverage += 1;
          break;
        case "Ignored":
          ignored += 1;
          break;
        default:
          errors += 1; // CompileError, RuntimeError, Pending
      }
      if (m.status === "Survived" || m.status === "NoCoverage") {
        survivors.push({
          file,
          line: m.location?.start?.line ?? 0,
          mutator: m.mutatorName ?? "?",
          original: originalCode(entry.source, m.location),
          replacement: m.replacement ?? "?",
        });
      }
    }
  }
  const detected = killed + timeout;
  const undetected = survived + noCoverage;
  const score =
    detected + undetected === 0
      ? 0
      : (100 * detected) / (detected + undetected);
  return {
    total,
    killed,
    timeout,
    survived,
    noCoverage,
    ignored,
    errors,
    score,
    survivors,
  };
}

/** @param {string} text */
function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Text as one-line inline code that stays intact whatever backticks it
 * holds; long mutant replacements are cut to 80 characters.
 *
 * @param {string} text
 */
function inlineCode(text) {
  const flat = oneLine(text);
  if (flat === "") return "(empty)";
  const short = flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
  const longest = Math.max(
    0,
    ...(short.match(/`+/g) ?? []).map((r) => r.length),
  );
  const fence = "`".repeat(longest + 1);
  return longest > 0
    ? `${fence} ${short} ${fence}`
    : `${fence}${short}${fence}`;
}

/**
 * One module's line in the summary: a score, or (result null) a harness error.
 * @typedef {{ file: string, result: ReturnType<typeof scoreFromReport> | null, error?: string }} Row
 */

/**
 * @param {Row[]} rows
 * @param {{ untested: string[], skippedRegistered: string[], excluded: string[], overflow: string[] }} meta
 */
export function renderSummary(rows, meta) {
  const lines = ["### Mutation-on-diff (advisory)", ""];
  if (rows.length === 0) {
    lines.push("_No eligible changed modules in this PR._", "");
  } else {
    lines.push(
      "| Module | Mutants | Killed | Survived | No coverage | Score |",
      "|---|---|---|---|---|---|",
    );
    for (const r of rows) {
      if (!r.result) {
        lines.push(
          `| ${r.file} | — | — | — | — | ⚠️ ${oneLine(r.error ?? "no report").replaceAll("|", "\\|")} |`,
        );
        continue;
      }
      // Only scored mutants, so the row's counts sum; ignored and errored
      // mutants get a note below the table instead.
      const scored =
        r.result.killed +
        r.result.timeout +
        r.result.survived +
        r.result.noCoverage;
      // Nothing scored means no score at all, not a low one.
      const score =
        scored === 0
          ? "n/a"
          : `${r.result.score.toFixed(1)}%${r.result.score < 60 ? " ⚠️" : ""}`;
      lines.push(
        `| ${r.file} | ${scored} | ${r.result.killed + r.result.timeout} | ${r.result.survived} | ${r.result.noCoverage} | ${score} |`,
      );
    }
    lines.push("");
    let unscored = false;
    for (const r of rows) {
      if (!r.result || r.result.ignored + r.result.errors === 0) continue;
      lines.push(
        `- ${r.file}: ${r.result.ignored} ignored, ${r.result.errors} errored — not scored`,
      );
      unscored = true;
    }
    if (unscored) lines.push("");
    for (const r of rows) {
      if (!r.result || r.result.survivors.length === 0) continue;
      lines.push(
        `<details><summary>${r.file}: ${r.result.survivors.length} survivor(s)</summary>`,
        "",
      );
      const byLine = [...r.result.survivors].sort((a, b) => a.line - b.line);
      for (const s of byLine) {
        lines.push(
          `- line ${s.line}: ${inlineCode(s.original)} mutated to ${inlineCode(s.replacement)} (${s.mutator}) — no test noticed`,
        );
      }
      lines.push("", "</details>", "");
    }
  }
  /** @param {string} label @param {string[]} items */
  const note = (label, items) => {
    if (items.length) lines.push(`- ${label}: ${items.join(", ")}`);
  };
  note("Untested changed modules (no co-located test)", meta.untested);
  note(
    "Skipped (already a registered mutation target)",
    meta.skippedRegistered,
  );
  note("Excluded (Hard-Exclusion, not human-approved)", meta.excluded);
  note("Over the cap, not run", meta.overflow);
  return lines.join("\n") + "\n";
}

/**
 * Turn one explore run into a summary row. Any sign the harness did not
 * finish (spawn failed, non-zero exit, no report, unreadable report) is an
 * error row, never a score.
 *
 * @param {string} file
 * @param {{ status: number | null, error?: NodeJS.ErrnoException }} run
 * @param {string | null} reportText null when the run wrote no report
 * @returns {Row}
 */
export function rowFromRun(file, run, reportText) {
  /** @param {string} error */
  const fail = (error) => ({ file, result: null, error });
  if (run.error) {
    return fail(
      `could not start explore (${run.error.code ?? run.error.message})`,
    );
  }
  if (run.status !== 0) {
    return fail(`explore exited ${run.status ?? "on a signal"}`);
  }
  if (reportText === null) return fail("explore exited 0 without a report");
  try {
    return { file, result: scoreFromReport(JSON.parse(reportText)) };
  } catch {
    return fail("unreadable report");
  }
}

/**
 * @param {string[]} argv the arguments after the script path
 * @returns {{ selectOnly: boolean, listFile: string } | null} null unless they
 *   are `[--select-only] <changed-files.txt>`
 */
export function parseArgs(argv) {
  const selectOnly = argv.includes("--select-only");
  const rest = argv.filter((a) => a !== "--select-only");
  const [listFile] = rest;
  if (rest.length !== 1 || !listFile || listFile.startsWith("--")) return null;
  return { selectOnly, listFile };
}

/**
 * What the select-only step tells the workflow: whether the install and the
 * run are needed and, when they are not, the summary to leave behind (the one
 * a full run with nothing eligible would write).
 *
 * @param {ReturnType<typeof selectEligible>} sel
 * @returns {{ run: boolean, summary: string | null }}
 */
export function selectOnlyOutcome(sel) {
  const run = sel.eligible.length > 0;
  return { run, summary: run ? null : renderSummary([], sel) };
}

/**
 * The PR's eligible modules, from the changed-file list. Both modes use this
 * one derivation, so the step that decides to skip the install and the run
 * that would have found work cannot disagree.
 *
 * @param {string} listFile
 */
function selectFromListFile(listFile) {
  const changed = readFileSync(listFile, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const registeredMutatePaths = new Set(
    Object.values(MUTATION_TARGETS).flatMap((t) => t.mutate),
  );
  return selectEligible(changed, {
    isHardExclusion,
    isApprovedExclusion,
    registeredMutatePaths,
    exists: (p) => existsSync(p),
  });
}

/** @param {string} summary */
function publishSummary(summary) {
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(
      "Usage: node scripts/ci/mutation-on-diff.mjs [--select-only] <changed-files.txt>",
    );
    process.exit(2);
  }
  const sel = selectFromListFile(args.listFile);

  if (args.selectOnly) {
    const { run, summary } = selectOnlyOutcome(sel);
    if (summary !== null) publishSummary(summary);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
    }
    console.log(
      `select-only: ${sel.eligible.length} eligible module(s), run=${run}`,
    );
    return;
  }

  const outDir = "reports/mutation/on-diff";
  mkdirSync(outDir, { recursive: true });
  /** @type {Row[]} */
  const rows = [];
  for (const { file, test } of sel.eligible) {
    const reportFile = join(
      outDir,
      `${file.replace(/[^a-zA-Z0-9]+/g, "-")}.json`,
    );
    // A report left by an earlier local run must not pass for this run's.
    rmSync(reportFile, { force: true });
    console.log(`::group::mutation:explore ${file}`);
    const run = spawnSync(
      "npm",
      // Only the co-located example test, never sibling .property.test.ts
      // files: a Lane F score is the baseline a later registration would
      // get (docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md).
      ["run", "--silent", "mutation:explore", "--", file, test],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          STRYKER_EXPLORE_JSON: "1",
          STRYKER_EXPLORE_JSON_FILE: reportFile,
        },
      },
    );
    console.log("::endgroup::");
    const reportText = existsSync(reportFile)
      ? readFileSync(reportFile, "utf8")
      : null;
    rows.push(rowFromRun(file, run, reportText));
  }

  publishSummary(renderSummary(rows, sel));
  process.exit(rows.some((r) => r.result === null) ? 1 : 0);
}

// Run only when executed directly, not when the unit tests import this file.
// Realpath BOTH sides: the ESM loader realpaths the main module (import.meta.url)
// but process.argv[1] keeps the path as given, so a launch through a symlink
// (macOS /var -> /private/var) made the old href comparison false and the
// script exited 0 having done nothing.
const isMain = (() => {
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
})();
if (isMain) {
  main();
}
