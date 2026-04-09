---
title: "Clean up duplicate _testInternals export in cooking route"
status: backlog
priority: low
created: 2026-04-09
updated: 2026-04-09
assignee:
labels: [code-quality, audit-9]
---

# Clean up duplicate _testInternals export in cooking route

## Summary

`server/routes/cooking.ts` exports `_testInternals` that duplicates access through `sessions._testInternals`. The route-level export should reference the sessions export instead of re-wrapping.

## Background

Audit #9 finding L16. After cooking session consolidation, there are two paths to the same internal state.

## Acceptance Criteria

- [ ] Single source of truth for test internals (via sessions module)
- [ ] Cooking route tests updated to use the canonical path
- [ ] All cooking tests pass
