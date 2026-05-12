# AI Drift Automation Plan

> Implementation plan for the scheduled checker that evaluates `docs/AI_DRIFT_CHECKLIST.md`. See the checklist file for the canonical row definitions and `docs/AI_WORKFLOW.md` § Drift Checklist for the workflow context.

## Overview

Build a small, deterministic checker that reads `docs/AI_DRIFT_CHECKLIST.md`, evaluates rows by stable `id`, and emits a structured report. The first iteration is report-only and ships with one real check (`DRIFT-001`, todo-researcher pinned docs bindings). Additional rows from the checklist get wired in incrementally as their automated-check column becomes implementable. The runner is scheduled via a GitHub Actions cron workflow.

## Problem Statement

`docs/AI_DRIFT_CHECKLIST.md` was added as the canonical recurring-drift list (see `docs/AI_WORKFLOW.md` § Drift Checklist) with stable IDs, intervals, and automation-friendly check descriptions. Today every row's `status` is `pending` and there is no scheduled mechanism to evaluate them — so drift is still caught only by manual review.

The goal is to turn the checklist from a passive document into an automatable signal source without baking in fragile assumptions or producing noisy diffs on the checklist file itself.

## Proposed Solution

### Architecture

```
scripts/check-ai-drift.js                 # CLI entry: parses checklist, dispatches per-id checks, prints report
scripts/ai-drift/                         # One module per DRIFT-NNN id (only the implemented ones)
  drift-001-researcher-bindings.js        # First check (pinned researcher tool names)
scripts/__tests__/check-ai-drift.test.ts  # Vitest coverage for the parser and DRIFT-001 module
.github/workflows/ai-drift.yml            # Cron workflow that runs the script and uploads the report
```

The script is plain ESM JavaScript with no new runtime dependencies — it follows the existing pattern in `scripts/check-accessibility.js`, `scripts/check-hardcoded-colors.js`, and `scripts/check-idor-storage.js`, all of which are zero-dep Node scripts invoked via `node scripts/...`.

### Runner Module API

Each per-id module exports a single function with this signature:

```js
// scripts/ai-drift/drift-001-researcher-bindings.js
/**
 * @param {{ repoRoot: string, row: ChecklistRow }} ctx
 * @returns {Promise<DriftCheckResult>}
 */
export async function check(ctx) {
  /* ... */
}
```

`ChecklistRow` is the parsed representation of one table row from `docs/AI_DRIFT_CHECKLIST.md` (`id`, `item`, `interval`, `status`, `last_checked`, `next_check`, `canonical_files`, `automated_check`).

`DriftCheckResult` matches the report record schema in the next section.

The top-level runner (`scripts/check-ai-drift.js`):

1. Reads `docs/AI_DRIFT_CHECKLIST.md` and parses the markdown table into `ChecklistRow[]`.
2. For each row with a registered module under `scripts/ai-drift/`, invokes `check(ctx)` and collects the result.
3. For each row without a registered module, emits a result with `status: "manual-review"` and `summary: "no automated check implemented yet"` so the report stays exhaustive.
4. Prints a JSON report to stdout and a human summary to stderr.
5. Exits `0` if every result is `ok` or `manual-review`, `1` if any result is `drift-detected` or `error`.

### Output / Report Format

Each row produces one record with the five fields required by `docs/AI_DRIFT_CHECKLIST.md` plus an optional `details` field for verbose drift diagnostics:

```json
{
  "id": "DRIFT-001",
  "status": "ok",
  "checked_at": "2026-05-10T14:22:31.000Z",
  "triggering_files": [".claude/agents/todo-researcher.md"],
  "summary": "All 4 pinned tool names still present in todo-researcher.md."
}
```

A drift-detected example:

```json
{
  "id": "DRIFT-001",
  "status": "drift-detected",
  "checked_at": "2026-05-10T14:22:31.000Z",
  "triggering_files": [".claude/agents/todo-researcher.md"],
  "summary": "Missing pinned tool names: github_text_search, mcp_github_search_code.",
  "details": {
    "expected": [
      "fetch_webpage",
      "github_text_search",
      "github_repo",
      "mcp_github_search_code"
    ],
    "missing": ["github_text_search", "mcp_github_search_code"],
    "unexpected_aliases": []
  }
}
```

Allowed `status` values match the checklist's recommended set: `pending`, `ok`, `drift-detected`, `manual-review`. The runner also emits `error` for internal failures (file not found, parse error) — those are not written back to the checklist; they only appear in the report and cause a non-zero exit.

The full report is a JSON array of these records, written to:

- stdout (always), so CI logs preserve it.
- `ai-drift-report.json` in the working directory when invoked with `--out ai-drift-report.json`, so the GitHub Action can upload it as an artifact.

### Report-Only vs. Auto-Edit Decision

**Decision: v1 is report-only.** The checker does not modify `docs/AI_DRIFT_CHECKLIST.md`.

Reasoning:

- The Risks section of the todo flags noisy diffs from auto-editing on every scheduled run.
- Monthly/quarterly intervals mean most rows would churn `last_checked`/`next_check` columns even when nothing changed semantically, producing diffs that obscure real drift events.
- Report-only keeps the canonical file human-curated. Drift events get reported in the workflow run; a human updates `status`/`notes` when reacting.
- This matches the checklist's own guidance: "If a scheduled check edits this file automatically, append short notes rather than rewriting the meaning of an existing row." Easier to comply with by not editing at all in v1.

A future v2 can opt in to writing `last_checked`/`next_check`/`status` for individual rows once the report format is stable and we've observed real drift events. v2 is out of scope for this todo.

### DRIFT-001 — Researcher Pinned Bindings Check

Concrete algorithm for `scripts/ai-drift/drift-001-researcher-bindings.js`:

```js
const EXPECTED_TOOLS = [
  "fetch_webpage",
  "github_text_search",
  "github_repo",
  "mcp_github_search_code",
];

const RETIRED_ALIASES = [
  // Names we know have been retired or renamed in past drift events.
  // Currently empty — populate as drift events are observed.
];

export async function check({ repoRoot, row }) {
  const file = path.join(repoRoot, ".claude/agents/todo-researcher.md");
  const contents = await fs.readFile(file, "utf8");
  const checkedAt = new Date().toISOString();

  // 1. Each expected tool name must appear at least once in the file
  //    (substring match — these are bare identifiers in prose and code fences).
  const missing = EXPECTED_TOOLS.filter((tool) => !contents.includes(tool));

  // 2. None of the known-retired aliases should appear outside an explicit
  //    "Deprecated" / "historical" context. Detect occurrences first; for v1,
  //    a flat occurrence count is enough — manual review handles false positives.
  const unexpectedAliases = RETIRED_ALIASES.filter((alias) =>
    contents.includes(alias),
  );

  if (missing.length === 0 && unexpectedAliases.length === 0) {
    return {
      id: row.id,
      status: "ok",
      checked_at: checkedAt,
      triggering_files: [".claude/agents/todo-researcher.md"],
      summary: `All ${EXPECTED_TOOLS.length} pinned tool names still present in todo-researcher.md.`,
    };
  }

  const issues = [];
  if (missing.length > 0) issues.push(`missing: ${missing.join(", ")}`);
  if (unexpectedAliases.length > 0) {
    issues.push(`unexpected aliases: ${unexpectedAliases.join(", ")}`);
  }

  return {
    id: row.id,
    status: "drift-detected",
    checked_at: checkedAt,
    triggering_files: [".claude/agents/todo-researcher.md"],
    summary: `Pinned tool binding drift — ${issues.join("; ")}.`,
    details: {
      expected: EXPECTED_TOOLS,
      missing,
      unexpected_aliases: unexpectedAliases,
    },
  };
}
```

Drift triggers and resulting status:

| Condition                                                  | Status           |
| ---------------------------------------------------------- | ---------------- |
| All four expected tool names present, no retired aliases   | `ok`             |
| One or more expected tool names absent                     | `drift-detected` |
| A retired alias appears (once `RETIRED_ALIASES` is seeded) | `drift-detected` |
| `.claude/agents/todo-researcher.md` missing or unreadable  | `error` (exit 1) |

Substring matching is intentional. The pinned tool names are bare identifiers — a stricter regex (word boundaries, quote requirements) would create false negatives when the agent doc evolves its prose. The expected set is small and the names are distinctive enough that incidental matches in other contexts are extremely unlikely.

### Adding More Checks Later

The runner registers modules by filename convention: `scripts/ai-drift/drift-NNN-<slug>.js` is auto-loaded for row `id = DRIFT-NNN`. To add a check:

1. Create `scripts/ai-drift/drift-NNN-<slug>.js` exporting `async function check(ctx)`.
2. Add a Vitest case in `scripts/__tests__/check-ai-drift.test.ts` covering the `ok` and `drift-detected` branches.
3. No registry edit needed — file discovery happens at runtime.

This keeps the cost of adding `DRIFT-002` through `DRIFT-007` low and avoids a central manifest that itself drifts.

### Scheduling

**Primary path: GitHub Actions cron workflow.** A new file `.github/workflows/ai-drift.yml`:

```yaml
name: AI Drift Check

on:
  schedule:
    # Weekly cadence — runs every Monday at 14:00 UTC.
    # The checklist's per-row interval is informational; the runner evaluates
    # every row every run, and report-only mode makes frequent runs cheap.
    - cron: "0 14 * * 1"
  workflow_dispatch: {}

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Run AI drift checks
        run: node scripts/check-ai-drift.js --out ai-drift-report.json

      - name: Upload drift report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ai-drift-report
          path: ai-drift-report.json
          retention-days: 30
```

Key choices:

- **`workflow_dispatch`** lets a human run the check on demand from the GitHub UI.
- **`if: always()`** uploads the report even when the runner exits 1 (drift detected) so the artifact is available for triage.
- **Weekly cadence** is finer than the checklist's `monthly`/`quarterly` columns. Those columns describe how often a human should _review_ a check; the automated run is cheap and report-only, so weekly is a defensible default. The checker does not enforce the interval columns in v1.
- **No npm install step** because the script is zero-dep Node — saves ~30s vs. a full `npm ci`.

**Alternative: local cron.** For self-hosted setups, the same script can be invoked from a crontab entry:

```
0 14 * * 1  cd /path/to/OCRecipes && node scripts/check-ai-drift.js --out /tmp/ai-drift.json
```

GitHub Actions is the recommended path because the report ends up attached to a workflow run that humans can find via the Actions tab; cron output requires extra plumbing for visibility.

## Technical Considerations

### Markdown Table Parsing

The runner needs a small Markdown table parser, not a full Markdown library. Approach:

1. Read `docs/AI_DRIFT_CHECKLIST.md`.
2. Find the first line starting with `| id ` (header row).
3. Skip the separator row.
4. Parse subsequent rows until a blank line or non-pipe row.
5. Split each row on `|` after trimming leading/trailing pipes.

This avoids adding a dependency on `marked` / `markdown-it`. The checklist's table format is stable (the file header explicitly says "Keep row IDs stable so scheduled jobs can parse and update the file"), so a custom parser is appropriate.

### CLI Flags

Minimal surface for v1:

- `--out <path>` — write JSON report to a file in addition to stdout.
- `--id <DRIFT-NNN>` — run only one check (useful for local debugging).
- `--repo-root <path>` — override the inferred repo root (defaults to the script's own grandparent directory).

### Exit Codes

- `0` — all results are `ok` or `manual-review`.
- `1` — at least one `drift-detected` or `error` result.
- `2` — the runner itself crashed (checklist missing, parse failure, etc.).

This lets CI surface drift as a workflow failure without conflating it with bugs in the runner.

### What Not to Build in v1

- No auto-editing of `docs/AI_DRIFT_CHECKLIST.md`. (Decision above.)
- No GitHub Issue auto-creation for drift events. (Manual review is fine for monthly cadence; can be added later if drift becomes frequent.)
- No checks for `DRIFT-002` through `DRIFT-007`. The runner reports them as `manual-review` so they're not invisible, but the modules are out of scope here.
- No new npm dependencies. The whole script stays zero-dep ESM Node.

### Maintenance Path

Every drift event observed in production must produce one of:

1. A code change that resolves the drift (the normal case).
2. A new entry in `RETIRED_ALIASES` so future renames keep tripping the check.
3. A checklist row update (manual) if the canonical expectation itself changed.

The third case is the maintenance hatch the todo's Risks section asks for — the checker does not bake in immutable assumptions; the source of truth is still the checklist file and the per-id module, both of which are human-editable.

## Testing Plan

`scripts/__tests__/check-ai-drift.test.ts` covers:

1. **Parser** — given a fixture checklist with three rows, returns `ChecklistRow[]` with the expected fields.
2. **DRIFT-001 ok branch** — `.claude/agents/todo-researcher.md` containing all four tool names returns `status: "ok"`.
3. **DRIFT-001 drift branch** — a fixture researcher file missing one tool name returns `status: "drift-detected"` with the missing tool in `details.missing`.
4. **Unregistered row** — a row with no module under `scripts/ai-drift/` returns `status: "manual-review"`.
5. **Exit code** — runner exits `1` when any result is `drift-detected`.

Tests run as part of the existing `npm run test:run` Vitest suite (no new test infra).

## Rollout

1. Land this plan document. (This todo.)
2. Implement the runner, the DRIFT-001 module, the tests, and the GitHub Action in a follow-up PR.
3. Observe two weeks of weekly runs; if the workflow is stable and zero false positives, leave it report-only.
4. If drift events accumulate and triage friction becomes a real cost, revisit auto-editing or auto-issue-creation in a separate plan.

## Open Questions

None blocking. The plan is concrete enough to implement directly.
