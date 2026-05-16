# Worktree Isolation Leak — Root Cause Analysis

- **Date:** 2026-05-16
- **Spec:** docs/superpowers/specs/2026-05-16-worktree-isolation-leak-design.md
- **Plan:** docs/superpowers/plans/2026-05-16-worktree-isolation-leak.md
- **Incident CC version:** 2.1.136 — **Investigation CC version:** 2.1.142

## Phase 1 — Forensic capture

### Locked worktree state

`git worktree list`:

```
/Users/williamtower/projects/OCRecipes                                            [fix/worktree-isolation-leak]
/Users/williamtower/projects/OCRecipes/.claude/worktrees/agent-a22fa743e844965e6  57d6162a [worktree-agent-a22fa743e844965e6] locked
/Users/williamtower/projects/OCRecipes/.worktrees/feature/curated-recipes         459bb064 [feature/curated-recipes]
```

The stalled executor's worktree `agent-a22fa743e844965e6`:

- HEAD at `57d6162a` — a plain commit on `main`. **No Phase 2 Step 5/6 commits** exist
  in this worktree. The stalled first executor never committed the refactor work.
- `git status --short` inside it: `M todos/2026-05-12-phase-2-pattern-decomposition.md`
  — a single uncommitted edit.
- Reflog has only two entries, both `57d6162a` (`reset: moving to HEAD`) at
  2026-05-15 21:27:28 — no branch/commit activity. Consistent with an agent that
  was created, parked, and stalled.

### PR #189 / #190 file lists

The Phase 2 Step 5/6 work that shipped correctly as PRs:

- **PR #189** (`808abb71`) — 1 file: `.claude/hooks/inject-patterns.sh`.
- **PR #190** (`effbc56f`) — ~40 files: the 16 `docs/patterns/ → docs/legacy-patterns/`
  renames, ~17 `.claude/agents/*.md` files, `.claude/skills/{audit,codify}/SKILL.md`,
  `docs/PATTERNS.md`, `docs/LEARNINGS.md`, `docs/AI_*.md`, `client/constants/notebook-colors.ts`.

This is the edit set that also appeared as 53 uncommitted changes in `main`.

### Transcript scan

Claude Code transcripts: `~/.claude/projects/<cwd-path-hash>/*.jsonl`. Two project
directories exist: `-Users-williamtower-projects-OCRecipes` (main) and
`-Users-williamtower-projects-OCRecipes--claude-worktrees-todo-2026-05-09-coach-intent-router`
(an unrelated old `.worktrees/`-style worktree). **No project directory keyed by a
`.claude/worktrees/agent-*` path exists** — worktree-isolated agent sessions are
not filed under a worktree-keyed project dir; they appear under the main project
path or as sidechains of the orchestrator session.

Sampled May-15-evening sessions around the incident (`2a2075ca`, `96d35ca0`,
`88dc656b`) for `Edit`/`Write` tool inputs:

- **Decisive finding — every `file_path` is absolute.** Across all sampled
  sessions, the count of relative `file_path` values is **zero**. Claude Code's
  `Edit`/`Write` tool calls always carry absolute paths; the model/harness does
  not emit worktree-relative paths.
- **Dual-path leak signature observed.** Session `2a2075ca` contains the same
  solution file at two paths:
  `…/OCRecipes/.worktrees/codify-fixture/docs/solutions/logic-errors/tier-detection-matched-clean-output-message-2026-05-15.md`
  **and**
  `…/OCRecipes/docs/solutions/logic-errors/tier-detection-matched-clean-output-message-2026-05-15.md`.
  A worktree-isolated agent's file also landed at the main-checkout path — the
  same "work exists in two places" symptom as the reported incident.

### Phase 1 implications for the mitigation

- Because tool calls are **always absolute**, the spec/plan's M2 instruction
  ("use worktree-relative paths") is largely unactionable — agents cannot choose
  relative paths. M2 must be reframed at the Task 3 checkpoint (e.g. assert the
  workspace and fail fast, rather than prescribe relative paths).
- The M1 hook's deny logic targets exactly the absolute-path-under-main case, so
  it remains the sound primary mitigation. Its "relative path → allow" early-exit
  is effectively dead code but harmless.

## Phase 2 — Controlled reproduction

(filled in by Task 2)

## Phase 3 — Root cause

(filled in by Task 3)
