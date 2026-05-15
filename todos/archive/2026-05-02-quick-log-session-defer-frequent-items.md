---
title: "Defer frequentItems query until QuickLogDrawer is opened"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, performance]
---

# Defer frequentItems query until QuickLogDrawer is opened

## Summary

`frequentItems` query fires unconditionally on mount of `useQuickLogSession`, which is called inside the always-mounted `QuickLogDrawer`. This fetches on every HomeScreen cold load even if the drawer is never opened.

## Background

Deferred from 2026-05-02 full audit (finding L11). `client/hooks/useQuickLogSession.ts` lines 154-166. Adding `enabled: isOpen` would defer the query until the drawer is expanded. The hook currently has no `isOpen` param — it would need to be passed in or the query could be moved to the drawer component itself.

## Acceptance Criteria

- [ ] `frequentItems` query only fires when the drawer is open (e.g. `enabled: isOpen` or lazy fetch on first open)
- [ ] After first open, query respects `staleTime: 5 * 60 * 1000` as today

## Implementation Notes

Options: (a) add `isOpen: boolean` param to `useQuickLogSession`, or (b) move the `frequentItems` query out of the hook and into `QuickLogDrawer` directly where `isOpen` is available.

## Dependencies

- None

## Risks

- Slight UX change: chips may not appear instantly on first open (they'll load). Acceptable since they're convenience features.

## Updates

### 2026-05-02

- Initial creation (deferred from audit L11)
