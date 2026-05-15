---
title: "Consolidate duplicated buildDietaryContext functions"
status: backlog
priority: medium
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [code-quality, audit-2026-04-02-full]
audit_id: M16
---

# Consolidate duplicated buildDietaryContext functions

## Summary

Three service files have near-identical `buildDietaryContext` functions that build dietary context strings from UserProfile. Consolidate into a single shared function.

## Background

Found during full audit 2026-04-02 (finding M16). The variants:

- `recipe-generation.ts:105-144` — basic (allergies, dietType, cookingSkill, cookingTime)
- `meal-suggestions.ts:73-138` — extended (adds foodDislikes, cuisinePreferences, expanded allergens)
- `recipe-chat.ts:175-252` — `buildSystemPrompt` has a third variant in prompt construction

## Acceptance Criteria

- [ ] Single `buildDietaryContext(profile, options?)` function created in `server/lib/dietary-context.ts`
- [ ] All 3 services import from the shared function
- [ ] Options parameter controls level of detail (basic vs extended)
- [ ] Existing behavior preserved exactly
- [ ] Tests pass

## Implementation Notes

- The meal-suggestions version is the most complete — use as canonical base
- The recipe-chat version is embedded in a larger system prompt builder, so may need a different extraction approach

## Risks

- Different services may rely on subtle formatting differences in the context string

## Updates

### 2026-04-02

- Deferred from full audit — moderate effort refactoring with no production risk
