# Worktree Isolation Leak — Investigation Design

- **Date:** 2026-05-16
- **Todo:** `todos/2026-05-16-investigate-worktree-isolation-leak.md`
- **Type:** Investigation + in-repo mitigation
- **Status:** Approved design — ready for implementation plan

## Goal

Determine why agents dispatched with `isolation: "worktree"` during the
2026-05-15/16 `/todo` run had their file edits land in the **main** working
tree (`/Users/williamtower/projects/OCRecipes`) instead of staying confined to
their `.claude/worktrees/agent-*` worktrees, and add an in-repo guardrail so the
leak cannot silently recur.

## Background

A `/todo` orchestrator run executing Phase 2 (Steps 5–6) of the
pattern-codification refactor dispatched `general-purpose` executor agents with
`isolation: "worktree"`. The intended work shipped correctly as PRs #189
(`808abb71`) and #190 (`effbc56f`). But after the run, `git status` on the main
checkout showed **53 uncommitted changes** — the same Step 5–6 edits — meaning
the work existed in two places: committed in the agents' worktrees _and_
uncommitted in `main`.

Claude Code version at incident time: `2.1.136`. Current version: `2.1.142`
(six patch releases later).

## Findings already established (pre-investigation)

- **Hooks are excluded as a cause.** Both `PreToolUse` hooks
  (`inject-patterns.sh`, `kimi-review.sh`) only _read_ files and emit JSON —
  neither writes. A hook cannot be the mechanism that leaked edits into `main`.
  The todo's "hook resolves `PROJECT_ROOT` to main repo" hypothesis is therefore
  pre-ruled-out as a _write_ vector. (A hook could still be the basis for the
  _fix_ — see M1.)
- **The leading hypothesis is path-based.** The likely mechanism is the executor
  agent's `Edit`/`Write`/`Bash` calls operating on absolute paths under the main
  repo root (`/Users/williamtower/projects/OCRecipes/...`) rather than the
  worktree root — so writes bypassed the worktree entirely.
- **Forensic state.** The stalled first executor's worktree
  (`.claude/worktrees/agent-a22fa743e844965e6`) is still on disk and `locked`,
  with HEAD at `57d6162a` — it carries **no** Step 5/6 commits (those are PRs
  #189/#190 from the other two executors). The Step 5/6 edits nonetheless
  appeared uncommitted in `main`. This worktree's reflog is forensic evidence
  and must not be removed until Phase 4.

## Approach

**Investigation: reproduce-first, forensics as fallback.** A controlled minimal
test agent is the cheapest discriminator — it either reproduces the leak on
`2.1.142` or it does not, and that result branches everything downstream. If it
does not reproduce, the bug was likely `2.1.136`-specific and already fixed
upstream; the todo then collapses to "verify + document + add the guardrail
anyway."

**Mitigation: guardrail hook (primary) + agent-instruction hardening (light).**
A hook is a real enforcement boundary that protects regardless of _why_ an agent
picks a bad path; instruction hardening makes executors fail fast with a clear
message instead of being silently denied mid-run.

## Phases

### Phase 1 — Forensic capture (before any cleanup)

Extract and freeze into the RCA doc:

- The locked worktree's reflog / `logs/HEAD` and branch state.
- PR #189 / #190 commit and file lists.
- The observed 53-file `git status` set (reconstruct from the merged PRs).
- The incident agents' tool-call history. Claude Code transcripts live in
  `~/.claude/projects/-Users-williamtower-projects-OCRecipes*/*.jsonl`, keyed by
  working-directory path — a worktree-isolated session gets its own entry keyed
  by the worktree path. Scan the run's `Edit`/`Write`/`Bash` calls for any
  absolute path under `/Users/williamtower/projects/OCRecipes/` that is not
  under a worktree root — that is the smoking gun for the path-based hypothesis.
  Note: transcripts are not in `.claude/worktrees/agent-*/` (that holds only a
  repo checkout).

The locked worktree `agent-a22fa743e844965e6` is **not removed** until Phase 4.

### Phase 2 — Controlled reproduction

Dispatch one minimal test agent with `isolation: "worktree"` that:

- Reports `pwd`, `git rev-parse --show-toplevel`, and the `cwd` field it
  observes in a `PreToolUse` hook event.
- Makes one trivial file edit.
- Confirms which copy of `.claude/hooks/` the harness executes for a
  worktree-isolated agent (the main checkout's copy vs. the worktree's own
  copy) and how that hook resolves the worktree root. This does not bear on the
  leak cause (hooks are read-only) but is load-bearing for M1's design — M1 is
  itself a hook and must anchor on a signal that is reliable in this context.

Then check `git status` on `main`. This simultaneously tests the leak **and**
establishes whether the harness sets the agent's CWD / hook-event `cwd` to the
worktree — the fact the M1 guardrail depends on.

### Phase 3 — Root cause

From Phases 1–2, confirm or conclusively rule out each hypothesis:

- (a) Harness does not isolate the agent's CWD to the worktree.
- (b) Agent issued absolute main-repo paths to `Edit`/`Write`/`Bash`.
- (c) `2.1.136`-specific behavior, already fixed by `2.1.142`.

Record a definitive RCA (root cause + supporting evidence) in the todo's
`Updates` section or a dedicated RCA note.

### Phase 4 — Mitigation

- **M1 (primary): guardrail hook.** A `PreToolUse` hook on
  `Edit`/`Write`/`MultiEdit` that fail-closes: if the hook-event `cwd` is inside
  `.claude/worktrees/agent-*` but the target `file_path` resolves _outside_ that
  worktree, deny the tool call with a clear reason. The exact anchor for the
  check is **contingent on Phase 2** — if Phase 2 proves the harness does not
  set `cwd` to the worktree, M1 must anchor on a different reliable signal.
- **M2 (light): agent-instruction hardening.** `todo-executor.md` instructs
  executors to assert their CWD (`git rev-parse --show-toplevel`) at startup and
  use worktree-relative paths.

Verify by re-running the Phase 2 test agent and confirming `main`'s
`git status` stays clean. Then remove the stale locked worktree.

## Out of scope

The agent-stall / `SendMessage`-unavailable symptom from the same run. The todo
explicitly scopes itself to the isolation leak only.

## Done when

- RCA recorded with supporting evidence.
- Root-cause fix applied, or — if the cause is the Claude Code harness and not
  fixable in-repo — the workaround documented.
- Guardrail (M1) + instruction hardening (M2) merged.
- Recurrence-prevention pattern codified in `docs/solutions/` (the active
  codification target; `docs/patterns/` was retired by PR #190).
- A fresh `isolation: "worktree"` agent run verified to leave `main`'s
  `git status` clean.

## Files in scope

- `.claude/settings.json` — register the guardrail hook.
- `.claude/hooks/` — new guardrail hook script.
- `.claude/agents/todo-executor.md` — M2 instruction hardening.
- `.claude/skills/todo/SKILL.md` — M2 instruction hardening (if dispatch-side).
- `docs/solutions/` — new entry codifying the recurrence-prevention pattern.
- `todos/2026-05-16-investigate-worktree-isolation-leak.md` — RCA record.
