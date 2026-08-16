---
title: "coverage-ratchet: three deferred test/robustness residuals from delta review"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, testing]
github_issue:
---

# coverage-ratchet: three deferred test/robustness residuals from delta review

## Summary

PR #822's second-round review left three SUGGESTION-level residuals in `scripts/coverage-ratchet.ts` / its suite: the `Unbalanced thresholds block` throw is untested; the colors-checker walker's own named scenario (a stray `client/*.test.tsx` inflating the "N files" count) has no pinning test; and `locateThresholdsBlock`/`maskNestedObjects` state (but do not enforce) the no-braces-in-string-literals assumption, which a brace-expansion glob key like `"client/{screens,components}/**"` would break.

## Background

All three are SUGGESTIONs deferred per "fix high/critical, defer the rest" (2026-08-16). The WARNING-level siblings (malformed-coverage exit 2, digit-length-crossing apply fixture) were fixed in-branch (`84452b4d`).

## Acceptance Criteria

- [x] Unit test: a thresholds block with a missing closing brace → `readCurrentThresholds` throws `/Unbalanced/`
- [x] Colors-checker no-arg test: `makeRepo({ "A.tsx": clean, "Stray.test.tsx": clean })` → output anchors `in 1 files` (not 2)
- [x] Brace-in-string decision recorded: either make the scanners string-aware, or detect a brace-containing string in the block and throw a clear error (the silent-desync path is the only unacceptable outcome)

## Implementation Notes

All in `scripts/__tests__/coverage-ratchet.test.ts` + `scripts/__tests__/check-hardcoded-colors.test.ts`; the third item may touch `scripts/coverage-ratchet.ts` (a `/["'`]._[{}]._["'`]/`-style pre-check inside the located block is likely sufficient — real per-glob keys with braces are the only plausible source).

## Scope Contract

- **Mechanisms to use:** existing test fixtures/helpers in the two suites.
- **Files in scope:** `scripts/__tests__/coverage-ratchet.test.ts`, `scripts/__tests__/check-hardcoded-colors.test.ts`, `scripts/coverage-ratchet.ts` (third item only).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #822 merged.

## Risks

- None material — additive tests plus one defensive check.

## Updates

### 2026-08-16

- Initial creation from PR #822 delta-review suggestions.
- Implemented: added the `Unbalanced` throw test and the colors-checker
  stray-`.test.tsx` count-pinning test; chose the throw-on-detection branch
  for the brace-in-string decision, adding an unexported
  `assertNoBraceInStringLiteral` check (single call site inside
  `locateThresholdsBlock`, covering both the read and `--apply` write paths)
  plus three negative-control tests. Advisor review caught that the
  Implementation Notes' suggested quote-spanning regex false-positives
  across two adjacent per-glob keys — replaced with per-literal enumeration
  (`STRING_LITERAL`) and comment-stripping before the scan; verified
  empirically. Code review (one round) fixed a test-comment overclaim and
  strengthened the colors-checker test to also assert on error content.
