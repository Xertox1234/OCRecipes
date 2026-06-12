---
title: "Network TypeError counts against offline queue retry budget"
status: backlog
priority: low
created: 2026-06-12
updated: 2026-06-12
assignee:
labels: [deferred, offline, reliability]
github_issue:
---

# Network TypeError counts against offline queue retry budget

## Summary

In `client/lib/offline-queue-drain.ts`, non-HTTP network errors (e.g. `TypeError: Network request failed` when the socket drops mid-drain) are treated identically to 5xx server errors and count against the 4-attempt retry budget. After 4 such transient errors on a flappy connection, the item is permanently evicted.

## Background

The drain logic distinguishes 4xx (permanent failure → immediate evict) from everything else (retry). However, the "everything else" bucket includes both 5xx server errors (appropriate to retry against the budget) and `TypeError` network-layer errors (the device was still offline — the attempt shouldn't consume a retry slot). On a flappy connection a user may lose queued food log entries that would have succeeded on the next stable reconnect.

## Acceptance Criteria

- [ ] `TypeError` (or errors matching `/network request failed/i`) in `attemptDrain` do not increment the retry budget counter — i.e., `dequeue` + `emitDrainError` are NOT triggered after `MAX_ATTEMPTS` if all failures are TypeErrors
- [ ] 5xx errors still consume retry budget slots (existing behaviour preserved)
- [ ] New unit test: 4 consecutive TypeError failures do not evict the item
- [ ] New unit test: mixed TypeError + 5xx failures count only 5xx against the budget

## Implementation Notes

In `client/lib/offline-queue-drain.ts`, the catch block in `attemptDrain` currently:

```ts
} catch (error) {
  const is4xx = error instanceof Error && /^4\d\d:/.test(error.message);
  if (is4xx || current.attempts >= MAX_ATTEMPTS) {
    await dequeue(current.id);
    emitDrainError();
    done = true;
  }
  // 5xx with remaining attempts: loop
}
```

Add a `isNetworkError` check:

```ts
const isNetworkError =
  error instanceof TypeError ||
  (error instanceof Error && /network request failed/i.test(error.message));
```

For `isNetworkError`: do NOT increment the eviction budget — break out of the drain loop for this item and leave it in the queue for the next `onlineManager` reconnect event. Do not call `dequeue`. Reset `isDraining = false` so the next reconnect event triggers a fresh drain attempt.

Note: `incrementAttempts` is called BEFORE the request — so the attempt count has already been incremented by the time we reach the catch. The fix must either not count the increment for TypeError failures or use a separate "server-attempt" counter.

## Dependencies

- Phase 1 offline queue (`feat/offline-queue`) must be merged

## Risks

- An infinite TypeError loop (never-resolving network) won't evict the item — the 24h TTL in `clearStale()` is the only backstop. This is acceptable: the user explicitly chose to queue the item offline.

## Updates

### 2026-06-12

- Identified during Phase 1 drain implementation review; deferred as low-severity
