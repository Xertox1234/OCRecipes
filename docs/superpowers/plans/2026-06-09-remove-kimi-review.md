# Remove Kimi Code Review Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the automated kimi code-review gates (Claude Code hook, Husky pre-commit, CI job) and all supporting infrastructure while preserving the I/O tools (ask-kimi, kimi-write, extract-chat, kimi-challenge).

**Architecture:** Three interleaved phases — infrastructure deletion first (so no hook fires during cleanup), then guidance doc updates in two git commits, then local-only file edits (CLAUDE.md files and memory are gitignored). No new code is added; all changes are removals or replacements of existing text.

**Tech Stack:** bash, JSON (settings.json, package.json), Markdown (CLAUDE.md, AI_WORKFLOW.md, todo-executor.md, SKILL.md), git

---

## File Map

| File                                                     | Action                                                                   | Commit     |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| `.claude/settings.json`                                  | Remove kimi-review.sh PreToolUse hook block                              | A          |
| `.husky/pre-commit`                                      | Strip drift check + kimi gate; keep lint-staged only                     | A          |
| `package.json`                                           | Remove 3 kimi npm scripts                                                | A          |
| `.claude/hooks/kimi-review.sh`                           | Delete                                                                   | A          |
| `.claude/hooks/test-kimi-review.sh`                      | Delete                                                                   | A          |
| `.github/workflows/kimi-review.yml`                      | Delete                                                                   | A          |
| `scripts/kimi-review.py`                                 | Delete                                                                   | A          |
| `scripts/ci-kimi-review.sh`                              | Delete                                                                   | A          |
| `scripts/check-kimi-engine.sh`                           | Delete                                                                   | A          |
| `scripts/sync-kimi-engine.sh`                            | Delete                                                                   | A          |
| `scripts/kimi-profiles.json`                             | Delete                                                                   | A          |
| `docs/kimi-review-architecture.md`                       | Delete                                                                   | A          |
| `CLAUDE.md` (project)                                    | Remove kimi-review guidance, add code-reviewer note                      | local-only |
| `~/.claude/CLAUDE.md` (global)                           | Remove 2 kimi-review AUTO-delegate lines                                 | local-only |
| `docs/AI_WORKFLOW.md`                                    | Remove Review Policy section + kimi-review/kimi-multi-review subsections | B          |
| `.claude/agents/todo-executor.md`                        | Remove Step 2 gate + replace Step 6 + 2 text patches                     | C          |
| `.claude/skills/todo/SKILL.md`                           | Remove Step 5 (kimi availability check)                                  | C          |
| `docs/todo-automation-runbook.md`                        | Remove 3 kimi-review references                                          | C          |
| `memory/reference_kimi_architecture_doc.md`              | Delete                                                                   | local-only |
| `memory/feedback_kimi_drizzle_notnull_false_critical.md` | Delete                                                                   | local-only |
| `memory/feedback_kimi_gate_false_positives.md`           | Delete                                                                   | local-only |
| `memory/feedback_kimi_review_stale_branch.md`            | Delete                                                                   | local-only |
| `memory/reference_kimi_tools_unversioned.md`             | Update — remove review-only references                                   | local-only |
| `memory/MEMORY.md`                                       | Remove 4 index entries                                                   | local-only |

> **Note on "local-only":** `CLAUDE.md`, `~/.claude/CLAUDE.md`, and all `memory/` files are gitignored. Edit them in-place; no commit step is needed or possible for those files.

---

## Task 1: Remove the Claude Code PreToolUse hook

**Why first:** The hook fires on every `git commit` issued from Claude Code. Removing it before anything else ensures it can't trigger during subsequent commits in this session.

**Files:** Modify `.claude/settings.json`

- [ ] **Step 1: Remove the kimi-review.sh hook block**

  In `.claude/settings.json`, find and remove the entire `PreToolUse` hook block for `kimi-review.sh`. The block to remove is:

  ```json
  {
    "matcher": "Bash",
    "hooks": [
      {
        "type": "command",
        "command": "bash .claude/hooks/kimi-review.sh",
        "timeout": 180,
        "statusMessage": "Running kimi-review on staged changes..."
      }
    ]
  },
  ```

  The resulting `PreToolUse` array should still contain the branch-preflight hook (for `Bash`), the batch-size-guard hook (for `Bash`), and the three pattern-injection hooks (for `Edit`, `Write`, `MultiEdit`), and the worktree-isolation hooks.

- [ ] **Step 2: Verify the hook entry is gone**

  ```bash
  grep -c "kimi-review.sh" .claude/settings.json
  ```

  Expected output: `0`

---

## Task 2: Strip kimi-review gate from .husky/pre-commit

**Files:** Modify `.husky/pre-commit`

- [ ] **Step 1: Replace the file content with the lint-staged-only version**

  The file currently contains: bash re-exec header → `set +e` → lint-staged line → engine drift check → kimi gate (everything from the `SKIP_KIMI_REVIEW` check to the final `exit 0`).

  Keep only the portion through `lint-staged`. The final file should be:

  ```bash
  #!/usr/bin/env bash
  # Pre-commit hook: lint-staged.
  #
  # Bypass: nothing to bypass — lint-staged always runs.

  # Husky runs hooks as `sh -e`, ignoring the bash shebang above. This script uses
  # bash-only features (arrays, `<<<` here-strings, `$'...'`). When `sh` is not bash
  # — e.g. dash, the default /bin/sh on Linux — re-exec under bash so those features
  # parse. Must run before lint-staged so it doesn't execute twice. On macOS `sh` is
  # bash (BASH_VERSION set), so this is a no-op there.
  if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
  fi
  # Husky invokes this script as `sh -e`, which activates errexit. We manage exit
  # codes explicitly, so clear errexit now that we are running under bash.
  set +e

  NODE_OPTIONS="--max-old-space-size=4096" npx lint-staged --concurrent false || exit 1
  ```

- [ ] **Step 2: Verify syntax and no kimi token**

  ```bash
  bash -n .husky/pre-commit && echo "syntax OK"
  grep -c "kimi" .husky/pre-commit
  ```

  Expected: `syntax OK` then `0`

---

## Task 3: Delete the 9 infrastructure files

**Files:** Delete all of the following

- [ ] **Step 1: Delete all review infrastructure files**

  ```bash
  rm .claude/hooks/kimi-review.sh \
     .claude/hooks/test-kimi-review.sh \
     .github/workflows/kimi-review.yml \
     scripts/kimi-review.py \
     scripts/ci-kimi-review.sh \
     scripts/check-kimi-engine.sh \
     scripts/sync-kimi-engine.sh \
     scripts/kimi-profiles.json \
     docs/kimi-review-architecture.md
  ```

- [ ] **Step 2: Verify all 9 are gone**

  ```bash
  ls .claude/hooks/kimi-review.sh .claude/hooks/test-kimi-review.sh \
     .github/workflows/kimi-review.yml scripts/kimi-review.py \
     scripts/ci-kimi-review.sh scripts/check-kimi-engine.sh \
     scripts/sync-kimi-engine.sh scripts/kimi-profiles.json \
     docs/kimi-review-architecture.md 2>&1
  ```

  Expected: every path prints `No such file or directory`

---

## Task 4: Remove kimi npm scripts from package.json

**Files:** Modify `package.json`

- [ ] **Step 1: Remove the three kimi script entries**

  Find and remove these three lines from the `"scripts"` object in `package.json`:

  ```json
  "ci:kimi-review": "bash scripts/ci-kimi-review.sh",
  "kimi:engine:sync": "bash scripts/sync-kimi-engine.sh",
  "kimi:engine:check": "bash scripts/check-kimi-engine.sh",
  ```

- [ ] **Step 2: Verify removal and valid JSON**

  ```bash
  jq '.scripts | keys' package.json | grep kimi
  node -e "require('./package.json')" && echo "valid JSON"
  ```

  Expected: first command prints nothing; second prints `valid JSON`

---

## Task 5: Commit A — infrastructure removal

- [ ] **Step 1: Stage and commit**

  ```bash
  git add .claude/settings.json .husky/pre-commit package.json
  git add -u .claude/hooks/kimi-review.sh .claude/hooks/test-kimi-review.sh \
              .github/workflows/kimi-review.yml scripts/kimi-review.py \
              scripts/ci-kimi-review.sh scripts/check-kimi-engine.sh \
              scripts/sync-kimi-engine.sh scripts/kimi-profiles.json \
              docs/kimi-review-architecture.md
  git commit -m "$(cat <<'EOF'
  chore: remove kimi code-review infrastructure

  Remove all 3 automated gates (Claude Code PreToolUse hook, Husky
  pre-commit gate, CI kimi-review.yml) and the Python engine, scripts,
  profiles, and test harness. Pre-commit now runs lint-staged only.
  Replace review with code-reviewer subagent + /code-review skill.

  Kept: ask-kimi, kimi-write, extract-chat, kimi-challenge (I/O tools).

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 2: Verify commit landed**

  ```bash
  git log --oneline -1
  git status --porcelain
  ```

  Expected: commit appears in log; working tree is clean

---

## Task 6: Update project CLAUDE.md (local-only — no commit)

**File:** `CLAUDE.md` (gitignored)

- [ ] **Step 1: Remove kimi-review project stack line**

  Find and remove this line near the top of the `## Cheap-Worker Delegation` section:

  ```
  Project stack: React Native/Expo/TypeScript — reference `.ts`/`.tsx` files (not `.py`) in kimi-review findings.
  ```

- [ ] **Step 2: Remove the two kimi-review AUTO-delegate lines**

  In the global `~/.claude/CLAUDE.md` the relevant AUTO-delegate section mirrors these — but in the project CLAUDE.md the same two lines appear. Find and remove:

  ```
  - Before committing any significant implementation → kimi-review --scope "[what changed]" (automatic via pre-commit hook in OCRecipes; run manually in other projects)
  ```

  and:

  ```
  - After kimi-review returns a CRITICAL finding → stop, surface to user, do not commit until resolved
  ```

- [ ] **Step 3: Delete the "Kimi review gate (mechanics)" subsection**

  Find and delete this entire block (from the heading through its last bullet):

  ```
  ### Kimi review gate (mechanics)
  - Auto-runs on every commit and is the default reviewer for ordinary commits and repetitive loops (todo execution, per-task passes): a Claude Code PreToolUse hook on `git commit` (`.claude/settings.json`) plus Husky's `.husky/pre-commit` (after `lint-staged`). Both auto-skip when no `.ts`/`.tsx` is staged, when `SKIP_KIMI_REVIEW=1` is set, or when `kimi-review` is not on PATH.
  - CRITICAL findings block the commit; WARNING findings print but do not block. The gate sees only the staged commit, so the full branch review below remains the way to catch cross-commit issues.
  - It sends function-context diffs and a names-only `<changed-files>` manifest at `temperature=0`. Mechanics, false-positive hardening, and the `sh -e`/dash hook fixes live in `docs/kimi-review-architecture.md` (single source of truth).
  - Escalate to deep subagents (beyond `kimi-multi-review`) when the risk is architectural, plan-level, or spread across several mostly-untouched files. Keep the code-reviewer and specialist subagents for deep cross-file audit inspection — they are not deprecated.
  ```

- [ ] **Step 4: Replace the "Project-specific triggers" subsection**

  Find and replace the entire block from `### Project-specific triggers` through the last line of the scoped-diff example:

  ```
  ### Project-specific triggers (supplements global CLAUDE.md rules):
  - New RN component, hook, TanStack Query hook, Express route, or Drizzle migration → full branch review: `kimi-review --scope "[what changed]" --base main --tiers CRITICAL,WARNING --profile ocrecipes` (staged-diff check is automatic at commit time)
  - Add `--patterns` to that review based on touched domains. Typical mappings: routes → `api,security,architecture`; storage/schema/migrations → `database,security,architecture`; RN UI → `react-native,design-system`; hooks/query state → `hooks,client-state`; AI/evals → `ai-prompting,security,testing`.
  - Domain-sensitive review → add targeted docs with `--patterns security,api,database` (choose only relevant files from `docs/legacy-patterns/`; pattern docs are capped by default, and `docs/rules/` should be passed via `--rules` when available. Use `--pattern-max-chars 0` only for a deliberately deep manual review.)
  - Cross-domain risky diff → `kimi-multi-review --base main --scope "[what changed]"` (auto-selects security/database/rn/ai/testing/performance reviewers from changed paths)
  - Pattern lookup → `ask-kimi --paths docs/legacy-patterns/[relevant].md --question "[what to check]"`
  - Scoped diff → `git diff main -- path/to/file.ts | kimi-review --scope "[what changed]" --tiers CRITICAL,WARNING --profile ocrecipes`
  ```

  Replace with:

  ```
  ### Code review
  For code review before a PR, use the `code-reviewer` subagent (Agent tool) or `/code-review` skill.
  For pattern lookup, use `ask-kimi --paths docs/legacy-patterns/[relevant].md --question "[what to check]"`.
  ```

- [ ] **Step 5: Verify no kimi-review token remains in the changed area**

  ```bash
  grep "kimi-review" CLAUDE.md
  ```

  Expected: no output (only `kimi-challenge` and `kimi-write`/`ask-kimi`/`extract-chat` references may remain)

---

## Task 7: Update global ~/.claude/CLAUDE.md (local-only — no commit)

**File:** `~/.claude/CLAUDE.md` (global, not in this repo)

- [ ] **Step 1: Remove the two kimi-review AUTO-delegate lines**

  Find the `### AUTO-delegate (no prompt needed):` section. Remove these two lines:

  ```
  - Before committing any significant implementation → kimi-review --scope "[what changed]" (automatic via pre-commit hook in OCRecipes; run manually in other projects)
  ```

  and:

  ```
  - After kimi-review returns a CRITICAL finding → stop, surface to user, do not commit until resolved
  ```

  Leave all other lines in the section unchanged (ask-kimi, kimi-write, extract-chat, kimi-challenge).

- [ ] **Step 2: Verify**

  ```bash
  grep "kimi-review" ~/.claude/CLAUDE.md
  ```

  Expected: no output

---

## Task 8: Update docs/AI_WORKFLOW.md

**File:** `docs/AI_WORKFLOW.md` (git-tracked)

This file has four kimi-specific areas to fix. Apply them in order.

- [ ] **Step 1: Replace "## Review Policy" section with a single routing rule**

  Find and remove the entire `## Review Policy` block — from `## Review Policy` down through the copy-paste checklist block ending with:

  ````
  ```
  ```
  ````

  The exact end boundary is the closing fence of the copy-paste checklist (`Review checklist: ...`) followed by the blank line before `### CI (GitHub Actions)`.

  Replace with:

  ```markdown
  ## Review Policy

  For code review, use the `code-reviewer` subagent (Agent tool with `subagent_type: "code-reviewer"`) for deep cross-file inspection, or the `/code-review` skill for diff-scoped review. Use specialist subagents for security, health-data, auth, or high-blast-radius changes.
  ```

- [ ] **Step 2: Update the pre-commit description in "### CI (GitHub Actions)"**

  Find this sentence in the CI section:

  ```
  The pre-commit hook runs `lint-staged` plus a staged-diff `kimi-review` check for `.ts`/`.tsx` changes when the CLI is available.
  ```

  Replace with:

  ```
  The pre-commit hook runs `lint-staged` on staged files.
  ```

- [ ] **Step 3: Remove "### Kimi Review CI" section**

  Find and delete the entire section from the heading through its last line:

  ```markdown
  ### Kimi Review CI

  `.github/workflows/kimi-review.yml` is an opt-in PR gate for TypeScript review. It runs only for `.ts`/`.tsx` pull request diffs and only when the repository variable `KIMI_REVIEW_CI_ENABLED` is set to `true`.

  When enabled for same-repo PRs, the workflow runs the base-branch copy of `scripts/ci-kimi-review.sh` over the PR merge-base/head diff. CRITICAL findings fail the job; WARNING findings print but do not fail. Fork PRs are skipped because repository secrets are unavailable to untrusted forks.

  Because this workflow uses `pull_request_target`, never change it to check out or execute PR-submitted scripts while repository secrets are in scope. The PR head is fetched only as diff data; the review runner must stay on trusted base-branch code.

  To enable the gate, set `WORKER_API_KEY` or `OPENROUTER_API_KEY` as a repository secret, then set repository variable `KIMI_REVIEW_CI_ENABLED=true`. Custom providers may use `MOONSHOT_API_KEY` only with `WORKER_BASE_URL`. The workflow installs the Python `openai` dependency and uses `scripts/kimi-review.py` as a bundled fallback when a global `kimi-review` CLI is not already on the runner. If the variable is enabled but the secret is missing, the job fails with an explicit setup error.
  ```

- [ ] **Step 4: Rewrite "### Pre-commit Hook" section**

  Find:

  ```markdown
  ### Pre-commit Hook (Husky / lint-staged / kimi-review)

  `.husky/pre-commit` always runs `lint-staged`. Staged `.ts`/`.tsx` files get ESLint auto-fix + Prettier, and then the hook runs `kimi-review` on the staged TypeScript diff with `--tiers CRITICAL,WARNING --profile ocrecipes`.

  CRITICAL Kimi findings block the commit. WARNING findings are printed but do not block. The Kimi gate is intentionally best-effort for local developer ergonomics: it skips when no `.ts`/`.tsx` files are staged, when `SKIP_KIMI_REVIEW=1` is set, or when `kimi-review` is not on `PATH`. Teammates without the Kimi CLI still get lint-staged locally and CI remains the authoritative shared gate.

  The hook does **not** run `tsc` or `npm test` — CI owns those.
  ```

  Replace with:

  ```markdown
  ### Pre-commit Hook (Husky / lint-staged)

  `.husky/pre-commit` runs `lint-staged`. Staged `.ts`/`.tsx` files get ESLint auto-fix + Prettier.

  The hook does **not** run `tsc` or `npm test` — CI owns those.
  ```

- [ ] **Step 5: Remove "### kimi-review" and "### kimi-multi-review" subsections**

  In the `## Cheap-Worker Delegation` section, find and delete the entire `### kimi-review` subsection (from the heading through the final `**Rule:**` line) and the entire `### kimi-multi-review` subsection (from its heading through the final "Keep this as an escalation path" sentence).

  Also update the Copilot intro sentence that mentions review:

  Find:

  ```
  Prefer the `kimi-*` tools below for cheap read/write/review/challenge passes; use Copilot Issues for tracked, tightly scoped deferred work where Copilot can open a normal pull request for human review.
  ```

  Replace with:

  ```
  Prefer the `kimi-*` tools below for cheap read/write/challenge passes; use Copilot Issues for tracked, tightly scoped deferred work where Copilot can open a normal pull request for human review.
  ```

- [ ] **Step 6: Verify no kimi-review or kimi-multi-review tokens remain**

  ```bash
  grep -c "kimi-review\|kimi-multi-review" docs/AI_WORKFLOW.md
  ```

  Expected: `0`

---

## Task 9: Commit B — AI_WORKFLOW.md

- [ ] **Step 1: Stage and commit**

  ```bash
  git add docs/AI_WORKFLOW.md
  git commit -m "$(cat <<'EOF'
  docs: remove kimi-review from AI_WORKFLOW.md

  Replace Review Policy routing matrix with a single code-reviewer
  subagent rule. Remove Kimi Review CI section, kimi-review and
  kimi-multi-review CLI subsections, and pre-commit kimi references.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: Update .claude/agents/todo-executor.md

**File:** `.claude/agents/todo-executor.md` (git-tracked)

Four patches. Apply in order.

- [ ] **Step 1: Remove Step 2 pre-flight gate (item 4)**

  In `## Step 2 — Pre-flight`, find and delete item 4 entirely:

  ````markdown
  4. **kimi-review availability gate**: Check that the required API key is set:
     ```bash
     if [[ -z "${WORKER_API_KEY:-}" && -z "${OPENROUTER_API_KEY:-}" && ( -z "${MOONSHOT_API_KEY:-}" || -z "${WORKER_BASE_URL:-}" ) ]]; then echo "missing"; else echo "found"; fi
     ```
  ````

  If `missing`, report `blocked` with reason "kimi-review requires WORKER_API_KEY, OPENROUTER_API_KEY, or MOONSHOT_API_KEY with WORKER_BASE_URL — set one and retry."

  ```

  After deletion, item 3 (Copilot delegation gate) is immediately followed by `---` and `## Step 3 — Research`.

  ```

- [ ] **Step 2: Update the advisor framing note in Step 3.5**

  Find:

  ```
  The note scopes the advisor to _approach review_, not code-level critique (that is kimi-review's job at Step 6).
  ```

  Replace with:

  ```
  The note scopes the advisor to _approach review_, not code-level critique (that is the code-reviewer subagent's job at Step 6).
  ```

- [ ] **Step 3: Replace the entire Step 6 — Code Review section**

  Find the entire block from `## Step 6 — Code Review` through the line `If no labels matched the table, omit...` (the last line before the `---` separator after Step 6). Replace with:

  ````markdown
  ## Step 6 — Code Review

  Check for working-tree changes, then review them with the `code-reviewer` subagent:

  ```bash
  DIFF=$(git diff HEAD -- .)
  ```
  ````

  If `$DIFF` is empty, skip and set `REVIEW_OUTPUT=""`.

  Otherwise, invoke the subagent via the Agent tool:

  ```
  Agent({
    description: "Code review: <todo title>",
    subagent_type: "code-reviewer",
    prompt: "Review the uncommitted working-tree changes in this repository for correctness bugs, security issues, and adherence to OCRecipes patterns.\n\nRun `git diff HEAD -- .` to see the changes. Use LSP and file-reading tools as needed for full context.\n\nThis review is for todo: <todo title>.\n\nReturn findings using exactly this format:\n[CRITICAL] file:line — description\n[WARNING] file:line — description\n\nIf there are no issues, return exactly: No findings."
  })
  ```

  Store the subagent's full response in working context as `review_output`.

  ```

  ```

- [ ] **Step 4: Update the DEFERRED_WARNINGS field description in the Step 11 report template**

  Find:

  ```
  DEFERRED_WARNINGS: <one line per unaddressed kimi-review WARNING or YELLOW advisor reason (description + file path), or "none">
  ```

  Replace with:

  ```
  DEFERRED_WARNINGS: <one line per unaddressed code review WARNING or YELLOW advisor reason (description + file path), or "none">
  ```

- [ ] **Step 5: Verify no kimi-review token remains**

  ```bash
  grep -c "kimi-review" .claude/agents/todo-executor.md
  ```

  Expected: `0`

---

## Task 11: Update .claude/skills/todo/SKILL.md

**File:** `.claude/skills/todo/SKILL.md` (git-tracked)

- [ ] **Step 1: Remove Step 5 kimi-review availability check**

  Find and delete this entire block:

  ````markdown
  5. **Verify kimi-review is available**: Check that the required API key is set:

     ```bash
     if [[ -z "${WORKER_API_KEY:-}" && -z "${OPENROUTER_API_KEY:-}" && ( -z "${MOONSHOT_API_KEY:-}" || -z "${WORKER_BASE_URL:-}" ) ]]; then echo "missing"; else echo "found"; fi
     ```
  ````

  If `missing`, stop immediately and report "Cannot run kimi-review — set WORKER_API_KEY, OPENROUTER_API_KEY, or MOONSHOT_API_KEY with WORKER_BASE_URL and retry."

  ```

  Then renumber the following item: find

  ```

  6. **If ANY command fails or any check above returns missing, stop immediately.**

  ```

  and change it to:

  ```

  5. **If ANY command fails or any check above returns missing, stop immediately.**

  ```

  ```

- [ ] **Step 2: Verify**

  ```bash
  grep -c "kimi-review" .claude/skills/todo/SKILL.md
  ```

  Expected: `0`

---

## Task 12: Update docs/todo-automation-runbook.md

**File:** `docs/todo-automation-runbook.md` (git-tracked)

- [ ] **Step 1: Remove the kimi-review item from the five-filter safety model**

  Find:

  ```
  2. **kimi-review** — CRITICAL findings block the commit (semantic skim at commit time).
  3. **`scripts/todo-automerge-guard.sh`** — fail-CLOSED allowlist;
  ```

  Replace with (renumber item 3 to 2 and shift subsequent numbers):

  ```
  2. **`scripts/todo-automerge-guard.sh`** — fail-CLOSED allowlist;
  ```

  Then find items 4 and 5 in the same list and renumber them to 3 and 4 respectively.

- [ ] **Step 2: Remove "kimi-gated" from the /todo description**

  Find:

  ```
  `/todo` is the worker it drives (worktree-isolated executors, kimi-gated).
  ```

  Replace with:

  ```
  `/todo` is the worker it drives (worktree-isolated executors).
  ```

- [ ] **Step 3: Remove the kimi-review reference from the implementation step**

  Find:

  ```
  1. Implement it via the /todo executor flow (worktree-isolated, kimi-gated).
  ```

  Replace with:

  ```
  1. Implement it via the /todo executor flow (worktree-isolated).
  ```

- [ ] **Step 4: Verify**

  ```bash
  grep -c "kimi" docs/todo-automation-runbook.md
  ```

  Expected: `0`

---

## Task 13: Commit C — todo/workflow agent files

- [ ] **Step 1: Stage and commit**

  ```bash
  git add .claude/agents/todo-executor.md .claude/skills/todo/SKILL.md docs/todo-automation-runbook.md
  git commit -m "$(cat <<'EOF'
  chore: remove kimi-review from todo executor and runbook

  - todo-executor: remove Step 2 API key gate, replace Step 6 with
    code-reviewer subagent, update advisor note and DEFERRED_WARNINGS
  - SKILL.md: remove Step 5 kimi availability check, renumber Step 6→5
  - todo-automation-runbook: remove kimi-review from safety model

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 14: Update memory files (local-only — no commit)

Memory files live at `/Users/williamtower/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/`.

- [ ] **Step 1: Delete the 4 stale memory files**

  ```bash
  MDIR=~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory
  rm "$MDIR/reference_kimi_architecture_doc.md" \
     "$MDIR/feedback_kimi_drizzle_notnull_false_critical.md" \
     "$MDIR/feedback_kimi_gate_false_positives.md" \
     "$MDIR/feedback_kimi_review_stale_branch.md"
  ```

- [ ] **Step 2: Update reference_kimi_tools_unversioned.md**

  Read the file, then remove the kimi-review-specific references. The updated file should describe that the remaining kimi-\* tools (ask-kimi, kimi-write, kimi-challenge) are unversioned scripts at `~/.local/bin/`, not that kimi-review/scripts/kimi-review.py are hand-synced. Remove any mention of `scripts/kimi-review.py` or the CI sync concern.

- [ ] **Step 3: Remove the 4 deleted entries from MEMORY.md**

  In `memory/MEMORY.md`, find and remove the index lines for:
  - `reference_kimi_architecture_doc.md`
  - `feedback_kimi_drizzle_notnull_false_critical.md`
  - `feedback_kimi_gate_false_positives.md`
  - `feedback_kimi_review_stale_branch.md`

  Keep the entry for `reference_kimi_tools_unversioned.md` (updated in step 2).

---

## Task 15: Run validation checklist

- [ ] **Step 1: All deleted files are gone**

  ```bash
  ls .claude/hooks/kimi-review.sh .claude/hooks/test-kimi-review.sh \
     .github/workflows/kimi-review.yml scripts/kimi-review.py \
     scripts/ci-kimi-review.sh scripts/check-kimi-engine.sh \
     scripts/sync-kimi-engine.sh scripts/kimi-profiles.json \
     docs/kimi-review-architecture.md 2>&1 | grep -c "No such file"
  ```

  Expected: `9`

- [ ] **Step 2: settings.json hook removed**

  ```bash
  grep "kimi-review.sh" .claude/settings.json
  ```

  Expected: no output

- [ ] **Step 3: pre-commit hook is valid and clean**

  ```bash
  bash -n .husky/pre-commit && grep -c kimi .husky/pre-commit
  ```

  Expected: syntax check passes, count is `0`

- [ ] **Step 4: package.json scripts removed**

  ```bash
  jq '.scripts | keys[]' package.json | grep kimi
  ```

  Expected: no output

- [ ] **Step 5: AI_WORKFLOW.md clean**

  ```bash
  grep -c "kimi-review\|kimi-multi-review" docs/AI_WORKFLOW.md
  ```

  Expected: `0`

- [ ] **Step 6: todo files clean**

  ```bash
  grep -c "kimi-review" .claude/agents/todo-executor.md .claude/skills/todo/SKILL.md docs/todo-automation-runbook.md
  ```

  Expected: all counts are `0`

- [ ] **Step 7: Push to origin**

  ```bash
  git push origin main
  ```
