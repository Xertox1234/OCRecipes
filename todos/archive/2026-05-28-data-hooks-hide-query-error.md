---
title: "Shared data hooks (useProfileData, useHistoryData) don't expose query error to consumers"
status: done
priority: medium
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [hooks, client-state, error-handling]
github_issue:
---

# Shared data hooks (useProfileData, useHistoryData) don't expose query error to consumers

## Summary

`useProfileData` and `useHistoryData` strip `isError`/`error` from their `useQuery` results, so consuming screens (Profile, History) are structurally unable to render an error — every failure is silent.

## Background

Surfaced during a silent-failure investigation (unsolicited user report). These are the most corrosive cases in the class: a screen-level miss is one careless screen, but a hook that omits `error` from its return makes silent failure _the only possible behavior_ for every consumer. Other data hooks likely share the omission (the investigation flagged many `NO-ERR-REF` hooks).

## Acceptance Criteria

- [ ] `useProfileData` return exposes `isError`/`error` for its widget/library/verification queries.
- [ ] `useHistoryData` return exposes `isError`/`error` for both the dashboard summary and the infinite scanned-items query.
- [ ] Consuming screens (ProfileScreen, HistoryScreen) render an error/retry state using the newly exposed fields.
- [ ] Quick audit of the other data hooks for the same omission; file follow-ups for any non-trivial ones.

## Implementation Notes

- `client/hooks/useProfileData.ts`: queries at lines 33, 34, 37-45 destructure `data`-only; the return object (lines 104-125) omits any error field.
- `client/hooks/useHistoryData.ts`: queries at lines 56-82 and 85-128 omit `error`; return object (lines 311-354) has no error field; `displayItems` collapses to `[]` on failure (line 131).
- Mechanical fix: thread `isError`/`error` through each hook's destructure and return, then handle at the consumer.
- LSP-first: use `findReferences` on each hook before changing its return shape to find all consumers.

## Dependencies

- A global `QueryCache.onError` net (`client/lib/query-client.ts:124`) is the higher-leverage companion fix that would catch these app-wide; out of scope here unless deliberately bundled.

## Risks

- Low. Additive to return objects; consumers opt in to the new fields. Watch for consumers that spread the hook return into props.

## Updates

### 2026-05-28

- Initial creation. Both hooks verified by reading their query destructures and return objects.
