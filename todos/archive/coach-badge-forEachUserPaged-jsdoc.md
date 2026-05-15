---
title: "Fix forEachUserPaged JSDoc: throws on any page fetch, not just the first"
status: done
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [dx, scheduler, coach-badge]
---

# Fix forEachUserPaged JSDoc: throws on any page fetch, not just the first

## Summary

The JSDoc for `forEachUserPaged` in `server/services/notification-scheduler.ts` says "Throws if the initial page fetch fails" — but the function actually throws on any page fetch failure, not just the first one. A mid-iteration page failure propagates out the same way.

## Background

`server/services/notification-scheduler.ts`:

```ts
/**
 * ...
 * Throws if the initial page fetch fails (callers should catch and return).
 */
async function forEachUserPaged(...)
```

The wording "initial page fetch" suggests only the first page can throw, which may mislead a future developer into thinking mid-iteration failures are silently swallowed.

## Acceptance Criteria

- [ ] JSDoc updated to reflect that any page fetch failure throws and propagates to the caller

## Implementation Notes

```ts
/**
 * ...
 * Throws on any page fetch failure; callers should wrap in try/catch and return.
 */
```

## Dependencies

- None

## Risks

- Trivial — documentation only

## Updates

### 2026-05-01

- Identified during code review of coach-badge todo session
