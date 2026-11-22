# Lane F — Mutation-on-Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every PR, run Stryker (via the existing gate-respecting `mutation:explore`) against the changed, non-excluded, co-located-tested pure modules, and put each module's score and survivor list in the job summary — advisory, never red on score.

**Architecture:** A pure eligible-set function in `scripts/ci/mutation-on-diff.mjs` (unit-tested with the registry's real `isHardExclusion`/`isApprovedExclusion`), an orchestrator in the same file that runs `mutation:explore` per file with a JSON reporter enabled by env flag, and a new `pull_request` workflow that copies the merge-base diff step from `mutation-non-excluded.yml` verbatim.

**Tech Stack:** Stryker 9 (`@stryker-mutator/core`, vitest runner), Node ESM (`.mjs`), Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` §Lane F. Shared constraints: `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-00-index.md` §Global Constraints.

## Global Constraints

- Advisory: the job never exits non-zero because of a score. It exits non-zero only on harness errors (missing report, explore refused).
- Hard exclusions come from `stryker.targets.mjs` exports (`isHardExclusion`, `isApprovedExclusion`) — never a second regex. `mutation:explore` re-enforces the gate in `stryker.explore.conf.mjs`, so the workflow cannot bypass it.
- Cap 6 eligible files per PR; overflow listed, not run. Lowered in F0 if p95 runtime exceeds ~10 minutes.
- Scores under 60 are flagged in the summary. Threshold promotion is out of scope.
- `stryker.explore.conf.mjs` keeps `incremental: false`.
- Commit messages: no backticks in `-m`; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a `/todo` worktree use `/usr/bin/git`.
- **STOP after each completed task** (green + committed + reviewed): report and end the turn so the user can compact. See index §Execution protocol. Task 4's replay control needs a throwaway PR — human-gated.

## File structure

| File                                         | Responsibility                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `scripts/ci/mutation-on-diff.mjs`            | `selectEligible`, `scoreFromReport`, `renderSummary` (pure); `main()` orchestration                          |
| `scripts/__tests__/mutation-on-diff.test.ts` | floor rule: exclusion, approved exclusion, registered skip, untested, cap, score maths from a report fixture |
| `stryker.explore.conf.mjs`                   | optional `json` reporter behind `STRYKER_EXPLORE_JSON=1`                                                     |
| `.github/workflows/mutation-on-diff.yml`     | `pull_request` → diff → orchestrate → summary + artefact                                                     |

---

### Task 1: Eligible-set and score functions with their floor-rule test

**Files:**

- Create: `scripts/ci/mutation-on-diff.mjs`
- Test: `scripts/__tests__/mutation-on-diff.test.ts`

**Interfaces:**

- Consumes (`stryker.targets.mjs`): `MUTATION_TARGETS` (record of `{ mutate: string[]; testInclude: string[]; breakThreshold?: number }`), `isHardExclusion(path: string): boolean`, `isApprovedExclusion(path: string): boolean`.
- Produces (exports of `scripts/ci/mutation-on-diff.mjs`):
  - `ELIGIBLE_DIRS = ["server/lib/", "server/services/", "shared/lib/", "client/lib/"]`; `MAX_FILES = 6`.
  - `selectEligible(changedFiles: string[], deps: { isHardExclusion, isApprovedExclusion, registeredMutatePaths: Set<string>, exists: (p: string) => boolean, max?: number }): { eligible: Array<{ file: string; test: string }>; untested: string[]; skippedRegistered: string[]; excluded: string[]; overflow: string[] }`. A file is a candidate when it ends in `.ts`, is not a test (`.test.ts`, `.property.test.ts`, `.d.ts`, or inside `__tests__/`), and either lives directly under an `ELIGIBLE_DIRS` entry or matches `client/**/*-utils.ts`. Its co-located test is `<dir>/__tests__/<basename>.test.ts`.
  - `scoreFromReport(report: { files: Record<string, { mutants: Array<{ status: string; mutatorName?: string; replacement?: string; location?: { start: { line: number } } }> }> }): { total: number; killed: number; timeout: number; survived: number; noCoverage: number; ignored: number; errors: number; score: number; survivors: Array<{ file: string; line: number; mutator: string; replacement: string }> }` — Stryker's definition: `detected = killed + timeout`, `undetected = survived + noCoverage`, `score = 100 * detected / (detected + undetected)` (0 when the denominator is 0).
  - `renderSummary(rows: Array<{ file: string; result: ReturnType<typeof scoreFromReport> | null; error?: string }>, meta: { untested: string[]; skippedRegistered: string[]; excluded: string[]; overflow: string[] }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/mutation-on-diff.test.ts
/**
 * Floor rule for Lane F: the eligible-set function must exclude what the
 * registry excludes, skip what the registry already gates, report untested
 * modules, enforce the cap, and the score maths must match Stryker's
 * definition — each proven on synthetic input using the REAL registry
 * predicates so a regex drift in stryker.targets.mjs shows up here.
 */
import { describe, it, expect } from "vitest";
import {
  isApprovedExclusion,
  isHardExclusion,
  MUTATION_TARGETS,
} from "../../stryker.targets.mjs";
import { scoreFromReport, selectEligible } from "../ci/mutation-on-diff.mjs";

const registered = new Set(
  Object.values(MUTATION_TARGETS).flatMap((t) => t.mutate),
);
const withTests = (tests: string[]) => (p: string) => tests.includes(p);
const deps = (tests: string[], max?: number) => ({
  isHardExclusion,
  isApprovedExclusion,
  registeredMutatePaths: registered,
  exists: withTests(tests),
  max,
});

describe("selectEligible", () => {
  it("pairs an eligible module with its co-located test", () => {
    const r = selectEligible(
      ["server/lib/foo.ts"],
      deps(["server/lib/__tests__/foo.test.ts"]),
    );
    expect(r.eligible).toEqual([
      { file: "server/lib/foo.ts", test: "server/lib/__tests__/foo.test.ts" },
    ]);
  });

  it("reports a module with no co-located test as untested", () => {
    const r = selectEligible(["server/services/bar.ts"], deps([]));
    expect(r.untested).toEqual(["server/services/bar.ts"]);
    expect(r.eligible).toEqual([]);
  });

  it("ignores tests, .d.ts, .tsx, and files outside the eligible roots", () => {
    const r = selectEligible(
      [
        "server/lib/__tests__/foo.test.ts",
        "server/lib/foo.property.test.ts",
        "server/lib/types.d.ts",
        "client/components/Button.tsx",
        "server/routes/recipes.ts",
        "scripts/ci/visual-diff.ts",
      ],
      deps(["server/lib/__tests__/foo.test.ts"]),
    );
    expect(r).toMatchObject({
      eligible: [],
      untested: [],
      excluded: [],
      skippedRegistered: [],
      overflow: [],
    });
  });

  it("includes client/**/*-utils.ts (the pure-function-extraction convention)", () => {
    const r = selectEligible(
      ["client/components/nutrition/label-utils.ts"],
      deps(["client/components/nutrition/__tests__/label-utils.test.ts"]),
    );
    expect(r.eligible[0].test).toBe(
      "client/components/nutrition/__tests__/label-utils.test.ts",
    );
  });

  it("excludes a Hard-Exclusion path using the registry predicate", () => {
    // server/middleware/auth.ts is outside ELIGIBLE_DIRS anyway; pick a path the
    // registry's HARD_EXCLUSION_RE matches inside an eligible dir. The registry
    // excludes goal-safety: server/services/goal-calculator.ts is APPROVED, so use
    // a sibling name the regex covers but no approval exists for.
    const hard =
      Object.keys(MUTATION_TARGETS).length > 0
        ? "server/services/iap-receipt-validation.ts"
        : "";
    expect(isHardExclusion(hard)).toBe(true); // guards the fixture: if the regex changes, this test says so
    const r = selectEligible(
      [hard],
      deps([`server/services/__tests__/iap-receipt-validation.test.ts`]),
    );
    expect(r.excluded).toEqual([hard]);
    expect(r.eligible).toEqual([]);
  });

  it("lets an APPROVED exclusion through", () => {
    const approved = "server/services/goal-calculator.ts";
    expect(isHardExclusion(approved) && isApprovedExclusion(approved)).toBe(
      true,
    );
    // goal-calculator is also a registered target, so it is skipped for THAT reason:
    const r = selectEligible(
      [approved],
      deps(["server/services/__tests__/goal-calculator.test.ts"]),
    );
    expect(r.skippedRegistered).toEqual([approved]);
  });

  it("skips registered targets (their required gates cover them)", () => {
    const r = selectEligible(
      ["server/lib/macro-gap-context.ts"],
      deps(["server/lib/__tests__/macro-gap-context.test.ts"]),
    );
    expect(r.skippedRegistered).toEqual(["server/lib/macro-gap-context.ts"]);
  });

  it("enforces the cap and lists the overflow", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"].map(
      (n) => `server/lib/${n}.ts`,
    );
    const tests = files.map((f) =>
      f.replace(/server\/lib\/(\w+)\.ts$/, "server/lib/__tests__/$1.test.ts"),
    );
    const r = selectEligible(files, deps(tests, 6));
    expect(r.eligible).toHaveLength(6);
    expect(r.overflow).toEqual(["server/lib/g.ts", "server/lib/h.ts"]);
  });
});

describe("scoreFromReport", () => {
  const report = {
    files: {
      "server/lib/foo.ts": {
        mutants: [
          {
            status: "Killed",
            mutatorName: "EqualityOperator",
            replacement: ">",
            location: { start: { line: 10 } },
          },
          { status: "Timeout" },
          {
            status: "Survived",
            mutatorName: "ConditionalExpression",
            replacement: "true",
            location: { start: { line: 42 } },
          },
          {
            status: "NoCoverage",
            mutatorName: "StringLiteral",
            replacement: '""',
            location: { start: { line: 50 } },
          },
          { status: "Ignored" },
          { status: "CompileError" },
        ],
      },
    },
  };

  it("computes Stryker's score: detected / (detected + undetected)", () => {
    const r = scoreFromReport(report);
    expect(r).toMatchObject({
      total: 6,
      killed: 1,
      timeout: 1,
      survived: 1,
      noCoverage: 1,
      ignored: 1,
      errors: 1,
    });
    expect(r.score).toBe(50);
  });

  it("lists survivors and no-coverage mutants with line and mutator", () => {
    expect(scoreFromReport(report).survivors).toEqual([
      {
        file: "server/lib/foo.ts",
        line: 42,
        mutator: "ConditionalExpression",
        replacement: "true",
      },
      {
        file: "server/lib/foo.ts",
        line: 50,
        mutator: "StringLiteral",
        replacement: '""',
      },
    ]);
  });

  it("returns 0 when nothing is detectable", () => {
    expect(
      scoreFromReport({ files: { x: { mutants: [{ status: "Ignored" }] } } })
        .score,
    ).toBe(0);
  });
});
```

If the Hard-Exclusion fixture path in "excludes a Hard-Exclusion path" is not matched by the registry's `HARD_EXCLUSION_RE` (the assertion `isHardExclusion(hard)` fails), read `stryker.targets.mjs:158` and substitute a path the regex does match — the point is to use the real predicate, not to hard-code a guess.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/mutation-on-diff.test.ts`
Expected: FAIL — `Cannot find module '../ci/mutation-on-diff.mjs'`

- [ ] **Step 3: Write the pure functions**

```js
// scripts/ci/mutation-on-diff.mjs
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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MUTATION_TARGETS,
  isApprovedExclusion,
  isHardExclusion,
} from "../../stryker.targets.mjs";

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
  if (rows.length === 0)
    lines.push("_No eligible changed modules in this PR._", "");
  else {
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
      for (const s of r.result.survivors)
        lines.push(
          `- line ${s.line}: ${s.mutator} → \`${s.replacement}\` — no test noticed`,
        );
      lines.push("", "</details>", "");
    }
  }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/mutation-on-diff.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/mutation-on-diff.mjs scripts/__tests__/mutation-on-diff.test.ts
git commit -m "ci(mutation): eligible-set and score functions for mutation-on-diff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: JSON reporter behind an env flag in explore mode

**Files:**

- Modify: `stryker.explore.conf.mjs` (the `reporters` line)

**Interfaces:**

- Produces: when `STRYKER_EXPLORE_JSON=1`, Stryker also writes a JSON report to `STRYKER_EXPLORE_JSON_FILE` (default `reports/mutation/explore.json`) in the standard mutation-report schema (`files[<path>].mutants[].status`). Local `mutation:explore` output is unchanged when the flag is unset.

- [ ] **Step 1: Edit the config**

Replace `reporters: ["clear-text", "progress"],` with:

```js
  reporters: process.env.STRYKER_EXPLORE_JSON === "1"
    ? ["clear-text", "progress", "json"]
    : ["clear-text", "progress"],
  ...(process.env.STRYKER_EXPLORE_JSON === "1"
    ? { jsonReporter: { fileName: process.env.STRYKER_EXPLORE_JSON_FILE ?? "reports/mutation/explore.json" } }
    : {}),
```

- [ ] **Step 2: Prove it locally on a registered target's module (fast, already baselined)**

```bash
STRYKER_EXPLORE_JSON=1 STRYKER_EXPLORE_JSON_FILE=/tmp/explore-check.json \
  npm run mutation:explore -- server/lib/macro-gap-context.ts server/lib/__tests__/macro-gap-context.test.ts \
  && node -e 'const r=require("/tmp/explore-check.json"); const f=Object.keys(r.files); console.log(f.length, "file(s);", r.files[f[0]].mutants.length, "mutants")'
```

Expected: the explore run completes as before and the last line prints `1 file(s); N mutants` with N > 0. (`reports/mutation/` is gitignored, `.gitignore:121`.)

- [ ] **Step 3: Commit**

```bash
git add stryker.explore.conf.mjs
git commit -m "ci(mutation): optional JSON reporter for explore mode behind STRYKER_EXPLORE_JSON

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The orchestrator (`main`) in `mutation-on-diff.mjs`

**Files:**

- Modify: `scripts/ci/mutation-on-diff.mjs` (append `main()` and the direct-run guard)

**Interfaces:**

- Consumes: env `CHANGED_FILES` (newline-separated, from the workflow's diff step); `npm run mutation:explore -- <file> <test>`; `STRYKER_EXPLORE_JSON` / `STRYKER_EXPLORE_JSON_FILE` (Task 2).
- Produces: `reports/mutation/on-diff/<slug>.json` per module; the summary appended to `$GITHUB_STEP_SUMMARY` (and printed). Exit 0 unless a harness error occurred (explore refused / report missing) — score never affects the exit code.

- [ ] **Step 1: Append the orchestrator**

```js
function main() {
  const changed = (process.env.CHANGED_FILES ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const registeredMutatePaths = new Set(
    Object.values(MUTATION_TARGETS).flatMap((t) => t.mutate),
  );
  const sel = selectEligible(changed, {
    isHardExclusion,
    isApprovedExclusion,
    registeredMutatePaths,
    exists: (p) => existsSync(p),
  });

  const outDir = "reports/mutation/on-diff";
  mkdirSync(outDir, { recursive: true });
  /** @type {Array<{ file: string, result: ReturnType<typeof scoreFromReport> | null, error?: string }>} */
  const rows = [];
  let harnessError = false;

  for (const { file, test } of sel.eligible) {
    const slug = file.replace(/[^a-zA-Z0-9]+/g, "-");
    const reportFile = join(outDir, `${slug}.json`);
    console.log(`::group::mutation:explore ${file}`);
    const run = spawnSync(
      "npm",
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
    if (!existsSync(reportFile)) {
      harnessError = true;
      rows.push({
        file,
        result: null,
        error: `explore exited ${run.status ?? "?"} without a report`,
      });
      continue;
    }
    rows.push({
      file,
      result: scoreFromReport(JSON.parse(readFileSync(reportFile, "utf8"))),
    });
  }

  const summary = renderSummary(rows, sel);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exit(harnessError ? 1 : 0);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
```

- [ ] **Step 2: Local dry run against a synthetic change list**

```bash
CHANGED_FILES=$'server/lib/civil-date.ts\nserver/lib/macro-gap-context.ts\nserver/middleware/auth.ts' node scripts/ci/mutation-on-diff.mjs
```

Expected: `civil-date.ts` is run (co-located test exists) and gets a score row; `macro-gap-context.ts` appears under "Skipped (already a registered mutation target)"; `auth.ts` does not appear (outside the eligible roots). Exit 0. Re-run the unit test file to confirm the pure functions are unchanged.

- [ ] **Step 3: Commit**

```bash
git add scripts/ci/mutation-on-diff.mjs
git commit -m "ci(mutation): orchestrate mutation:explore per eligible changed module with a step summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The workflow, and the F0 replay control

**Files:**

- Create: `.github/workflows/mutation-on-diff.yml`

**Interfaces:**

- Consumes: the merge-base diff logic from `.github/workflows/mutation-non-excluded.yml` lines 20–37 (copied verbatim, including the fail-loud `rev-parse` checks and the three-dot diff); `scripts/ci/mutation-on-diff.mjs`.
- Produces: job `Mutation-on-diff (advisory)`; artefact `mutation-on-diff-<run_id>` with the JSON reports.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/mutation-on-diff.yml
name: Mutation-on-diff

# ADVISORY — not a required check, never red on score. Generalises "prove the
# test can fail" from the ten registered Stryker targets to whatever pure
# module a PR touched: runs `mutation:explore` (gate-respecting; Hard-Exclusion
# re-enforced in stryker.explore.conf.mjs) per changed, co-located-tested,
# non-excluded module and posts score + survivors to the job summary.
# Registered targets are skipped here — their required gates cover them.

on:
  pull_request:

permissions:
  contents: read

jobs:
  mutation-on-diff:
    name: Mutation-on-diff (advisory)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # need the merge-base for the three-dot diff below

      # Copied from mutation-non-excluded.yml: FAIL LOUD on a missing SHA or
      # merge-base rather than defaulting to an empty change list.
      - name: Detect changed files
        id: changed
        run: |
          set -euo pipefail
          BASE='${{ github.event.pull_request.base.sha }}'
          HEAD='${{ github.event.pull_request.head.sha }}'
          git rev-parse --verify "$BASE^{commit}" >/dev/null
          git rev-parse --verify "$HEAD^{commit}" >/dev/null
          CHANGED="$(git diff --name-only "$BASE...$HEAD")"
          echo "Changed files in this PR:"
          echo "$CHANGED"
          {
            echo "files<<EOF"
            echo "$CHANGED"
            echo "EOF"
          } >> "$GITHUB_OUTPUT"

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Mutation-on-diff
        env:
          CHANGED_FILES: ${{ steps.changed.outputs.files }}
        run: node scripts/ci/mutation-on-diff.mjs

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: mutation-on-diff-${{ github.run_id }}
          path: reports/mutation/on-diff/
          if-no-files-found: ignore
```

- [ ] **Step 2: Validate and commit**

```bash
npx --yes yaml-lint .github/workflows/mutation-on-diff.yml
git add .github/workflows/mutation-on-diff.yml
git commit -m "ci(mutation): advisory mutation-on-diff workflow on pull_request

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Replay control — the lane must be observed reporting a drop**

On the F0 branch itself, the PR's own diff touches only `scripts/`, `stryker.explore.conf.mjs`, and the workflow — no eligible module — so the summary reads "No eligible changed modules". That is the empty case, not the control. For the control:

1. Create a throwaway branch from the F0 branch: `git switch -c tmp/f0-replay-control`.
2. Touch an eligible module trivially (add a comment line to `server/lib/civil-date.ts`) and, in `server/lib/__tests__/civil-date.test.ts`, delete one `expect(...)` line from a test that covers a branch. Commit both; open a draft PR; wait for `Mutation-on-diff (advisory)`.
3. Record the summary's score for `server/lib/civil-date.ts` (call it S_weak).
4. Restore the deleted `expect`, commit, wait again; record S_intact.

Expected: S_weak < S_intact, and the weak run's survivor list names the line whose assertion was removed. Paste both run URLs and both scores into the F0 PR body under "Replay control". Close the draft PR; delete the branch. If S_weak ≥ S_intact, the deleted assertion did not guard any mutant — pick a different assertion (one on a comparison or boundary) and repeat; do not declare the lane proven on an equal score.

- [ ] **Step 4: Runtime measurement**

From the Actions tab, take the three most recent runs of `Mutation-on-diff (advisory)` on real PRs (once the workflow is on `main`) and record their durations in the PR body. If the slowest exceeds ~10 minutes, lower `MAX_FILES` in `scripts/ci/mutation-on-diff.mjs` (and the cap test's expectation) in a follow-up commit and say so.

## Verification (F0 PR)

```bash
npx vitest run scripts/__tests__/mutation-on-diff.test.ts scripts/__tests__/mutation-explore.test.ts 2>/dev/null || npx vitest run scripts/__tests__/mutation-on-diff.test.ts
grep -n "STRYKER_EXPLORE_JSON" stryker.explore.conf.mjs
grep -c "HARD_EXCLUSION" scripts/ci/mutation-on-diff.mjs || echo "no second regex (correct)"
```

Expected: green; the reporter flag present; the last grep prints `0` (or the "(correct)" line) — the orchestrator never defines its own exclusion regex.

## Considered and rejected

- Reusing `stryker.conf.mjs` with a synthetic `MUTATION_TARGET` per changed file — that config's `incremental` file and threshold semantics are per-registered-target; explore mode is the documented ad-hoc path and already enforces the gate twice.
- Making the job red under 60 now — no runtime or noise data exists yet; promotion is a separate decision after several weeks of summaries.
- Generating the `mutation-non-excluded.yml` target regex from the registry in this lane — filed as its own P3 todo (index Task 0).
