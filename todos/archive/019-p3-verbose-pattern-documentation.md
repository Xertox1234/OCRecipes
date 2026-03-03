---
title: "Condense verbose pattern documentation from PR #10"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [documentation, tech-debt, pr-10-review]
---

# Condense Verbose Pattern Documentation

## Summary

PR #10 added 601 lines of documentation across `docs/PATTERNS.md` (+413) and `docs/LEARNINGS.md` (+188). The patterns reproduce full source code verbatim instead of describing the technique with file references. Could convey the same information in ~200 lines — a ~400 line reduction.

## Specific Issues

### PATTERNS.md

| Pattern | Current Lines | Suggested Lines | Issue |
|---------|--------------|----------------|-------|
| Optimistic Mutation on Infinite Query Pages | ~128 | ~30 | Reproduces complete hook source code |
| Two-Tap Expand-then-Navigate | ~85 | ~20 | Reproduces HistoryScreen implementation |
| Soft Delete with Aggregation Guard | ~70 | ~15 | Key insight is 3 lines (compound WHERE) |
| Toggle via Transaction | ~54 | ~15 | Standard Drizzle transaction pattern |
| Parameterized ID Callbacks | ~88 | ~20 | Includes 15 lines of "bad" code to not write |

### LEARNINGS.md

3 of 5 learnings duplicate code samples already in PATTERNS.md. Should cross-reference instead of repeating.

## Acceptance Criteria

- [ ] Each pattern reduced to: 2-3 sentence description + key code insight (5-10 lines) + file reference
- [ ] LEARNINGS.md entries cross-reference PATTERNS.md instead of duplicating code
- [ ] No information loss — all concepts still documented
- [ ] Total documentation for PR #10 patterns reduced from 601 to ~200 lines

## Dependencies

- None

## Risks

- Terse documentation may be less helpful for developers unfamiliar with the patterns
- Balance brevity with teachability

## Updates

### 2026-02-27
- Created from PR #10 code review (found by code-simplicity-reviewer)
