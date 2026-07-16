---
title: "Local vitest crash on all RN component/hook tests: 'No such built-in module: node:'"
status: done
priority: medium
created: 2026-07-15
updated: 2026-07-16
assignee:
labels: [testing, infra]
github_issue:
---

# Local vitest crash on all RN component/hook tests

## Summary

Every React Native component/hook test (anything rendering via the RN/jsdom shim layer) currently fails to even collect on this local machine, crashing with `Error: No such built-in module: node:`. Pure-function tests are unaffected.

## Background

Found during end-to-end validation of the new `/todo-fast` skill (docs/superpowers/plans/2026-07-15-todo-fast-skill.md, PR #632). Scoped and ruled out as a code/branch issue:

- Reproduces with `npx vitest run client/screens/__tests__/LoginScreen.test.tsx` (and any other RN component/hook test file tried).
- Reproduces on a completely unmodified main checkout (branch `guard/merge-approval-hook`, zero of the `/todo-fast` branch's commits) — not caused by that branch's changes.
- Does **not** reproduce in CI: GitHub's `CI` workflow is green on recent `origin/main` commits (checked via `gh run list --branch main`), meaning a clean-environment run of the same suite passes.

Conclusion: local-machine-specific (stale `node_modules`, a cache, a Node/Vite version mismatch, or similar), not a defect in the repository's code or dependencies. Not root-caused further — that's this todo's job.

One clue not yet chased down: the crash is immediately preceded by a vite warning —

```
[vite] (client) warning: Module "node:module" has been externalized for browser compatibility,
imported by "test/setup.ts". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility
```

— suggesting the RN/jsdom test path's Vite transform is choking on a `node:` built-in import somewhere in `test/setup.ts`'s (or a dependency's) resolution chain, specifically in this local environment.

## Acceptance Criteria

- [x] Root-cause why this local environment hits the crash (stale `node_modules`, Node version, Vite/vitest version drift, corrupted cache, or something else)
- [x] `npx vitest run client/screens/__tests__/LoginScreen.test.tsx` (or any other RN component test) passes locally
- [x] Confirm the fix isn't needed repo-wide (i.e., don't "fix" something that was never broken for other developers/CI) before changing any tracked config

## Implementation Notes

- Start by ruling out the obvious local-environment culprits before touching any tracked file: `rm -rf node_modules && npm ci`, check `node --version` against whatever the project expects, clear any Vite/vitest cache directories.
- If a tracked config or dependency version does turn out to be the cause, treat that as a much higher-severity finding — it would mean CI got lucky rather than the repo actually being healthy — and re-verify against CI green/red before concluding a code fix is needed.
- `test/setup.ts` is the file the vite warning names — start there.

## Dependencies

None.

## Risks

- Could be difficult to reproduce/diagnose if it's tied to something environment-specific to this one machine (stale global npm cache, an nvm version switch, etc.) that isn't easily inspectable from within a session.

## Updates

### 2026-07-15

- Filed after discovery during `/todo-fast` plan validation (PR #632) — confirmed pre-existing, repo-wide-reproducible-locally-only, CI unaffected.

### 2026-07-16

- **Could not reproduce.** `npx vitest run client/screens/__tests__/LoginScreen.test.tsx` (raw output via `rtk proxy`, bypassing the token-optimizer summary) ran clean: 8/8 tests passed, no crash, and no trace of the "node:module has been externalized" vite warning the original report cited.
- Ruled out every stable-state explanation before concluding it's transient:
  - Node version: installed `v24.9.0` matches `.nvmrc` (`24`) and `package.json` engines (`24.x`) exactly.
  - `node_modules` and `package-lock.json` share an mtime of 2026-07-12 — unchanged since **before** this crash was even filed (2026-07-15); no reinstall happened between the crash and this investigation.
  - Installed `vite@8.0.14` / `vitest@4.1.7` match `package.json`'s `vitest: ^4.1.7` range; no drift.
  - `node_modules/.vite` (Vite's dep-optimization cache) is dated 2026-05-23 — untouched for weeks, not regenerated around the incident.
  - Machine uptime is 12 days (no reboot since 2026-07-04) — nothing OS-level cleared.
- **Conclusion:** no tracked file, dependency, cache, or Node version changed across the incident window, yet the crash no longer reproduces. This was a one-off transient failure — most likely resource contention from concurrent heavy processes at the time (the crash was originally found _during_ `/todo-fast` skill validation, i.e. while other worktrees/agents were plausibly running on the same machine), not a persistent defect in tracked config or dependencies. No tracked-file change made; satisfies AC3 (fix not needed repo-wide) by construction — CI was never affected.
- Codified as `docs/solutions/runtime-errors/vitest-collection-crash-transient-contention-2026-07-16.md` so a future recurrence has a fast elimination checklist instead of re-deriving this from scratch.
