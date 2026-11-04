---
title: "Sentry drift-guard test hard-codes a node_modules path, so it fails in every agent worktree"
status: backlog
priority: low
created: 2026-11-03
updated: 2026-11-03
assignee:
labels: [deferred, testing]
github_issue:
---

# Sentry drift-guard test hard-codes a node_modules path

## Summary

The `SENSITIVE_HEADER_SNIPPETS drift guard` test in `server/lib/__tests__/error-reporter.test.ts` reads `@sentry/core`'s `filtering-snippets.js` through `new URL("../../../node_modules/@sentry/node/node_modules/@sentry/core/...", import.meta.url)`. That path is relative to the test file, so in an agent worktree (whose `node_modules` is near-empty and relies on module resolution climbing to the main checkout) it throws ENOENT, and the pre-push gate blocks any push that touches the error reporter.

## Background

Hit on 2026-11-03 while reviving #1627: `preflight:fast` failed with `ENOENT ... .claude/worktrees/revive-1627/node_modules/@sentry/node/node_modules/@sentry/core/build/cjs/utils/data-collection/filtering-snippets.js`. The main checkout has the file. The workaround was a temporary `node_modules/@sentry` symlink in the throwaway worktree. CI is unaffected (fresh `npm ci`). Deferred: low severity, outside that PR's scope.

## Acceptance Criteria

- [ ] The test locates the installed file through Node module resolution (e.g. `createRequire(import.meta.url).resolve("@sentry/core/package.json", { paths: [<@sentry/node's dir>] })`, then join the build path) instead of a hard-coded relative path
- [ ] It still reads the copy `@sentry/node` actually uses (the nested one when present), so the drift guard keeps its meaning
- [ ] It passes from an agent worktree with no local `node_modules/@sentry`, and in CI

## Implementation Notes

- Only `server/lib/__tests__/error-reporter.test.ts` changes. `"@sentry/node"` is aliased to `test/mocks/sentry-node.ts` in Vitest, so resolve by package path, not by importing it.

## Scope Contract

- **Mechanisms to use:** Node's `createRequire` / `require.resolve` — nothing new
- **Files in scope:** `server/lib/__tests__/error-reporter.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-03

- Filed during the #1627 revive.
