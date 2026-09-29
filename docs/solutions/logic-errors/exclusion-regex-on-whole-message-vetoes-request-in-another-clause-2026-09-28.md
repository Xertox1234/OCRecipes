---
title: "An exclusion regex tested against the whole message vetoes a real request in another clause — scope the veto to the clause or span the request matched"
track: bug
category: logic-errors
tags: [ai-prompting, testing, intent-classification, regex]
module: server
applies_to: ["server/services/coach-intent-classifier.ts", "server/services/**/*classif*.ts"]
symptoms: ["\"Find me a recipe, I don't like that recipe\" stops routing to the recipe finder after an exclusion for actions on an existing recipe is added", "Every hand-written must-route and must-NOT-route test passes, yet a generated corpus shows many rows changed from routed to not-routed and none the other way", "A docblock says \"a request for A recipe still routes\" and is false for any message with two clauses"]
created: 2026-09-28
severity: medium
---

# An exclusion regex tested against the whole message vetoes a real request in another clause

## Problem

#1152 stopped Coach sending actions on a recipe the user already has ("add this recipe to my meal plan") to the recipe finder. It did this with `RECIPE_REQUEST_EXCLUSIONS`, which is checked with `.some((re) => re.test(trimmed))` **before** any request pattern runs. The new referent exclusion `/\b(?:this|that|these|those|my)\s+(?:[\w-]+\s+){0,2}recipes?\b/i` is unanchored. A demonstrative or possessive "recipe" **anywhere** in the message therefore cancels a genuine request **elsewhere** in it:

- "Find me a recipe, I don't like that recipe"
- "Give me a recipe similar to my lasagna recipe"
- "Find me a new recipe for my recipe box"

## Symptoms

- All three reviewers of #1152 measured it against `main`. ai-reviewer ran 6 openers × 4 objects × 15 tails = 360 generated rows: **168 went from routed to not-routed, and 0 the other way**. Every lost row came from one of the 7 tails that contain a qualified "recipe".
- The 16 must-NOT-route cases and 8 must-route controls written with the fix all passed. Every one was a single clause, so the list could not contain the failing shape.

## Root Cause

A veto and a match were computed over different extents. The request pattern matches one clause, but the exclusion was allowed to match any clause, and the classifier treated "an exclusion matched somewhere" as "this message is not a request". The hand-written corpus came from the cases the author already had in mind (one clause each), so it reproduced that blind spot.

## Solution

The fix is tracked in `todos/P2-2026-09-28-recipe-finder-referent-exclusion-vetoes-compound-requests.md`, which must land before `RECIPE_FINDER_ENABLED` is flipped. The reviewers proposed three shapes; measure them against each other:

1. Apply the exclusions only to the clause (split on `[,;—.?!]`) that contains the request-pattern hit, or only when the exclusion's `.index` overlaps or comes before the request match.
2. Gate the referent exclusion on the absence of an indefinite request with a negative lookahead (`a|an|another|new|different|some … recipe` not followed by `to|on|in|into`). This measured `bad=0` on the shipped lists plus 4 compound rows.
3. Skip the referent exclusion after a comparator (`like|similar to|than|based on|instead of`). This recovers 5 of the 7 lost tails.

Whichever shape is chosen, "I want to add a recipe to my meal plan" must stay excluded. A bare indefinite-article override would let it back in.

## Prevention

- When adding an exclusion to a classifier, test it on **compound** messages: a genuine request clause joined to a clause that triggers the exclusion. Generate them as openers × tails, never as a hand list.
- Report each change as a pair of directions against the base (`routed→not`, `not→routed`). A one-sided swing across many rows means the new rule is wider than its intent.
- A docblock sentence like "X still routes" is a claim over all messages, so test it on the compound shape.

## Related Files

- `server/services/coach-intent-classifier.ts` — `RECIPE_REQUEST_EXCLUSIONS`
- `server/services/__tests__/coach-intent-classifier.test.ts` — `recipe_request routing (R4)`

## See Also

- [classify a command by its full text](classify-a-command-by-its-full-text-not-its-display-line-2026-09-26.md) — the same "the extent you match over decides the verdict" family
- [safety flag must veto, not alias](safety-flag-must-veto-not-alias-2026-08-16.md) — when a veto *is* the right shape
