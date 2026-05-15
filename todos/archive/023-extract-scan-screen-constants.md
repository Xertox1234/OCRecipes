---
title: "Extract magic numbers to constants in ScanScreen"
status: done
priority: low
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [code-quality, refactoring]
---

# Extract Magic Numbers to Constants in ScanScreen

## Summary

ScanScreen contains several magic numbers for timing and animation that should be extracted to named constants for better maintainability.

## Background

**Location:** `client/screens/ScanScreen.tsx`

Current magic numbers:

```typescript
debounceMs: 2000,  // line 79
}, 300);  // navigation delay
}, 500);  // reset delay
```

These values are scattered and their purpose isn't immediately clear.

## Acceptance Criteria

- [ ] Extract timing values to named constants
- [ ] Group related constants together
- [ ] Add brief comments explaining each value's purpose
- [ ] Consider moving to a shared constants file if reused

## Implementation Notes

```typescript
const SCAN_TIMING = {
  /** Debounce between barcode scans to prevent duplicates */
  SCAN_DEBOUNCE_MS: 2000,
  /** Delay before navigation to allow success animation */
  NAVIGATION_DELAY_MS: 300,
  /** Delay before resetting scan state after navigation */
  RESET_DELAY_MS: 500,
} as const;
```

## Dependencies

- None

## Risks

- Low risk refactoring

## Updates

### 2026-02-01

- Initial creation from code review
- **Approved during triage** - Status changed: backlog → ready
