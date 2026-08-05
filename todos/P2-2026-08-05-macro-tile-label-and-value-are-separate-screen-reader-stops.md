---
title: "Group the macro tiles for screen readers — label and value are two stops and the unit is a bare letter"
status: backlog
priority: medium
created: 2026-08-05
updated: 2026-08-05
assignee:
labels: [accessibility, react-native, client]
github_issue:
---

# Group the macro tiles for screen readers

## Summary

Each Protein / Carbs / Fat tile on the Nutrition Detail screen renders its label and its value as
two independent `ThemedText` nodes inside an unannotated `<View>`. A screen reader therefore stops
on each **twice** — "Protein", then "0 g" — and the unit is the bare letter `g`, not the word
"grams". Give the tile one `accessible` group with a composed `accessibilityLabel`, the way
`NutritionPanel` already does for its rows.

The calorie row directly above has the same shape: the figure carries
`accessibilityRole="header"` and `kcal` is a separate sibling Text, so it is two stops as well.
Fix both in one pass — a reviewer who sees one addressed and not the other will ask why.

## Background

Found during the **device pass for PR #753** (slice 2c of the Nutrition Detail redesign) on
2026-08-05, using an Android emulator and an iOS simulator.

**This is PRE-EXISTING, not a slice-2c regression — this was checked, do not re-litigate it.**
`git show main:client/screens/NutritionDetailScreen.tsx` lines 486-556 carry the identical markup:
the same `styles.macroTile` / `macroTileLabel` / `macroTileValue` / `macroTileUnit`, the same
`macro.label` + `macro.value` split, the same bare `g`, and likewise no `accessible` and no
`accessibilityLabel` on the tile `<View>`. Slice 2c **relocated** that markup verbatim from the
screen into `NutritionSummaryCard`; it did not introduce the gap. It was filed rather than folded
into #753 for exactly that reason.

**Three independent confirmations, all recorded in the device-pass evidence:**

1. `adb shell uiautomator dump --compressed` — `PROTEIN` at `[126,131][346,173]` and `0 g` at
   `[126,178][346,247]` are separate `TextView`s with no content-description-bearing parent.
2. Live TalkBack focus rectangle, located by pixel-scanning `adb exec-out screencap` for TalkBack's
   stroke colour `(54,145,8)`, measured at `(126,131)-(345,172)` — an exact bounds match for the
   `PROTEIN` label **alone**. TalkBack really does focus it independently.
3. The source, below.

**What good looks like, three inches down the same screen.** `NutritionPanel`'s rows compose one
label per row via `composeNutrientRowLabel` and read `Sugar, 35 grams, medium` /
`Sodium, 0 milligrams, low` — one stop, unit spelled as a word, band included. The compressed dump
shows each such row as a single `focusable="true"` node whose inner `Sugar` / `35 g` TextViews are
`focusable="false"`. That is the target shape.

**Why no test caught it.** Nothing asserted a label that does not exist. The panel's own tests
assert `composeNutrientRowLabel` output; the summary card has no equivalent assertion because it
has no equivalent label.

## Acceptance Criteria

- [ ] Each macro tile is a single accessible group: `accessible` set on the tile `<View>` with a
      composed `accessibilityLabel` in the panel's house style — `Protein, 0 grams`,
      `Carbs, 52 grams`, `Fat, 0 grams`.
- [ ] The unit is spoken as a **word** (`grams`), never the bare letter `g`. Reuse the panel's
      existing spelling helper rather than writing a second mapping — see Implementation Notes.
- [ ] A `—` value announces as "not recorded", matching the panel's wording for the same state,
      not as a literal em dash.
- [ ] The calorie row is one stop too: `139 kcal` (or "not recorded"), with `accessibilityRole=
    "header"` preserved on the group rather than dropped.
- [ ] Tests assert the composed `accessibilityLabel` on the tile group for a recorded value, a
      zero value, and an absent (`undefined`) value. Use `renderComponent` from
      `test/utils/render-component`, not `@testing-library/react-native`.
- [ ] The visible text is unchanged — this is a screen-reader-only change. A screenshot of the card
      before and after should be pixel-identical.
- [ ] Android check: `adb shell uiautomator dump --compressed` shows each tile as ONE
      `focusable="true"` node carrying the composed label, with its inner label/value TextViews
      `focusable="false"` — the same shape the panel rows already produce.

## Implementation Notes

**File depends on whether PR #753 has merged.**

| State of #753     | Where the markup lives                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Merged (expected) | `client/components/nutrition/NutritionSummaryCard.tsx:85-158` — `calorieRow` at `:85-95`, `macroTiles` at `:108-158` |
| Not merged        | `client/screens/NutritionDetailScreen.tsx:486-556` on `main` — identical markup                                      |

**Do not hand-roll the unit word.** `client/components/nutrition/NutritionPanel-utils.ts` already
owns the unit-to-word spelling used by `composeNutrientRowLabel`. Read it first and reuse it. A
second mapping is exactly the two-sources-of-truth shape codified in
`docs/solutions/logic-errors/field-parallel-objects-diverge-on-the-fallback-path-2026-08-04.md` —
the two would agree today and drift the first time a unit is added.

**Watch the nested-Text structure.** The value Text currently _contains_ the unit Text as a child
(`{Math.round(value)}<ThemedText> g</ThemedText>`) so the unit tracks the number's baseline. Adding
`accessible` to the tile must not require flattening that nesting — the visual result has to stay
identical. Set the group on the outer tile `<View>` and let the inner Texts keep their layout.

**RN grouping semantics differ by platform** — an `accessible` wrapper collapses its subtree on
iOS but not on Android, where children can still be reached unless they are excluded. Verify with
the compressed dump on Android, not by reasoning from the iOS behaviour. Note that `focusable=
"false"` alone is **not** evidence of exclusion; the discriminator is whether the parent is a
single `focusable="true"` node carrying the composed label.

## Scope Contract

- **Mechanisms to use:** `accessible` + `accessibilityLabel` on the two existing wrapper `<View>`s,
  plus the panel's existing unit-word helper. Nothing else.
- **Files in scope:** `client/components/nutrition/NutritionSummaryCard.tsx` (or the `main`
  equivalent above) and its test file under `client/components/nutrition/__tests__/`.
- Do **not** restyle the tiles, change the visible copy, alter the rounding, or touch
  `NutritionPanel` / `NutritionPanel-utils.ts` beyond _reading_ the helper it exports. If the
  helper is not exported, exporting it is in scope; rewriting it is not.

## Dependencies

- **Prefer waiting for PR #753 to merge**, purely so the edit lands in `NutritionSummaryCard.tsx`
  and not in a file 2c deletes. There is no behavioural dependency — the fix is correct on either
  branch — so if #753 stalls, take the `main` path and expect a trivial conflict at merge.

## Risks

- **Low blast radius, screen-reader-only.** The main risk is a visual regression from restructuring
  the nested Text to satisfy the grouping; see Implementation Notes. Guard it with the
  pixel-identical check in the acceptance criteria.
- **A composed label that disagrees with the visible number.** The tile rounds for display
  (`Math.round`). The label must use the same rounded figure, or the screen reader and the screen
  will report different values — the same divergence class as the codified solution doc above.

## Updates

### 2026-08-05

- Initial creation. Found during the PR #753 device pass on an Android emulator + iOS simulator.
- Verified against `main` that the markup is pre-existing and was relocated, not introduced, by
  slice 2c — so it does not bear on #753's merge decision.
