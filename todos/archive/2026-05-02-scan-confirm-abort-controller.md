---
title: "Add AbortController cleanup to returnAfterLog fetch"
status: backlog
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, data-integrity]
---

# Add AbortController cleanup to returnAfterLog fetch

## Summary

The `returnAfterLog` barcode-info fetch in `ScanScreen.tsx` is a bare `.then()/.catch()` chain with no `AbortController`. If the user taps Dismiss while the fetch is in-flight, `setConfirmCard(...)` fires on a screen that has already been reset, potentially re-showing the overlay.

## Background

Deferred from 2026-05-02 full audit (finding M2). The SESSION_COMPLETE effect at lines 188-207 starts a GET fetch and resolves it asynchronously. If `handleConfirmDismiss` fires before the fetch completes, `setConfirmCard` races against the null reset.

## Acceptance Criteria

- [ ] The fetch is issued with an `AbortController`
- [ ] The cleanup function returned from `useEffect` calls `controller.abort()`
- [ ] The `.catch()` handler silences `AbortError` (does not call `setConfirmCard` on abort)

## Implementation Notes

`ScanScreen.tsx` lines 188-207. Pattern:

```js
const controller = new AbortController();
apiRequest("GET", `/api/nutrition/barcode/${barcode}`, undefined, { signal: controller.signal })
  .then(...)
  .catch((err) => {
    if (err?.name === "AbortError") return;
    setConfirmCard({ ... });
  });
return () => controller.abort();
```

Verify `apiRequest` passes `signal` through to `fetch`.

## Dependencies

- None

## Risks

- `apiRequest` may not forward `RequestInit` options — check before implementing

## Updates

### 2026-05-02

- Initial creation (deferred from audit M2)
