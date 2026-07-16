---
title: "A vitest RN-component collection crash ('No such built-in module: node:') may be transient contention, not a regression"
track: bug
category: runtime-errors
module: client
severity: low
tags: [testing, vitest, vite, flake, diagnosis]
symptoms: ["Every RN component/hook test fails to collect with a 'No such built-in module' error", "A vite warning about node:module being externalized for browser compatibility appears immediately before the crash", "Pure-function (non-component) tests are unaffected", "CI is green on the same commit while it crashes locally"]
created: '2026-07-16'
---

# A vitest RN-component collection crash ("No such built-in module: node:") may be transient contention, not a regression

## Problem

`npx vitest run <any RN component/hook test file>` (the jsdom-environment path — see `test/setup.ts`) crashed at collection time with `Error: No such built-in module: node:`, immediately preceded by a vite warning that `test/setup.ts`'s `node:module` import "has been externalized for browser compatibility." Pure-function tests (no jsdom, no RN shim) were unaffected. CI was green on the same commit the whole time.

## Symptoms

- Every RN component/hook test crashes at collection, not at a specific assertion.
- The vite warning naming `node:module`/`test/setup.ts` appears right before the crash.
- Pure-function tests pass; only the jsdom/RN-shim path is affected.
- CI (`gh run list --branch main`) is green for the exact commit that crashes locally — ruling out a real repo-wide defect.

## Root Cause

Undetermined — and that's the point of this entry. When investigated a day later, the crash **did not reproduce at all**: raw `vitest run` output (bypass any output-summarizing wrapper — `rtk proxy "npx vitest run <file>"` here) showed 8/8 tests passing cleanly, with no crash and no trace of the vite warning.

Before concluding "transient," every stable-state explanation was checked and ruled out — none had changed across the incident window:

1. **Node version** — `node --version` vs `.nvmrc` and `package.json` `engines.node`. Match exactly (both `24.x`, installed `v24.9.0`) → not a version drift.
2. **`node_modules` / lockfile staleness** — `stat -f "%Sm" node_modules package-lock.json`. Both shared one mtime, dated *before* the crash was even reported → no reinstall happened in between, so a stale-`node_modules` fix would have nothing to fix.
3. **Vite/vitest version drift** — `npm ls vite vitest` vs the `package.json` semver range. Installed versions matched the declared range exactly.
4. **Vite's dependency-optimization cache** (`node_modules/.vite`) — its mtime was weeks old, untouched around the incident.
5. **Machine uptime** — `uptime`. No reboot near the incident, so an OS-level cache clear isn't the explanation either.

With all five levers unchanged yet the crash gone, the most plausible explanation is **transient resource contention** from concurrent heavy processes on the machine at the exact moment of the original run (this crash was first observed *during* a multi-agent skill-validation session — i.e., while other worktrees/processes were plausibly running concurrently) — not a persistent defect in tracked config, dependencies, or Node version.

This is a **different phenomenon** from the CPU-contention flakiness already documented for the full test-run (`retry: 2` in `vitest.config.ts`, resolved 2026-05-23): that one is a probabilistic **per-test** flake under full-suite parallel load, reliably reproducible and absorbed by retries. This one is a hard **collection-time crash** on a single targeted file — not reproducible even once on a clean re-run.

## Solution

There is no code fix — the crash could not be reproduced, so there is nothing to patch. The "solution" is the elimination checklist above, run in order, before spending more time on it:

1. Reproduce the crash with **raw** tool output — a token-optimizing wrapper (e.g. `rtk`) may summarize a failing collection into a terse status line that hides whether it's really the same crash. Use `rtk proxy "npx vitest run <file>"` (or the equivalent raw-passthrough for your tool) to see the actual stack trace and vite warnings.
2. If it does **not** reproduce, run through the checklist (Node version vs `.nvmrc`/`engines`, `node_modules`+lockfile mtime vs incident date, installed vite/vitest vs `package.json` range, `node_modules/.vite` mtime, machine uptime).
3. If none of those show a change across the incident window, treat it as transient contention: document the finding (root cause + elimination checklist) and move on. Do **not** preemptively touch tracked config, `package.json`, or `test/setup.ts` for a crash you can no longer observe — that risks "fixing" something that was never broken for anyone else (CI never saw it).
4. If the checklist instead surfaces a real divergence (e.g., installed version doesn't match the lockfile, or Node version doesn't match `.nvmrc`), that IS the root cause — treat it as a much higher-severity finding (a tracked-config/dependency problem, not a local quirk) and re-verify against CI green/red before deciding a code fix is needed.

## Prevention

- When a crash is reported as "was there yesterday, can't tell today," always re-run with raw tool output before assuming it's fixed or still broken — a summarizing wrapper can mask the actual signal in either direction.
- Keep the five-point elimination checklist as the fast triage path for any "local-only, CI-unaffected" test-collection crash before spending time on a deeper investigation.

## Related Files

- `test/setup.ts` — the file the vite `node:module` externalization warning names.
- `vitest.config.ts` — global `environment: "node"`; RN component tests opt into jsdom via a per-file `// @vitest-environment jsdom` pragma.
- `todos/archive/P2-2026-07-15-local-vitest-rn-component-crash.md` — the investigation this entry was extracted from.

## See Also

- [A failed CI test shard may be a Docker Hub service-container pull timeout, not a test failure](../best-practices/ci-shard-failure-may-be-postgres-pull-timeout-not-test-flake-2026-06-25.md) — the sibling pattern for CI: a red check that doesn't mean the code regressed.
