---
title: "AI output that announces an allergen as absent ('gluten-free' tags) trips the fail-closed allergen filter and empties the result — fix the prompt, never loosen the filter"
track: bug
category: logic-errors
module: server
severity: medium
tags: [ai-prompting, allergens, nutrition, safety, string-matching, testing]
symptoms: [Every AI idea card is dropped for one allergy (gluten) while other allergies get cards, The eval case returns null / "returned null" for a severe-gluten profile asking for pasta or baked goods, Raw drafts are fine dishes but each carries a "gluten-free" tag or "dairy-free" in its description, The filter is working exactly as designed — no unit test is red]
applies_to: [server/services/inspired-recipes/suggest-listing.ts, server/services/**/*.ts, evals/datasets/inspired-suggestions-cases.json]
created: 2026-10-16
---

# AI output that announces an allergen as absent trips the fail-closed allergen filter and empties the result

## Problem

`dropAllergenConflicts` (`server/services/inspired-recipes/suggest-listing.ts`) drops any AI-written idea card whose title, description or tags name one of the user's allergens. It is fail-closed on purpose: a mention is a conflict. For a severe gluten allergy asking for "comforting pasta and baked goods", eval case `insp-gluten-celiac-01` returned `null`. Every card had been dropped, and the user saw nothing (#1464).

## Symptoms

See frontmatter. The trap is that nothing is broken in isolation. The model behaves "helpfully", the filter behaves "safely", and their composition is an empty screen.

## Root Cause

Two safety measures cancelled out:

- **The model reassures.** Told about an allergy, it tags every card "gluten-free". In run 1 of the measurement, 8 of 8 cards carried that tag.
- **The filter cannot read negation.** `detectAllergens` matches the allergen word, so "gluten-free" is a gluten hit, and the card is dropped. Teaching it to accept "X-free" would be the dangerous direction: "gluten-free pasta" for a wheat allergy is a substituted staple, and an earlier rule in the same prompt already bans naming it.

The earlier prompt rule ("don't name foods that contain an allergen, even as 'X-free' versions") covered dish names, not tags, so the model kept announcing safety in the tags.

## Solution

Fix the producer, not the guard. One prompt line (#1464):

```
Never write a listed allergen's name anywhere in a card, tags included: no "gluten-free", "wheat-free", "dairy-free" or "nut-free" tag, title or description. The profile is already respected, so don't announce it; use tags for flavour, cuisine, texture or method instead.
```

The filter and the shared matcher are unchanged and still fail closed. After the fix, 8 of 8 live runs returned 7–8 cards. A 7-card run lost a real wheat dish such as couscous to the filter, which is correct.

## Prevention

- When a fail-closed text filter sits behind an LLM, the prompt must forbid the LLM from writing the guarded words **in any field the filter reads**, including the reassuring negated form. Pin it with a prompt test (`suggest-listing.test.ts` asserts `tags included` and the `"gluten-free", "wheat-free"` list).
- Add a filter test with a negated-form tag (`tags: ["gluten-free"]`) that must still be dropped, so nobody "fixes" the empty result by teaching the filter negation.
- Keep an eval case for each allergy whose natural request is that allergen's staple (gluten → pasta and bread), and treat `returned null` as a failure.
- Diagnose an empty AI result by **logging the raw drafts and the drop reason per card** before changing anything. The cause was visible in one run of raw output.

## Related Files

- `server/services/inspired-recipes/suggest-listing.ts`: system prompt, `dropAllergenConflicts`
- `server/services/inspired-recipes/__tests__/suggest-listing.test.ts`
- `evals/datasets/inspired-suggestions-cases.json`: `insp-gluten-celiac-01`

## See Also

- [allergen-filter-on-free-text-misses-canonical-ids-and-punctuation](allergen-filter-on-free-text-misses-canonical-ids-and-punctuation-2026-10-13.md) — how this filter came to use the canonical matcher
- [presence-matcher-false-flags-negated-free-from-form](presence-matcher-false-flags-negated-free-from-form-2026-07-22.md) — the opposite trade-off for display labels, where a "free-from" form must NOT flag
