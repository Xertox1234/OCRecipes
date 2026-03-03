---
title: "Add reduced motion support to Card component"
status: complete
priority: p3
issue_id: "028"
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [accessibility, animation, wcag]
tags: [accessibility, animation, wcag]
dependencies: []
---

# Add reduced motion support to Card component

## Problem Statement

The Card component (`client/components/Card.tsx`) animates on press but does not check for reduced motion preference. This violates WCAG 2.1 AA guidelines for users who prefer reduced motion.

## Findings

- Location: `client/components/Card.tsx:70-76`
- Press animations do not respect reduced motion preference
- Same issue as Button component
- The `useAccessibility` hook exists and should be used

## Current Code

```typescript
const handlePressIn = () => {
  scale.value = withSpring(0.98, pressSpringConfig);
};

const handlePressOut = () => {
  scale.value = withSpring(1, pressSpringConfig);
};
```

## Proposed Solution

Add reduced motion check using the `useAccessibility` hook:

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";

// Inside component:
const { reducedMotion } = useAccessibility();

const handlePressIn = () => {
  if (!reducedMotion) {
    scale.value = withSpring(0.98, pressSpringConfig);
  }
};

const handlePressOut = () => {
  if (!reducedMotion) {
    scale.value = withSpring(1, pressSpringConfig);
  }
};
```

## Acceptance Criteria

- [ ] Card respects user's reduced motion preference
- [ ] No animation occurs when reduced motion is enabled
- [ ] Existing functionality unchanged when reduced motion is disabled
- [ ] `npm run check:types` passes

## Technical Details

- **Affected Files**: `client/components/Card.tsx`
- **Related Components**: Button.tsx (similar issue)
- **Database Changes**: No

## Resources

- Pattern reference: `docs/PATTERNS.md` - Reduced Motion Animation Pattern
- Similar implementation: `client/screens/HistoryScreen.tsx:106-108`

## Work Log

### 2026-02-01 - Created from Code Review

**By:** Claude Code Review Agent
**Source:** Code review of current working tree
**Priority:** P3 (NICE-TO-HAVE) - Accessibility improvement
