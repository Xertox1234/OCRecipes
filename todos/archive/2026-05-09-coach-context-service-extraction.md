---
title: "Extract coach context aggregation into a service function"
status: in-progress
priority: low
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, architecture, audit-2026-05-09]
---

# Extract coach context aggregation into a service function

## Summary

`GET /api/coach/context` makes 5 parallel storage calls + computes multi-step derived logic inline. This is the same pattern that was already extracted into `services/profile-hub.ts` for the profile widget endpoint — the coach context handler was never similarly extracted.

## Background

Identified in the 2026-05-09 full audit (M6) by the architecture-specialist agent. The route comment even notes it was partially extracted (warm-up was extracted to `coach-warm-up.ts`) but the context aggregation itself remains inline.

## Acceptance Criteria

- [ ] Extract a `buildCoachContext(userId, features)` function to `server/services/coach-context-builder.ts`
- [ ] Move the 5 storage calls + protein-gap arithmetic + suggestion chip construction into the service
- [ ] Route handler becomes a thin wrapper: auth → premium check → `buildCoachContext` → return
- [ ] All existing coach context route tests still pass

## Implementation Notes

Pattern reference: `server/services/profile-hub.ts` (`getProfileWidgets`). The service should accept `userId` and computed user context as parameters — avoid storage calls inside services where possible.
