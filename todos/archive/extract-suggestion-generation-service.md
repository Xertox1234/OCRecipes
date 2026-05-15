---
title: "Extract suggestion generation to dedicated service"
status: in-progress
priority: high
created: 2026-04-07
updated: 2026-04-07
assignee:
labels: [architecture, layer-violation]
---

# Extract suggestion generation to dedicated service

## Summary

`server/routes/suggestions.ts` directly calls OpenAI (lines 144, 336) and builds dietary context inline, violating the routes-delegate-to-services pattern. Extract to `server/services/suggestion-generation.ts`.

## Background

Every other AI call in the codebase goes through a service file (photo-analysis, recipe-generation, nutrition-coach, etc.). The suggestions route is the sole exception, with 382 lines of prompt construction and AI invocation mixed into route handlers. It also duplicates `buildDietaryContext()` logic (lines 82-99, 268-282) instead of using `server/lib/dietary-context.ts`.

## Acceptance Criteria

- [ ] New `server/services/suggestion-generation.ts` with `generateSuggestions()` and `generateInstructions()`
- [ ] Route handlers reduced to thin controllers (parse, delegate, respond)
- [ ] Uses `buildDietaryContext()` from `server/lib/dietary-context.ts` instead of inline construction
- [ ] All existing suggestion tests pass
- [ ] No direct `openai` import in `server/routes/suggestions.ts`

## Implementation Notes

- Move system prompts, user prompt construction, and OpenAI calls to the service
- The caching logic (lines 37-71, 175-224) can stay in the route or move to storage
- The service should accept parsed user profile + query params, not raw request objects

## Updates

### 2026-04-07

- Identified in full audit #6 (H1)
