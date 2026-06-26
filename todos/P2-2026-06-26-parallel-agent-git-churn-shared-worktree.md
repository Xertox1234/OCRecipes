<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Parallel agents/processes destructively churn shared git state (core.bare flip, bogus user override, phantom x.txt, reverted tracked-file edits)"
status: backlog
priority: medium
created: 2026-06-26
updated: 2026-06-26
assignee:
labels: [tooling, git, dx, multi-agent, safety]
github_issue:

---

# Parallel agents/processes destructively churn shared git state

## Summary

When a second agent (or the VSCode Git extension, or a runaway hook) operates on the repo concurrently, the shared git state gets corrupted mid-session: `core.bare` flips to `true`, a bogus `user.email=t@t` / `user.name=T` local override appears, a phantom staged `x.txt` (content `x`) recurs, and **uncommitted tracked-file edits get reverted before they can be committed** — silently losing in-flight work. Harden the dev tooling so concurrent agents cannot clobber each other's git state.

## Background

Observed live during the PR #458 (notification Phase 0) `/codify` step, with a second agent running in another terminal. Symptoms, all reproduced multiple times within minutes:

- **`core.bare=true` re-flips** repeatedly after being reset to `false`. Worktrees share the common `.git/config`, so a single flip poisons every worktree at once. Already documented in CLAUDE.md memory ("core.bare=true breaks the work tree — multiple triggers"; triggers include the VSCode Git extension on restart and hand-removing a harness worktree).
- **Bogus local user override** `user.email=t@t`, `user.name=T` appears in the (shared) local config, overriding the real `william.tower@gmail.com`. Some process writes this — it mis-authors any commit made while it's active.
- **Phantom `x.txt`** (one-byte content `x`) recurs as a staged add-then-deleted (`AD`) entry. This is almost certainly a test fixture leaking into the real worktree.
- **Tracked-file edits reverted:** uncommitted edits to `.claude/agents/*.md` were wiped (working tree reset to HEAD) before they could be staged/committed — twice. The fix was to apply-and-commit in a single atomic shell call (a working-tree revert can't touch a commit, since HEAD was not being moved). Untracked new files (e.g. a fresh solution file or this todo) survived, since a `git checkout`/`restore`/`reset --hard` does not remove untracked files.

Prime suspect for the `x.txt` + revert artifacts: **`.claude/hooks/test-branch-preflight.sh`** (the branch-preflight hook self-test, run by the full `npm run preflight` on pre-push). It creates temporary git state to assert the hook denies commits on detached HEAD; under `core.bare=true` confusion it may resolve to the **real** worktree instead of an isolated temp repo, leaving `x.txt` and reverting/resetting the live tree. This test is NOT part of CI (CI runs only the Vitest shards), so it passes in CI while failing/corrupting locally.

## Acceptance Criteria

- [ ] **Hermetic hook self-test:** `.claude/hooks/test-branch-preflight.sh` (and any sibling hook tests) run entirely inside an isolated `$(mktemp -d)` repo with their own `GIT_DIR`/`GIT_WORK_TREE`/`HOME`, never touching the caller's repo. A `trap ... EXIT` cleans up. Add an assertion at the end that the caller's `git status --porcelain` is unchanged and no `x.txt` was created.
- [ ] **`core.bare` guard:** a lightweight check (husky `pre-commit`/`pre-push` preamble or a SessionStart hook) that asserts `core.bare=false`, auto-corrects it, and logs when it had to. Identify and stop the source of the flip (confirm whether it's the VSCode Git extension vs a hook).
- [ ] **Eliminate the bogus `t@t`/`T` override:** find what writes `user.email=t@t` / `user.name=T` to the local config (grep hooks + test fixtures for `t@t`, `git config user.`) and prevent it; if it's a test, scope it to the isolated temp repo.
- [ ] **Concurrent-worktree safety:** document (and ideally enforce) that each agent works in its **own** worktree and never shares a working directory; consider a simple lock/serialization for git-mutating operations against the shared common dir, or a guard that warns when two processes target the same worktree.
- [ ] No phantom `x.txt`, no `core.bare` flip, and no tracked-file reverts reproduce after the fixes, with two agents running concurrently.

## Implementation Notes

- Grep for the `x.txt` origin: `grep -rn "x.txt\|echo x\b\|> x.txt" .claude/hooks scripts` and the husky dir.
- Grep for the bogus-user writer: `grep -rn "t@t\|user.name\|user.email\|git config user" .claude/hooks scripts .husky`.
- The hermetic pattern: `tmp=$(mktemp -d); GIT_DIR="$tmp/.git" GIT_WORK_TREE="$tmp" git init -q ...; trap 'rm -rf "$tmp"' EXIT` — and crucially never run a bare `git` (which inherits the caller's repo) inside the test body; always use `git -C "$tmp"` or the exported env.
- Workarounds already in CLAUDE.md memory: `git config core.bare false`; unset the bogus `[user]` override; commit work atomically (apply + `git add` + `git commit` in one shell invocation) so a working-tree revert can't lose it.
- The bypass for an already-broken local gate is `git push --no-verify` (the failing self-test is local-only; CI is the authoritative gate) — but that's a workaround, not the fix.

## Dependencies

- None blocking. Touches `.claude/hooks/`, `.husky/`, and possibly the preflight script.

## Risks

- **Hard to reproduce deterministically** — it's timing-dependent on concurrent activity. Validate by running two agents/terminals doing git ops in the same repo simultaneously.
- Hardening `test-branch-preflight.sh` must not weaken what it validates (the branch-preflight hook's detached-HEAD deny behavior). Keep the assertions; only change _where_ they run.
- The `core.bare` flip may be owned by the VSCode Git extension (outside this repo's control) — the guard mitigates the symptom even if the root trigger is external.

## Updates

### 2026-06-26

- Initial creation. Discovered during PR #458 `/codify` with a second agent running concurrently; agent-file edits were reverted twice and had to be committed atomically. `core.bare` flip + bogus `t@t`/`T` user override + phantom `x.txt` all reproduced. Prime suspect: non-hermetic `.claude/hooks/test-branch-preflight.sh` under `core.bare=true`.
