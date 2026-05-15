---
status: complete
priority: p3
issue_id: "012"
tags: [cleanup, client, dead-code]
dependencies: []
---

# Remove unused image utility functions

## Problem Statement

`getImageDimensions` and `needsCompression` functions are never called. ~20 lines of dead code.

## Findings

- Location: `client/lib/image-compression.ts`
- `getImageDimensions` function unused
- `needsCompression` function unused
- No imports found in codebase

## Proposed Solutions

### Option 1: Delete both functions

- **Pros**: Cleaner codebase, smaller bundle
- **Cons**: None (functions are unused)
- **Effort**: Small
- **Risk**: Low

Delete both `getImageDimensions` and `needsCompression` functions.

## Recommended Action

Implement Option 1 - delete the unused functions.

## Technical Details

- **Affected Files**: `client/lib/image-compression.ts`
- **Related Components**: None (unused)
- **Database Changes**: No
- **LOC Removed**: ~20

## Resources

- Original finding: Code review (code-simplicity-reviewer)

## Acceptance Criteria

- [ ] Verify functions are truly unused (grep for imports/calls)
- [ ] Delete `getImageDimensions` function
- [ ] Delete `needsCompression` function
- [ ] Remove from exports if separately exported
- [ ] Tests pass
- [ ] Code reviewed

## Work Log

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status: ready
- Ready to be picked up and worked on

**Learnings:**

- Remove dead code to reduce bundle size and maintenance burden

## Notes

Source: Triage session on 2026-02-01
