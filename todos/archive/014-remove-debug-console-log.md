---
title: "Remove debug console.log from production code"
status: complete
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [cleanup, code-review]
---

# Remove Debug Console.log

## Summary

A debug console.log statement is left in HistoryScreen that will appear in production builds.

## Background

**Location:** `client/screens/HistoryScreen.tsx:244`

```typescript
console.log("Card pressed, navigating to item:", item.id);
```

## Acceptance Criteria

- [ ] Remove the console.log statement
- [ ] Search for other debug console.logs in client code
- [ ] Consider adding ESLint rule to warn on console statements

## Implementation Notes

Simply delete the line or wrap in `__DEV__`:

```typescript
if (__DEV__) {
  console.log("Card pressed, navigating to item:", item.id);
}
```

Or better, just remove it entirely since it's not providing useful debugging value.

## Dependencies

- None

## Risks

- None

## Updates

### 2026-01-30
- Initial creation from code review
