---
title: "An exclusion regex tested against the whole message vetoes a real request in another clause — key the veto on order, and never let the gate that lifts it consume the vetoed token"
track: bug
category: logic-errors
tags: [ai-prompting, testing, intent-classification, regex]
module: server
applies_to: ["server/services/coach-intent-classifier.ts", "server/services/**/*classif*.ts"]
symptoms: ["\"Find me a recipe, I don't like that recipe\" stops routing to the recipe finder after an exclusion for actions on an existing recipe is added", "Every hand-written must-route and must-NOT-route test passes, yet a generated corpus shows many rows changed from routed to not-routed and none the other way", "A docblock says \"a request for A recipe still routes\" and is false for any message with two clauses"]
created: 2026-09-28
last_updated: 2026-09-28
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

#1156 measured the three shapes the reviewers proposed on 587 labelled rows. The rows were the shipped test lists, 6 openers × 4 objects × 19 tails, hand-written compounds, and the 41 eval cases.

| shape | new-recipe requests missed | must-NOT-route rows routed |
|---|---|---|
| base (#1152) | 274 | 0 |
| clause scoping | 197 | 2 |
| indefinite-anywhere lookahead | 26 | 8 |
| comparator skip | 126 | 0 |
| **order: no indefinite recipe before the referent** | 3 | 0 |

- **Clause scoping** fails because splitting re-anchors `^`-anchored `recipe_leading` on a fragment: "I need a grocery list for my recipe, a big recipe for 8" routed.
- **The lookahead** fails on referent-first actions: "Turn my chili recipe into a slow-cooker recipe".
- **Order is the signal.** Request first means the referent is a comparison or an aside ("a recipe like my lasagna recipe"). Referent first means the message acts on it.

The shipped exclusion is `^(?:(?!INDEFINITE_RECIPE)[\s\S])*?REFERENT_RECIPE`. It is one left-to-right pass, ≤1 ms at 2–4× the 2000-char cap.

**Second defect, found in review:** `INDEFINITE_RECIPE`'s `{0,3}` modifier window could swallow the referent. "I want a name for my recipe" matched as the indefinite phrase `a name for my recipe`, so the scan never reached "my recipe" and the veto lifted. That was 2240 of 3360 generated actions (5 heads × 7 determiners × 8 nouns × 4 prepositions × 3 referents). Main routed 0 of them. The fix: a modifier is never a referent determiner (`(?:(?!REFERENT_DETERMINER\b)[\w-]+\s+){0,3}`), so the phrase that lifts the veto cannot contain the token the veto keys on.

Known residual: a referent-first message that then asks for a new recipe ("My chili recipe is boring. Find me a better one") stays with the Coach, as it did on the base.

## Prevention

- When adding an exclusion to a classifier, test it on **compound** messages: a genuine request clause joined to a clause that triggers the exclusion. Generate them as openers × tails, never as a hand list.
- Report each change as a pair of directions against the base (`routed→not`, `not→routed`). A one-sided swing across many rows means the new rule is wider than its intent.
- A docblock sentence like "X still routes" is a claim over all messages, so test it on the compound shape.
- When a pattern **lifts** a veto, check that it cannot match across the token the veto keys on. A generated corpus must vary every slot the pattern has, including the filler between determiner and noun. In the #1156 corpus every indefinite phrase ended at its own "recipe", so no row put a referent inside the modifier window, and the corpus could not see the swallow.

## Related Files

- `server/services/coach-intent-classifier.ts` — `RECIPE_REQUEST_EXCLUSIONS`
- `server/services/__tests__/coach-intent-classifier.test.ts` — `recipe_request routing (R4)`

## See Also

- [classify a command by its full text](classify-a-command-by-its-full-text-not-its-display-line-2026-09-26.md) — the same "the extent you match over decides the verdict" family
- [safety flag must veto, not alias](safety-flag-must-veto-not-alias-2026-08-16.md) — when a veto *is* the right shape
