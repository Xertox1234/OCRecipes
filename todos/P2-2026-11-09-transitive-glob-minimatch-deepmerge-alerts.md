---
title: "Clear the transitive glob / minimatch / deepmerge Dependabot alerts"
status: backlog
priority: medium
created: 2026-11-09
updated: 2026-11-09
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

- [ ] `npm explain` traced for every installed minimatch and glob in the vulnerable range (10.2.6 and 13.0.6 were not traced at filing time)
- [ ] Overrides (or upstream bumps) put every minimatch at >=11.0.1 and glob at >=14.0.2, OR a written reason why a given consumer can't take the major
- [ ] Metro / babel module-resolution still works after any override (the `@/` and `@shared/` aliases resolve; app bundles)
- [ ] deepmerge: re-check for a patched release; if none, record it as accepted-risk in the PR body (no patched version exists as of 2026-11-09)
- [ ] Dependabot alerts tab shows the cleared alerts closed after merge

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
