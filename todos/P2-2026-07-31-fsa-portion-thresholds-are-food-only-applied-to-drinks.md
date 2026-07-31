---
title: "FSA per-portion thresholds are the FOOD table but are applied to drinks (two sites, ~2x under-warning)"
status: backlog
priority: medium
created: 2026-07-31
updated: 2026-07-31
assignee:
labels: [deferred, api, nutrition]
github_issue:
---

# FSA per-portion thresholds are food-only but applied to drinks

## Summary

`FSA_PORTION` holds the UK FSA **food** per-portion red thresholds. Two code paths apply it
to beverages as if it were scale-agnostic. The FSA publishes a **separate drink portion
table** at roughly half the food values, with a different trigger size. The result is
under-warning: a sugary drink can clear both the per-100ml line and the (too-lenient) food
portion line and earn no red at all.

## Background

Found 2026-07-31 during slice 2a of the Nutrition Detail redesign (PR #747). Surfaced to the
user, who ruled: file as its own todo after 2a lands. It was deliberately kept **out** of 2a
because 2a's binding constraint was "No existing flag changes its emission condition" — this
is an emission change and needs its own characterisation tests first.

### Verified FSA per-portion table

Checked against the published UK FSA front-of-pack guidance, not inferred:

|           | food (trigger: portion **>100 g**) | drink (trigger: portion **>150 ml**) |
| --------- | ---------------------------------- | ------------------------------------ |
| fat       | >21 g                              | >10.5 g                              |
| saturates | >6 g                               | >3 g                                 |
| sugars    | >27 g                              | >13.5 g                              |
| salt      | >1.8 g (= 720 mg sodium)           | >0.9 g (= 360 mg sodium)             |

Sodium figures are salt (g) × 400, matching the existing single-conversion rule. Do not
re-derive salt or re-convert sodium anywhere downstream.

### The three defects

**D1 — `server/services/universal-flags.ts` (~`:96-110`), SHIPS TODAY.** The per-100 table
switches on `drink` (`const per100 = drink ? FSA_DRINK : FSA_FOOD`), but `FSA_PORTION.*` is
passed to `nutrientFlag` unconditionally. So a beverage is judged on the per-100**ml** line
and the per-portion **food** line simultaneously.

Worked example: a 500 ml bottle with 20 g sugar is 4 g/100 ml — under the 11.25 drink line —
and 20 < 27, so nothing fires. The correct drink portion line is 13.5, so it should be RED.

**D2 — `server/services/universal-flags.ts` (~`:56-66`), SHIPS TODAY.** The `high()` helper
gates the portion arm on `(servingGrams ?? 0) > 100` uniformly. The FSA trigger is >100 g for
food but **>150 ml for drinks**. A 100–150 ml drink portion gets the portion check applied
when FSA guidance says it should not apply yet. Direction is mixed, so treat it as a spec
deviation regardless of net effect.

**D3 — `shared/lib/nutrition-bands.ts` `concernBand`, client-side band layer.** Same root
cause. In slice 2a this was gated to `basis.scale === "food"`, so it now **under-warns
honestly** rather than applying a food line to a drink — but the drink table is still
unimplemented, so drinks get no per-portion escalation at all.

Before the 2a gate, this was verified by running the committed code:

```
Cherry Coke 39 g/355 ml, portionGrams=355  -> high    (39 > 27, the FOOD line)
500 ml drink 28 g sugar (5.6 g/100 ml)     -> high    (invented red)
```

**Fixing only D1/D2 leaves the client shipping a different wrong answer from the server.**
All three are one defect: a food-scale table used as if it were universal.

### A trap for whoever picks this up

Under the **correct** drink portion table, Cherry Coke IS red (39 > 13.5, 355 > 150). So the
pre-2a client code reached the right answer for that product by the wrong arithmetic, and the
2a gate makes it honestly `medium` until the drink table lands. **Do not read the current
`medium` as the intended final answer for that product** — it is the honest-under-warning
placeholder.

### Why the name is the defect

`FSA_FOOD` and `FSA_DRINK` say which scale they are. `FSA_PORTION` does not — and two
authors, months apart and in different layers, independently assumed it was scale-agnostic.
Renaming it as part of this work is likely the highest-leverage part of the fix.

## Acceptance Criteria

- [ ] Characterisation tests for the **current** emission behaviour are written and committed
      **before** any threshold change, so a behaviour change fails loudly (same discipline as
      PR #747's `2bb8fa60`)
- [ ] A drink per-portion table exists with the four verified values above, sourced from the
      same shared constants module as `FSA_FOOD`/`FSA_DRINK` — no second copy
- [ ] `FSA_PORTION` is renamed to make its scale explicit (e.g. `FSA_PORTION_FOOD`), and the
      guard test in `server/services/__tests__/no-server-fsa-constants.test.ts` still passes
- [ ] `universal-flags.ts` selects the portion table on the same `drink` boolean it already
      computes for the per-100 table
- [ ] The portion trigger is >100 g for food and >150 ml for drinks, not >100 uniformly
- [ ] `concernBand`'s per-portion override applies the drink table when `basis.scale === "drink"`
      instead of skipping the override entirely
- [ ] Server and client agree: a test pins that the same product yields the same band from
      `evaluateUniversalFlags` and from `concernBand`
- [ ] The 500 ml / 20 g sugar case from D1 above emits a red where it previously emitted nothing
- [ ] No nutrient gains or loses a flag except via the intended threshold correction, and the
      characterisation tests document exactly which emissions changed

## Implementation Notes

- Thresholds live in `shared/constants/nutrition-bands.ts`. Its `FSA_PORTION` docblock already
  records the drink table's existence and values — read it first; it was corrected in PR #747
  precisely so this work would not start from the belief that the figures do not exist.
- `concernBand`'s portion override can only ever promote **to** `high`; it never demotes.
  Preserve that.
- Total fat has a published per-portion figure (>21 g food / >10.5 g drink) but **no fat flag
  exists anywhere in the app**. Adding the threshold without a consumer is dead data — and
  note that `nutrientFlag` takes `nk: keyof typeof NUTRIENT_META`, which has no `fat` key, so
  a fat entry there silently unlocks a loop-over-table refactor. Leave fat alone unless the
  fat flag is being added deliberately in the same change.
- This is user-health-adjacent logic: **never delegate to a kimi-\* cheap worker.**

## Scope Contract

- **Mechanisms to use:** the existing shared-constants module and the existing
  `drink ? … : …` selection pattern — no new abstraction, no new config
- **Files in scope:** `shared/constants/nutrition-bands.ts`, `shared/lib/nutrition-bands.ts`,
  `server/services/universal-flags.ts`, `server/services/nutrition-flag-rules.ts`, and the
  co-located `__tests__/` files for each
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Slice 2a (PR #747) has merged; the shared constants and `concernBand` both exist on `main`.
- Coordinate with slice 2c if it is in flight — 2c renders `concernBand`'s output, so a band
  change is user-visible the moment 2c ships.

## Risks

- **This changes what users are told about their food.** It is an emission change in the
  over-warning direction (more reds), which is the opposite of the project's usual
  fail-toward-under-warning default — that is correct here because the current state is a
  deviation from the published standard, but it means the characterisation tests are the
  safety net, not a formality.
- `evaluateUniversalFlags` is consumed by the barcode route on three surfaces including the
  nested `conflict.label`. Verify all three.
- Do NOT arm auto-merge on the resulting PR. Every path here is inside
  `scripts/todo-automerge-guard.sh`'s safe-path allowlist, so the guard alone will not hold it.

## Updates

### 2026-07-31

- Filed after PR #747 (slice 2a) merged. D1/D2 found by a domain review of the threshold
  values during Task 1; D3 found by a code review of Task 5, which caught that 48 passing
  tests could not see it because every drink test omitted `portionGrams` and every
  portion-override test used a food basis — the two axes were never crossed.
- FSA table independently verified against the published guidance rather than taken from an
  agent's report.
