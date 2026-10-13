# Remove Kimi Code Review Infrastructure — Design

**Date:** 2026-06-09
**Status:** Approved (revised after user spec review)

## Summary

Remove the automated and CI-gated kimi code review system entirely. Keep the cheap-worker I/O tools (ask-kimi, kimi-write, extract-chat, kimi-challenge). Replace review guidance and automated gates with the `code-reviewer` subagent and `/code-review` skill.

## Motivation

- The per-commit gate adds latency (120–330s) with marginal signal — Claude subagents with LSP access produce higher-quality, context-aware findings
- False-positive rate required significant hardening (function-context diffs, `<changed-files>` manifest, deterministic temperature, verification layer) — ongoing maintenance cost
- I/O delegation (ask-kimi, kimi-write) remains cost-effective; judgment work (review, challenge) is where Claude wins

## Scope

### What is removed

**Code review surfaces (all 3 gates):**

1. Claude Code `PreToolUse` hook (`.claude/hooks/kimi-review.sh`) — blocks `git commit` when CRITICAL findings present
2. Husky `pre-commit` gate — runs after lint-staged on every terminal commit
3. CI `kimi-review.yml` workflow — `pull_request_target` job reviewing PR diffs

**`kimi-multi-review`** — also a review tool; removed alongside kimi-review. All invocations in guidance docs are removed.

**Supporting infrastructure:**

- `scripts/kimi-review.py` — vendored Python review engine
- `scripts/ci-kimi-review.sh` — CI runner script
- `scripts/check-kimi-engine.sh` — drift check between canonical and vendored engine
- `scripts/sync-kimi-engine.sh` — sync script
- `scripts/kimi-profiles.json` — review profiles (OCRecipes-specific prompt config, review-only)
- `.claude/hooks/test-kimi-review.sh` — hook test harness
- `docs/kimi-review-architecture.md` — architecture doc for removed system

**npm scripts removed from `package.json`:**

- `ci:kimi-review`
- `kimi:engine:sync`
- `kimi:engine:check`

### What is kept

- `.claude/hooks/lib/domain-map.sh` — shared with `inject-patterns.sh`, not review-specific
- `ask-kimi`, `kimi-write`, `extract-chat` — I/O delegation tools (reading, boilerplate, context stripping)
- `kimi-challenge` — architectural decision pressure-testing (judgment, not code review)
- All `kimi-challenge triggers` guidance in project CLAUDE.md

---

## File-by-file changes

### Delete (9 files)

| File                                | Reason                        |
| ----------------------------------- | ----------------------------- |
| `.claude/hooks/kimi-review.sh`      | PreToolUse review hook        |
| `.claude/hooks/test-kimi-review.sh` | Hook test harness             |
| `.github/workflows/kimi-review.yml` | CI review job                 |
| `scripts/kimi-review.py`            | Vendored Python review engine |
| `scripts/ci-kimi-review.sh`         | CI runner                     |
| `scripts/check-kimi-engine.sh`      | Engine drift check            |
| `scripts/sync-kimi-engine.sh`       | Engine sync script            |
| `scripts/kimi-profiles.json`        | Review-only profile data      |
| `docs/kimi-review-architecture.md`  | Docs for removed system       |

### Modify — infrastructure (3 files)

**`.claude/settings.json`**
Remove the PreToolUse hook block whose `command` is `bash .claude/hooks/kimi-review.sh`.

**`.husky/pre-commit`**
Keep: the bash re-exec header + `set +e` preamble + the `npx lint-staged` line.
Remove: the engine drift check block (the `if [ -f scripts/check-kimi-engine.sh ]` block) and the entire kimi gate block (from `if [ "$SKIP_KIMI_REVIEW" = "1" ]` through the final `exit 0`).

**`package.json`**
Remove `ci:kimi-review`, `kimi:engine:sync`, and `kimi:engine:check` from the `scripts` object.

### Modify — CLAUDE.md files (2 files)

**`CLAUDE.md` (project)**

In `Cheap-Worker Delegation` → `### AUTO-delegate` list, remove:

- "Before committing any significant implementation → kimi-review --scope ..."
- "After kimi-review returns a CRITICAL finding → stop, surface to user, do not commit until resolved"

Delete the entire `### Kimi review gate (mechanics)` subsection.

Delete the entire `### Project-specific triggers` subsection (all kimi-review and kimi-multi-review invocations).

Add in its place (where "Project-specific triggers" was):

> "For code review before a PR, use the `code-reviewer` subagent (Agent tool) or `/code-review` skill."

Keep: `### kimi-challenge triggers`, `### NEVER delegate`.

**`~/.claude/CLAUDE.md` (global)**

In `AUTO-delegate` list, remove:

- "Before committing any significant implementation → kimi-review --scope ..."
- "After kimi-review returns a CRITICAL finding → stop, surface to user, do not commit until resolved"

Keep all other entries unchanged.

### Modify — workflow guidance (3 files)

**`docs/AI_WORKFLOW.md`**

Remove `## Review Policy` section and its `### Review Routing Matrix` table entirely (both reference kimi-review as default path).

Replace with a single routing rule:

> "For code review, use the `code-reviewer` subagent for deep cross-file inspection, or `/code-review` skill for diff-scoped review. Specialist subagents for security, health-data, auth, or high-blast-radius changes."

In `### Pre-commit Hook` section: rewrite to describe lint-staged only. Remove all kimi-review references.

Remove the `### Kimi Review CI Workflow` section.

In `## Cheap-Worker Delegation` section: remove the `### kimi-review` and `### kimi-multi-review` subsections (and their CLI examples). Keep `### ask-kimi`, `### kimi-write`, `### kimi-challenge`.

**`.claude/agents/todo-executor.md`**

- Remove Step 4 entirely (the "Verify kimi-review is available" API key check — currently lines ~53–57).
- Replace Step 6 (currently the `kimi-review` CLI call over working-tree diff) with: invoke the `code-reviewer` subagent (Agent tool, `subagent_type: "code-reviewer"`) to review working-tree changes before committing. Keep same blocking logic: CRITICAL-equivalent findings block the commit, WARNING-equivalent findings are added to DEFERRED_WARNINGS.
- Update Step 7 advisor framing note (currently references "kimi-review's job at Step 6") to reference the code-reviewer subagent instead.
- Update `DEFERRED_WARNINGS` field description (currently "one line per unaddressed kimi-review WARNING or YELLOW advisor reason") to remove the kimi-review reference.

**`.claude/skills/todo/SKILL.md`**

Remove Step 5 (the "Verify kimi-review is available" check, currently lines 89–95). Renumber subsequent steps.

### Modify — memory (5 files, all at `/Users/williamtower/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/`)

| File                                              | Action                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference_kimi_architecture_doc.md`              | Delete — points to the deleted architecture doc                                                                                                                 |
| `feedback_kimi_drizzle_notnull_false_critical.md` | Delete — only relevant to the review gate                                                                                                                       |
| `feedback_kimi_gate_false_positives.md`           | Delete — only relevant to the review gate                                                                                                                       |
| `feedback_kimi_review_stale_branch.md`            | Delete — only relevant to the review gate                                                                                                                       |
| `reference_kimi_tools_unversioned.md`             | Update — remove kimi-review/kimi-review.py references; note that the remaining tools (ask-kimi, kimi-write, kimi-challenge) are still unversioned local scripts |
| `MEMORY.md`                                       | Remove 4 index entries for the deleted files; keep and update the entry for `reference_kimi_tools_unversioned.md`                                               |

**`docs/todo-automation-runbook.md`**

Line 8: remove "`kimi-review` — CRITICAL findings block the commit (semantic skim at commit time)" from the overlay description list.
Line 18: same reference — remove or replace with "code-reviewer subagent review before PR".
Line 72: remove "kimi-gated" qualifier from the `/todo` executor description.

---

## Resolved open questions

**Step 6 replacement in todo-executor:** Use the `code-reviewer` subagent (Agent tool). This gives full LSP-backed cross-file reasoning, matches the user's stated rationale ("Claude can do it better with subagents and LSP"), and is consistent with the replacement guidance added to CLAUDE.md.

**kimi-multi-review fate:** Explicitly removed. It is a review tool. All invocations are deleted from AI_WORKFLOW.md and CLAUDE.md.

**AI_WORKFLOW.md rewrite scope:** Remove review-routing decision table and replace with a single routing rule (see above). The doc remains valid for its other sections (quality gates, delegation tools, pre-commit hook description, todo workflow).

**`/code-review` skill:** Confirmed present in session skills list — valid reference.

---

## Validation plan

After implementation, confirm:

```bash
# All deleted files are gone
ls .claude/hooks/kimi-review.sh .claude/hooks/test-kimi-review.sh \
   .github/workflows/kimi-review.yml scripts/kimi-review.py \
   scripts/ci-kimi-review.sh scripts/check-kimi-engine.sh \
   scripts/sync-kimi-engine.sh scripts/kimi-profiles.json \
   docs/kimi-review-architecture.md
# → all must show "No such file"

# settings.json hook removed
grep "kimi-review.sh" .claude/settings.json
# → no output

# pre-commit hook is syntactically valid with no kimi-review token
bash -n .husky/pre-commit && grep -c kimi-review .husky/pre-commit
# → syntax check passes; count returns 0

# package.json scripts removed
jq '.scripts | keys' package.json | grep kimi
# → empty

# CLAUDE.md and AI_WORKFLOW.md clean
grep -r 'kimi-review' CLAUDE.md docs/AI_WORKFLOW.md
# → no output

# todo files clean
grep kimi-review .claude/agents/todo-executor.md .claude/skills/todo/SKILL.md
# → no output

# Smoke-test: start a /todo dry-run and confirm it no longer blocks at Step 4/5
# with a kimi-review error
```
