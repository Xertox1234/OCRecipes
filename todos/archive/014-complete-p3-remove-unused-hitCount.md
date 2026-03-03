---
status: complete
priority: p3
issue_id: "014"
tags: [cleanup, backend, dead-code, performance]
dependencies: []
---

# Remove unused `hitCount` increment logic

## Problem Statement

`hitCount` is incremented but never read or used for any purpose. ~5 lines of fire-and-forget code with no benefit.

## Findings

- Location: `server/services/nutrition-lookup.ts:94-98`
- Cache hit triggers database UPDATE to increment hitCount
- hitCount column never queried or displayed
- Wasted database write on every cache hit
- No analytics implemented to use this data

## Proposed Solutions

### Option 1: Remove the hitCount increment

- **Pros**: Removes unnecessary DB write, cleaner code
- **Cons**: Loses ability to add analytics later (but can re-add if needed)
- **Effort**: Small
- **Risk**: Low

Delete the fire-and-forget update (~5 lines).

### Option 2: Implement cache analytics

- **Pros**: Actually uses the data being collected
- **Cons**: More work, may not be needed
- **Effort**: Medium
- **Risk**: Low

## Recommended Action

Implement Option 1 - remove the unused increment. If cache analytics are needed later, can re-implement properly.

## Technical Details

- **Affected Files**: `server/services/nutrition-lookup.ts`
- **Related Components**: Nutrition cache
- **Database Changes**: No (column can remain, just stop writing to it)
- **LOC Removed**: ~5
- **Performance Benefit**: One fewer DB write per cache hit

## Resources

- Original finding: Code review (code-simplicity-reviewer)

## Acceptance Criteria

- [ ] Verify hitCount is never read anywhere
- [ ] Remove the hitCount increment code
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

- Don't collect data you don't use
- Fire-and-forget DB writes still have performance cost

## Notes

Source: Triage session on 2026-02-01
