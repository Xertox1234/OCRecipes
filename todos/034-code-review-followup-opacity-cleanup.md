---
title: "Code review follow-up: withOpacity migration & hardcoded colors"
status: done
priority: low
created: 2026-02-05
updated: 2026-02-05
assignee:
labels: [code-quality, design-system, cleanup]
---

# Code Review Follow-up: withOpacity Migration & Hardcoded Colors

## Summary

Complete the migration to the `withOpacity()` utility function and remove remaining hardcoded `#FFFFFF` values identified during code review of commit 2b8ca40.

## Background

The code review of todos 031-033 resolution identified remaining instances of:

1. String concatenation for opacity (e.g., `color + "20"`) that should use `withOpacity(color, 0.2)`
2. Hardcoded `#FFFFFF` values that should use `theme.buttonText`

These are non-critical code quality improvements for consistency with the new patterns.

## Acceptance Criteria

- [x] All opacity string concatenations migrated to `withOpacity()` utility
- [x] All hardcoded `#FFFFFF` replaced with theme values
- [x] Verify opacity values match Figma design intent (note: `"20"` hex = ~12.5%, `0.2` = 20%)
- [x] No lint or TypeScript errors introduced
- [ ] Visual appearance verified (opacity changes may be noticeable)

## Implementation Notes

### Files to Modify

| File                               | Change                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `client/components/Chip.tsx`       | Lines 67-68, 77: Replace `theme.link + "30"`, `+ "15"`, `+ "10"` with `withOpacity()` |
| `client/screens/LoginScreen.tsx`   | Line 171: Replace `theme.error + "15"` with `withOpacity(theme.error, 0.06)`          |
| `client/screens/ProfileScreen.tsx` | Line 1191: Replace `borderColor: "#FFFFFF"` with `theme.buttonText`                   |
| `client/screens/ProfileScreen.tsx` | Multiple locations: Replace remaining `+ "20"` patterns                               |

### Opacity Conversion Reference

| Hex Suffix | Decimal | Actual Opacity | withOpacity() Equivalent    |
| ---------- | ------- | -------------- | --------------------------- |
| `"10"`     | 16      | 6.3%           | `withOpacity(color, 0.06)`  |
| `"15"`     | 21      | 8.2%           | `withOpacity(color, 0.08)`  |
| `"20"`     | 32      | 12.5%          | `withOpacity(color, 0.125)` |
| `"30"`     | 48      | 18.8%          | `withOpacity(color, 0.19)`  |
| `"33"`     | 51      | 20%            | `withOpacity(color, 0.2)`   |

**Note:** If the original hex values were intentional for Figma matching, use the "Actual Opacity" column. If they were approximations of round percentages, use round numbers like `0.1`, `0.2`.

### Example Changes

```typescript
// Chip.tsx - Before
backgroundColor: theme.link + "30",

// Chip.tsx - After (preserving original opacity)
backgroundColor: withOpacity(theme.link, 0.19),

// OR if rounding to clean values is acceptable:
backgroundColor: withOpacity(theme.link, 0.2),
```

## Dependencies

- None

## Risks

- **Visual changes**: Converting hex suffixes to `withOpacity()` may slightly change opacity values if using rounded percentages
- **Low risk**: These are purely cosmetic changes with no functional impact

## Updates

### 2026-02-05

- Initial creation from code review of commit 2b8ca40
- Identified remaining string concatenation patterns and hardcoded colors
- **Resolved**: Migrated 18 opacity patterns and 1 hardcoded color in commit e74aeb3
