---
title: "Stabilize PremiumContext.Provider value object"
status: in-progress
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, performance]
---

# Stabilize PremiumContext.Provider value object

## Summary

`PremiumContext.Provider` passes an inline `value={{ tier, features, ... }}` — a new object reference on every render. All context consumers (including `ChatStackNavigator`'s `usePremiumContext()`) re-render on every parent render.

## Background

Deferred from 2026-05-02 full audit (finding L10). `client/context/PremiumContext.tsx` lines 152-175. Newly exercised by ChatStackNavigator's `usePremiumContext()` call. Wrapping the value in `useMemo` with the actual state fields as deps would prevent spurious consumer re-renders.

## Acceptance Criteria

- [ ] The context `value` object is wrapped in `useMemo(() => ({ tier, features, ... }), [tier, features, ...])`
- [ ] No existing consumer behavior changes

## Implementation Notes

Standard React context optimization pattern. List all fields in the `useMemo` dep array.

## Dependencies

- None

## Risks

- None — `useMemo` is safe here; the value is only recomputed when a dep changes

## Updates

### 2026-05-02

- Initial creation (deferred from audit L10)
