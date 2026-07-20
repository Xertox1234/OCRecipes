---
title: 'Ad hoc git worktrees outside .claude/worktrees/ get no node_modules symlink'
track: knowledge
category: conventions
module: shared
tags: [git, worktree, tooling, husky]
applies_to: [.husky/post-checkout]
created: '2026-07-06'
last_updated: '2026-07-19'
---

# Ad hoc git worktrees outside .claude/worktrees/ get no node_modules symlink

## Rule

Any `git worktree add` invoked directly (as opposed to through the Agent tool's `isolation:"worktree"` parameter or the `EnterWorktree` tool) — an ad hoc verification worktree in `/tmp`, a `--detach` worktree off a raw commit SHA, a one-off worktree for manual conflict resolution, or a skill's own Phase 1 creating a single shared worktree for multiple agents — gets `.env` and `docs/LEARNINGS.md` auto-symlinked by `.husky/post-checkout`, but **not** `node_modules`, regardless of where it lives or what it's named. Any command needing the toolchain (`vitest`, `eslint`, `tsc`, or a `git commit`/`push` whose hook shells out to `npx`) fails with `env: eslint: No such file or directory` or `ENOENT`, even though the repo state is otherwise correct.

## Smell patterns

- A hook failure naming a binary that's normally on `PATH` inside the repo (`eslint`, `tsc`, `vitest`) from a worktree you created by hand rather than through an agent-dispatch convention.
- `ls <worktree>/node_modules` comes back "No such file or directory" while `.env` is present and correct.
- A single test fails with ENOENT on a path under `node_modules/<pkg>/...` while every other test in the same run (including other tests in the same file) passes — especially if the failing test constructs the path explicitly (e.g. via `import.meta.resolve`, `require.resolve` with an explicit `basedir`, or string-concatenating `process.cwd()`) rather than using a plain `import`/`require` of the package. Confirm by re-running the identical test from the main checkout — if it passes there, this is the worktree module-resolution artifact, not a real regression.

## Why

`.husky/post-checkout`'s symlink list is hardcoded to the two gitignored files a new worktree actually needs to run the app or read project context (`.env`, `docs/LEARNINGS.md`) — it has no `node_modules` case because the executor/audit conventions that motivated it always provision worktrees under `.claude/worktrees/agent-*`, which are set up through a separate provisioning path. A raw `git worktree add <path> <ref>` bypasses that path entirely, so nothing symlinks `node_modules` for it.

Ordinary imports keep working via Node's ancestor `node_modules` walk-up (the worktree is nested inside the main checkout), which is exactly why this gap goes unnoticed for so long — only cwd-anchored explicit path construction exposes it.

## Examples

Symlink it manually before running any toolchain command in the worktree:

```bash
ln -s /absolute/path/to/main-checkout/node_modules /path/to/ad-hoc-worktree/node_modules
```

Hit twice in one session with the identical fix both times: once independently verifying a Babel-plugin behavior claim in a detached `/tmp` worktree, once resolving a merge conflict in an ad hoc worktree created off a PR branch.

## Exceptions

Worktrees created via the Agent tool's native `isolation: "worktree"` dispatch parameter (or the `EnterWorktree` tool) don't need this — those provisioning paths symlink `node_modules` automatically. **This is about the creation MECHANISM, not the resulting directory name or path.** A worktree living under `.claude/worktrees/agent-*` is not automatically exempt: `/todo-fast`'s Phase 1 creates its ONE shared multi-agent worktree via a raw `git worktree add ".claude/worktrees/agent-todo-fast-$SLUG" ...` (a shared worktree used by several concurrent implementers can't use per-call `isolation:"worktree"`, which mints a fresh worktree per Agent call) — and this worktree, despite matching the `agent-*` naming convention exactly, still needs the manual `ln -sf` fix below. Confirmed by direct testing during `/todo-fast`'s own Task 5 validation (2026-07-15): two worktrees manually created with `git worktree add ".claude/worktrees/agent-todo-fast-<slug>" ...` both came up with no `node_modules` at all (not even a broken one — the directory was simply absent), until symlinked by hand.

A second confirmed counter-case: during the `USDA-by-UPC barcode branch discards real serving size` todo (P3-2026-07-16), a todo-executor agent dispatched via the Agent tool with `isolation:"worktree"` (matching the `.claude/worktrees/agent-*` naming convention exactly, a single per-call worktree, NOT a shared multi-agent one) had a `node_modules` directory that was a REAL (not symlinked) directory containing only `.cache/` and `.vite/` — zero actual npm packages, confirmed via `ls`/`du` (44K total). This was not caught earlier because Node's ancestor-directory module resolution walk-up (since the worktree is nested inside the main checkout's directory tree) transparently resolves ordinary `require`/`import` calls up to the main checkout's real `node_modules`, so almost everything still works. The ONLY thing that broke was a single vitest test (`server/lib/__tests__/error-reporter.test.ts`'s Sentry-source-drift guard) that builds an explicit cwd-anchored file path to an installed package's source file (`readFile` on a path derived from `import.meta.resolve` or similar, anchored to `process.cwd()`) rather than using an ordinary import — that ENOENT'd in the worktree but passed cleanly when the identical test was run from the main checkout.

**RESOLVED at the hook level (2026-07-19, same branch as the `.worktrees/` widening):** `worktree-deps.sh` now treats an existing `node_modules` that contains ONLY dot-entries as tool-cache noise — no resolvable package can live at a hidden name — and replaces it with the shared symlink; any directory with a non-hidden entry is treated as a real install and never touched. A third case exists since PR #672: a `node_modules` the probe cannot inspect at all (restrictive permissions, root-owned residue — the noise classification is gated on `find`'s own exit status) is left alone entirely, with a `worktree-deps: cannot inspect ...` notice on stdout — so if a permission-damaged `node_modules` persists, that is deliberate; fix the permissions and re-run the hook. All three cases are covered in `test-worktree-deps.sh`. The manual `ln -sf` recovery below remains relevant only for worktrees outside the two harness-managed roots.

A third confirmed counter-case, distinct from the first two: `worktree-deps.sh`'s trigger registration (`SessionStart` + `PostToolUse:EnterWorktree` only) means even a worktree living squarely under one of its two covered path roots (`.claude/worktrees/*`, and `.worktrees/*` as of `P3-2026-07-18-worktree-deps-provisioning-scope`) gets skipped if it's created via a plain Bash `git worktree add` mid-session — neither trigger fires (`SessionStart` already ran; `EnterWorktree` was never invoked). The `/audit` skill hits this on every run: Phase 1 step 3 creates `.worktrees/audit-YYYY-MM-DD` with raw `git worktree add` + `cd`. The fix is neither a manual `ln -s` nor a predicate change — it's an **explicit invocation of the hook itself** right after entering the new worktree, before any toolchain command runs:

```bash
bash .claude/hooks/worktree-deps.sh
```

Because the hook enumerates worktrees via `git worktree list --porcelain` rather than acting only on its own trigger payload, invoking it from inside the new worktree (or from anywhere in the repo) symlinks it correctly — the trigger and the mechanism are decoupled, so an explicit call is a legitimate substitute for a missed trigger, not a workaround-of-a-workaround.

A fourth confirmed counter-case, same day as the "RESOLVED at the hook level" note above: a `todo-executor` dispatched via `Agent(isolation:"worktree")` — the exact mechanism the `## Exceptions` intro claims "symlink node_modules automatically" — still had `node_modules` containing only `.vite/` (zero real packages) when it reached Step 5b's verification (`npm run test:run` ENOENT'd on the identical `error-reporter.test.ts` path). The PR #669 cache-noise fix inside `worktree-deps.sh` is not in question here — the hook's trigger simply never fired for this dispatch, the same root cause as the third counter-case, just via a different creation path (the harness's own `isolation:"worktree"` machinery instead of a skill's raw `git worktree add`). Whether `PostToolUse:EnterWorktree` fires reliably for every `Agent(isolation:"worktree")` dispatch remains unverified in practice — treat the "Exceptions" claim as aspirational, not guaranteed, and self-heal defensively: **any executor/agent operating inside a freshly dispatched `isolation:"worktree"` worktree should run `bash .claude/hooks/worktree-deps.sh` once, near the start, before trusting `npm run test:run`/`check:types`/`lint` output** — the same explicit-invocation fix as the third counter-case, just applied proactively instead of reactively. The `rm -rf` + symlink is idempotent and near-instant, so running it unconditionally costs nothing even when provisioning already succeeded.

## Related Files

- `.husky/post-checkout` — the symlink list that doesn't include `node_modules`
- `.claude/hooks/worktree-deps.sh` — the node_modules-symlinking hook itself; its path predicate covers `.claude/worktrees/*` and `.worktrees/*`, but it only *fires* on `SessionStart`/`PostToolUse:EnterWorktree`, not on a Bash-invoked `git worktree add`
- `.claude/skills/todo-fast/SKILL.md` — Phase 1, the shared-worktree creation block: `ln -sf "$MAIN_CHECKOUT/node_modules" "$WORKTREE/node_modules"` immediately after `git worktree add`, with an inline comment citing this file
- `.claude/skills/audit/SKILL.md` — Phase 1 step 3, the third counter-case's fix: `bash .claude/hooks/worktree-deps.sh` invoked explicitly right after entering the new `.worktrees/audit-YYYY-MM-DD` worktree
- `server/lib/__tests__/error-reporter.test.ts` — the concrete cwd-anchored-path test that surfaces this artifact; passes from the main checkout, ENOENTs in an under-provisioned worktree

## See Also

- [Isolate into worktree when concurrent-session guard warns](isolate-into-worktree-when-concurrent-session-guard-warns-2026-06-27.md)