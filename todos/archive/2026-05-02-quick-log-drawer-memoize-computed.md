---
title: "Memoize totalCalories and hasParsedItems in QuickLogDrawer"
status: done
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, performance]
---

# Memoize totalCalories and hasParsedItems in QuickLogDrawer

## Summary

`totalCalories` (`.reduce()`) and `hasParsedItems` are computed inline on every render of `QuickLogDrawer`, including high-frequency `volume` re-renders during speech input. They should be wrapped in `useMemo`.

## Background

Deferred from 2026-05-02 full audit (finding M6). `client/components/home/QuickLogDrawer.tsx` lines 102-106. The `VoiceLogButton` re-renders on every `volume` tick (roughly 10Hz during speech). Both computations are O(n) and derived from `session.parsedItems`.

## Acceptance Criteria

- [ ] `totalCalories` is wrapped in `useMemo(() => ..., [session.parsedItems])`
- [ ] `hasParsedItems` is wrapped in `useMemo(() => ..., [session.parsedItems])` (or derived as `totalCalories > 0` after memoization)

## Implementation Notes

Simple `useMemo` wrapping — no structural change needed.

## Dependencies

- None

## Risks

- Negligible — pure derivation from stable dep

## Updates

### 2026-05-02

- Initial creation (deferred from audit M6)
