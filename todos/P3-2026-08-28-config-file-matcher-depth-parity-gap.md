---
title: "config-file Matcher: TS regex is root-anchored, generated bash form is not"
status: backlog
priority: low
created: 2026-08-28
updated: 2026-08-28
assignee:
labels: [deferred, harness]
github_issue:
---

# config-file Matcher: TS regex is root-anchored, generated bash form is not

## Summary

`scripts/lib/path-domains.ts`'s `config-file` `Matcher` kind compiles to a root-anchored TS
regex (`^(basename\.[^/]+|...)$`) but a non-root-anchored bash glob (`*/basename.*`,
`basename.*`, both of which match at any depth). A path like `some/nested/dir/package.json`
routes via the generated `domain-map.sh` but NOT via `rulesDomainsForPath` — the two disagree.

## Background

Found while implementing `todos/archive/P3-2026-08-11-unrouted-surfaces-domain-map-decision.md`
(routing `package.json`/`package-lock.json`/`app.json` to `architecture`). The gap is not new —
it's been latent since the existing `vitest.config.*`/`eslint.config.*` config-file rule — just
never exercised by a nested-path entry in `PARITY_CORPUS` (`scripts/lib/__tests__/path-domains.test.ts`)
before now. Deliberately not fixed as part of that todo (out of its Scope Contract).

Practical impact is low: same accepted over-match class as the `scripts/**`/`ios/**` recursive-dir
rules (a nested config file picks up an extra domain injection in the _shell_ hook path that the
TS function wouldn't grant) — benign noise, not a missed-injection correctness bug in the more
commonly-used direction.

## Acceptance Criteria

- [x] ~~Add a `PARITY_CORPUS` entry exercising a nested path~~ — done as part of landing the
      routing todo this was filed from: `client/lib/package.json` and `assets/app.json` are now
      in `PARITY_CORPUS`, guarded by an explicit `isConfigFileDepthMismatch` allowance clause in
      the parity test (mirroring the existing `isTestExcludingServerDir` clause) — a code
      reviewer flagged that the original comment-only exclusion was an unguarded silent-gap risk
      (the next person to add a nested corpus path would have hit an unexplained failure). The
      underlying asymmetry itself is still live; this only closes the "regression goes uncaught"
      risk.
- [ ] Decide: root-anchor the bash form too (`compileToBashConditions`'s `config-file` case,
      dropping the `*/${b}.*` leading-wildcard variant), OR relax the TS regex to also match at
      depth (`(^|/)^...`), OR accept and document the asymmetry permanently (already partially
      done — the rule's own description in `path-domains.ts` and the `PARITY_CORPUS` comment
      both point here now)
- [ ] If a behavior change is made: update/remove the `isConfigFileDepthMismatch` allowance
      clause and the two nested `PARITY_CORPUS` entries accordingly
- [ ] Regenerate `domain-map.sh` + `copilot-instructions.md` if the bash form changes

## Implementation Notes

- `compileToRegExp`'s `config-file` case: `scripts/lib/path-domains.ts`
- `compileToBashConditions`'s `config-file` case: same file
- Mechanism precedent: this is the same class of TS/bash asymmetry already accepted and pinned
  for `TS_TEST_EXCLUDING_DIRS` (`server/routes`/`server/storage` test-file exclusion) — a
  documented, deliberate divergence is an acceptable resolution here too.

## Scope Contract

- **Mechanisms to use:** `scripts/lib/path-domains.ts`'s existing `Matcher` compile functions —
  nothing new
- **Files in scope:** `scripts/lib/path-domains.ts`, `scripts/lib/__tests__/path-domains.test.ts`,
  generated `domain-map.sh` (only if the bash form changes)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Low — the current behavior is a narrow over-match in the shell/hook direction only, not a
  missed-injection in the direction that matters for `rulesDomainsForPath` (TS) consumers.

## Updates

### 2026-08-28

- Filed while implementing `todos/archive/P3-2026-08-11-unrouted-surfaces-domain-map-decision.md`
  (the package-manifest routing surfaced this pre-existing gap; not in that todo's scope to fix).
