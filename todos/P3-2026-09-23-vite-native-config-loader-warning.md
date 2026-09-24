---
title: "Vite 8.3 warns vitest.config.ts is unsupported by the future native config loader"
status: in-progress
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

- [ ] `vitest.config.ts` and `scripts/pg-lab/vitest-flake-reporter.ts` load under the native config loader (e.g. rename to `.mts`, or otherwise make them ESM), and the warning no longer prints.
- [ ] `npm run test:run` and the CI test shards still pass. `preflight:fast` still finds related tests.
- [ ] Do NOT just set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true`; that hides the signal without fixing the loader incompatibility.

## Implementation Notes

- Check every reference to these paths before renaming: `package.json` scripts, CI workflows and preflight scripts.

## Updates

### 2026-09-23

- Filed from #1033 review.
