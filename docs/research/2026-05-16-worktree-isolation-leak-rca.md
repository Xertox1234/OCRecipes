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

### Baseline

`git status --short` on the main checkout: clean apart from the expected
untracked `todos/2026-05-16-investigate-worktree-isolation-leak.md`.

### Probe 1 — relative-path write (cwd semantics)

A worktree-isolated agent reported:

- `pwd` = `…/OCRecipes/.claude/worktrees/agent-a74b80abaa5eb2f12`
- `git rev-parse --show-toplevel` = the same worktree path
- `git rev-parse --absolute-git-dir` = `…/OCRecipes/.git/worktrees/agent-a74b80abaa5eb2f12`
- A `Write` with the **relative** path `repro-marker-relative.txt` landed **inside
  the worktree**; the file did not appear in the main checkout.

**Conclusion:** the harness sets a worktree-isolated agent's cwd to its worktree,
and relative paths resolve into the worktree. Isolation works for the normal flow.

### Probe 2 & 3 — absolute main-path write (agent behavior)

Two separate worktree agents were asked to `Write` to the absolute main-checkout
path `/Users/williamtower/projects/OCRecipes/probe-absolute-marker.txt`. Both
**refused**, correctly identifying the path as outside their worktree and the
write as an isolation-boundary violation. No leak — but this is _agent caution_,
not a harness guarantee.

### Probe 4 — absolute-path reachability (harness behavior)

A worktree agent:

- **`Read` of the absolute path `/Users/.../OCRecipes/CLAUDE.md` (main checkout,
  no worktree segment) SUCCEEDED.** The harness does **not** sandbox absolute
  paths — they are resolved literally by the filesystem.
- `Read` of the relative path `CLAUDE.md` failed: `CLAUDE.md` is `.gitignore`d
  and untracked, so it is absent from the worktree checkout (a red herring for
  the leak, but it cleanly demonstrated the absolute-path reach above).
- A `Write` to an absolute path **inside** the worktree landed in the worktree.

### Other findings

- **Agent worktrees are created from `origin/main`** (`7324bac3`), not the
  orchestrator's local branch/HEAD. Confirmed: every probe worktree's HEAD equals
  `origin/main`. Material for Task 6 — a guardrail must be on `origin/main` before
  a freshly dispatched agent's worktree will contain it.
- The worktree checkout is otherwise complete (2259 tracked files present);
  `.claude/settings.json` and `.claude/hooks/` are present, so hooks defined in
  settings apply to worktree agents.
- Hooks fire for worktree agents — empirical confirmation deferred to Task 6's
  end-to-end run with the real M1 hook.

## Phase 3 — Root cause

(filled in by Task 3)
