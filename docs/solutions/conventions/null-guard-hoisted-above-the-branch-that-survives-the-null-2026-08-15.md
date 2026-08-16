---
title: A null-input guard hoisted to the top of a function kills the branch that legitimately survives that null
track: knowledge
category: conventions
tags: [hooks, client-state, react-native, guard-placement, null-handling, control-flow, code-review, nutrition]
module: client
applies_to: ["client/hooks/**/*.ts", "client/lib/**/*.ts", "client/components/**/*.tsx"]
symptoms: ["a control that worked yesterday now silently does nothing after a null-guard was added upstream", "a derived useMemo returns null on a path that has a perfectly good value from another source", "adding a defensive guard passes every existing test but disables a feature on one entry path"]
created: 2026-08-15
severity: medium
---

# A null-input guard belongs below the branch that legitimately succeeds without that input

## The rule

When you add a guard that returns `null` because some input is missing, place it **after**
every earlier branch that can produce a correct result *despite* that same input being
missing. The conventional instinct — guards go at the top, next to the other precondition
checks — is wrong whenever the function has more than one source for its answer.

The test for placement is not "is this input required?" It is: **"is there a path through
this function that is already correct while this input is absent?"** If yes, the guard goes
below it.

## Why this is easy to get wrong

A guard hoisted too high fails in the direction least likely to be caught:

- **It reads as more defensive, not less correct.** "Check preconditions first" is a
  well-drilled habit, and reviewers pattern-match on it approvingly.
- **The existing tests stay green.** The path it kills is, by construction, one where the
  input is null — the same shape the new guard was written to reject. A test suite that
  covers "null input" now has two behaviours under one description, and asserting either
  one looks like it covers both.
- **The symptom is silence.** The function returns `null`, its caller early-returns on
  `null`, and the UI simply stops responding. No throw, no log, no visible error.

## Worked example

`client/hooks/useNutritionLookup.ts` derives a per-100 g basis from two different sources:

```ts
const effectivePer100g = useMemo((): NutritionPer100g | null => {
  if (validatedData) return validatedData.per100g;          // ← source A
  if (!nutrition || nutrition.calories === undefined) return null;

  // The guard added by PR #819. It MUST sit here, not above.
  const grams = servingSizeGrams;
  if (!(grams != null && grams > 0)) return null;           // ← source B needs grams

  const factor = 100 / grams;
  // …back-calculate from `nutrition`
}, [validatedData, nutrition, servingSizeGrams]);
```

`servingSizeGrams === null` means two entirely different things depending on which source
is live:

| Path | `servingSizeGrams` | `validatedData` | Correct result |
| --- | --- | --- | --- |
| Saved item (`itemId`) — effect calls only `setNutrition` | `null` | `null` | **unresolvable** — there is no basis, and back-calculating from per-serving values fabricates one |
| Direct-OFF fallback — record whose `serving_size` is `"1 bottle"` | `null` | present | **`validatedData.per100g`** — the weight is unknown but the per-100 g values are real and published |

The second row is the trap. It is a real, shipping path: an Open Food Facts record can
carry trustworthy per-100 g nutriments alongside a serving string with no metric quantity,
so a null weight there is expected, not degenerate. Hoisting the `grams` guard three lines
up nulls that out too — and `recalculateNutrition`, the memo's consumer, early-returns on
`null`, so the serving-size chips and the quantity stepper stop updating the card. Silently.

## How to apply

1. **Before adding the guard, enumerate the function's sources of truth.** A leading
   `if (x) return …` / `??` chain, an early return from a cache, a prop that overrides
   computed state — each is a branch that may not need your input at all.
2. **Place the guard immediately above the first use of the input**, not at the top of the
   body. Proximity to the division/index/dereference that actually needs it is what keeps
   the placement obvious to the next editor.
3. **Write the placement pin as its own test.** Assert that a path with the input absent
   *and* an alternate source present still produces its value. That test passes before your
   change — it is a placement pin, not a bug reproduction, and it should say so in a
   comment or it will read as redundant and get deleted.
4. **Say so in the code.** A one-line "this sits below the `validatedData` branch because
   …" is what stops a future tidy-up from hoisting it back.

## Reviewing for it

When a diff adds a `return null` guard, look upward from the insertion point, not downward.
Any `return` above it is a branch the guard now shadows — ask whether that branch was
correct with the input absent. If the diff adds no test that exercises "input absent +
alternate source present", that gap is the finding.

## Related

- [[truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30]] — the mirror
  failure: *removing* a truthiness guard silently drops its decision about every falsy
  value, not just the one being replaced. Same family, opposite direction; codified from
  PR #740, the sibling fix one layer down in this same hook.
- [[lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10]] — a guard that is
  positioned correctly but is unreachable because an upstream parser never fails.
- [[derived-label-gated-to-flow-that-populates-its-state-2026-07-17]] — the multi-mode
  screen shape that produces these "null on one entry path, real on another" states in the
  first place.
