---
title: A disjunctive gate whose alternatives fail to the same root cause is a single point of failure wearing an OR
track: bug
category: logic-errors
tags: [validation, ocr, nutrition, label-override, fail-silent, corroboration, gate-design]
module: shared
applies_to: ["client/lib/nutrition-ocr-parser.ts", "server/services/label-override.ts", "client/hooks/useNutritionLookup.ts"]
symptoms: ["A photographed label is discarded and database values are shown, with no error and no notice", "The discarded label visibly contained the right numbers — a human reading the OCR dump can see them", "The displayed value is an exact per-100 g/mL figure presented as if it were the whole serving", "Requiring 'field A or field B' looks like cheap redundancy but rejects nearly every real input"]
created: 2026-07-30
severity: high
---

# A disjunctive gate whose alternatives fail to the same root cause is a single point of failure wearing an OR

## Problem

Scanning a Cherry Coke can (`06772408`) and photographing its Nutrition Facts
panel showed **39 kcal**. The can is ~140. The label had been read successfully.

Both the client readiness gate and the server override gate required:

```ts
calories != null && (totalSugars != null || totalFat != null) && servingSize != null
```

## Symptoms

- The label is silently unused; the screen falls back to the product database.
- The value shown is the database's **per-100 g/mL** figure displayed as a
  serving, because the serving-size correction rides on the same rejected label.
- Nothing errors. A refusal to compare returns the same response shape as
  agreement, so the client cannot tell "we checked and it matched" from "we
  declined to check".

## Root Cause

The verbatim device OCR was:

```
Per 1 can (355 mL)
Calories 140
Fat / Ipldes 0 9
hydrate / Glucldes 39g
Sugars Sucres 39 9
Sodlum 30 mg
```

Three of the four gate clauses passed: `calories` = 140, `servingSize` =
`"1 can (355 mL)"` (the Canadian `Per …` pattern handles this and yields 355).
The gate failed **only** on `(totalSugars != null || totalFat != null)`.

And both of those failed to **one** cause: the recogniser reads `g` as `9`
(`Sugars Sucres 39 9`, `Fat / Ipldes 0 9`). The field patterns require a literal
`g` after the number, so a single substitution class takes out sugars and fat
*together*. "Either one" was never independent corroboration — the alternatives
share a failure mode, so the disjunction has exactly the reliability of one
clause while reading like two.

`fixOCRDigits` exists to repair such misreads, but it runs on the **captured
value**, after a successful match. These substitutions break the match, so
repair never gets a chance to run.

## Solution

Require only the fields the decision actually rests on, and make each one carry
its own weight:

```ts
// client/lib/nutrition-ocr-parser.ts
export function isLabelReady(parsed: LocalNutritionData | null | undefined): boolean {
  if (parsed == null || parsed.calories == null) return false;
  return parseLabelServingGrams(parsed.servingSize) != null;
}
```

- `calories` — the value being adopted.
- a **parseable** serving — what that value is *per*. Without it the calorie
  figure would be presented as whatever serving the database assumed, which is
  the bug itself relocated.

The same relaxation must land on **both** gates in the same change. A server
refusal returns the agreement-shaped body, so a client that sends what the
server rejects produces database values with no indication the label was dropped.

## Prevention

- When a validation requires "A or B", ask what makes A and B fail. If one root
  cause can take out every alternative, the disjunction is decoration.
- Prefer requiring the fields the decision *uses* over demanding unrelated
  fields as a proxy for confidence.
- A gate whose failure path substitutes **less trustworthy** data is not
  conservative. Falling back to the database here is what put a wrong number in
  a food log; "on doubt, use the other source" is only safe when the other
  source is actually better.
- Capture real device output as a test fixture, defects included. A cleaned-up
  fixture would have passed this gate and hidden the whole defect — two separate
  hypotheses about the cause (a newline-spanning capture; unsupported Canadian
  wording) were both *disproven* by the raw dump.

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — `isLabelReady`, `FIELD_PATTERNS`, `SERVING_PER_PATTERN`
- `server/services/label-override.ts` — `buildLabelConflict` presence gate
- `client/hooks/useNutritionLookup.ts` — `labelReady`, and the `grams = servingSizeGrams || 100` fallback that renders the un-scaled value
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — the verbatim Cherry Coke fixture

## See Also

- [Explicit-zero corroboration must not inherit the nonzero path's guards](explicit-zero-corroboration-needs-contradiction-checks-2026-07-17.md) — the neighbouring nutrition-trust failure, where the guard was too strict rather than falsely redundant
- [../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md](../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — relaxing this very gate broke downstream code that had relied on the removed guarantee
