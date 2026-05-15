---
title: "Type the logAllMutation server response (currently Promise<any>)"
status: in-progress
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, code-quality]
---

# Type the logAllMutation server response

## Summary

`res.json()` in `logAllMutation.mutationFn` returns untyped `Promise<any>`. The `_data` variable in `onSuccess` is `any[]`, breaking type safety on the server response.

## Background

Deferred from 2026-05-02 full audit (finding L6). `client/hooks/useQuickLogSession.ts` line 126. The `POST /api/scanned-items` response shape is known — add a type and cast `res.json()` to it.

## Acceptance Criteria

- [ ] Define a `ScannedItemResponse` type matching the server response from `POST /api/scanned-items`
- [ ] Cast `res.json()` to `Promise<ScannedItemResponse>`
- [ ] `_data` in `onSuccess` is typed as `ScannedItemResponse[]`

## Implementation Notes

The type can live in `shared/types/` if used server-side too, or inline in `useQuickLogSession.ts` if client-only. Check the server route handler for the exact response shape.

## Dependencies

- None

## Risks

- None — type-only change

## Updates

### 2026-05-02

- Initial creation (deferred from audit L6)
