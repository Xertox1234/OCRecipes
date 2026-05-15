---
title: "Log acknowledge() errors instead of silently swallowing them"
status: in-progress
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [dx, coach-badge, client]
---

# Log acknowledge() errors instead of silently swallowing them

## Summary

Both `CoachProScreen` and `ChatListScreen` call `acknowledge().catch(() => {})` on focus, silently discarding any error. If the acknowledge call fails repeatedly (e.g., network down, expired token), the dot badge stays visible indefinitely with no trace in the console.

## Background

`client/screens/CoachProScreen.tsx:55` and `client/screens/ChatListScreen.tsx:88`:

```ts
useFocusEffect(
  useCallback(() => {
    acknowledge().catch(() => {}); // errors silently dropped
  }, [acknowledge]),
);
```

The UX decision to not surface this error to the user is correct — it shouldn't interrupt the screen. But dropping it entirely makes debugging session issues much harder.

## Acceptance Criteria

- [ ] Errors from `acknowledge()` are logged at warn level (not swallowed)
- [ ] No visible UI change — the error is not shown to the user
- [ ] Works in both screens

## Implementation Notes

```ts
acknowledge().catch((err) => {
  if (__DEV__) console.warn("[CoachProScreen] acknowledge failed", err);
});
```

Or use the existing `logger` if one is available on the client. The key is that the error is traceable in dev without surfacing to the user.

## Dependencies

- None

## Risks

- Trivial — no behavior change, logging only

## Updates

### 2026-05-01

- Identified during PR #45 code review
