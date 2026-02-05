---
title: "Figma design review follow-up items"
status: backlog
priority: low
created: 2026-02-05
updated: 2026-02-05
assignee:
labels: [code-quality, design-system]
---

# Figma Design Review Follow-up Items

## Summary

Address medium and low severity issues identified during code review of the Figma design system integration (feat/figma-design-tokens branch).

## Background

Code review of the Figma design integration identified several non-critical issues that should be addressed for code quality and maintainability. These are follow-up items from PR review.

## Acceptance Criteria

### Medium Priority

- [ ] Fix magic number in Chip borderRadius - add `BorderRadius.chipFilled: 19` to theme.ts instead of `BorderRadius.chip - 9`
- [ ] Create color opacity utility function - replace string concatenation like `theme.link + "20"` with `withOpacity(color, 0.2)`
- [ ] Fix conflicting text alignment in LoginScreen - header has `alignItems: "flex-start"` but subtitle has unused `textAlign: "center"`

### Low Priority

- [ ] Remove unused `Colors` import in MainTabNavigator.tsx
- [ ] Replace hardcoded `#FFFFFF` with `theme.buttonText` in ProfileScreen.tsx

## Implementation Notes

### Magic Number Fix

```typescript
// In theme.ts BorderRadius object
chip: 28,
chipFilled: 19,  // Add this

// In Chip.tsx, change:
borderRadius: BorderRadius.chip - 9,
// To:
borderRadius: BorderRadius.chipFilled,
```

### Color Opacity Utility

```typescript
// Add to theme.ts or create utils/colors.ts
export function withOpacity(hexColor: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hexColor}${alpha}`;
}

// Usage:
backgroundColor: withOpacity(theme.link, 0.2); // Instead of theme.link + "20"
```

### Files to Modify

| File                                     | Change                                                       |
| ---------------------------------------- | ------------------------------------------------------------ |
| `client/constants/theme.ts`              | Add `chipFilled` to BorderRadius, add `withOpacity` function |
| `client/components/Chip.tsx`             | Use `BorderRadius.chipFilled`                                |
| `client/components/Card.tsx`             | Use `withOpacity` for badge colors                           |
| `client/screens/LoginScreen.tsx`         | Remove unused `textAlign: "center"` from subtitle style      |
| `client/navigation/MainTabNavigator.tsx` | Remove `Colors` from import                                  |
| `client/screens/ProfileScreen.tsx`       | Replace `#FFFFFF` with `theme.buttonText`                    |

## Dependencies

- None

## Risks

- Low risk - these are code quality improvements with no functional impact

## Updates

### 2026-02-05

- Initial creation from code review of feat/figma-design-tokens branch
