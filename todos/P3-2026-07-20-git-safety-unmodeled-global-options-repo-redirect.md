---
title: "git-safety gate models only -C/-c among git global options — --git-dir/--work-tree (and a global before -C) redirect the repo past the contract"
status: backlog
priority: low
created: 2026-07-20
updated: 2026-07-20
assignee:
labels: [deferred, harness, hooks, security]
github_issue:
human_led: true
blocked_reason: "Never delegate — live blocking git gate protecting the main checkout; truth-table-first TDD, verified fail-closed, primary session only (same contract as the -C front-door todo)"
---

# git-safety gate: unmodeled git global options redirect the repo past the contract

## Summary

`MUTATING_GIT_SEG_RE` recognizes only `-C` and `-c` among git's global options.
Other **repo-redirecting** globals (`--git-dir`, `--work-tree`) and even a benign
global placed _before_ the `-C` (`--no-pager`, `-p`) let a mutating git command
reach the MAIN checkout without the contract ever DENYing it. Same "a global option
redirects/hides the repo" family the chained-`-C` fix hardened, but a different
option set — deliberately left for its own scoped landing.

## Background

Filed from the security-auditor pass on
[[P2-2026-07-19-git-safety-frontdoor-quote-aware-segmentation]] (the chained-`-C`
fix, branch `fix/git-safety-chained-c-resolution`). The auditor confirmed the `-C`
change introduced **no** regression, and flagged this as a **pre-existing** residual
(identical behavior before and after that PR).

`human_led: true` / **never delegate** — this is a live, blocking git gate protecting
the main checkout; changes must be truth-table-first TDD, verified fail-closed, primary
session only. Same contract as the parent todo.

## Confirmed bypasses (live-hook repros; cwd = a registered worktree, contract active, real git → main)

All verified `old=ALLOW new=ALLOW` by the auditor against the current hook:

1. **`--git-dir` redirect — FALSE-NEGATIVE.** `git --git-dir=<MAIN>/.git commit -m x`
   → ALLOW. No `-C` at all; git mutates main via `GIT_DIR`. `git_c_target` sees no
   `-C`, so `EFFECTIVE=cwd` (the worktree) → allowlisted → ALLOW. (A bare `--git-dir`
   without a matching `--work-tree` mutates the index/refs of main.)
2. **`--work-tree` redirect — FALSE-NEGATIVE.** `git --work-tree=<MAIN> commit -m x`
   / `git --git-dir=<MAIN>/.git --work-tree=<MAIN> commit` → ALLOW. Same mechanism.
3. **A benign global BEFORE the `-C` breaks the regex — FALSE-NEGATIVE.**
   `git --no-pager -C <MAIN> commit` and `git -p -C <MAIN> commit` → ALLOW. The
   `-C <MAIN>` _is_ present and real git honors it, but `MUTATING_GIT_SEG_RE`'s
   options group only consumes `-C…`/`-c…`, so an unmodeled `--no-pager`/`-p` token
   stops the regex from ever reaching the verb → segment skipped → ALLOW. (This one is
   NOT a repo-redirect per se — the `-C` already targets main — it is the regex being
   unable to skip an unmodeled global.)

## Acceptance Criteria

- [ ] Decide (fix or explicitly document as accepted residual, with a test either way)
      each case. `--git-dir`/`--work-tree` are direct repo redirects and arguably deserve
      closing; `--no-pager`/`-p`-before-`-C` is a regex-skip gap in the same family.
- [ ] If fixing `--git-dir`/`--work-tree`: teach the effective-repo resolution about
      `GIT_DIR`/`GIT_WORK_TREE` semantics (they differ from `-C`'s cwd model — resolve
      the work-tree/git-dir target, not a chdir). Truth-table-first: a red test per closed
      case (`git --git-dir=<MAIN>/.git commit` → DENY), fail-open guards for worktree targets.
- [ ] If fixing the unmodeled-global-skip: let the options group tolerate other known git
      globals (`--no-pager`/`-p`/`-P`/`--bare`/`--namespace=…`/`--exec-path[=…]`/…) so a
      real `-C <MAIN>` after them is still reached. Keep it a strict superset (never a new
      DENY→ALLOW).
- [ ] All existing mutating-git guards stay green; full hook self-test sweep green.
- [ ] Update the `git_c_target` docstring residual list as the residuals actually shrink.

## Scope Contract

- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- **Mechanisms to use:** the existing in-file quote-state AWK machine + the anchored
  per-segment regex; no new matching architecture, no new files.
- Do NOT weaken any existing mutating-git or write-shaped guard test.

## Risks

- Live, contract-gated blocking gate. A regression in the PERMISSIVE direction is a
  security hole; verify every change fails closed. Never delegate; primary session only.
- `--git-dir`/`--work-tree` resolution is genuinely different from `-C` (env-var repo
  redirect, not a chdir), so this needs its own careful truth table — not a copy of the
  `-C` logic.

## Updates

### 2026-07-20

- Filed from the security-auditor review of the chained-`-C` fix. Pre-existing family
  (behavior identical before/after that PR), backstopped by `SKIP_WORKTREE_CONTRACT=1`
  and the file-tool guard — a guardrail residual, not a sandbox breach — hence deferred
  for its own deliberate, fully-tested landing.
