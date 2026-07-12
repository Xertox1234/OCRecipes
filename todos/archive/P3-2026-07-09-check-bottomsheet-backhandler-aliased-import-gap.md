<!-- Filename: P3-2026-07-09-check-bottomsheet-backhandler-aliased-import-gap.md -->

---

title: "check-bottomsheet-backhandler.js misses BottomSheetModal usage under an aliased import"
status: done
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, tooling, code-quality]
github_issue:

---

# check-bottomsheet-backhandler.js misses BottomSheetModal usage under an aliased import

## Summary

The pre-commit/CI checker script `scripts/check-bottomsheet-backhandler.js` (added in PR #555 to
catch a future `BottomSheetModal` host that forgets to wire `useSheetBackHandler`) matches JSX on
the literal name `BottomSheetModal`. A component imported under an alias (e.g.
`import { BottomSheetModal as Sheet } from ...`) would render as `<Sheet ...>` and bypass
detection entirely — a fail-open false negative.

## Background

Filed as a deferred `code-reviewer` SUGGESTION from PR #555's code review (`/todo` run,
2026-07-09). This is documented in the script's own docstring as a known limitation, not fixed
inline, because no aliased import of `BottomSheetModal` exists anywhere in the codebase today —
the gap is latent, not a live miss.

## Acceptance Criteria

- [ ] Either resolve the actual imported local binding name for `BottomSheetModal` (parse the
      import specifier, including any `as` alias) before matching JSX usage against it, or add an
      explicit regression-test case that demonstrates and guards the current limitation, so a
      future change in either direction (closing the gap, or someone actually introducing an
      aliased import) is caught rather than silently passing or failing.
- [ ] `scripts/__tests__/check-bottomsheet-backhandler.test.ts` covers whichever behavior is
      chosen.

## Implementation Notes

- Files: `scripts/check-bottomsheet-backhandler.js`, `scripts/__tests__/check-bottomsheet-backhandler.test.ts`.
- Precedent for import-aware scanning may already exist in `scripts/check-accessibility.js` or
  `scripts/check-hardcoded-colors.js` — check those before writing new AST-parsing logic from
  scratch.

## Dependencies

- None.

## Risks

- Low — no aliased import of `BottomSheetModal` exists in the codebase today, so closing this gap
  is preventive, not a fix for a live miss.

## Updates

### 2026-07-09

- Filed as a deferred warning from the `/todo` executor that implemented PR #555, per user
  instruction to convert deferred items into tracked todos.
