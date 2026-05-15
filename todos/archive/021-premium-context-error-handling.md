---
title: "Add error handling to PremiumContext"
status: done
priority: medium
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [premium, error-handling, ux]
---

# Add Error Handling to PremiumContext

## Summary

When the subscription API fails, PremiumContext silently falls back to free tier defaults without notifying the UI, potentially causing poor user experience for premium users.

## Background

**Location:** `client/context/PremiumContext.tsx`

Current behavior:

```typescript
const tier = subscriptionData?.tier ?? "free"; // Silent fallback
```

If a premium user's subscription status fails to load (network error, server down), they'll see free tier limitations without understanding why.

## Acceptance Criteria

- [ ] Expose `isError` and `error` state from the context
- [ ] Allow UI components to show appropriate error messaging
- [ ] Add retry mechanism or manual refresh option
- [ ] Consider showing a banner when premium status is uncertain

## Implementation Notes

```typescript
interface PremiumContextType {
  // ... existing fields
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

// In ScanScreen or a global component:
if (isError && !isPremium) {
  // Show: "Unable to verify subscription. Some features may be limited."
}
```

## Dependencies

- None

## Risks

- Over-alerting users about transient errors
- Need to balance UX between silent fallback and error visibility

## Updates

### 2026-02-01

- Initial creation from code review
- **Approved during triage** - Status changed: backlog → ready
