---
title: "Add reduced motion support to NutritionDetailScreen"
status: complete
priority: p3
issue_id: "029"
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [accessibility, animation, wcag, screen]
tags: [accessibility, animation, wcag, screen]
dependencies: []
---

# Add reduced motion support to NutritionDetailScreen

## Problem Statement

The NutritionDetailScreen (`client/screens/NutritionDetailScreen.tsx`) uses FadeInUp entrance animations without checking for reduced motion preference. This violates WCAG 2.1 AA guidelines.

## Findings

- Location: `client/screens/NutritionDetailScreen.tsx:66-68, 250, 282, 286, 323, 352, 375`
- MacroCard and main content use FadeInUp animations unconditionally
- HistoryScreen properly implements reduced motion checks - this screen should follow same pattern
- Multiple Animated.View components with `entering` prop need updates

## Current Code

```typescript
// MacroCard example
<Animated.View
  entering={FadeInUp.delay(index * 100).duration(400)}
  style={[styles.macroCard, { backgroundColor: withOpacity(color, 15) }]}
>
```

## Proposed Solution

Add reduced motion check following HistoryScreen pattern:

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";

// Inside component:
const { reducedMotion } = useAccessibility();

// For MacroCard
const enteringAnimation = reducedMotion
  ? undefined
  : FadeInUp.delay(index * 100).duration(400);

<Animated.View
  entering={enteringAnimation}
  style={[styles.macroCard, { backgroundColor: withOpacity(color, 15) }]}
>
```

## Acceptance Criteria

- [ ] Screen respects user's reduced motion preference
- [ ] No entrance animations when reduced motion is enabled
- [ ] Content still displays correctly without animations
- [ ] Existing functionality unchanged when reduced motion is disabled
- [ ] `npm run check:types` passes

## Technical Details

- **Affected Files**: `client/screens/NutritionDetailScreen.tsx`
- **Related Components**: ItemDetailScreen.tsx (similar issue)
- **Database Changes**: No

## Resources

- Pattern reference: `docs/PATTERNS.md` - Reduced Motion Animation Pattern
- Reference implementation: `client/screens/HistoryScreen.tsx:106-108`

## Work Log

### 2026-02-01 - Created from Code Review

**By:** Claude Code Review Agent
**Source:** Code review of current working tree
**Priority:** P3 (NICE-TO-HAVE) - Accessibility improvement
