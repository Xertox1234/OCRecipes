---
title: "Cap unbounded query limit params on multiple endpoints"
status: backlog
priority: low
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [performance, code-review, security]
---

# Cap Unbounded Query Limit Parameters

## Summary

Several endpoints accept `limit` query params without upper-bound validation. Some routes properly use `Math.min()` but exercises, weight, and adaptive-goals routes do not.

## Background

Also, several storage methods return all rows with no limit: getSavedItems, getGroceryLists, getPantryItems, getChatConversations, getWeightLogs (no options), getExerciseLogs (no options).

## Acceptance Criteria

- [ ] All endpoints that accept `limit` use `Math.min(parsedLimit, 100)` consistently
- [ ] Storage methods have default limits on unbounded queries
- [ ] Resource exhaustion via `?limit=999999999` prevented

## Updates

### 2026-02-24
- Found by security-sentinel and performance-oracle agents
