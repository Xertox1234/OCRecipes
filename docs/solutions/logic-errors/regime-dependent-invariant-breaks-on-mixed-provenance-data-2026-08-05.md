---
title: "A cross-field invariant that holds under ONE regulatory regime is not an invariant on a mixed-provenance corpus"
track: bug
category: logic-errors
tags: [nutrition, open-food-facts, provenance, invariants, eu-vs-us, fibre, validation, ocr]
module: shared
applies_to: ["client/lib/nutrition-ocr-parser.ts", "server/services/**/*.ts", "shared/lib/**/*.ts"]
symptoms: ["A containment or sum check rejects correct data for one class of products", "The rule was reasoned from a single jurisdiction's label format", "The failures cluster on imported, EU-sourced or high-fibre products", "A correct value is silently 'corrected' to a wrong one rather than dropped"]
severity: high
created: 2026-08-05
---

# A cross-field invariant that holds under ONE regulatory regime is not an invariant on a mixed-provenance corpus

## Problem

An OCR plausibility rule resolved ambiguous readings by containment — a child
field's value cannot exceed its parent's — with this parent map:

```ts
const PARENT_FIELD = {
  saturatedFat: "totalFat",
  transFat: "totalFat",
  dietaryFiber: "totalCarbs",   // <-- false
  totalSugars: "totalCarbs",
};
```

`dietaryFiber ≤ totalCarbs` is not a fact about nutrition, it is a fact about
**US labelling**. EU Regulation 1169/2011 declares *available* carbohydrate and
lists fibre separately, outside it; US labels count fibre within total
carbohydrate. Open Food Facts aggregates both.

So on an EU-sourced bran, psyllium or chia product, a correct fibre reading
legitimately exceeds a correct carbohydrate one. `Carbohydrate 11 / Fiber 19` is
a real label — and the containment rule "resolved" that true 19 g to 1 g.

## Symptoms

- A validation or inference rule misfires only on imported / EU-sourced records
- High-fibre products are the cluster: bran, psyllium, chia, fibre-fortified
- The rule does not merely reject the value, it substitutes a plausible wrong one
- The invariant reads as self-evidently true, and is, under one format

## Root Cause

Two different quantities share one field name. "Carbohydrate" means available
carbohydrate in the EU and total-including-fibre in the US, so any arithmetic
relating carbs to fibre is regime-dependent. The rule was derived from the
mental model of a single label format and then applied to a corpus that mixes
formats by design.

This repository had already been bitten by the same fact in a different place:
the Atwater energy check in
`name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md`
deliberately **excludes** fibre, with the reasoning written out — "OFF mixes EU
(carbs EXCLUDE fibre) and US (carbs INCLUDE fibre) labels, so any fiber-
correction sign is wrong for half the corpus". The new rule contradicted a
codified one, which is the part worth remembering: the lesson existed and was
not consulted.

## Solution

Drop the regime-dependent bound and keep the ones that survive every regime:

```ts
const PARENT_FIELD = {
  saturatedFat: "totalFat",   // fractions of fat, by chemistry
  transFat: "totalFat",
  totalSugars: "totalCarbs",  // inside available carbohydrate under US, EU and Codex
};
```

Fibre glued forms are declined again — for a field that is not in the override
payload, the cost is display-only recall, against a wrong value that would have
been shown as fact.

Check rounding too, not just chemistry, since both numbers are read as printed.
Fat survives it: the FDA/CFIA fat grid (nearest 0.5 g below 5 g, nearest 1 g at
or above) is monotonic, so a rounded child cannot overtake a rounded parent.

## Prevention

- Before writing a cross-field invariant over label data, name the jurisdiction
  it comes from, then ask whether the corpus is single-jurisdiction. For OFF the
  answer is always no.
- Regime-dependent quantities to distrust: carbohydrate vs fibre, salt vs
  sodium, energy units (kJ/kcal), "sugars" vs "added sugars", serving-size
  conventions.
- Grep the solutions corpus for the *entities* in a new rule (`fibre`, `carbs`)
  before writing it. A contradiction with an existing doc is the cheapest kind
  of review finding to have found yourself.
- Prefer declining to inferring for any field whose invariant you cannot state
  without naming a regulator.

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — `PARENT_FIELD` and its docblock
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — "does not bound fibre by carbohydrate — the regimes disagree", with the sugars bound as its positive control
- `.claude/agents/ai-reviewer.md` — carries the OFF mixed-provenance rule

## See Also

- [name-matched secondary must not replace a self-consistent label](name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — the prior codification of this same fibre fact, for the Atwater check
- [a derived bound is only as trustworthy as its derivation](derived-bound-is-only-as-trustworthy-as-its-derivation-2026-08-05.md) — the sibling defect in the same rule: a corrupt parent, rather than an invalid bound
- [absent field beats a defaulted one in a precedence chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — the decline-over-guess principle this restores
