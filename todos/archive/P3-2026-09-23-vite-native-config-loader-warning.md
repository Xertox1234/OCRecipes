---
title: "Vite 8.3 warns vitest.config.ts is unsupported by the future native config loader"
status: done
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, testing]
github_issue:
---

# Vite 8.3 warns vitest.config.ts is unsupported by the future native config loader

## Summary

Since #1033 (vitest 4.1.7 → 4.1.11, which hoisted vite 8.0.14 → 8.3.0), every `vitest run` prints: "Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite". It names `vitest.config.ts` and `scripts/pg-lab/vitest-flake-reporter.ts`, which are loaded as CommonJS despite their ESM syntax.

## Background

Raised by #1033's review, which reproduced it: the warning is absent on vite 8.0.14 and present on 8.3.0. Nothing is broken today and all tests pass. But a future Vite major that makes the native loader the default will need these files converted, and the warning adds noise to every test run until then.

## Acceptance Criteria

- [x] `vitest.config.ts` and `scripts/pg-lab/vitest-flake-reporter.ts` load under the native config loader (e.g. rename to `.mts`, or otherwise make them ESM), and the warning no longer prints.
- [x] `npm run test:run` and the CI test shards still pass. `preflight:fast` still finds related tests.
- [x] Do NOT just set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true`; that hides the signal without fixing the loader incompatibility.

## Implementation Notes

- Check every reference to these paths before renaming: `package.json` scripts, CI workflows and preflight scripts.

## Updates

### 2026-09-23

- Filed from #1033 review.
- Implemented: renamed `vitest.config.ts` → `vitest.config.mts` and
  `scripts/pg-lab/vitest-flake-reporter.ts` → `.mts`. Root-caused via
  `node_modules/vite`'s own compat-check source (not guessed): once a file is
  ESM, Vite's native-loader check ALSO flags `__dirname` usage and
  extensionless relative imports — both fixed (`import.meta.dirname` in the
  `resolve.alias` block; explicit `.mts` specifiers on every import of the
  renamed files, including the two sibling configs that import
  `./vitest.config` and intentionally stay `.ts`).
  Mechanically-required companion edits: `tsconfig.json` (`**/*.mts` in
  `include`, `allowImportingTsExtensions`), `tsconfig.check.json` (stale
  exclude literal), `eslint.config.js` (eslint-config-expo's TS parser block
  doesn't cover `.mts` — added a parser block + widened the type-aware
  async-safety glob), `package.json` (lint-staged + format globs),
  `scripts/preflight.sh` (changed-file pathspec — AC #2's "preflight:fast
  still finds related tests", measured with
  `scripts/preflight.sh --fast --uncommitted`), `scripts/coverage-ratchet.ts`
  - its test (load-bearing `DEFAULT_CONFIG` path).
    Verified: warning gone (before/after capture), `npm run test:run` (541
    files / 8599 tests), `npm run check:types`, `npm run lint`,
    `bash scripts/run-hook-tests.sh` (38/38) all clean.
    `vitest.integration.config.ts`/`vitest.mutation.config.ts` have the same
    underlying ESM-in-CJS issue and independently still print the warning —
    out of this todo's stated scope (only the two named files), surfaced as a
    `DEFERRED_WARNINGS` line rather than fixed here or filed as a new todo.
    Codified: `docs/solutions/best-practices/vite-native-config-loader-mts-migration-2026-09-23.md`.
    Also logged an unrelated, pre-existing hook-test self-isolation gap found
    while verifying (`PREFLIGHT_VERBOSE` leaking into a nested `preflight.sh`
    invocation inside `.claude/hooks/test-preflight-output.sh`) to
    `docs/harness-residuals.md` per the frozen-harness policy — never fires
    under the documented Step 5a invocation or in CI.
