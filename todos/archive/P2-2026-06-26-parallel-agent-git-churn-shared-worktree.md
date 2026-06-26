<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Parallel agents/processes destructively churn shared git state (core.bare flip, bogus user override, phantom x.txt, reverted tracked-file edits)"
status: done
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

- [x] **Hermetic hook self-test:** `test-branch-preflight.sh` now `unset`s inherited git env (`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/…) + `GIT_CONFIG_GLOBAL=/dev/null` up front, and a new end-of-run guard asserts the caller's repo (`user.email`, HEAD, `git status --porcelain`) is byte-for-byte untouched. `preflight.sh` also strips git env around the whole `test-*.sh` loop. (PR/commit `36f94012`.)
- [x] **`core.bare` guard:** built as a PreToolUse(Bash) hook `core-bare-guard.sh` (auto-resets `core.bare=true`→`false` before any git command, WARN-only). Chosen over husky (which runs _after_ git already refuses) / SessionStart (misses mid-session flips). Source of the flip confirmed external: VS Code's Git integration (this session's env carries `GIT_ASKPASS=.../Visual Studio Code.app/...`). (commit `209120df`.) **Registered** as a PreToolUse(Bash) hook in `.claude/settings.json` (commit `61143056`, lines 89–92) — and `.claude/settings.json` is git-tracked, so the registration is durable. Self-test green: `test-core-bare-guard.sh` (7/7).
- [x] **Eliminate the bogus `t@t`/`T` override:** root cause found — `test-branch-preflight.sh:42` itself (`git -C "$REPO" config user.email "t@t"`); under an inherited **absolute** `GIT_DIR`, `git -C` is defeated and the write lands in the real `.git/config`. Hermeticity (above) eliminates it. Reproduced + fixed (red→green) with the real script.
- [x] **Concurrent-worktree safety:** IMPLEMENTED (see Updates 2026-06-26 #3). New PreToolUse(Bash) hook `guard-concurrent-session.sh` (registered in `.claude/settings.json`, after `drift-detect.sh`) detects when a **second live Claude session is mutating the same working tree** and WARNs once with a nudge to isolate via `superpowers:using-git-worktrees`. Keyed on `git rev-parse --show-toplevel` (the working-tree root), so two agents in **separate** worktrees are correctly seen as isolated — only a **shared** checkout triggers it. Self-expiring lease (20-min mtime TTL → a crashed/idle peer stops counting), WARN-only, fail-open. It is the complement of `guard-worktree-isolation.sh`: that hook **enforces** isolation once a worktree exists; this one **flags its absence** when two sessions share the main checkout. A true cross-process mutex is infeasible from PreToolUse (the hook returns before the command runs) — so the lever is **isolation, not a lock**. Hermetic self-test `test-guard-concurrent-session.sh` green (13/13, incl. the caller-repo-untouched guard).
- [x] No phantom `x.txt`, no `t@t` override, and no tracked-file reverts reproduce: verified via the red→green reproduction (absolute `GIT_DIR` corrupts pre-fix, clean post-fix) + all 8 original assertions + the new hermeticity guard pass. `core.bare` flip is auto-healed once the guard is registered.

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
- **Root cause corrected + fixed (commits `36f94012`, `209120df`).** The prime suspect was right about the file, wrong about the mechanism: it is **not** `core.bare` confusion and **not** the pre-push hook (verified: a real pre-push hook receives `GIT_DIR='<unset>'`). The real cause is that an inherited **absolute** `GIT_DIR`/`GIT_WORK_TREE` **overrides `git -C <dir>`** — so the test's `git -C "$REPO"` setup wrote `t@t`/`T` into the _real_ `.git/config` and its `checkout --detach`/`switch` moved the _real_ HEAD. Proven with the real script: corrupts under absolute `GIT_DIR`, clean under relative. The injector is VS Code's Git integration (this session's env carries its `GIT_ASKPASS`). Fix is trigger-agnostic (unset inherited git env). `core.bare` (symptom #1) has no in-repo writer → separate PreToolUse auto-heal hook, pending `settings.json` registration. Remaining open: broader concurrent-worktree process/policy (criterion 4).

### 2026-06-26 (#2 — closed)

- **`core.bare` guard registration landed (commit `61143056`).** Criterion 2's "pending `settings.json` registration" is resolved — `core-bare-guard.sh` is wired as a PreToolUse(Bash) hook at `.claude/settings.json:89–92`, and `.claude/settings.json` is git-tracked, so the registration survives across sessions. (The 4 corruption symptoms — `core.bare` flip, `t@t`/`T` override, phantom `x.txt`, tracked-file reverts — are now each closed by a committed mechanism.)
- **Re-verified end-to-end in a fresh session.** Live repo state clean: `git status --porcelain` empty, `core.bare=false`, no local `user.email`/`user.name` override, HEAD on `main`. Both hook self-tests green in-session: `test-branch-preflight.sh` 9/9 (incl. the hermeticity guard "caller repo untouched") and `test-core-bare-guard.sh` 7/7. Solution codified at `docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md`.
- **Criterion 4 (broader concurrent-worktree safety) deferred-and-closed, not implemented.** The actual corruption vector (non-hermetic self-test under inherited absolute `GIT_DIR`) is fixed; a speculative cross-agent git-mutation lock is open-ended policy work and over-engineered for a solo workflow. The residual is already mitigated by `drift-detect.sh`, the registered `core-bare-guard.sh`, and `superpowers:using-git-worktrees`. Reopen as a fresh todo if multi-agent git contention recurs in practice. **Closing this todo as done.**

### 2026-06-26 (#3 — criterion 4 implemented on request)

- **Criterion 4 reopened and implemented** at the user's explicit request ("implement criterion 4"). Faithful scope (settled with the reviewer): criterion 4 is concurrent-**agent** safety, not guarding Claude's own destructive ops. An earlier candidate — a `git reset --hard`/`checkout .` guard on Claude's own commands — was rejected as a tangential feature: it guards a vector that was never the cause (the reverts came from an **external** writer, which a PreToolUse hook on Claude's own commands cannot intercept).
- **Delivered:** `guard-concurrent-session.sh` + hermetic `test-guard-concurrent-session.sh` (13/13) + `.claude/settings.json` registration (PreToolUse(Bash), after `drift-detect.sh` so `core-bare-guard` heals `core.bare` first). Detects a second live session in the **same working tree** via a self-expiring `/tmp` lease keyed on `git rev-parse --show-toplevel`; WARNs once per session with a worktree-isolation nudge. WARN-only, fail-open, separate-worktree-safe. Full hook test suite (15 suites) green under the preflight env-strip wrapper; live tree verified clean (`core.bare=false`, no `t@t` override, no phantom `x.txt`).
- **Design note (why detect, not lock):** a PreToolUse hook returns _before_ the command runs, so it cannot hold a cross-process mutex across the git op. Nothing in-process can stop an **external** process from clobbering a shared checkout — the only real fix is isolation (separate worktrees), so the hook surfaces the contention and nudges toward it rather than pretending to lock. All 5 acceptance criteria now `[x]`.
