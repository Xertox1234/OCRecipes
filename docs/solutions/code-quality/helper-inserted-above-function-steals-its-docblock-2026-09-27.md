---
title: "A helper inserted between a docblock and its function steals the docblock — JSDoc attaches to the next declaration, so hover and review read it on the wrong symbol"
track: bug
category: code-quality
module: server
tags: [typescript, architecture, documentation, jsdoc]
applies_to: [server/**/*.ts, shared/**/*.ts, client/**/*.ts, client/**/*.tsx]
symptoms: ["Hovering a new type or constant shows a docblock that describes a different function", "A function that had a docblock shows none after an edit that did not touch it", "A review flags a comment as false for the symbol it sits on"]
created: '2026-09-27'
severity: low
---

# A helper inserted between a docblock and its function steals the docblock

## Problem

Adding a helper "just above the function that uses it" by anchoring on the function's
signature line inserts the helper **between** the function and its `/** … */` block. JSDoc
and TSDoc attach a block comment to the next declaration, so the old docblock now documents
the helper, and the function it describes has none.

It happened twice in one session:
- #1126: `DEHYDRATED_WORDS`/`isUnaskedDehydratedForm` landed under `scoreCNFMatch`'s
  docblock (caught before commit by reading the diff).
- #1128: `type UsdaNutrient`, `KJ_PER_KCAL` and `usdaKcal` landed under
  `mapUsdaFoodToNutrition`'s docblock. Code review caught it: hover on `UsdaNutrient`
  showed "Map a parsed USDA food … to NutritionData".

## Symptoms

- IDE hover and generated docs show the wrong text on the new symbol.
- The original function loses its documentation silently.

## Root Cause

An edit anchored on `function name(` inserts text directly above that line. The docblock
sits above the anchor, so the insertion lands between the docblock and the function.

## Solution

Anchor the insertion **above the docblock**: search back from the function signature for
its `/**`, and insert before it. Or, after the edit, read the lines just above each
function whose neighbourhood changed.

## Prevention

- When a diff adds declarations immediately before an existing function, check that
  function's docblock still sits directly on it.
- A docblock that names a shape ("`{ nutrientName, value }`") must be updated in the same
  change that widens the shape.

## Related Files

- `server/services/nutrition-lookup.ts`: `scoreCNFMatch`, `mapUsdaFoodToNutrition`

## See Also

- [kj-to-kcal-conversion-nutrition-parsers](../conventions/kj-to-kcal-conversion-nutrition-parsers-2026-05-13.md) — the #1128 change where the docblock moved
