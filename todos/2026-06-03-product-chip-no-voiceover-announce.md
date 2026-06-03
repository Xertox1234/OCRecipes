---
title: "Add announceForAccessibility when ProductChip slides in after scan"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Add announceForAccessibility when ProductChip slides in after scan

## Summary

`ProductChip` slides in when a barcode is locked or a smart-photo scan completes, with `accessibilityViewIsModal={true}`, but no `announceForAccessibility`. VoiceOver users get no audible indication that new actionable content appeared.

## Background

Deferred from 2026-06-03 full audit (M8). File: `client/camera/components/ProductChip.tsx:70-73`. The modal focus trap catches VoiceOver after it moves focus, but there's no proactive announcement when the chip first appears.

## Acceptance Criteria

- [ ] On mount/slide-in, iOS-gated `announceForAccessibility` announces the product name or "Product found, tap to view details"
- [ ] Android uses `accessibilityLiveRegion` or rely on focus shift
- [ ] VoiceOver focus moves into the chip after announcement

## Implementation Notes

Add `useEffect(() => { if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility("Product found"); }, [])` (fires on mount). The `[]` dep skips repeated scans (chip unmounts and remounts for each new result).

## Dependencies

- None

## Risks

- Low — mount-time announce only

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M8)
