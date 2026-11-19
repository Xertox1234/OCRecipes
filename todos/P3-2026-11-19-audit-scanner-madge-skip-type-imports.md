---
title: "Make the audit scanner's madge run skip type-only imports"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, tooling, audit]
github_issue:
---

# Make the audit scanner's madge run skip type-only imports

## Summary

`scripts/audit-scanners.ts` runs plain `madge --circular`, which counts `import type` edges, so every maintainability audit reports 100+ cycles that triage then rules type-only by hand. Run it with `skipTypeImports` so the rows are runtime cycles only.

## Background

2026-11-19 maintainability audit: madge reported 117 cycles; with `detectiveOptions.{ts,tsx}.skipTypeImports=true` it reported 0. The 2026-09-23 and 2026-10-25 audits made the same type-only ruling. See `docs/solutions/best-practices/madge-counts-type-only-imports-use-skip-type-imports-2026-11-19.md`.

## Acceptance Criteria

- [ ] The scanner's madge call skips type-only imports (madge 8 reads `.madgerc` from cwd — pass the config without leaving a file in the repo, e.g. a temp cwd or madge's JS API)
- [ ] A test pins that a type-only cycle is not reported and a value cycle still is (both as fixtures)
- [ ] The row's Verification re-run command matches what the scanner actually runs
- [ ] Fail-open behaviour unchanged (a madge failure is still `skipped — <reason>`, never a clean zero)

## Implementation Notes

- File: `scripts/audit-scanners.ts` (madge block near `:564`), its test under `scripts/__tests__/`.
- Keep `NPX_PINS.madge` pinned.

## Scope Contract

- **Mechanisms to use:** madge's own `detectiveOptions.skipTypeImports` — nothing new.
- **Files in scope:** `scripts/audit-scanners.ts`, `scripts/__tests__/audit-scanners*.test.ts`, test fixtures it needs
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- A config that silently fails to apply would turn real cycles into a false zero — the value-cycle fixture is the control.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit codification.
