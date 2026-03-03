---
title: "Consider simplifying single-screen stack navigators"
status: done
priority: low
created: 2026-01-30
updated: 2026-02-01
assignee:
labels: [simplification, code-review]
---

# Simplify Single-Screen Stack Navigators

## Summary

`ScanStackNavigator.tsx` and `ProfileStackNavigator.tsx` each wrap only ONE screen, adding complexity without clear benefit.

## Background

**Locations:**

- `client/navigation/ScanStackNavigator.tsx` - wraps only `ScanScreen`
- `client/navigation/ProfileStackNavigator.tsx` - wraps only `ProfileScreen`

Each file defines a full stack navigator with type definitions for a single screen.

**Counter-argument:** This pattern provides:

- Consistent header styling via `useScreenOptions()`
- Ready infrastructure for adding future screens
- Type safety for future navigation params

## Acceptance Criteria

- [x] Evaluate if additional screens are planned for these stacks
- [ ] ~~If no screens planned, inline screens directly in MainTabNavigator~~ (N/A)
- [x] If screens planned, keep current structure (no action needed)

## Implementation Notes

If simplifying:

```typescript
// MainTabNavigator.tsx
<Tab.Screen
  name="ScanTab"
  component={ScanScreen}  // Direct component instead of ScanStackNavigator
  options={{
    tabBarLabel: "Scan",
    // ... header options can be set here
  }}
/>
```

This would remove ~55 LOC across two files.

## Dependencies

- Decision on future screens

## Risks

- May need to recreate if screens are added later
- Loss of consistent header styling pattern

## Updates

### 2026-02-01

- **Decision: Keep current structure**
- Additional screens are planned for both Scan and Profile stacks
- The duplicate camera button issue that prompted this review can be fixed separately
- ScanScreen's `headerShown: false` can be changed to show the header once the camera button duplication is resolved

### 2026-01-30

- Initial creation from code review
- Marked as low priority - current structure has valid extensibility benefits
