---
title: "Remove redundant non-null assertion in AdaptiveGoalCard inside null guard"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Remove redundant non-null assertion in AdaptiveGoalCard inside null guard

## Summary

`AdaptiveGoalCard.tsx:248` uses a `!` non-null assertion on `recommendation.weightTrendRate!` inside a `!= null` guard where TypeScript already narrows the type. Redundant assertion suppresses future type safety.

## Background

Deferred from 2026-06-03 full audit (M11). File: `client/components/AdaptiveGoalCard.tsx:248`.

## Acceptance Criteria

- [ ] `recommendation.weightTrendRate!` → `recommendation.weightTrendRate` (remove `!`)
- [ ] TypeScript compiles with no new errors at that line

## Implementation Notes

One-character change. The `!= null` guard at the enclosing `if` already narrows the type; the `!` is dead.

## Dependencies

- None

## Risks

- None — purely removing a redundant operator

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M11)
