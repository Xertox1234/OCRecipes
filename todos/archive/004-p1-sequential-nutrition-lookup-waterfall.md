---
title: "Sequential nutrition lookup waterfall in food-nlp"
status: backlog
priority: critical
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [performance, code-review, ai-services]
---

# Sequential Nutrition Lookup Waterfall in food-nlp

## Summary

`server/services/food-nlp.ts` (lines 59-94) looks up nutrition for each parsed food item sequentially. If GPT returns 5 items, each taking 1-3 seconds, total response time is 5-15 seconds.

## Background

After GPT parses natural language text into food items, each item's nutrition is fetched one-at-a-time using `lookupNutrition`. The `batchNutritionLookup` function already exists in the same codebase and handles parallel lookups with rate limiting, but it's not being used here.

## Acceptance Criteria

- [ ] Replace sequential `for` loop with `Promise.all` or `batchNutritionLookup`
- [ ] Response time < 3s for typical 3-5 food item inputs
- [ ] Error handling still per-item (one failure shouldn't block others)

## Implementation Notes

- Use `Promise.allSettled` to handle individual failures gracefully
- The existing `batchNutritionLookup` function may need adaptation for this use case

## Updates

### 2026-02-24

- Found during code review by performance-oracle agent
