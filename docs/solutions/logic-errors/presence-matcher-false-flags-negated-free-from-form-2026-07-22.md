---
title: "A presence matcher for a negatable attribute false-flags the 'free-from' form (caffeine-free → Contains caffeine)"
track: bug
category: logic-errors
tags: [ingredient-matching, regex, false-positive, i18n, caffeine, nutrition, negation, detection]
module: server
applies_to: ["server/services/nutrition-flag-rules.ts", "server/services/universal-flags.ts", "shared/constants/allergens.ts"]
symptoms: ["A 'Contains X' flag/label appears on a product that explicitly declares it is X-FREE", "The false positive is multilingual — triggers on foreign-language 'free-from' phrasings even when the English one was hand-checked", "An explicit numeric 0 (or a broad category) is treated as presence of the attribute"]
created: 2026-07-22
severity: medium
---

# A presence matcher for a negatable attribute false-flags the 'free-from' form (caffeine-free → Contains caffeine)

## Problem

The Smart Scan caffeine detector (PR #694) raised a "Contains caffeine" flag on **caffeine-FREE** products. The ingredient-text signal was a bare substring alternation:

```ts
const CAFFEINE_INGREDIENT_RE = /caffeine|caféine|cafeina|cafeína|koffein|guaraná|guarana/i;
```

The attribute's own token appears **verbatim inside the phrase that negates it**, so the matcher fires on the negation:
- German `koffeinfrei` (caffeine-free) contains `koffein`.
- English `caffeine-free` contains `caffeine`.
- Spanish `sin cafeína` (without caffeine) contains `cafeína`.

Two adjacent signals compounded it: an explicit `caffeine: 0` was treated as presence (`!== undefined`), and a decaf-eligible category (`en:coffees`) fired even for a decaffeinated coffee.

## Symptoms

- A decaf/free-from product shows "Contains caffeine" (info) despite declaring zero caffeine.
- The bug is invisible in English-only review — a hand-checked `caffeine-free` case might be caught, but `koffeinfrei` / `sin cafeína` slip through because the reviewer never fed a foreign negated fixture.
- Every unit test passed: the fixtures only ever contained *caffeinated* products, so the false-positive direction was untested.

## Root Cause

Presence detection for a **negatable** attribute treated "the token is present in the text" as "the attribute is present in the product." For a negatable attribute those are different propositions — the token is equally present in `koffein` (has it) and `koffeinfrei` (explicitly lacks it). Word boundaries alone do **not** fix it: `\bcaffeine\b` still matches the whole word in `caffeine-free` (the hyphen is a boundary), and `\b` misbehaves around accented letters (`é`/`í`), risking new false negatives.

The deeper cause is a review/test blind spot: a matcher for a negatable concept was only ever exercised with the positive case, so no fixture could expose the negated-form false positive.

## Solution

Add an explicit **negation/decaf regex** that suppresses the presence signal, and require numeric signals to be strictly positive:

```ts
// nutrition-flag-rules.ts — multilingual caffeine-free / decaf suppressor
export const CAFFEINE_FREE_RE =
  /caffeine[-\s]?free|decaffeinat|\bdecaf\b|koffeinfrei|entkoffeiniert|descafein|sin\s+cafe[íi]na|d[eé]caf[eé]in|sans\s+caf[eé][íi]?ne|senza\s+caffeina|decaffeinato/i;

// universal-flags.ts — gate ALL presence signals on !caffeineFree, and require > 0
const caffeineFree =
  servingMg === 0 || per100Mg === 0 ||
  (input.ingredientsText != null && CAFFEINE_FREE_RE.test(input.ingredientsText));
const hasCaffeineSignal =
  !caffeineFree &&
  ((servingMg !== undefined && servingMg > 0) ||
   (per100Mg !== undefined && per100Mg > 0) ||
   (input.ingredientsText != null && CAFFEINE_INGREDIENT_RE.test(input.ingredientsText)) ||
   input.categoriesTags.some((t) => CAFFEINE_CATEGORY_TAGS.includes(t)));
```

The suppressor is stem-based (`decaffeinat`, `descafein`, `d[eé]caf[eé]in`) so it catches inflections across languages, and it gates the category signal too, so a decaf coffee stops flagging. The discriminating test is that the *positive* still fires: `"Wasser, Zucker, Koffein"` → "Contains caffeine", while `"koffeinfrei"` → nothing.

## Prevention

**When you build presence-detection for any negatable attribute (caffeine, gluten, dairy, "free-from", allergens), the test set and the review MUST include the negated form** — in every language the matcher claims to support. A matcher tested only on the positive case is structurally blind to the false-positive direction. Prefer an explicit negation/exclusion pass over trusting word boundaries, which break on hyphens and accented letters.

## Related Files

- `server/services/nutrition-flag-rules.ts` — `CAFFEINE_INGREDIENT_RE`, `CAFFEINE_FREE_RE`
- `server/services/universal-flags.ts` — the caffeine ladder / `hasCaffeineSignal`
- `server/services/__tests__/universal-flags.test.ts` — the negated fixtures (koffeinfrei / caffeine-free / sin cafeína / explicit-0)

## See Also

- [allergen matcher false-flags plant substitutes](allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md) — sibling false-positive in the same keyword-matcher family (almond milk → dairy)
- [allergen matcher singular-only under-detection](allergen-keyword-matcher-singular-only-plural-under-detection-2026-07-21.md) — the opposite direction (missed plurals) in the same family
- [broadened matcher needs new-input regression tests](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — the general testing rule this instantiates for the negated direction
- [quote-strip escape glue hides a real command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — another matcher fooled by structure inside the text it scans
