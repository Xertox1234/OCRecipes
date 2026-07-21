---
title: Allergen keyword matcher missed plurals — singular-only keywords under-detect (peanut → peanuts)
track: bug
category: logic-errors
module: shared
severity: high
tags: [allergens, nutrition, safety, string-matching, regex, testing]
symptoms: [detectAllergens misses an allergen when the ingredient text uses the plural form (e.g. "roasted peanuts" with allergen keyword "peanut"), deriveRecipeAllergens under-derives a recipe's allergen cache for plural ingredient names, A recipe with "almonds"/"cashews"/"soybeans" in its ingredient list is not flagged for the corresponding allergen]
applies_to: [shared/constants/allergens.ts]
created: '2026-07-21'
---

# Allergen keyword matcher missed plurals — singular-only keywords under-detect (peanut → peanuts)

## Problem

`ALLERGEN_INGREDIENT_MAP` stored most `directIngredients`/`derivedIngredients`
keywords in singular form only (`"peanut"`, `"almond"`, `"cashew"`,
`"walnut"`, `"soybean"`, …). `ingredientContainsKeyword`'s single-word path
(`getKeywordPattern`) requires a boundary character (`[\s,;/()\-]` or
end-of-string) **immediately after** the keyword — so `"peanut"` never
matched `"roasted peanuts"` (the trailing `s` isn't a boundary character).
Plural ingredient names are the common case in real ingredient lists, so
ingredient-text detection systematically under-detected allergens. This is
safety-relevant: an under-detection is fail-**dangerous** (silence read as
"safe"), and `deriveRecipeAllergens` (recipe-side allergen derivation) has no
other fallback signal — unlike the barcode/Smart Scan path, which has Open
Food Facts' structured `allergens_tags` as the primary signal and
ingredient-text as only a secondary check.

## Symptoms

- `detectAllergens(["roasted peanuts"], [{name: "peanuts", severity: "severe"}])` returned `[]` before this fix (keyword `"peanut"` doesn't match `"peanuts"`).
- `deriveRecipeAllergens(["almonds"])` returned `[]` — a tree-nut recipe silently had no allergen cache entry.
- Any single-word keyword paired with a plural ingredient name in the source text reproduces this.

## Root Cause

**Multi-word keywords were never affected.** `ingredientContainsKeyword`
routes them through a plain `lowerIngredient.includes(keyword)` substring
check, not the boundary regex — and since English plurals are formed by
appending characters, a multi-word singular keyword (`"sesame seed"`,
`"egg white"`, `"brazil nut"`) is *already a substring* of its own plural
(`"sesame seeds"`, `"egg whites"`, `"brazil nuts"`), so those always matched.
**Only single-word keywords had the gap** — the boundary regex's trailing
anchor is what breaks on a plural suffix. Any future fix (or review of this
area) must keep that asymmetry in mind: a "the plural doesn't match" report
almost always means a single-word keyword, and a proposed fix for a
multi-word keyword is very likely already working (verify empirically before
"fixing" it — see Prevention).

## Solution

**Enumerate the plural explicitly** as an additional array entry alongside
each singular keyword (Option A from the originating todo, chosen over a
generic pluralization/stemming step in the matcher — Option B). Rationale:

- It requires **zero changes to the matcher functions** (`getKeywordPattern`,
  `ingredientContainsKeyword`, `getSubstituteModifierPattern`) — a stemming
  rule in the matcher would touch code shared by every allergen and risk
  interacting with the plant-substitute guard (see
  [allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md](./allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md)).
  Per-keyword enumeration is a pure data change with a trivially auditable
  blast radius.
- It composes correctly with `detectAllergens`/`deriveRecipeAllergens`'s
  match logic: both iterate the keyword array and OR the hits together, so
  adding an array entry can only **add** a match, never remove one — the
  additive-only guarantee this kind of change requires is structurally true
  by construction, not something that has to be separately proven per
  keyword. **Caveat:** this by-construction guarantee holds only for keywords
  NOT gated by the plant-substitute guard. For the four guard-sensitive words a
  map-only add is a *dangerous* over-flag — see "Guard-sensitive follow-up".
- **Deliberately left un-pluralized:** `milk`/`cream`/`butter`/`flour` — the
  bare keywords gated by `MODIFIER_SENSITIVE_KEYWORDS`/`SUBSTITUTE_MODIFIERS`
  (the plant-substitute suppression guard, e.g. "almond milk" must not flag
  dairy). Touching those risks weakening that guard for no real-world
  payoff (they're near-universally used as mass nouns in ingredient text,
  rarely pluralized as "milks"/"creams"/"flours"). If a genuine plural gap
  ever surfaces for one of those four, treat it as its own reviewed change,
  not a drive-by addition alongside an unrelated batch of plurals. → **Done
  guard-safely in PR #687; see "Guard-sensitive follow-up" below.**

### Guard-sensitive follow-up (PR #687): safely pluralizing milk/cream/butter/flour

The four deferred words were later pluralized (`milks`/`creams`/`butters`/`flours`)
as its own reviewed, `safety`-labeled change. The technique — and why the
additive-only-by-construction guarantee above does NOT extend to them:

- **Add each plural to BOTH `ALLERGEN_INGREDIENT_MAP` AND
  `MODIFIER_SENSITIVE_KEYWORDS`.** The suppression in `ingredientContainsKeyword`
  is keyed on the *exact keyword under test* being in the guard set. A plural in
  the map alone matches `"almond milks"` with no suppression → flags dairy, a
  fail-**dangerous** false positive. For these four families the guard-set mirror
  is what keeps the change additive-only for *genuine* dairy/wheat text; miss one
  mirror entry and exactly that plant substitute over-flags. `getSubstituteModifierPattern`
  interpolates the keyword, so the plural inherits a correct
  `(?:almond|oat|…)[\s\-]<plural>` suppression pattern for free once it's in the set.
- **Prove the guard entry is load-bearing via a map-first intermediate state.**
  A suppression test (`"almond milks"` must not flag dairy) is green at HEAD (no
  `"milks"` keyword registered) and stays green if you add both lists at once —
  proving nothing. Stage it map-first: add the plural to the map only, watch
  `"almond milks"` start flagging dairy (RED), THEN add the guard-set entry to go
  GREEN. That red→green transition is the only evidence the mirror matters.
- **Pin the two-list consistency with a behavioral invariant test, not just
  point-in-time strings.** A `["almond milks","milks"]→false` string test can't
  catch a *future* desync (a plural dropped from the guard set, a typo in either
  list) — the dangerous over-flag direction, with zero red tests. Add a test that
  iterates the guard-sensitive forms and asserts each map-registered form is
  suppressed after a plant modifier yet still matches bare (`plant-substitute guard
  invariant` in the test file). It reads observable `ingredientContainsKeyword`
  behavior, since `MODIFIER_SENSITIVE_KEYWORDS` is module-private.
- Fish species where the English plural equals the singular (salmon, tuna,
  cod, trout, halibut, bass, …) were intentionally skipped — but **check
  each one**, don't assume the whole category is invariant: "snapper" and
  "grouper" have ordinary regular plurals ("snappers"/"groupers") and were
  initially missed in review before being added; "octopus" → "octopuses"
  was missed the same way. A "this species pluralizes irregularly" claim
  needs verifying per-word, not per-category.

## Prevention

- When asked to fix a "singular keyword doesn't match its plural" report on
  a **multi-word** keyword, verify empirically first (stash the fix, rerun
  the specific failing case) — it's very likely genuinely already passing.
  Don't add a redundant array entry and claim it as a fix; if you add it
  anyway for documentation/explicitness, label the test as confirmation, not
  regression coverage (this file's own PR made that exact mistake with
  `"sesame seeds"` and `"egg whites"` before catching it — do not repeat it).
- **...but do NOT delete the redundant multi-word plurals as "cleanup"
  either.** Their redundancy is a property of *today's* matcher, not an
  invariant: multi-word keywords match via `includes()`, so `"egg white"`
  substring-matches `"egg whites"` *only because* the multi-word path has no
  word-boundary anchor. The day someone hardens that path to boundary
  matching (a reasonable-looking symmetry fix with the single-word regex),
  every deleted multi-word plural silently becomes a fail-**dangerous**
  under-detection. On a fail-dangerous file the additive-only invariant cuts
  both ways: a review finding of "these entries are redundant" is answered by
  a comment or this note, never by a deletion. They are cheap
  belt-and-suspenders on a safety surface — keep them. (Surfaced by the
  `/code-review` of PR #684.)
- Regression tests for a specific keyword's plural must **isolate** the
  ingredient string to just that keyword — no other allergen keyword may be
  present in the same test ingredient. A case like `["whole wheat crackers",
  "wheat"]` intended to prove `"cracker"`→`"crackers"` is vacuous: it passes
  via the pre-existing `"wheat"` keyword regardless of whether `"crackers"`
  matches. Prefer `["crushed crackers", "wheat"]` — nothing else in that
  string can make the assertion pass for the wrong reason.
- The safety asymmetry from the plant-substitute solution still applies here
  in the opposite direction: over-flagging (adding a match) is always the
  safe direction for this engine, so additive-only keyword changes are
  low-risk by design — but a change that *removes* or *narrows* a match
  (e.g. replacing a keyword rather than adding alongside it) is not, and
  needs the same full regression-suite scrutiny as any other allergen-engine
  change.

## Related Files

- `shared/constants/allergens.ts` — `ALLERGEN_INGREDIENT_MAP`, `getKeywordPattern`, `ingredientContainsKeyword`
- `shared/constants/__tests__/allergens.test.ts` — plural-form regression tests (single-word vs. multi-word split)

## See Also

- [allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md](./allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md) — the plant-substitute suppression guard this fix deliberately left untouched
