---
title: "Implement tap-outside-to-collapse for expanded history items"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [ux, client, react-native, pr-10-review]
---

# Implement Tap-Outside-to-Collapse for Expanded History Items

## Summary

PR #10's test plan lists "tap outside collapses expanded item" as a manual test, but the code does not implement this behavior. Currently, collapsing only happens by re-tapping the same item or tapping a different item.

## Background

The current expand/collapse logic in `HistoryScreen.tsx`:
```typescript
setExpandedItemId((prev) => (prev === itemId ? null : itemId));
```

This toggles on re-tap and switches on different-item tap, but doesn't handle taps on empty space or scroll gestures.

## Acceptance Criteria

- [ ] Scrolling the FlatList collapses the expanded item
- [ ] Tapping empty space (if any) collapses the expanded item
- [ ] Tapping a different item still switches expansion (existing behavior preserved)
- [ ] Animation remains smooth during collapse

## Implementation Notes

Add `onScrollBeginDrag` handler to FlatList:
```typescript
<FlatList
  onScrollBeginDrag={() => setExpandedItemId(null)}
  // ... existing props
/>
```

## Dependencies

- None

## Risks

- May feel jarring if user scrolls slightly while trying to tap an action button
- Consider a small threshold before collapsing on scroll

## Updates

### 2026-02-27
- Created from PR #10 code review (found by architecture-strategist)
