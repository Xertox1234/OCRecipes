---
title: "Memoize useDiscoveryCards visibleCards filter to stabilize array reference"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, performance]
github_issue:
---

# Memoize useDiscoveryCards visibleCards filter to stabilize array reference

## Summary

`useDiscoveryCards` computes `visibleCards` filter inline (new array ref each render) without `useMemo`. The `usageCounts` object also rebuilds on every call, making stabilization futile without memo.

## Background

Deferred from 2026-06-03 full audit (L3). File: `client/hooks/useDiscoveryCards.ts:29-31`.

## Acceptance Criteria

- [ ] `visibleCards` is computed with `useMemo` keyed on stable inputs (cards array, hidden set, usageCounts)
- [ ] `usageCounts` is also memoized or moved outside the render cycle
- [ ] Array reference is stable across renders with identical inputs

## Implementation Notes

Wrap `visibleCards` computation in `useMemo`. Identify stable deps — if `usageCounts` is derived from query data, include `queryData` as dep rather than the derived object.

## Dependencies

- None

## Risks

- Low — memoization is additive

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L3)
