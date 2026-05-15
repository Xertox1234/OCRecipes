---
title: "Stabilize inline arrow refs in QuickLogDrawer and HomeScreen"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, performance]
---

# Stabilize inline arrow refs in QuickLogDrawer and HomeScreen

## Summary

Several inline arrow closures create unnecessary new references on every render:

- `onLogSuccess` passed as inline arrow prop to `useQuickLogSession` (QuickLogDrawer line 58-64) — fires sync useEffect on every `volume` re-render
- Inline arrows wrapping `session.handleChipPress`/`session.removeItem` in `.map()` (QuickLogDrawer lines 216, 268)
- `contentContainerStyle` inline object + `onRefresh` inline arrow in HomeScreen (lines 134-149)

## Background

Deferred from 2026-05-02 full audit (findings L7, L8, L9). These are low-impact but compound with the high-frequency voice volume re-renders (10Hz during speech input).

## Acceptance Criteria

- [ ] `onLogSuccess` extracted to a `useCallback` before being passed to `useQuickLogSession`
- [ ] `.map()` callbacks use `session.handleChipPress` and `session.removeItem` directly (or via `useCallback` wrapper) instead of inline arrows
- [ ] `contentContainerStyle` in HomeScreen extracted to a `useMemo` or static style
- [ ] `onRefresh` in HomeScreen extracted to a `useCallback`

## Implementation Notes

The `onLogSuccess` ref-mirror pattern in `useQuickLogSession` (lines 28-31) already handles changing callbacks gracefully — so stabilizing the prop also removes a sync effect re-run per volume tick.

## Dependencies

- None

## Risks

- Minor refactor — test all affected flows after change

## Updates

### 2026-05-02

- Initial creation (deferred from audit L7, L8, L9)
