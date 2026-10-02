---
title: "vitest.integration.config.ts and vitest.mutation.config.ts still trigger Vite's native-config-loader warning"
status: done
priority: low
created: 2026-09-24
updated: 2026-10-02
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

- [x] `vitest.integration.config.ts` and `vitest.mutation.config.ts` are renamed to `.mts` and
      `npm run test:integration:http` / the mutation config load without the warning
- [x] Every reference is updated: `package.json` scripts (`--config vitest.integration.config.ts`),
      `stryker.conf.mjs` and `stryker.explore.conf.mjs` (`configFile`),
      the `grep -qE` path filters in `.github/workflows/mutation-goal-safety.yml` and
      `mutation-non-excluded.yml` (written regex-escaped as `vitest\.mutation\.config\.ts`, so a
      literal grep misses them) — sweep with `git grep -nP` (not `-E`: `\b` silently matches
      nothing under `-E` on this git), using a pattern that tolerates the escaping, e.g.
      `vitest\\?\.(integration|mutation)\\?\.config\\?\.ts`
- [x] CI's mutation and integration jobs still run
- [x] While here: three comments in `scripts/__tests__/coverage-ratchet.test.ts` still call the
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

### 2026-10-02

- Renamed `vitest.integration.config.ts` and `vitest.mutation.config.ts` to `.mts` (`git mv`). Nothing
  else in the configs' code needed changing: both already import `./vitest.config.mts` with the extension
  and neither uses `__dirname`, and #1039 had already put `**/*.mts` in `tsconfig.json`, the `.mts`
  parser block in `eslint.config.js`, and `mts` in the lint-staged and format globs and the preflight
  pathspec.
- References moved with them, swept with `git grep -nP 'vitest\\?\.(integration|mutation)\\?\.config\\?\.ts'`
  (22 hits across 3957 tracked files before, 0 after, excluding `todos/` and the migration doc's own
  history sentence): the `test:integration:http` script, `stryker.conf.mjs` (plus one comment),
  `stryker.explore.conf.mjs`, the regex-escaped path filters in `mutation-goal-safety.yml` and
  `mutation-non-excluded.yml`, a comment in `vitest.integration.config.mts`, `test/integration/README.md`,
  and the three `docs/solutions` docs that name the files (`applies_to`, prose, code samples). The three
  "real vitest.config.ts" comments in `coverage-ratchet.test.ts` now say `.mts`; its
  `path.join(dir, "vitest.config.ts")` temp-dir fixtures are untouched.
- Verified, each with a denominator: `vitest list --config <cfg>` printed one native-loader warning block
  (`(!) Your Vite config uses features …`) per config before and none after, with 6 (integration) and 17
  (mutation) tests still listed; `npm run test:integration:http` passes against the real DB (6 tests);
  `stryker run --dryRunOnly` passes through both `stryker.conf.mjs` and `stryker.explore.conf.mjs`
  (`Ran 17 tests`, no warning);
  `npm run test:run` (605 files, 9916 tests) and `check:types` pass, and `lint` reports 0 errors (5 warnings
  in four files this change does not touch). Criterion 3's CI half is evidenced by running each job's own
  command locally; the PR's checks are the final word, and `integration-http` is advisory (not a required
  check), so its result has to be read, not assumed.
- The workflow regex update is load-bearing but this PR's own CI cannot show it. Probed in bash with a
  positive and a negative control, the OLD regex still fires on this PR's whole changed-file list (the PR
  also edits `stryker.conf.mjs`, which another alternative of the same regex matches) but does NOT fire on
  `vitest.mutation.config.mts` alone, which the new regex does. A rename-only PR, or the next edit to the
  renamed file, would have self-scoped both required gates to green without running Stryker.
- Review: one `code-reviewer` pass, no blocking findings. Its one WARNING is reported, not fixed (outside
  the Scope Contract): `.mts` paths are not covered by the `typescript` fallback in
  `.claude/hooks/inject-patterns.sh` and `scripts/lib/path-domains.ts`, so the two renamed configs no
  longer receive pattern injection when edited (measured by running the real hook: about 4.9 KB of rules
  and solutions for the `.ts` spelling, about 1.2 KB of preamble only for `.mts`). It likely belongs in
  `docs/harness-residuals.md`, which this todo did not touch. Also noted: `vitest.config.ts` (the base
  config's pre-#1039 name) still appears in 22 `docs/solutions` files and one client test comment.
- Codified: extended `docs/solutions/best-practices/vite-native-config-loader-mts-migration-2026-09-23.md`
  with the CI-gate regex and routing checklist items and a verification recipe.
