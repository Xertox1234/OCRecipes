---
title: "Clear the transitive glob / minimatch / deepmerge Dependabot alerts"
status: done
priority: medium
created: 2026-11-09
updated: 2026-11-12
assignee:
labels: [deferred, security]
github_issue:
---

# Clear the transitive glob / minimatch / deepmerge Dependabot alerts

## Summary

Three open Dependabot alerts on `main` sit in transitive dependencies that the
2026-11-09 patch/minor dependency refresh did not touch. Each needs an
`overrides` floor (or an upstream bump), not a direct-dependency update.

## Background

Found while fixing the stale Dependabot `expo` boundary (PR #1814). Dependabot
listed 4 open alerts on 2026-11-09; the fourth (zod, High) is a separate owner
decision and is NOT in this todo. Deferred because the dependency-refresh PRs
were scoped to in-range bumps; these cross majors.

| Alert                                       | Severity | Vulnerable range | Patched | Installed (2026-11-09)                     | Pulled in by                                         |
| ------------------------------------------- | -------- | ---------------- | ------- | ------------------------------------------ | ---------------------------------------------------- |
| minimatch — DoS via globparts amplification | medium   | >=7.0.0 <11.0.1  | 11.0.1  | 8.0.7, 10.2.6 (3.1.5 is outside the range) | 8.0.7: glob 9 ← `babel-plugin-module-resolver` (dev) |
| glob — AbortSignal cancellation bypass      | medium   | >=9.0.0 <=14.0.1 | 14.0.2  | 9.3.5, 13.0.6                              | 9.3.5: `babel-plugin-module-resolver` (dev)          |
| deepmerge — mergeObject prototype poisoning | low      | >=4.2.0 <=4.3.1  | none    | 4.3.1                                      | `expo` / `babel-preset-expo`                         |

Exposure is build-time / dev tooling, not the server request path, which is
why this is medium rather than high.

## Acceptance Criteria

- [x] `npm explain` traced for every installed minimatch and glob in the vulnerable range (10.2.6 and 13.0.6 were not traced at filing time)
- [x] Overrides (or upstream bumps) put every minimatch at >=11.0.1 and glob at >=14.0.2, OR a written reason why a given consumer can't take the major
- [x] Metro / babel module-resolution still works after any override (the `@/` and `@shared/` aliases resolve; app bundles)
- [x] deepmerge: re-check for a patched release; if none, record it as accepted-risk in the PR body (no patched version exists as of 2026-11-09)
- [x] Dependabot alerts tab shows the cleared alerts closed after merge

## Implementation Notes

- Overrides live in `package.json` → `overrides` (existing entries such as `brace-expansion@^1.0.0` show the scoped-override style for multi-major trees).
- glob 9 → 14 and minimatch 8 → 11 are majors: scope the override to the consumer (e.g. `"babel-plugin-module-resolver": { "glob": "..." }`) and check that consumer's API use.
- Dependabot's own security PR can't do this: the fixes cross majors in transitive trees.

## Scope Contract

- **Mechanisms to use:** `package.json` `overrides` — nothing new
- **Files in scope:** `package.json`, `package-lock.json`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A forced glob/minimatch major under babel-plugin-module-resolver could break alias resolution at bundle time — CI has no native build, so check the bundle locally.

## Updates

### 2026-11-09

- Initial creation (auto-filed from the Dependabot-boundary / dependency-refresh session)

### 2026-11-12

- Implemented. Traced (from package-lock) every glob/minimatch: glob 9.3.5 (babel-plugin-module-resolver, dev), glob 13.0.6/13.0.7 (@expo/cli, @expo/fingerprint, expo, @sentry/bundler-plugins), minimatch 8.0.7 (under glob 9), minimatch 10.2.6 (eslint/typescript-estree/stryker/ts-morph/expo). minimatch 3.1.5 is outside the vulnerable range and left alone.
- Added scoped overrides `glob@^9.0.0` and `glob@^13.0.0` -> `^14.0.2`, `minimatch@^8.0.0` and `minimatch@^10.0.0` -> `^11.0.1`. Lock now has glob 14.0.6 and minimatch 11.0.8 only (plus out-of-range 3.1.5).
- Verified in a scratch `npm ci` of the new lockfile: `expo export --platform ios` bundles (Hermes bytecode produced) and eslint runs.
- deepmerge: latest on npm is 4.3.1, still inside the vulnerable range, no patched release. Accepted risk (build-time only, via expo / babel-preset-expo).
- Dependabot alerts close only after merge; confirm on the alerts tab.
