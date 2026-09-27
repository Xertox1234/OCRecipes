---
title: "Quick Log follow-ups from #1116's review: lock resolving while open, success announce, locked screen's idle query"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, react-native, accessibility]
github_issue:
---

# Quick Log follow-ups from #1116's review: lock resolving while open, success announce, locked screen's idle query

## Summary

Three small, non-blocking gaps the reviewers of PR #1116 (Quick Log lock + submit UX) noted.
None blocks use; each is a cheap polish.

## Background

- **Lock resolves while the drawer is open.** `HomeScreen`'s Quick Log lock is
  `isPremiumResolved && !canQuickLog`. If the subscription loads after a free or lapsed user
  already opened the drawer, the header repaints locked but the body stays open with a live
  input. `handleDrawerToggle` checks the lock only when opening, so the next tap closes the
  drawer instead of showing the upgrade flow. It heals on that tap.
- **No announce when food is found.** An empty parse is announced (polite live region on
  Android, one iOS announcement). A successful parse only fires a haptic and shows the list;
  VoiceOver users hear nothing. This predates #1116.
- **Locked `QuickLogScreen` still runs its session.** The screen calls
  `useQuickLogSession({ isOpen: true })` before its locked early return, so a free account
  fetches frequent items it never shows.

## Acceptance Criteria

- [ ] When the Quick Log lock becomes true while its drawer is open, Home closes the drawer
      (test: open as unresolved, then resolve to locked; `isOpen` becomes false).
- [ ] A successful parse announces the item count (e.g. "Found 2 items. Log All to save.")
      once per result: iOS imperative announce, Android via a live region, never both on
      one platform (`docs/rules/accessibility.md` → Announcements).
- [ ] `QuickLogScreen` passes `isOpen: !isLocked`, so a locked screen makes no
      frequent-items request (test: locked render does not enable the query).

## Implementation Notes

- Lock: an effect in `client/screens/HomeScreen.tsx` keyed on `quickLogLocked` that clears
  `openDrawerId` when it is `"quick-log"`.
- Announce: `client/components/home/QuickLogDrawer.tsx` already has an edge-guarded effect
  for `parseEmpty` and a `hadParsedItemsRef` edge for `onResultsShown`; announce on that
  same false→true edge. `QuickLogScreen` would need the same (it uses toasts).
- Idle query: `client/screens/QuickLogScreen.tsx`, the `useQuickLogSession` call.

## Scope Contract

- **Mechanisms to use:** existing edge-guarded effects and `AccessibilityInfo` /
  `accessibilityLiveRegion`. Nothing new.
- **Files in scope:**
  - `client/screens/HomeScreen.tsx`
  - `client/components/home/QuickLogDrawer.tsx`
  - `client/screens/QuickLogScreen.tsx`
  - their co-located `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-09-26

- Filed from the mobile and code reviews of PR #1116 (all non-blocking suggestions).
