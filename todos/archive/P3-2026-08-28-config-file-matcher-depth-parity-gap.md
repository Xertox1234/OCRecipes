---
title: "config-file Matcher: TS regex is root-anchored, generated bash form is not"
status: done
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
- [x] Decide: root-anchor the bash form too (`compileToBashConditions`'s `config-file` case,
      dropping the `*/${b}.*` leading-wildcard variant), OR relax the TS regex to also match at
      depth (`(^|/)^...`), OR **accept and document the asymmetry permanently** — chosen. Both
      behavior-changing fixes were considered and declined: root-anchoring the bash form is a
      generated-artifact change for a gap whose only practical effect is benign shell-side
      over-match noise (never a missed injection in the `rulesDomainsForPath`/TS direction that
      matters), and relaxing the TS regex would make `rulesDomainsForPath` start matching nested
      occurrences (e.g. under `node_modules/**`), which is the wrong direction entirely. The
      decision is recorded in
      `docs/solutions/code-quality/parity-test-comment-only-exclusion-is-unenforced-2026-08-28.md`
      → `## Decision record`, and both live-code comments (`path-domains.ts`'s config-file rule,
      `path-domains.test.ts`'s `isConfigFileDepthMismatch`) now state the asymmetry is
      permanently accepted rather than pointing at an open todo.
- [x] If a behavior change is made: update/remove the `isConfigFileDepthMismatch` allowance
      clause and the two nested `PARITY_CORPUS` entries accordingly — **N/A**, no behavior change
      was made; the clause and both corpus entries (`client/lib/package.json`, `assets/app.json`)
      are unchanged and remain correct under the "accept" decision.
- [x] Regenerate `domain-map.sh` + `copilot-instructions.md` if the bash form changes — **N/A**,
      the bash form is unchanged (only `//` comments were edited; the `description:` field that
      feeds the generators was left byte-identical, verified by `npm run build:generated:check`).

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

### 2026-08-28 (resolved)

- Decision made: accept and document the asymmetry permanently — no behavior change. Both
  alternative fixes (root-anchor the bash form; relax the TS regex to match at depth) were
  considered and declined; rationale recorded in
  `docs/solutions/code-quality/parity-test-comment-only-exclusion-is-unenforced-2026-08-28.md`.
  Updated the two live-code comments that previously pointed at this (now-closing) todo to
  instead state the asymmetry is permanently accepted, citing the solution doc. No follow-up
  todo filed — this decision-todo closes clean.
