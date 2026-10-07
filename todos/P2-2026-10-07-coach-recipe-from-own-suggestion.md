---
title: "Coach Pro: 'turn that into a recipe' after a meal suggestion should generate that recipe"
status: backlog
priority: medium
created: 2026-10-07
updated: 2026-10-07
assignee:
labels: [coach, recipe-finder, ai]
github_issue:
---

# Coach Pro: "turn that into a recipe" after a meal suggestion should generate that recipe

## Summary

On device (2026-10-07), the owner listed their ingredients in Coach Pro and got a meal suggestion. They then asked "Can you turn that into a recipe for me?" and got a plain chat reply: no recipe card and no Generate button. That follow-up should produce a recipe card for the meal the coach just suggested.

## Background

Recipe requests reach the Recipe Finder only when `classifyIntent` (`server/services/coach-intent-classifier.ts`, `RECIPE_REQUEST_PATTERNS`) returns `recipe_request`. The classifier is regex-only. A probe against origin/main `68fceab6` gave:

| Message                                                      | Intent                 |
| ------------------------------------------------------------ | ---------------------- |
| Can you turn that into a recipe for me? (owner's exact text) | personalized_advice ❌ |
| Turn that into a recipe                                      | personalized_advice ❌ |
| Can you make me a recipe for chicken thighs?                 | personalized_advice ❌ |
| Come up with a low carb dinner recipe                        | personalized_advice ❌ |
| Make me a healthy pasta dish                                 | personalized_advice ❌ |
| How do I make chicken curry?                                 | personalized_advice ❌ |
| Can I get the recipe for that?                               | recipe_request ✅      |
| Find me a high protein chicken recipe                        | recipe_request ✅      |
| Create a recipe with salmon and rice                         | recipe_request ✅      |

**Two problems:**

1. **Missed phrasings.**
   - "turn X into a recipe" is never matched.
   - "make me a recipe for…" misses because `recipe_verb` has no `make` and the 4+ words before "recipe" fall outside `recipe_leading`'s {0,3} bound.
   - "come up with" isn't matched either.
2. **Referent requests.** Even when "Can I get the recipe for that?" matches, the finder searches the community catalog for the literal request. "That" refers to the coach's previous message, so the results would be unrelated. The useful action is to generate directly from the conversation.

`server/services/recipe-finder/generate.ts` already has `mode: "refine"`, which builds the recipe context from chat history (`buildRecipeContext(history)`). That is likely the building block.

## Proposed behaviour (owner saw this design 2026-10-07 and deferred it to a fresh session; re-confirm before building)

- **After a coach meal suggestion:** a request to make that suggestion into a recipe goes straight to a generated recipe card in the chat. It skips the community search and uses the suggested meal plus the ingredients from the conversation.
  - Examples: "turn that into a recipe", "can I get the recipe for that", "write that up as a recipe", "how do I make that?"
- **Non-referent phrasings** ("make me a recipe for…", "come up with a … recipe") enter the normal Recipe Finder flow.
- **Daily limits:** generation counts against the existing recipe-generation daily cap, the same as the Generate button.

## Acceptance Criteria

- [ ] The owner's exact message, sent after a coach meal suggestion, yields a recipe card for that suggested meal.
- [ ] Every ❌ row in the table above is a regression test with its intended outcome.
- [ ] Negative tests stay non-recipe and keep their current intent:
  - "that recipe was too salty";
  - "log that recipe";
  - "how many calories in that recipe";
  - "add that recipe to my meal plan".
- [ ] A referent request with no prior coach suggestion in the conversation does not generate from empty context. It falls back to the normal flow or asks a clarifying question.
- [ ] The Recipe Finder spec says Coach Pro and RecipeChef behave identically. Either RecipeChef gets the same behaviour, or the PR records why it doesn't apply there.
- [ ] Free Coach is unchanged.
- [ ] The safety intent still wins over every new pattern.

## Implementation Notes

**Read first:**

- Memory `project_recipe_finder_design_2026_09_28.md`, which holds binding rulings D1–D11 (including D10 and `classifyTurn`).
- The local-only spec `docs/superpowers/specs/2026-09-28-recipe-finder-design.md`.

**Where the code is:**

- The finder entry point in `server/services/coach-pro-chat.ts`, around lines 553–575 (`classifiedIntent === "recipe_request"` → `classifyTurn`).
- `server/services/recipe-finder/coach-turn.ts` (`classifyTurn`: new_request / refine_current / other). A "make the coach's last suggestion into a recipe" turn may fit as a new turn kind, or as `refine_current` pointed at the last assistant message.
- `server/services/recipe-finder/generate.ts` (`mode: "refine"`, history-based context).

**Watch out for:**

- Ruling "Approach 2": the server owns the steps and there are no model tool loops. Keep it that way.
- Regex additions must respect `RECIPE_REQUEST_EXCLUSIONS` and the referent/indefinite recipe logic in the same file.
- Prod model for coach-pro-chat is `openai/gpt-6-luna` via OpenRouter (Azure-pinned). Check which feature row the generation call uses.

## Scope Contract

- **Mechanisms to use:** the existing intent classifier, `classifyTurn`, and recipe-finder generate. No new model tool loop.
- **Files in scope:**
  - `server/services/coach-intent-classifier.ts`
  - `server/services/coach-pro-chat.ts`
  - `server/services/recipe-finder/**`
  - the RecipeChef equivalent, if parity applies
  - their `__tests__/`
- No client change expected. If one turns out to be needed, it ships as an OTA and says so in the PR.

## Dependencies

- None. `RECIPE_FINDER_ENABLED` is already on in prod.

## Risks

- Over-matching: chat about an existing recipe could get hijacked into generation. The negative tests are the guard.
- Generation spend per referent message. It is capped by the existing daily limit.

## Updates

### 2026-10-07

- Filed after the owner's on-device Coach Pro test. In the same session, prod routing was confirmed in the Railway logs: the coach-pro-chat requests went to openrouter, model `openai/gpt-6-luna`, with Azure as the answering provider.
