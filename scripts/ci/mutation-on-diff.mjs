// @ts-check
/**
 * Lane F: advisory mutation-on-diff. Pure functions (unit-tested) + an
 * orchestrator that runs `npm run mutation:explore` per eligible changed file
 * with a JSON reporter, then writes a step summary. Never red on score.
 *
 * Exclusions come from stryker.targets.mjs (isHardExclusion /
 * isApprovedExclusion) and mutation:explore re-enforces them — there is no
 * second regex here.
 */
import { basename, dirname, join } from "node:path";

export const ELIGIBLE_DIRS = [
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
  const inRoot = ELIGIBLE_DIRS.some(
    (d) => file.startsWith(d) && !file.slice(d.length).includes("/"),
  );
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
    if (!isCandidate(file)) continue;
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
 * Stryker's score: detected (killed + timeout) over detected + undetected
 * (survived + noCoverage); 0 when nothing is detectable.
 *
 * @param {{ files: Record<string, { mutants: Array<{ status: string, mutatorName?: string, replacement?: string, location?: { start: { line: number } } }> }> }} report
 */
export function scoreFromReport(report) {
  let killed = 0,
    timeout = 0,
    survived = 0,
    noCoverage = 0,
    ignored = 0,
    errors = 0,
    total = 0;
  /** @type {{ file: string, line: number, mutator: string, replacement: string }[]} */
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

/**
 * @param {Array<{ file: string, result: ReturnType<typeof scoreFromReport> | null, error?: string }>} rows
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
          `| ${r.file} | — | — | — | — | ⚠️ ${r.error ?? "no report"} |`,
        );
        continue;
      }
      const flag = r.result.score < 60 ? " ⚠️" : "";
      lines.push(
        `| ${r.file} | ${r.result.total} | ${r.result.killed + r.result.timeout} | ${r.result.survived} | ${r.result.noCoverage} | ${r.result.score.toFixed(1)}%${flag} |`,
      );
    }
    lines.push("");
    for (const r of rows) {
      if (!r.result || r.result.survivors.length === 0) continue;
      lines.push(
        `<details><summary>${r.file}: ${r.result.survivors.length} survivor(s)</summary>`,
        "",
      );
      for (const s of r.result.survivors) {
        lines.push(
          `- line ${s.line}: ${s.mutator} → \`${s.replacement}\` — no test noticed`,
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
