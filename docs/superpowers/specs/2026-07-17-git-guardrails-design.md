# Git Guardrails: Worktree Contracts, Destructive-Op Advisor, Scope Contracts

**Date:** 2026-07-17
**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Driver:** Insights-report incident clusters — wrong-checkout writes and destructive cleanup near-misses (PR #520 closed unmerged), plus over-engineered first-pass fixes (PR #575 extra mechanism; a fail-open gate-widening).

## 1. Problem

Two recurring failure clusters, both traced to the same root: every rule that failed exists only as **prose an agent is supposed to follow**, and the incidents happened precisely when an agent didn't follow it.

**Cluster 1 — git state / destructive cleanup.** Verified enforcement gaps (exploration 2026-07-16):

- `.claude/hooks/guard-worktree-isolation.sh` fires only on Edit/Write/MultiEdit. Bash writes (`git mv`, `sed -i`, `>` redirects, `cp`) escape entirely — the exact vector of the wrong-checkout incident.
- The guard only detects escape _out of_ a worktree (cwd inside `.claude/worktrees/agent-*`). It structurally cannot detect the actual incident: **working in the main checkout while assigned a worktree**.
- Relative `file_path`s are always allowed; NotebookEdit is uncovered; the nested-worktree path-math bug is documented and unfixed (`docs/solutions/logic-errors/nested-worktree-defeats-isolation-guard-path-math-2026-07-15.md`), and `todo-fast` Phase 1 uses the relative-path `git worktree add` that triggers it.
- **Branch deletion has zero mechanical enforcement.** No hook matches `git branch -D`, `git push --delete`, or `gh pr close`; `merge-approval-guard.sh` was removed 2026-07-15; `.husky/pre-push` explicitly skips deletion pushes. The postmortem rule "confirm `merged: true` per-branch immediately before deleting" (`docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md`) is advisory-only. `/todo` Phase 0's `merged_only()` gate — the sole mechanical check — trusts a batch snapshot (`/tmp/todo-all-prs.json`) captured at sweep start, not a delete-time read: the exact staleness seam that closed PR #520.

**Cluster 2 — over-engineered first-pass fixes.** All guardrails are advisory: the inject-patterns discipline preamble (Edit/Write only, never Bash), agent-file prose, and reviewers who surface scope-creep as non-blocking WARNING/SUGGESTION. Nothing binds an implementation to the mechanisms the task actually asked for.

**Facts established during design:**

- Live branch protection on `main`: `enforce_admins: true`, 8 required checks (verified 2026-07-16 via `gh api`). The contrary comment in `branch-preflight.sh` is stale. A wrong-checkout commit cannot land directly on `main` — the blast radius is local-tree corruption and lost worktree isolation, not prod deploys.
- `CLAUDE_CODE_SESSION_ID` is present in the Bash tool environment and corresponds to the `session_id` hooks receive in their JSON input — so a script run by the agent can write session-keyed state that hooks later read. **Verified 2026-07-17 (spec review + probe): subagents inherit the parent's session ID in BOTH the env var and hook JSON** — a subagent-triggered `drift-detect-update.sh` wrote the parent-keyed file. Session-keyed state is therefore shared across the entire agent tree; no per-subagent identity exists on either side. Any contract mechanism must be safe under parallel subagents sharing one key (see §3.1 registry design).

## 2. Decisions (user-confirmed)

| Decision            | Choice                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Scope               | Both clusters, hooks-first                                                                                             |
| Destructive git ops | **Warn-only** — inject fresh PR state as ground truth at decision time; never block                                    |
| Worktree isolation  | **Declared-worktree contract, DENY enforcement**                                                                       |
| Over-engineering    | **Scope contract in todos + reviewer tier bump** — no new review rounds (user has twice pushed back on process weight) |

Enforcement philosophy: **deny** where correctness is mechanically decidable (a path is or isn't inside the declared worktree), **warn-with-fresh-data** where failures came from deciding on stale state, **process** where only judgment can detect the problem.

## 3. Design

### 3.1 Worktree contract (deny-enforced)

**Declaration — a registry, not a slot.** Because every subagent shares the parent's session ID (verified fact, §1), a single session-keyed contract file would race under parallel `/todo` dispatch (4 executors, 4 worktrees, last-write-wins → spurious denies of siblings). The contract store is therefore a **registry directory** holding one entry per declared worktree:

- Store: `/tmp/claude-worktree-contracts-$CLAUDE_CODE_SESSION_ID/<key>`, where `<key>` is the first 16 hex chars of `shasum` of the absolute worktree path and the file content is that path. Declares are idempotent; concurrent declares of different worktrees coexist without collision.
- `declare-worktree.sh <abs-path>` — verifies the path is a registered worktree (`git worktree list --porcelain`), then writes its registry entry. Refuses relative paths and unregistered directories with a clear error.
- `declare-worktree.sh --remove <abs-path>` — removes that entry. `--clear` — removes the whole registry.
- Callers: `todo-executor.md` Step 0 declares its own worktree (right after its existing pwd verification) and `--remove`s it as its final completion step; `todo-fast` Phase 1 (after `git worktree add`) plus its implementer dispatch preambles (all share one worktree — idempotent re-declares are fine). Ad-hoc worktree sessions (e.g. after `superpowers:using-git-worktrees`, a plugin we cannot durably edit) declare manually — a one-line CLAUDE.md note documents this, and the fallback-mode guard still covers undeclared sessions.
- Lifecycle: `/todo`'s orchestrator runs `--clear` after all executors return and **before** Phase 5 reconciliation (mopping up entries left by crashed executors, and unblocking its own main-checkout git ops). SessionEnd removes the registry directory wholesale via the existing `session-coord-hook.sh deregister` step.
- **Rejected alternative (spec review):** keying the contract by worktree identity alone — a path-hash lookup or an in-worktree marker discovered from cwd's worktree root. Both discover the contract _from the operation's location_, so when cwd is the main checkout (the actual incident), no contract is found and the write is allowed. Discovery-from-location cannot catch location-is-wrong; the registry keeps session-scoped discovery with worktree-granular entries.

**Enforcement.** `guard-worktree-isolation.sh` is rewritten with two modes:

_Registry non-empty (primary mode):_

- **Edit / Write / MultiEdit / NotebookEdit** (NotebookEdit newly wired): resolve `file_path` / `notebook_path` — relative paths resolved against the hook-reported cwd, closing today's relative-path hole — and DENY if the resolved path is outside **every** registered worktree. Allowlisted outside targets: `/tmp`, `/var/folders` (macOS TMPDIR), the session scratchpad directory, `~/.claude` (plans, memory).
- **Bash** (via the combined `git-safety.sh` entry, §3.2): DENY when a _mutating_ git subcommand (`commit`, `mv`, `rm`, `restore`, `checkout`, `stash pop`, `reset`, `rebase`, `merge`, `cherry-pick`, `apply`, `am`, `clean`) runs with an effective repo — cwd, or the `-C <path>` override, with relative `-C` targets resolved against cwd via `realpath` before comparison — that is not one of the registered worktrees. DENY write-shaped shell commands (`sed -i`, `tee`, `cp`, `mv`, `rm`, `>` / `>>` redirect targets) whose absolute-path arguments land outside every registered worktree (targets are additionally scoped to the main checkout — absolute writes elsewhere are out of this guard's scope — and target extraction is scoped per sub-command after quote-stripping). Read-shaped commands and relative-path shell writes (they land in cwd, which mutating-git rules already police) pass untouched.
- **Accepted limitation:** one registered worktree's agent writing into a _sibling's_ registered worktree passes (any-registered semantics). Cross-worktree confusion has never been an observed incident; main-checkout drift has, twice — and that is always denied while any assignment is active.

_Registry empty (fallback mode):_ today's behavior — active only when cwd is inside `.claude/worktrees/agent-*`, denying absolute Edit/Write escapes — is preserved, but the path derivation replaces `sed` string surgery with `git rev-parse --git-common-dir`, which resolves the true main checkout regardless of nesting depth. This fixes the documented nested-worktree bug at the guard rather than at call sites.

_Shared rules:_ bypass via `SKIP_WORKTREE_CONTRACT=1` (house pattern, same as `SKIP_PR_PREFLIGHT`). All gated-field parsing quote-strips and fails closed on unrecognized values per `docs/solutions/logic-errors/guard-script-field-quote-strip-fail-closed-2026-07-16.md`. Deny messages state the registered worktree(s), the offending path, and both escape hatches (`SKIP_WORKTREE_CONTRACT=1` for one command; `declare-worktree.sh --remove/--clear` when an assignment has genuinely ended).

### 3.2 Destructive-op advisor (warn-only)

One new **combined** PreToolUse Bash script, `.claude/hooks/git-safety.sh`, hosts both the §3.1 Bash-side contract check and the advisor — a single hook invocation with a fast early-exit regex, respecting the measured ~140 ms per-Bash-hook budget (net one new Bash hook, not two).

Advisor triggers: `git branch -D`, `git push … --delete <branch>` or `:<branch>` refspec, `gh pr close`, `git worktree remove --force`. On match:

1. Extract the branch (or PR number for `gh pr close`).
2. Run a **fresh** `gh pr view <ref> --json number,state,mergedAt` (≈1 s, only on matched commands).
3. Inject `additionalContext` — examples:
   - `state=MERGED`: "PR #642 for `todo/foo` is MERGED (2026-07-16T…) — deletion is safe."
   - `state=OPEN`: "⚠ PR #520 for this branch is OPEN and NOT merged — deleting the branch will close it unmerged. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md"
   - No PR: "⚠ No PR found for `<branch>` — deletion may lose never-pushed work."

**Never blocks.** `gh` failure or timeout → inject "could not verify PR state — treat as unverified" and continue (fail open; the hook is advisory by user decision).

### 3.3 `/todo` Phase 0 sweep hardening + todo-fast fixes

- `.claude/skills/todo/SKILL.md` Phase 0: the batch snapshot remains the _candidate selector_; **immediately before each individual branch deletion**, the sweep calls a new fail-closed helper `scripts/verify-branch-merged.sh <branch>` (exit 0 only when a fresh `gh pr view <branch> --json state` reports `MERGED`; any other state, no PR, or `gh` failure → non-zero). Non-zero → skip the deletion and surface it in Phase 5 reconciliation. A script rather than inline prose so the check is mechanically testable — unenforced prose is the anti-pattern this spec exists to fix.
- `/todo` orchestrator: run `declare-worktree.sh --clear` after all executors return, before Phase 5 (per §3.1 lifecycle).
- `.claude/skills/todo-fast/SKILL.md` Phase 1: build the `git worktree add` destination as an **absolute** path (removing the nested-worktree trigger); call `scripts/declare-worktree.sh "$WORKTREE"` after creation; include the declaration command in every implementer dispatch preamble (all implementers share the one worktree, so repeated declares are idempotent — each subagent must still `cd "$WORKTREE"` first, since it starts in the main checkout).

### 3.4 Scope contract + reviewer tier bump

- `todos/TEMPLATE.md`: new **## Scope Contract** section with three lines — _mechanisms to use_ (e.g. "standard `blocked_until` frontmatter — nothing new"), _files in scope_, and the default closing line "No new mechanisms, files, or abstractions beyond those listed."
- `docs/AI_WORKFLOW.md` → Review Policy tier rule: add "**Violation of a stated scope contract = CRITICAL (blocking)** — a new mechanism, file, or abstraction the contract excludes is treated like a correctness failure, not a style suggestion."
- `.claude/agents/code-reviewer.md`: explicit checklist item — when the task carries a scope contract, enumerate every mechanism/file the diff adds and check each against the contract; violations are CRITICAL.
- `.claude/agents/todo-executor.md`: pass the Scope Contract section verbatim into both the implementer prompt and reviewer dispatch prompts.

Tasks without a scope contract behave exactly as today — the tier bump binds only when a contract is stated, so ad-hoc work gains no process weight.

### 3.5 Small corrections

- `branch-preflight.sh`: fix the stale comment claiming `enforce_admins` is off (verified on, 2026-07-16).
- Nested-worktree path math fixed inside the guard (§3.1), superseding the call-site workaround.

## 4. Error handling summary

| Condition                                                    | Behavior                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry entry malformed / unreadable                        | Guard fails **closed** (deny with diagnostic) — a corrupted entry must not silently disable isolation                                                                                                                                                                                                                                  |
| `declare-worktree.sh` given relative/unregistered path       | Refuses with error; no entry written                                                                                                                                                                                                                                                                                                   |
| 4 parallel executors declare 4 worktrees (shared session ID) | Registry holds 4 coexisting entries — no collision, no last-write-wins. Ops inside any registered worktree pass; main-checkout ops denied                                                                                                                                                                                              |
| Crashed executor leaves a stale registry entry               | `/todo` orchestrator's `--clear` before Phase 5 removes it; interactive sessions use `--remove`/`--clear` or `SKIP_WORKTREE_CONTRACT=1`                                                                                                                                                                                                |
| `gh` unavailable/timeout in advisor                          | Fail **open** — inject "unverified" warning, allow                                                                                                                                                                                                                                                                                     |
| `gh` fresh-check fails in `/todo` sweep                      | Skip that deletion, surface in Phase 5                                                                                                                                                                                                                                                                                                 |
| Hook JSON missing fields / no jq                             | Unparseable envelope → fallback mode (session/registry unknowable). Once a registry is identifiable: missing `file_path`, malformed entries, dot-segment (`/../`, `/./`) paths, or missing `jq` → deny (fail closed; the Bash guard's no-jq deny keys off any `/tmp/claude-worktree-contracts-*` existing). Advisor: allow (fail open) |
| Legitimate cross-tree need                                   | `SKIP_WORKTREE_CONTRACT=1` for that command, or `declare-worktree.sh --clear` when the assignment genuinely ends                                                                                                                                                                                                                       |

## 5. Testing (strict TDD)

Test strategy is split by artifact location, matching repo precedent exactly (spec review 2026-07-17):

**`.claude/hooks/*.sh` → paired Bash self-tests** — `test-guard-worktree-isolation.sh` and `test-git-safety.sh`, matching the 28 existing `test-*.sh` examples, auto-discovered by `scripts/run-hook-tests.sh` and run by CI's dedicated "Hook self-tests" step (`.github/workflows/ci.yml:63`). Written failing-first. Matrix:

- Registry non-empty × {Edit, Write, MultiEdit, NotebookEdit} × {inside a registered worktree, outside absolute, outside relative, scratchpad/tmp allowlist}.
- Registry non-empty × Bash: mutating git in wrong cwd; `git -C <main>` from a worktree; relative `-C` resolution against cwd; read-only git anywhere (allow); `sed -i` / `tee` / redirect with outside absolute target; relative shell writes (allow).
- **Concurrency:** two worktrees registered under one session — ops inside each pass (no cross-contamination), main-checkout op denied; declares idempotent, `--remove` of one leaves the other enforced.
- Registry empty: legacy behavior incl. a **nested-worktree fixture** proving the `--git-common-dir` fix denies what the old sed math allowed.
- Advisor: each trigger pattern × {MERGED, OPEN, CLOSED-unmerged, no-PR, gh-failure} with a mock `gh` on PATH; assert never-blocks.
- Bypass and fail-closed paths: `SKIP_WORKTREE_CONTRACT=1`, malformed registry entry, quoted/unquoted JSON field values.

**`scripts/*.sh` → Vitest shell-out tests** (precedent: `scripts/todo-automerge-guard.sh` ↔ `scripts/__tests__/todo-automerge-guard.test.ts`), written failing-first:

- `declare-worktree.sh`: declare/`--remove`/`--clear` lifecycle; idempotent re-declare; refusal of relative/unregistered paths; concurrent declares coexisting under one key-space.
- `verify-branch-merged.sh`: mock `gh` on PATH × {MERGED → exit 0; OPEN, CLOSED-unmerged, no-PR, `gh` failure → non-zero} — fail-closed in every non-MERGED case, covering the snapshot-flip scenario (branch MERGED in snapshot, OPEN at fresh read → deletion skipped).

## 6. Verification (end-to-end)

1. Hook test matrix green.
2. Manual smoke: create **two** scratch worktrees and declare both under one session → Edit inside each passes (no cross-contamination from the sibling's entry), Edit targeting the main checkout denied, `git mv` with main-checkout cwd denied, `git branch -D` of a branch with an open PR injects "OPEN and NOT merged" context; after `--clear`, fallback mode applies again.
3. Latency: time the `git-safety.sh` early-exit path on a no-op command (`echo hi`) — must stay single-digit ms in-script.
4. CI green (8 required checks). `.claude/hooks/**` and `scripts/**` are automerge-HOLD paths — the PR gets individual review by design.

## 7. Out of scope

- Blocking enforcement for branch deletion / PR closure (explicitly rejected — warn-only).
- Diff-budget heuristics and pre-PR minimalism self-check steps (rejected — process weight).
- Changes to GitHub branch protection (already correct).
- The `land` skill's merge ritual (already prose-adequate; it gains the advisor's context automatically since the advisor fires on the underlying commands).

## 8. Implementation files

| Area         | Files                                                                                                                                                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hooks        | `.claude/hooks/guard-worktree-isolation.sh` (rewrite) + `test-guard-worktree-isolation.sh`, `.claude/hooks/git-safety.sh` (new) + `test-git-safety.sh`, `.claude/hooks/branch-preflight.sh` (comment), `.claude/hooks/session-coord-hook.sh` (registry cleanup), `.claude/settings.json` (wiring: NotebookEdit matcher, git-safety.sh Bash matcher) |
| Scripts      | `scripts/declare-worktree.sh` (new), `scripts/verify-branch-merged.sh` (new) + Vitest tests in `scripts/__tests__/`                                                                                                                                                                                                                                 |
| Skills       | `.claude/skills/todo/SKILL.md` (Phase 0), `.claude/skills/todo-fast/SKILL.md` (Phase 1 + preambles)                                                                                                                                                                                                                                                 |
| Process docs | `todos/TEMPLATE.md`, `docs/AI_WORKFLOW.md`, `.claude/agents/code-reviewer.md`, `.claude/agents/todo-executor.md`, `CLAUDE.md` (local-only: ad-hoc declaration note)                                                                                                                                                                                 |

Note: this spec file lives under gitignored `docs/superpowers/` (repo convention — specs are local-only); the implementation itself ships via feature branch → PR.
