---
title: "getByLabelText solution doc: the 'no override needed' exception lists four whitespace triggers but \\s also matches NBSP, CR, FF and Unicode spaces"
status: in-progress
priority: low
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, testing]
github_issue:
---

# getByLabelText doc exception misses NBSP and Unicode spaces

## Summary

The Exceptions bullet in `docs/solutions/conventions/getbylabeltext-multiline-string-never-matches-default-normalizer-2026-09-28.md` says a label needs no identity normalizer when it has "no newline, tab, repeated space, or leading/trailing whitespace". The default normalizer is `text.trim().replace(/\s+/g, " ")`, and JS `\s` also matches NBSP, `\r`, `\f`, `\v` and other Unicode space separators. So a label like `"250 kcal"` with an NBSP passes the four-item checklist but still gets rewritten, and it hits the same false-RED failure the doc exists to prevent.

## Background

This came from the review of #1146 (the follow-up to #1145). It was non-blocking, and under the one-review-pass rule it is fixed in a follow-up rather than on the reviewed branch. The reviewer measured it against the real `getDefaultNormalizer()`: NBSP, CR, FF and em-space each became `"a b"` (`changed=true`); plain `"a b"` stayed unchanged.

## Acceptance Criteria

- [ ] The Exceptions bullet states the actual predicate: the label is unchanged by `text.trim().replace(/\s+/g, " ")`, meaning no edge whitespace and no whitespace between tokens other than a single ASCII space. Name NBSP as the realistic UI case.
- [ ] Any example added to the doc is measured against `getDefaultNormalizer()` from `@testing-library/dom`, not asserted.

## Implementation Notes

- Doc-only change to the one bullet; keep frontmatter arrays single-line (`scripts/check-solution-frontmatter.js`).

## Scope Contract

- **Files in scope:** `docs/solutions/conventions/getbylabeltext-multiline-string-never-matches-default-normalizer-2026-09-28.md`

## Dependencies

- None

## Updates

### 2026-09-28

- Auto-filed (Low) from #1146's review.
