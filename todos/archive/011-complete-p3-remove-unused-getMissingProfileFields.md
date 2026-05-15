---
status: complete
priority: p3
issue_id: "011"
tags: [cleanup, backend, dead-code]
dependencies: []
---

# Remove unused `getMissingProfileFields` function

## Problem Statement

Function is exported but never imported anywhere. ~25 lines of dead code.

## Findings

- Location: `server/services/goal-calculator.ts:126-151`
- Function `getMissingProfileFields` is exported
- No imports found in codebase
- Dead code adds maintenance burden

## Proposed Solutions

### Option 1: Delete the function

- **Pros**: Cleaner codebase, less confusion
- **Cons**: None (function is unused)
- **Effort**: Small
- **Risk**: Low

Simply delete lines 126-151.

## Recommended Action

Implement Option 1 - delete the unused function.

## Technical Details

- **Affected Files**: `server/services/goal-calculator.ts`
- **Related Components**: None (unused)
- **Database Changes**: No
- **LOC Removed**: ~25

## Resources

- Original finding: Code review (code-simplicity-reviewer)

## Acceptance Criteria

- [ ] Verify function is truly unused (grep for imports)
- [ ] Delete `getMissingProfileFields` function
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

- Remove dead code promptly to reduce maintenance burden

## Notes

Source: Triage session on 2026-02-01
