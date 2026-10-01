---
title: "vitest.integration.config.ts and vitest.mutation.config.ts still trigger Vite's native-config-loader warning"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, testing]
github_issue:
---

# Rename the two sibling Vitest configs to .mts

## Summary

PR #1039 renamed `vitest.config.ts` to `.mts` to silence Vite 8.3's native-config-loader warning.
The two sibling configs still use ESM syntax in a `.ts` file, so they print the same warning.

## Background

Vite's check flags ESM syntax loaded as CommonJS first, then `__dirname`/extensionless imports.
The full checklist is in
`docs/solutions/best-practices/vite-native-config-loader-mts-migration-2026-09-23.md`.

## Acceptance Criteria

- [ ] `vitest.integration.config.ts` and `vitest.mutation.config.ts` are renamed to `.mts` and
      `npm run test:integration:http` / the mutation config load without the warning
- [ ] Every reference is updated: `package.json` scripts (`--config vitest.integration.config.ts`),
      `stryker.conf.mjs` and `stryker.explore.conf.mjs` (`configFile`),
      the `grep -qE` path filters in `.github/workflows/mutation-goal-safety.yml` and
      `mutation-non-excluded.yml` (written regex-escaped as `vitest\.mutation\.config\.ts`, so a
      literal grep misses them) — sweep with `git grep -nP` (not `-E`: `\b` silently matches
      nothing under `-E` on this git), using a pattern that tolerates the escaping, e.g.
      `vitest\\?\.(integration|mutation)\\?\.config\\?\.ts`
- [ ] CI's mutation and integration jobs still run
- [ ] While here: three comments in `scripts/__tests__/coverage-ratchet.test.ts` still call the
      production config "the real vitest.config.ts" (found by #1039's final review) — change them
      to `.mts`, leaving that file's `path.join(dir, "vitest.config.ts")` temp-dir fixtures alone

## Implementation Notes

- Follow the solution doc's checklist; `.claude/hooks/**` is frozen (log any hook reference to
  `docs/harness-residuals.md`).

## Scope Contract

- **Mechanisms to use:** the same rename pattern as #1039, plus a comment-only edit in
  `scripts/__tests__/coverage-ratchet.test.ts`.
- **Files in scope:** the two configs, every file that references them, and
  `scripts/__tests__/coverage-ratchet.test.ts` (comments only).
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from PR #1039's deferred warning.
