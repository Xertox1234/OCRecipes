---
title: "A helper that takes the REMAINING budget but computes target − remaining as the gap reports what was EATEN — the meal hint pushed the nutrient the user had most of, and its own unit tests encoded the same misreading"
track: bug
category: logic-errors
tags: [ai-prompting, typescript, testing, nutrition]
module: server
applies_to: ["server/lib/macro-gap-context.ts", "server/services/meal-suggestions.ts", "evals/datasets/meal-suggestion-cases.json"]
symptoms: ["The meal-suggestion prompt says 'The user is 120g short on protein' for a user who has eaten 120 g of protein and has 30 g left", "A user with 400 calories left is told to prioritise calorie-dense meals of at least 500 calories", "A nutrient hint fires on most eval cases, including ones whose story has nothing to do with a gap"]
created: 2026-09-30
severity: high
---

# A helper that takes the remaining budget but treats target − remaining as the gap reports what was eaten

## Problem

`buildMacroGapEmphasis(targets, remaining)` (`server/lib/macro-gap-context.ts`) adds an
"IMPORTANT: the user is N short on X — prioritise X-dense options" line to the meal-suggestion
prompt. Its only caller passes `remainingBudget`, which the route computes as
`max(0, target − consumed)` (`server/routes/meal-suggestions.ts`). The helper took
`target − remaining` as the gap. That is the amount already **eaten**. So the hint named the
nutrient the user had eaten the most of, as if they were short of it:

- 120 g of a 150 g protein target eaten (30 g left) → "120g short on protein".
- Everything eaten (all remaining 0) → "150g short on protein".
- Nothing eaten yet (remaining = target) → no hint, although every nutrient is 100% to go.
- In the eval set: "very-low-budget-04" (400 of 2000 calories left) → "1600cal short on calories —
  prioritise calorie-dense (≥500cal)". The hint fired on 16 of 19 cases.

It shipped in May (37f04da7, "steering the LLM toward the most-deficient nutrient") and ran
until 2026-09-30.

## Why nothing caught it

Every layer shared the same reading of the word "remaining":

- The unit tests wrote "31% short: consumed 31g, remaining 69g" and asserted the protein hint.
  The comment and the code agreed with each other, so the suite (and Stryker at 100%) certified
  the inversion.
- The eval cases were calibrated to trigger the hint under the inverted formula ("User 75% short
  on protein" with 40 of 160 g *remaining*), and a solution doc taught that calibration as the
  correct example.
- The service test asserted `toContain("protein")`, which the DAILY TARGETS line satisfies on its
  own.

What caught it was a property written from the **intent**, not from the code: "when nothing
remains, the hint names nothing" (Lane B property tests, Task 4). It failed on the real code.

## Fix

The hint now fires when a macro **lags the day**: its eaten share trails the eaten share of
calories by more than 0.30. It names the macro that lags most and reports how much of it is
still left (the same number as the prompt's REMAINING BUDGET line). Calories are the reference,
never the subject, so the prompt can no longer push calorie-dense meals. Nothing lags before
anything is eaten, so breakfast gets no hint. Eval cases 17–19 kept their stories and got
remaining amounts that match them. The hint now fires on exactly those three.

## Rule

- When a function takes a quantity whose name has a direction (`remaining`, `consumed`, `left`,
  `used`), check the **caller's** computation of it, not the parameter name. Write the
  direction into the doc comment: "`remaining` is target − consumed".
- A test comment that restates the formula ("consumed 31g → 31% short") certifies nothing.
  At least one test must be written from the user story ("nothing eaten yet → no hint",
  "everything eaten → no hint") without consulting the formula.
- An assertion on a word the prompt already contains elsewhere is vacuous. Assert the
  emphasis line's own text (`"The user is 135g short on protein today"`).
