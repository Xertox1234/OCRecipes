---
title: "Normalize the single scanned-item query key to the tuple form for persist-allowlist consistency"
status: backlog
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, client-state]
github_issue:
---

# Normalize the single scanned-item query key to the tuple form

## Summary

`ItemDetailScreen` keys a single scanned item with a template-literal string
(`` [`/api/scanned-items/${itemId}`] ``), whereas the list/lookup reads use the
tuple form (`["/api/scanned-items", itemId]`). Only the tuple form collapses to an
allowlisted `queryKey[0]` (`/api/scanned-items`), so the single-item read is
silently EXCLUDED from the offline persist allowlist added in PR #406 (M5).

## Background

Surfaced during the code review of PR #406 (2026-06-19 audit). M5 added a
`dehydrateOptions.shouldDehydrateQuery` allowlist keyed on `query.queryKey[0]`
against the 4 `QUERY_KEYS`. The template-literal key yields
`queryKey[0] === "/api/scanned-items/<id>"`, which is not in the allowlist, so
tapping into a logged item while offline has no cached detail. Judged acceptable at
audit triage (single-item detail isn't an offline-critical primary read), but the
two key shapes for one resource are an inconsistency worth normalizing so the
allowlist / invalidation reasoning stays uniform across the app.

## Acceptance Criteria

- [ ] `ItemDetailScreen`'s single-item query uses the tuple form
      `["/api/scanned-items", itemId]` (matching `useNutritionLookup`).
- [ ] Confirm the corresponding invalidation/refetch paths still hit the key (no
      stale-read regression) — check `findReferences` on the key, not grep.
- [ ] Decide single-item offline behavior explicitly: if offline read IS desired,
      confirm the tuple key is then covered by the M5 allowlist
      (`queryKey[0] === "/api/scanned-items"`); if NOT desired, leave a comment
      stating it's intentionally excluded.

## Implementation Notes

- `client/screens/ItemDetailScreen.tsx:143` — the template-literal key to replace.
- `client/hooks/useNutritionLookup.ts:165` — the tuple-form precedent.
- `client/App.tsx` — the M5 `PERSISTED_QUERY_KEYS` allowlist (matches `queryKey[0]`).
- `client/lib/query-keys.ts` — the centralized `QUERY_KEYS`.
- Note: a tuple key whose `[0]` is `/api/scanned-items` would START persisting the
  single-item detail offline — that's a (small) behavior change, so make the
  offline-vs-not decision deliberately, not incidentally.
