# `/todo-fast` — accelerated single-todo execution skill

## Problem Statement

`/todo`'s parallelism model works across independent todos (up to 4 executors, one per todo, each in its own worktree) but delivers zero speedup for a single todo — which is the common case when the user picks one specific medium/high/critical item to work rather than batch-processing the backlog. Tracing a live run (`todo/P2-2026-07-14-scan-shutter-overlaps-productchip-caption`, priority `medium`) confirmed the bottleneck: `todo-executor.md`'s Step 5 runs the full, unscoped test suite (`vitest run` — the entire ~1300+ test suite), a full unscoped `expo lint`, and a whole-program `tsc --noEmit`, and can repeat that full trio up to 3 times for one todo (initial verify, plus up to 2 review-fix rounds). This is the exact footgun the interactive dev loop already fixed for itself via `preflight:fast` (CLAUDE.md's 2026-07 preflight consolidation) — the `/todo` pipeline never received the same treatment. A 136-line diff took over an hour with only one subagent ever dispatched, because the pipeline itself — not a lack of agents — is a long, unscoped, serial chain.

**Revised framing (post advisor-review):** the verification bottleneck is universal — it slows every `/todo` batch run too, not just single-todo runs — so the fix belongs in `todo-executor.md` itself, shared by both callers. The motivating example (`ProductChip.tsx` + its `-utils` file + both test files — tightly import-coupled) would **not** safely decompose into disjoint sub-tasks, which is a useful signal: genuinely independent-file todos are the exception, not the rule. So `/todo-fast`'s own distinct value is narrower than originally scoped — it adds Plan-agent decomposition and optional parallel implementation on top of a now-fixed `todo-executor`, rather than owning the verification fix itself.

## Goals

- Fix the actual bottleneck — unscoped, repeated full-suite verification — once, in shared infrastructure (`todo-executor.md` Step 5 and a new `scripts/preflight.sh` mode), so every `/todo` and `/todo-fast` run benefits.
- On top of that fix, add genuine multi-agent parallelism to the implementation step for the subset of medium/high/critical todos that safely decompose into disjoint-file sub-tasks — without weakening correctness ("get it right the first time" matters more here than in the backlog-batch case), and without forcing a decomposition that risks a bad split.
- Reuse existing, proven machinery (`todo-executor.md`'s steps, the reviewer roster, `codify`, `land`) wherever it already fits, rather than re-deriving logic — this codebase is explicit about avoiding copy-paste drift.

## Non-Goals

- Backlog scanning / triage — `/todo-fast` operates on exactly one todo file passed by the caller.
- Replacing `/todo` — low-priority todos remain `/todo`'s job (they already fast-track via the auto-merge guard and don't suffer from this bottleneck).
- Duplicating verification-scheduling logic inside `/todo-fast` — that fix lives once, in `todo-executor.md` Step 5 and `scripts/preflight.sh`, and both callers reference it.

## Scope Guard

If the target todo's frontmatter `priority` is `low`, refuse and point the user at `/todo` instead — the heavier machinery here (Plan-agent decomposition, shared worktree, `/land` handoff) buys nothing for a todo that already auto-merges quickly. `medium`, `high`, and `critical` proceed.

## Invocation

```
/todo-fast todos/<filename>.md
```

One explicit path argument. No default/auto-pick — the caller has already chosen the item.

## Part A — Shared Fix: Verification Scheduling

This part lands in existing, shared files and benefits `/todo` batch runs immediately, independent of whether `/todo-fast` is ever invoked.

### A1. New `preflight.sh` mode: scope off the uncommitted diff

**Confirmed by reading the script:** `scripts/preflight.sh --fast` computes `BASE=$(git merge-base HEAD origin/main)` and diffs `BASE..HEAD` — committed history only ("push gate semantics", per its own header comment). A todo-executor's implementation is uncommitted at verify time (commit happens later, in Step 8) — invoking today's `--fast` mid-pipeline would see zero changed files and silently no-op instead of actually checking the diff.

Add a new flag, `--uncommitted`, combinable with `--fast` (`scripts/preflight.sh --fast --uncommitted`): swap the changed-file computation from `git diff --name-only --diff-filter=ACMR "$BASE" HEAD` to `git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx'` (working tree vs. HEAD — the same diff base `todo-executor.md` Step 6 already uses for its review diff: `git diff HEAD -- .`). Everything else about `--fast` (type-aware lint on the changed set, whole-program `tsc`, tests that import the changed files, the pass-stamp write) stays the same shape, just re-pointed at the working-tree diff. The existing `--fast` push-gate mode is untouched — this is a new, additive mode.

This is a real script change with testable behavior — follows normal TDD (failing test first: exercise the new flag against a repo state with uncommitted-but-not-committed `.ts` changes and confirm it scopes to them; then implement).

### A2. `todo-executor.md` Step 5 rewrite

Replace today's "run the full trio, possibly 3 times" with:

1. After implementation (and after each Step 7 fix round), run `scripts/preflight.sh --fast --uncommitted` (A1). Cheap, catches obvious regressions immediately. Fix and re-run until it passes before proceeding.
2. Once the scoped-fast check passes, issue — **in the same turn**, as ordinary parallel tool calls (matching the existing multi-Agent dispatch convention Step 6 already uses; NOT `run_in_background: true`) — both:
   - the full CI-parity suite: `npm run test:run`, `npm run check:types`, `npm run lint` (matching what CI actually gates on), as synchronous Bash calls, and
   - the Step 6 reviewer-agent dispatch (`code-reviewer` baseline + up to 2 domain reviewers, unchanged selection logic).

   These are read-only checks against the same diff with no dependency between them, so running them as parallel tool calls in one turn costs nothing extra in wall-clock (bounded by whichever is slower, not their sum) while still gating on the full suite every round instead of once.

   **Explicit non-goal, to prevent a future misread:** this is plain multiple-tool-calls-in-one-turn parallelism, the same pattern Step 6 already uses to dispatch multiple reviewer agents together. It is deliberately **not** `run_in_background: true` on the full-suite Bash call — that would reintroduce exactly the stranding failure mode the existing Step 5 text already warns about ("you get no equivalent notification when your own backgrounded shell command finishes... nothing re-invokes you"). A dispatched agent has no way to be woken by its own background shell command finishing; it does not need one here, because these are ordinary synchronous tool calls issued together, not backgrounded ones.

3. If either the full suite fails or review returns CRITICAL findings, proceed to Step 7 (unchanged: fix, re-run the scoped-fast check to confirm, repeat once more if the fix was non-trivial). Cap at 2 rounds, same as today.

This benefits every `todo-executor` invocation — whether dispatched by `/todo`'s batch orchestrator or by `/todo-fast` — with no duplicated logic.

## Part B — `/todo-fast`: Decomposition and Parallel Implementation

Given Part A already fixes the universal bottleneck, `/todo-fast`'s own job is narrower: parse one todo, optionally split it into disjoint-file sub-tasks via the `Plan` agent, implement (single or parallel), and otherwise ride the same (now-fixed) pipeline `todo-executor.md` already defines.

`/todo-fast` is a new skill, `.claude/skills/todo-fast/SKILL.md`, sibling to `.claude/skills/todo/`. It runs as the orchestrator directly in the caller's session (same pattern `/todo`'s own `SKILL.md` uses — no wrapper agent).

| Phase                       | Source                                                         | Notes                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Preflight                | `todo-executor.md` Steps 1–2, unchanged                        | Parse frontmatter, status gate, dependency check, legacy-delegation gate, remote-branch probe. Add the priority scope guard above.                                                                                                                                                                        |
| 1. Shared worktree creation | new                                                            | One worktree for the whole run, created manually (not via Agent-tool `isolation`).                                                                                                                                                                                                                        |
| 2. Research                 | `todo-executor.md` Step 3, unchanged                           | Verified-solution read-back, short-circuit gate, or `todo-researcher` dispatch — reused verbatim.                                                                                                                                                                                                         |
| 3. Decomposition            | new                                                            | `Plan` agent proposes a file-disjoint sub-task split (or "does not decompose").                                                                                                                                                                                                                           |
| 4. Advisor pre-check        | `todo-executor.md` Step 3.5, extended                          | Same framing note, plus one added question: is the proposed decomposition safe?                                                                                                                                                                                                                           |
| 5. Parallel implementation  | new                                                            | One or more `todo-fast-implementer` agents, concurrent, in the shared worktree.                                                                                                                                                                                                                           |
| 6. Verify + Review          | `todo-executor.md` Step 5 (Part A2, fixed) + Step 6, unchanged | No longer rewritten inside `/todo-fast` — referenced directly, same as Steps 1/2/3/3.5/7/8/10/11.                                                                                                                                                                                                         |
| 7. Address feedback         | `todo-executor.md` Step 7, unchanged                           | Same CRITICAL/WARNING/SUGGESTION tiering, same 2-round cap.                                                                                                                                                                                                                                               |
| 8. Commit & Archive         | `todo-executor.md` Step 8, unchanged                           |                                                                                                                                                                                                                                                                                                           |
| 9. Codify                   | invokes `/codify` skill directly                               | Formalizes what Step 9 already points at.                                                                                                                                                                                                                                                                 |
| 10. Push & PR               | `todo-executor.md` Step 10, mostly unchanged                   | Guard-eligible (medium, non-security, guard OK) → auto-merge armed exactly as today. Anything the guard does NOT auto-arm (held/review-required/unknown — typically high/critical) → invoke the `/land` skill to walk through the merge decision live, since this is a single, interactively-watched run. |
| 11. Report                  | `todo-executor.md` Step 11, adapted                            | Same `REASON_CODE` enum; report reflects decomposition (N sub-tasks) and which verify/review rounds ran.                                                                                                                                                                                                  |

## Phase 1 — Shared Worktree Creation

The Agent tool's `isolation: "worktree"` param creates a _fresh_ worktree per call — that doesn't work when multiple implementer agents need to land in the _same_ worktree so their disjoint-file edits combine into one commit. Instead, the orchestrator creates ONE worktree itself before dispatching anyone:

```bash
git worktree add .claude/worktrees/agent-todo-fast-<todo-slug> -b todo/<todo-slug> <BASE_BRANCH>
```

Naming it under `.claude/worktrees/agent-*` is deliberate — it matches **two** existing mechanisms:

- `/todo`'s own Phase 0/5 cleanup sweep (`awk '/\.claude\/worktrees\/agent-/ ...'`), which force-removes any leftover worktree matching that path — a free backstop if `/todo-fast` crashes, on top of its own cleanup (Edge Cases).
- `.claude/hooks/guard-worktree-isolation.sh`, the PreToolUse hook that blocks an Edit/Write whose absolute path escapes a worktree into the main checkout. **Confirmed by reading the hook:** it keys off the tool call's `.cwd` field matched against `*/.claude/worktrees/agent-*` (line 21) — it does not care how the agent was dispatched, only where its cwd actually is at the moment of the edit.

**Dispatch contract, split by agent type** (this replaces the earlier single "no `cd`, use `git -C`" rule, which was wrong for implementers — see below):

- **Read-only agents** (`Plan`, research, reviewers): no `cd` needed — they only run read/diff commands, use `git -C <path>` for any git operation, exactly as `todo-executor.md` Step 6 already does for reviewers. No Edit/Write access, so `guard-worktree-isolation.sh` never fires for them regardless.
- **`todo-fast-implementer` agents (Phase 5):** first action must be an explicit `cd <shared-worktree-absolute-path>`, then `pwd` and `git rev-parse --show-toplevel` to confirm — mirroring `todo-executor.md` Step 0's own assertion pattern, and the established project convention for this exact situation (a dispatched subagent does not inherit its parent session's cwd — an explicit `cd` is required, not just `git -C`, because `git -C` never touches the session's tracked cwd, which is what the guardrail hook actually keys off). **This is required, not optional:** without the explicit `cd`, the implementer's cwd stays wherever a fresh agent starts by default (not the shared worktree), so (a) the Step 0-style workspace assertion would need to compare against that default rather than the worktree, defeating its purpose, and (b) the implementer loses `guard-worktree-isolation.sh`'s structural protection against an absolute-path edit accidentally landing in the main checkout — the same protection `todo-executor` gets for free via `isolation: "worktree"`.

## Phase 3 — Decomposition via the `Plan` Agent

**Cheap pre-check first:** extract file references from the todo's Implementation Notes and Acceptance Criteria (same three patterns `/todo` Phase 3 already uses: bare paths, paths with line ranges, backtick-quoted paths). If fewer than 2 distinct files are mentioned, there is nothing to decompose — skip straight to Phase 5 with a single `todo-fast-implementer` covering the whole todo.

Otherwise, dispatch the `Plan` agent:

```
Agent({
  description: "Decompose todo into parallel-safe sub-tasks: <todo title>",
  subagent_type: "Plan",
  prompt: "<todo body> — propose a split of the Acceptance Criteria into sub-tasks where each sub-task's affected files are completely disjoint from every other sub-task's. If no safe disjoint split exists, say so explicitly. For each sub-task, list: the Acceptance Criteria items it covers, and the exact file paths it will touch."
})
```

`Plan` is read-only, so this costs one fast round-trip and adds a specialized, existing agent's judgment to a decision that's easy to get subtly wrong (a shared import, a barrel file, a type both sub-tasks touch). If `Plan` reports no safe split (or the tool errors), fall back to a single `todo-fast-implementer` for the whole todo — same fallback path as any other decomposition failure. **Expect this fallback to be common** — tightly-coupled component+utils+test clusters (the motivating example) are a normal shape for a UI/bugfix todo, not an edge case.

Cap: max 4 sub-tasks (same ceiling `/todo` uses for parallel batches, and the project's general parallel-agent guidance).

## Phase 4 — Advisor Pre-check (extended)

Same mechanism as `todo-executor.md` Step 3.5 (call `advisor()` with no parameters — the full transcript, including the todo, research brief, and `Plan`'s proposed decomposition, is forwarded automatically). The framing note written immediately before the call gets one addition to its existing questions:

> Is the proposed decomposition safe? Could any two sub-tasks' file sets actually overlap (a shared import, a barrel file, a type the split missed)? Is anything grouped together that should be split, or split that should be grouped?

Same verdict handling as today: `GREEN` → proceed silently; `YELLOW: <reason>` → proceed, reason recorded in `DEFERRED_WARNINGS`; `RED: <reason>` → do not implement, report `blocked: advisor red-flag: <reason>` (Step 11 block path), todo stays at `backlog`. If the advisor flags the decomposition specifically (not just the approach), fall back to a single implementer rather than force the split.

## Phase 5 — Parallel Implementation

New agent: `.claude/agents/todo-fast-implementer.md`. Used uniformly whether `Plan` found N=1 (single fallback) or N=2–4 (parallel split) sub-tasks — same agent, same protocol, just one instance or several dispatched concurrently.

**Scope of this agent (deliberately narrow):**

1. Workspace assertion — `cd` into the exact shared worktree path passed in its prompt, then verify with `pwd` / `git rev-parse --show-toplevel` (see Phase 1's dispatch contract). If it doesn't match, report `blocked` and stop, same denial convention `todo-executor.md` Step 0 already uses.
2. Implement only its assigned Acceptance Criteria items, touching only its assigned file list. Never edit a file outside that list — the whole safety guarantee behind running concurrently in a shared worktree depends on this.
3. Self-check the diff against its assigned criteria.
4. Report one of: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED` — reusing `subagent-driven-development`'s existing status protocol rather than inventing a new one.

**Explicitly NOT this agent's job:** running verification commands, `git commit`, `git push`, or PR creation — the orchestrator does all of that once (via the fixed `todo-executor.md` Step 5/6, Part A), after every dispatched implementer has reported back. Concurrent agents running their own `npm test`/`tsc` inside a shared worktree would race on caches for no benefit; batching verification is both faster and simpler.

**DB-serial todos:** if the todo touches `shared/schema.ts`, `migrations/`, `drizzle`, or `db:push`, `Plan`'s decomposition (Phase 3) must bucket every DB-touching criterion into one non-parallel group. That implementer acquires `scripts/pg-lab/db-serial-lock.sh` before its DDL step exactly as `/todo`'s existing dispatch prompt already does — reused verbatim, not reinvented.

## Phases 6–8 — Verify + Review, Address Feedback, Commit & Archive

Phase 6 is no longer a `/todo-fast`-specific rewrite — it is `todo-executor.md`'s Step 5 (as fixed in Part A2) followed by Step 6, referenced directly. Phases 7–8 are `todo-executor.md` Steps 7 and 8, unchanged — same CRITICAL/WARNING/SUGGESTION tiering, same `DEFERRED_WARNINGS` field, same archive-then-stage-then-commit sequence.

## Phase 9 — Codify

Invoke the `/codify` skill directly (via the Skill tool) rather than following inline duplicate logic — `todo-executor.md` Step 9 already points at `codify/SKILL.md` for its routing rubric; this phase formalizes that as an explicit invocation rather than a reference.

## Phase 10 — Push & PR

Same push/PR/guard mechanics as `todo-executor.md` Step 10 (branch naming, non-fast-forward collision triage, PR body template, Copilot review request, `todo-automerge-guard.sh` eligibility check) — unchanged.

**One addition:** after the guard eligibility check resolves:

- `MERGE_ELIGIBLE: yes (auto-merge enabled)` → nothing further needed, exactly as today.
- Any other outcome (`held`, `review-required`, `unknown`) → invoke the **`/land`** skill before finishing the run. `/land` is designed for exactly this moment — assessing whether a PR is ready to merge (CI status, review state) and handling branch cleanup — and since `/todo-fast` is a single, interactively-watched todo (unlike `/todo`'s overnight batch mode), walking straight into that assessment while the user is already watching fits better than deferring it to a summary line the user reads later. **This does not change who decides to merge** — `merge-approval-guard.sh` already blocks any agent-executed `gh pr merge` regardless of which skill leads there (per the PR #626 incident), so `/land`'s role here is strictly to present the readiness assessment and options; the actual merge command remains the user's call, exactly as it is for every other `/todo`-produced PR today.

## Phase 11 — Report

Same structured report as `todo-executor.md` Step 11 (`STATUS`, `COMMIT`, `BRANCH`, `PR_URL`, `MERGE_ELIGIBLE`, `CODIFICATION_COMMIT`, `SOLUTION_FILE`, `FILES_CHANGED`, `SHORT_CIRCUIT`, `REVIEW_ROUNDS`, `ADVISOR`, `DEFERRED_WARNINGS`), same `REASON_CODE` enum for skip/block/failure (Steps 2 and 10 are reused verbatim, so the enum carries over with no changes). Additionally reports: number of sub-tasks dispatched (1 if no decomposition), and whether `/land` was invoked.

## New / Modified Artifacts

1. `.claude/skills/todo-fast/SKILL.md` — new orchestrator skill (Part B).
2. `.claude/agents/todo-fast-implementer.md` — new narrow-scope implementer agent (Phase 5).
3. `scripts/preflight.sh` — modified: new `--uncommitted` flag, combinable with `--fast` (Part A1).
4. `.claude/agents/todo-executor.md` — modified: Step 5 rewritten to use the scoped-fast check plus an overlapped full-suite/review pass (Part A2). No other step changes.

No changes to `todo-researcher.md`, the reviewer roster, `codify/SKILL.md`, or `land/SKILL.md` — all reused as-is.

## Edge Cases & Failure Handling

- **`Plan` agent unavailable or errors:** skip decomposition, single `todo-fast-implementer` for the whole todo (same fallback as "no safe split found").
- **A sub-task reports `NEEDS_CONTEXT`:** the orchestrator provides the missing context and re-dispatches that one implementer; other concurrent implementers are unaffected (disjoint files, no reason to block them).
- **A sub-task reports `BLOCKED`:** same two-attempt cap as `todo-executor.md`'s Failure Path, scoped to that sub-task's files. If still blocked after a retry, the **whole todo** reverts cleanly — every sub-task's changes, not just the failed one's — and reports `failed`. A todo with unmet Acceptance Criteria is never archived, regardless of how many other slices independently succeeded. No partial-credit half-merges.
- **Concurrency cap:** max 4 parallel `todo-fast-implementer` agents, matching `/todo`'s existing ceiling.
- **Worktree cleanup:** the shared worktree is force-removed at the end of the run (success or failure) — since it was created manually rather than via `isolation`, `/todo-fast` is responsible for its own teardown, though the `.claude/worktrees/agent-*` naming means a crashed run is also swept by the next `/todo` invocation as a backstop.

## Validation Plan

- **Part A1 (`preflight.sh --uncommitted`):** standard TDD — a failing test first (exercise the new flag against a repo state with uncommitted-but-not-committed `.ts`/`.tsx` changes, confirm the changed-file scope matches the working-tree diff, not `BASE..HEAD`), then implement until it passes.
- **Part A2 (`todo-executor.md` Step 5) and Part B (`/todo-fast`, `todo-fast-implementer`):** these are orchestration/agent markdown, not vitest-testable — validated the same way `/todo` itself is, via real dry runs:
  1. A dry run against a **genuinely decomposable** todo (Acceptance Criteria spanning 2+ disjoint files) to exercise the `Plan` decomposition and parallel `todo-fast-implementer` dispatch end-to-end.
  2. A dry run against a **non-decomposable** todo (a tightly-coupled component+utils+test cluster, matching the motivating example's shape) to exercise the single-implementer fallback and confirm the fixed Step 5 verification timing behaves correctly with no decomposition involved.
  3. Confirm, for both runs, that `guard-worktree-isolation.sh` actually fires as expected if an implementer's edit is deliberately pointed outside its assigned file list (a one-off manual check, not a permanent test) — this is the structural safety guarantee the whole shared-worktree model depends on.

## Reused Components (explicit)

- `todo-executor.md` Steps 1, 2, 3, 3.5 (extended), 7, 8, 10, 11 — referenced, not copied. Step 5 is modified (Part A2), shared by both `/todo` and `/todo-fast`.
- `todo-researcher.md` — dispatched unchanged when Step 3's short-circuit gate misses.
- `docs/AI_WORKFLOW.md` → Review Policy roster — same reviewer selection logic, now invoked from the fixed Step 5/6.
- `.claude/skills/codify/SKILL.md` — invoked directly in Phase 9.
- `.claude/skills/land/SKILL.md` — invoked in Phase 10 for non-auto-merge-eligible outcomes.
- `subagent-driven-development`'s implementer status protocol (`DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`) — reused for `todo-fast-implementer` reporting.
- `.claude/hooks/guard-worktree-isolation.sh` — the existing structural protection the Phase 1 `cd`-based dispatch contract relies on (confirmed by reading the hook, not assumed).
- `scripts/pg-lab/db-serial-lock.sh` — reused verbatim for DB-serial sub-tasks.
