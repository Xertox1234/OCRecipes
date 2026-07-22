---
title: "On a user-safety classifier, an ambiguous separator must fail toward over-flag, never suppression"
track: knowledge
category: conventions
tags: [allergen, safety, regex, matcher, fail-safe, mutation-testing, over-flag]
module: shared
applies_to: ["shared/constants/allergens.ts", "shared/constants/__tests__/allergens.test.ts"]
created: 2026-07-21
---

# On a user-safety classifier, an ambiguous separator must fail toward over-flag, never suppression

## When this applies

Any classifier whose output gates a **user-safety signal** where the two failure
directions are asymmetric — one is annoying, the other is dangerous. The canonical
case here is the allergen engine (`ingredientContainsKeyword` in
`shared/constants/allergens.ts`): a *plant-substitute guard* suppresses the
dairy/wheat allergen when a plant qualifier precedes a bare keyword (`"almond milk"`
carries no milk). **Suppression removes an allergen flag, so it is the dangerous
direction; over-flagging (a false warning) is the safe direction.**

The guard joins the qualifier to the keyword with a small separator character class
(`[\s\-]`). The temptation is to widen that class to match the keyword-matcher's own
word-boundary set (`[\s,;/()\-]`) so compact forms like `"almond/milk"` stop
over-flagging. **Do not widen it to any separator whose meaning is ambiguous.**

## Smell patterns

- Two sibling regexes/parsers that must "agree" on a boundary, and a PR that closes
  the gap by copying one char class into the other.
- A separator being reclassified from "delimiter" to "joiner" (or vice-versa) to fix
  a false-positive, on a path where the opposite error is a safety miss.
- A comment justifying a change with "this just makes X consistent with Y" on a
  matcher that gates a safety flag.

## Why

Separator characters split into two **safety classes**, and conflating them flips a
safe over-flag into a dangerous under-flag:

- **Within-token joiners** — space, `-` — unambiguously bind ONE compound name
  (`"almond milk"`, `"oat-flour"`). Safe to suppress on.
- **Ingredient delimiters** — `,` `;` — separate DISTINCT list items
  (`"almond, milk"` = almond AND genuine milk). Suppressing across them hides real
  dairy → **fail-dangerous**. Never add them to the join.
- **Genuinely ambiguous** — `/`, parentheses — `"almond/milk"` reads as one
  substitute, but `/` is also a list / "and-or" delimiter (`"soy/milk"`,
  `"water/sugar/salt"`). Treating it as a joiner flips `"soy/milk"` from flagged →
  suppressed, i.e. a real milk allergen silently missed.

The rule: **when a separator's meaning is ambiguous, resolve it toward the fail-safe
(over-flag) direction.** The `"almond/milk"` over-flag is a harmless false positive;
the `"soy/milk"` under-flag is a health risk. Accept the false positive. This is the
same principle already applied to parentheses in the same guard, and the same shape
as the command-safety gate that had to model a tool option's real cumulative
semantics rather than a convenient approximation (see See Also).

## Examples

```ts
// shared/constants/allergens.ts — getSubstituteModifierPattern
// GOOD: inner join accepts ONLY unambiguous within-token joiners.
`(?:^|[\\s,;/()\\-])(?:${mods})[\\s\\-]${escaped}(?:$|[\\s,;/()\\-])`
//                                     ^^^^^^ space + hyphen only

// BAD: "/" added to the join to stop "almond/milk" over-flagging.
`...(?:${mods})[\\s/\\-]${escaped}...`   // "soy/milk" now suppresses real milk
```

### Testing corollary — mutation sentinels on a single-character class need NO-SPACE canaries

To prove the delimiters stay excluded, add a fail-dangerous **sentinel** test — but
the canary input must be the **no-space** form:

```ts
// The join class matches EXACTLY ONE character. "almond, milk" (comma + space)
// survives a comma-in-join mutation because the single char can't span both the
// comma and the space — so it is NOT a faithful canary. The no-space form is.
["almond,milk", "milk"],  // RED the day "," enters the join  ← load-bearing
["oat;milk",    "milk"],  // RED the day ";" enters the join  ← load-bearing
["almond, milk","milk"],  // realistic-format sanity check only, NOT a canary
```

Always *run* the mutation (temporarily add `,` to the join, watch the sentinel go
red, revert) — a comma+space canary passes the mutation vacuously and gives false
confidence. No-space forms are also the realistic input: packaged-food / OCR
ingredient panels routinely omit spaces (`"water,sugar,salt"`).

## Exceptions

- If ingredient strings are guaranteed pre-split into individual items upstream, the
  cross-item under-flag risk shrinks — but a single item can still contain an
  ambiguous separator (OCR, free-text entry), so the fail-safe default still holds
  for a safety flag.
- The rule is about the *dangerous* direction. On a non-safety classifier where both
  errors are equally benign, optimize for accuracy instead.

## Related Files

- `shared/constants/allergens.ts` — `getSubstituteModifierPattern` (the join),
  `getKeywordPattern` (the boundary matcher), `ingredientContainsKeyword` (chokepoint
  used by both `detectAllergens` and `deriveRecipeAllergens`).
- `shared/constants/__tests__/allergens.test.ts` — `plant-substitute guard invariant`
  suite (slash over-flag decision-record + comma/semicolon fail-dangerous sentinel).

## See Also

- [../logic-errors/allergen-keyword-matcher-singular-only-plural-under-detection-2026-07-21.md](../logic-errors/allergen-keyword-matcher-singular-only-plural-under-detection-2026-07-21.md) — the sibling allergen-matcher fix (plural under-detection) in the same file.
- [../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — when broadening a matcher, regression-test the newly-matched inputs.
- [../logic-errors/command-gate-option-cardinality-and-verb-boundary-2026-07-20.md](../logic-errors/command-gate-option-cardinality-and-verb-boundary-2026-07-20.md) — a safety gate must model the real semantics of what it guards, not a convenient approximation.
