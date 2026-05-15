---
title: "Add reduced motion support to ItemDetailScreen"
status: complete
priority: p3
issue_id: "030"
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [accessibility, animation, wcag, screen]
tags: [accessibility, animation, wcag, screen]
dependencies: []
---

# Add reduced motion support to ItemDetailScreen

## Problem Statement

The ItemDetailScreen (`client/screens/ItemDetailScreen.tsx`) uses entrance animations without checking for reduced motion preference. This violates WCAG 2.1 AA guidelines.

## Findings

- Location: `client/screens/ItemDetailScreen.tsx:114-115, 282, 323, 375`
- Entrance animations do not respect reduced motion preference
- Similar issue to NutritionDetailScreen
- Should follow the established pattern from HistoryScreen

## Current Code

```typescript
<Animated.View
  entering={FadeInUp.delay(100).duration(400)}
  style={styles.content}
>
```

## Proposed Solution

Add reduced motion check following HistoryScreen pattern:

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";

// Inside component:
const { reducedMotion } = useAccessibility();

// For each Animated.View with entering prop
const enteringAnimation = reducedMotion
  ? undefined
  : FadeInUp.delay(100).duration(400);

<Animated.View
  entering={enteringAnimation}
  style={styles.content}
>
```

## Acceptance Criteria

- [ ] Screen respects user's reduced motion preference
- [ ] No entrance animations when reduced motion is enabled
- [ ] Content still displays correctly without animations
- [ ] Existing functionality unchanged when reduced motion is disabled
- [ ] `npm run check:types` passes

## Technical Details

- **Affected Files**: `client/screens/ItemDetailScreen.tsx`
- **Related Components**: NutritionDetailScreen.tsx (similar issue)
- **Database Changes**: No

## Resources

- Pattern reference: `docs/PATTERNS.md` - Reduced Motion Animation Pattern
- Reference implementation: `client/screens/HistoryScreen.tsx:106-108`

## Work Log

### 2026-02-01 - Created from Code Review

**By:** Claude Code Review Agent
**Source:** Code review of current working tree
**Priority:** P3 (NICE-TO-HAVE) - Accessibility improvement
