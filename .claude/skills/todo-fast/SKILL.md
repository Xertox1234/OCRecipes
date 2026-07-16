---
name: todo-fast
description: Use to accelerate a single medium/high/critical todo — decomposes it into parallel-safe sub-tasks via the Plan agent where possible, dispatches concurrent todo-fast-implementer agents in one shared worktree, and rides todo-executor.md's (now-fixed) research/verify/review/commit/codify/PR pipeline for everything else.
---

You are running the todo-fast orchestrator for a single todo. Unlike `/todo`, this skill never scans the backlog — it operates on exactly the todo file you were given. **Never skip phases.**

## Phase 0 — Preflight

1. **Parse the todo.** Read the todo file at the given path. Extract YAML frontmatter (`title`, `status`, `priority`, `created`, `labels`, `github_issue`) and body sections (Acceptance Criteria, Implementation Notes, Dependencies, Risks) — same extraction as `todo-executor.md` Step 1.

2. **Scope guard.** If `priority` is `low`, stop and report: "This todo is priority `low` — it already fast-tracks through `/todo`'s auto-merge guard path. Use `/todo` instead; `/todo-fast`'s extra machinery (decomposition, shared worktree, `/land` handoff) doesn't pay for itself here." Do not proceed.

3. **Status gate.** If `status` is not `backlog` or `planned`, report `skipped` with reason `"status is <actual status>, expected backlog or planned"` and stop — same as `todo-executor.md` Step 2.1.

4. **Dependency check.** If the Dependencies section lists other todo files that still exist under `todos/` (not archived), report `blocked` with the list and stop — same as `todo-executor.md` Step 2.2.

5. **Legacy delegation gate.** If the todo has a `github_issue` frontmatter value, report `skipped` with reason `legacy github_issue todo: <url> — needs manual triage` — same as `todo-executor.md` Step 2.3.

6. **Remote-branch probe.** Run `git ls-remote --heads origin todo/<todo-slug>` (slug = filename minus `.md`). If it returns any output, run the same five-outcome collision triage `todo-executor.md` Step 2.4 / Step 10 defines (`OPEN_PR_COLLISION`, `STALE_BRANCH_MERGED`, `PR_CLOSED_UNMERGED`, `ORPHAN_BRANCH`, `PR_CHECK_FAILED`) and stop before doing any work if it fires.

7. **Capture the base branch and main checkout**, same as `/todo`'s own Phase 1 step 3: `git branch --show-current` (or `git rev-parse --abbrev-ref HEAD` if empty; stop if that also returns `HEAD` — detached HEAD is not supported) → `BASE_BRANCH`. `git rev-parse --path-format=absolute --git-common-dir` → derive `MAIN_CHECKOUT` as its parent directory.

8. **Local-environment escape hatch.** If the todo describes the defect as reproducing on this specific machine only rather than in tracked source or config — tells include phrasing like "local machine"/"this environment" in the Background, or an Acceptance Criterion of the shape "confirm the fix isn't needed repo-wide before changing tracked config" — treat it as a **local-diagnosis todo** and skip Phase 1's shared worktree (and Phases 3/5's decomposition/parallel-implementer machinery) entirely. Diagnose, and validate any fix, directly in the main checkout instead. Reason: Phase 1's worktree shares `node_modules` with the main checkout via a symlink, so a content-level fix there (`rm -rf node_modules && npm ci`, a cache clear, etc.) only unlinks the symlink and reinstalls a worktree-local copy that never reaches the main checkout — the fix could never land where the problem actually is. A fresh worktree also lacks the main checkout's untracked cache directories, so it can just as easily mask a cache-only bug (false green) as reproduce a `node_modules`-content one. If the investigation instead surfaces a genuine tracked-file/dependency defect (the todo's own higher-severity branch), fall back to the standard Phase 1-10 flow for that fix. Get advisor sign-off before committing to the local-diagnosis path if the todo's phrasing is ambiguous.

   Before any tracked-file edit on this path, create the todo's branch directly in the main checkout — Phase 1 is the only place a branch normally gets created, and skipping it without this step leaves every later command running on `$BASE_BRANCH` itself (typically `main`), which Phase 10's `git branch -m todo/<todo-slug>` would then rename in place:

   ```bash
   SLUG="<todo filename minus .md>"
   git checkout -b "todo/$SLUG" "$BASE_BRANCH"
   WORKTREE="$MAIN_CHECKOUT"   # no worktree was created — every later `git -C "$WORKTREE"` / `cd "$WORKTREE"` now resolves to the main checkout
   ```

   Still open a PR (Phase 8/10) if any tracked file changes (e.g. the archived todo's Updates section, a codified solution) — skipping the worktree does not exempt tracked-file changes from branch/PR/review.

## Phase 1 — Shared Worktree Creation

Skip this phase entirely for a local-diagnosis todo (Phase 0 step 8) — go directly to Phase 2 in the main checkout. Otherwise, create ONE worktree for the entire run — every subsequent agent (research, `Plan`, implementer(s), reviewers) operates inside it:

```bash
SLUG="<todo filename minus .md>"
git worktree add ".claude/worktrees/agent-todo-fast-$SLUG" -b "todo/$SLUG" "$BASE_BRANCH"
WORKTREE="$(cd ".claude/worktrees/agent-todo-fast-$SLUG" && pwd)"
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
ln -sf "$MAIN_CHECKOUT/node_modules" "$WORKTREE/node_modules"
```

`.husky/post-checkout` auto-symlinks `.env*` and `docs/LEARNINGS.md` into a freshly-checked-out worktree, but NOT `node_modules` — that's normally provided by the Agent tool's own `isolation: "worktree"` dispatch mechanism (what `/todo`'s executor uses), which this Phase deliberately does not use (a shared multi-agent worktree needs one `git worktree add`, not a fresh worktree per dispatch). Without the explicit symlink above, Phase 6's `npm`/`vitest` commands fail with module-not-found errors — not a graceful test failure, a missing-dependency crash — on every run.

`MAIN_CHECKOUT` is re-derived here rather than reused from Phase 0's capture of the same value — shell state (including `$BASE_BRANCH`) does not persist across separate tool calls, and re-deriving it keeps this block self-contained instead of depending on the orchestrator correctly substituting a second recorded literal.

Record `$WORKTREE` (absolute path) — every dispatch prompt below substitutes it in literally, never the placeholder text.

**Dispatch contract, by agent type** — this determines whether an agent needs to `cd` or can use `git -C`:

- **Read-only agents** (`Plan` in Phase 3, `todo-researcher` in Phase 2, reviewers in Phase 6): no `cd`. They only run read/diff commands — use `git -C "$WORKTREE"` for any git operation. No Edit/Write access, so `.claude/hooks/guard-worktree-isolation.sh` (the PreToolUse hook that blocks an edit escaping a worktree into the main checkout) never applies to them regardless.
- **`todo-fast-implementer` agents (Phase 5):** the prompt's first instruction must be an explicit `cd "$WORKTREE"`, then `pwd` and `git rev-parse --show-toplevel` to confirm — mirroring `todo-executor.md` Step 0. This is required, not optional: a dispatched subagent does not inherit the parent session's cwd, and `git -C` never changes a session's _tracked_ cwd — but `guard-worktree-isolation.sh` keys its protection off exactly that tracked cwd (its `.cwd` field, matched against `*/.claude/worktrees/agent-*`). Skip the `cd` and the implementer loses the same structural protection `todo-executor` gets for free via `isolation: "worktree"`.

Naming the worktree under `.claude/worktrees/agent-*` is deliberate — it matches `/todo`'s own Phase 0/5 cleanup sweep glob, so a crashed `/todo-fast` run is also swept by the next `/todo` invocation as a backstop, on top of this skill's own cleanup (see the Cleanup section near the end of this file).

## Phase 2 — Research

Follow `todo-executor.md` Step 3 exactly (verified-solution read-back in `docs/solutions/`, the short-circuit gate, or a `todo-researcher` dispatch on a miss) — unchanged, reused verbatim. Every git command in this phase uses `git -C "$WORKTREE"`.

## Phase 3 — Decomposition

**Cheap pre-check.** Extract file references from the todo's Implementation Notes and Acceptance Criteria — the same three patterns `.claude/skills/todo/SKILL.md`'s Phase 3 already uses: bare paths (`path/to/file.ts`), paths with line ranges (`path/to/file.ts:123-145`), backtick-quoted paths. If fewer than 2 distinct files are mentioned, skip straight to Phase 5 with exactly one `todo-fast-implementer` covering the whole todo — there is nothing to decompose.

**Otherwise, dispatch `Plan`**, giving it the shared worktree path so it inspects the actual files rather than judging disjointness from the todo's prose alone:

```
Agent({
  description: "Decompose todo into parallel-safe sub-tasks",
  subagent_type: "Plan",
  model: "sonnet",
  prompt: "Todo: <full todo body>.\n\nWorktree to inspect (read-only — use `git -C <$WORKTREE>` or Read tool calls against this path; do not edit anything): <$WORKTREE>\n\nPropose a split of the Acceptance Criteria into sub-tasks where each sub-task's affected files are COMPLETELY DISJOINT from every other sub-task's. Before proposing, actually read each candidate file in the worktree and check for shared imports, shared barrel-file re-exports, or shared type definitions between candidate sub-tasks — do not rely on the todo's prose description alone. If no safe disjoint split exists, say so explicitly and explain why (cite the specific shared import/file you found). For each sub-task you propose, list: (1) the exact Acceptance Criteria items it covers, (2) the exact file paths it will touch. Cap at 4 sub-tasks."
})
```

Read the response:

- **No safe split reported, or the `Agent()` call errors:** fall back to exactly one `todo-fast-implementer` for the whole todo (same as the pre-check miss above). This is expected to be the common outcome — tightly-coupled component+utils+test clusters are a normal todo shape, not an edge case.
- **A split is proposed:** carry it forward as `decomposition_plan` (list of {criteria, files} per sub-task) for Phase 4's advisor gate and Phase 5's dispatch.

## Phase 4 — Advisor Pre-check

Follow `todo-executor.md` Step 3.5's mechanism exactly (call `advisor()` with no parameters — your transcript, including the todo, the research brief, and `decomposition_plan` if one exists, forwards automatically). Write the SAME framing note Step 3.5 specifies, with one addition appended to its questions:

> Is the proposed decomposition safe? Could any two sub-tasks' file sets actually overlap (a shared import, a barrel file, a type the split missed)? Is anything grouped together that should be split, or split that should be grouped?

(Omit this addition if Phase 3 found no split — there's nothing to gate.)

Same verdict handling as `todo-executor.md` Step 3.5: `GREEN` → proceed silently; `YELLOW: <reason>` → proceed, record the reason in `DEFERRED_WARNINGS`; `RED: <reason>` → do not implement, report `blocked: advisor red-flag: <reason>` (Step 11's block-path format), todo stays at `backlog`. If the advisor flags the decomposition specifically (not the overall approach), discard `decomposition_plan` and fall back to one `todo-fast-implementer` for the whole todo rather than force the split. Same unparseable-response and advisor-unavailable fallbacks as Step 3.5 (`YELLOW: advisor returned prose without a verdict line`; `ADVISOR: skipped` if the tool errors).

For a local-diagnosis todo (Phase 0 step 8), this phase still runs as the mandatory approach gate — step 8's own conditional advisor consult (triggered only when the todo's phrasing was ambiguous) does not substitute for it. Only the decomposition-specific addition above is skipped, exactly like the no-split case above.

## Phase 5 — Parallel Implementation

Dispatch one `todo-fast-implementer` per entry in `decomposition_plan` (or exactly one, covering the whole todo, if Phase 3/4 found no safe split) — up to 4, all in the SAME message so they run concurrently:

```
Agent({
  description: "Implement sub-task: <sub-task summary>",
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: "You are a todo-fast-implementer agent. Follow .claude/agents/todo-fast-implementer.md exactly.\n\nShared worktree (absolute path — cd here FIRST, before anything else): <$WORKTREE>\nTodo file: todos/<filename>.md\nYour assigned Acceptance Criteria items: <list>\nYour assigned files (touch ONLY these): <list>\nResearch brief: <Phase 2's brief or short-circuit citation>\n\nImplement your assigned scope and report your status."
})
```

If only one implementer is dispatched (no decomposition), its "assigned Acceptance Criteria items" is the todo's full Acceptance Criteria list and its "assigned files" is every file the todo's Implementation Notes/Acceptance Criteria mention (or "no specific files named — use your judgment from the todo body" if none were extracted).

**Handling reports:**

- **`DONE` / `DONE_WITH_CONCERNS`:** record the concern (if any) for the Step 11 report; proceed once every dispatched implementer has reported one of these two, or handled per below.
- **`NEEDS_CONTEXT`:** provide the missing context and re-dispatch that ONE implementer (same prompt, plus the added context). Other concurrent implementers are unaffected — they're on disjoint files.
- **`BLOCKED`:** re-dispatch that ONE implementer once (same two-attempt cap `todo-executor.md`'s Failure Path uses). If still `BLOCKED`, the **whole todo** fails: revert every implementer's changes (`git -C "$WORKTREE" checkout -- .`), report `failed` (Step 11's failure format), and skip the rest of this run. A todo with unmet Acceptance Criteria is never archived, regardless of how many other sub-tasks independently succeeded.

**DB-serial todos:** if the todo touches `shared/schema.ts`, `migrations/`, `drizzle`, or `db:push`, Phase 3's `Plan` dispatch prompt must additionally instruct: "bucket every DB-touching Acceptance Criterion into ONE non-parallel sub-task — it cannot run concurrently with anything else." That sub-task's implementer prompt gets the same `db-serial-lock.sh` block `.claude/skills/todo/SKILL.md`'s Phase 4 "DB-serial todos only" section already specifies (resolve `WATCH_PID`, `db-serial-lock.sh acquire --watch-pid`, retry-once-on-exit-2 semantics, release on completion) — copy that block verbatim into the prompt, substituting the worktree path.

## Phase 6 — Verify + Review

Follow `todo-executor.md` Steps 5 (as fixed in Task 2 — scoped-fast check via `scripts/preflight.sh --fast --uncommitted`, then the full CI-parity suite issued in the same turn as Step 6's reviewer dispatch) and 6 (reviewer selection/dispatch) exactly, unchanged from what those steps now specify. Every git command uses `git -C "$WORKTREE"`; every Bash command that isn't a git command (e.g. `npm run test:run`) runs with its cwd set to `$WORKTREE` (prefix with `(cd "$WORKTREE" && ...)` rather than a bare `cd` in your own session, so your own tracked cwd — which `guard-worktree-isolation.sh` checks — never drifts away from wherever Phase 0 started you).

## Phase 7 — Address Feedback

Follow `todo-executor.md` Step 7 exactly — same CRITICAL/WARNING/SUGGESTION tiering, same `DEFERRED_WARNINGS` field, same 2-round cap.

## Phase 8 — Commit & Archive

Follow `todo-executor.md` Step 8 exactly — mark `done`, move to `todos/archive/`, stage both paths, commit with the same label→type mapping. Use the **plain `mv` + a single combined `git add <old-path> <new-path>`** that Step 8 specifies, not `git mv` — `git mv`'s implicit staging of a pre-edited file can have its content silently dropped by the lint-staged stash/restore cycle on commit (see `docs/solutions/logic-errors/git-mv-lint-staged-drops-content-edits-2026-07-05.md`); verify with a post-commit `git status --porcelain` regardless.

## Phase 9 — Codify

Invoke the `/codify` skill directly (via the Skill tool) rather than following `todo-executor.md` Step 9's inline routing logic — `/codify`'s `SKILL.md` is the canonical routing rubric Step 9 already points at; this phase calls it directly instead of re-deriving its steps.

## Phase 10 — Push & PR

Follow `todo-executor.md` Step 10 exactly (branch naming, non-fast-forward collision triage, PR body template, Copilot review request, `todo-automerge-guard.sh` eligibility check).

**One addition, after the guard eligibility check resolves:**

- `MERGE_ELIGIBLE: yes (auto-merge enabled)` → nothing further, exactly as today.
- Any other outcome (`held`, `review-required`, `unknown`) → invoke the **`/land`** skill before Phase 11. `/land` assesses merge-readiness and handles branch cleanup — it does not change who decides to merge: `/land`'s own ritual requires a human to run the actual merge regardless of which skill leads there, so `/land`'s role here is strictly to present the readiness assessment and options.

## Phase 11 — Report

Same structured report as `todo-executor.md` Step 11 (`STATUS`, `COMMIT`, `BRANCH`, `PR_URL`, `MERGE_ELIGIBLE`, `CODIFICATION_COMMIT`, `SOLUTION_FILE`, `FILES_CHANGED`, `SHORT_CIRCUIT`, `REVIEW_ROUNDS`, `ADVISOR`, `DEFERRED_WARNINGS`), same `REASON_CODE` enum. Add two fields:

```
SUB_TASKS: <N — 1 if no decomposition, 2-4 if Plan proposed a split>
LAND_INVOKED: <yes | no (auto-merge enabled, not needed) | n/a (no PR)>
```

## Cleanup

Force-remove the shared worktree at the end of the run, success or failure:

```bash
git worktree unlock ".claude/worktrees/agent-todo-fast-$SLUG" 2>/dev/null
git worktree remove --force ".claude/worktrees/agent-todo-fast-$SLUG" 2>/dev/null
git worktree prune
```

(Its `agent-*` naming means a crashed run that skips this step is also swept by the next `/todo` invocation's Phase 0 cleanup sweep, as a backstop.)

## Rules

- **Max 4 parallel `todo-fast-implementer` agents** — same ceiling `/todo` uses for parallel batches.
- **One shared worktree for the whole run** — never a fresh one per implementer; that's what makes a single combined commit possible without a merge step.
- **Explicit `cd`, not `git -C`, for implementer agents** — the structural safety guarantee of running concurrently in a shared worktree depends on it (Phase 1).
- **Decomposition failure is the expected common case, not an error** — always have a working single-implementer fallback path.
- **Never duplicate `todo-executor.md`'s verify/review/commit/codify/PR logic** — reference it, per Phases 6–10 above.
- **A todo with any `BLOCKED` sub-task after retry reverts entirely** — no partial-credit half-merges.
