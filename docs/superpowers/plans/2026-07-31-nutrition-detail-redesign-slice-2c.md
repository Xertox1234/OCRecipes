# Nutrition Detail Redesign — Slice 2c (Presentation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `NutritionDetailScreen`'s flat calorie card + "Additional Nutrients" list
with a verdict-led summary card and an FSA traffic-light nutrient panel, move `Add to Today`
into a sticky bar, collapse six advisory surfaces into one `NoticeStack`, and fix the
bottom-up entrance-animation ordering.

**Architecture:** All band logic already exists and shipped in slice 2a
(`shared/lib/nutrition-bands.ts`, `shared/constants/nutrition-bands.ts`). 2c is presentation
only: it adds a pure adapter that selects a **serving-invariant** band source, four new
components under `client/components/nutrition/`, and rewires the screen. No server change, no
new route, no change to which flags the server emits.

**Tech Stack:** React Native / Expo, TypeScript strict, `react-native-reanimated` (entering
animations only), Vitest + `renderComponent` from `test/utils/render-component`.

**Binding contract:** `docs/superpowers/specs/2026-07-31-nutrition-detail-redesign-design.md`.
Where this plan and the spec disagree, the spec governs — except for the four numbered
deviations recorded under "Decisions this plan settles", each of which the spec explicitly
delegates to implementation.

**Predecessors, both merged:** slice 2a = PR #747 (`shared/` band layer), slice 2b = PR #751
(`ProductHero` / `FlagSections` / `CapturedPhotos` / `VerificationPanel` extracted, plus an
accessibility fix). `main` is at `fb1baf71`.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the
spec or verified in source while writing this plan.

1. **Never compute a band from `nutrition`.** This is the single most important rule in the
   slice and it has its own section below. `nutrition` is display state and is multiplied by
   `servingSizeGrams × servingQuantity`; a band derived from it moves when the user changes
   their serving. Bands come from `validatedData` (scan path) or from `nutrition` **only on
   the saved-item path**, where no serving control renders.

2. **An unresolvable basis renders the row UNBANDED — never a green LOW, never a fabricated
   red.** Safety invariant 1. It outranks completeness of the panel.

3. **Three display states stay visually distinct:** a zero value, a value with no applicable
   standard (unbanded), and no value at all ("Not recorded"). Collapsing any two reproduces
   the fail-silent shape `nutrient-unavailable` exists to prevent.

4. **Nutrient flags fail toward under-warning.** Where a choice exists — a skipped
   per-portion override, an unknown scale — prefer showing less over inventing a red.

5. **`hasValue` is derived from the raw value's presence, NEVER from `band === "unknown"`.**
   `concernBand`/`benefitBand` both return `"unknown"` for an absent value _and_ for an
   unresolved basis, so deriving the flag from the band re-collapses the two states it exists
   to separate — silently, in a way no type checker can see.

6. **`"nutrient"` must STAY in `UNIVERSAL_KINDS`** (`client/screens/nutrition-detail-flags-utils.ts`).
   `partitionScanFlags` warn-and-drops unmodelled kinds, so removing it swallows the flags
   rather than relocating them. The narrowing happens at the **render** step, not the
   partition step.

7. **The FlagSections narrowing filters on `flag.nutrient`, NOT on `flag.kind`.** Verified in
   `server/services/universal-flags.ts:151-169`: the caffeine flag ships as
   `kind: "nutrient"` with `nutrient: "caffeine"`. A `kind !== "nutrient"` filter silently
   deletes the "High in caffeine" warning, which the panel's caffeine row (unbanded, value
   only) does not replace. Drop exactly `sugar | saturated_fat | sodium` — the snake_case
   `NutrientKind` values from `shared/types/scan-flags.ts:14`.

8. **`accessibilityViewIsModal` stays on BOTH branches** — loading and main. The screen is
   `presentation: "modal"` (`client/navigation/RootStackNavigator.tsx:246`) and VoiceOver
   navigates behind it without this. The sticky bar must render **inside** that root or it
   falls outside the modal's a11y scope on iOS.

9. **`insets.bottom` is counted exactly once.** The `LogActionBar` owns
   `paddingBottom: insets.bottom + …`. The ScrollView's existing
   `paddingBottom: insets.bottom + Spacing["3xl"]` must NOT survive alongside it. The
   ScrollView's bottom padding becomes the bar's **measured** `onLayout` height plus spacing
   — never a hardcoded constant. The bar has three heights (normal, gated, offline caption).

10. **No formatting inside a worklet.** A function imported from a `-utils.ts` module and
    called inside `useAnimatedProps`/`useDerivedValue` needs its own `"worklet"` directive,
    and a miss is a **silent app close in release/OTA builds** that `tsc`, ESLint and the
    whole Vitest suite all pass. Drive value transitions with `withTiming` on
    opacity/translate only and set the text through React state. Adding `"worklet"` to
    `shared/lib/nutrition-bands.ts` is the wrong escape hatch — the Express server imports
    that module.

11. **`reducedMotion` must still land on the value.** The reduced-motion branch skips the
    transition but must assign the new number. Cancel any in-flight animation before a static
    assignment, and resync when `reducedMotion` changes at runtime.

12. **`NoticeStack` carries NO `accessibilityLiveRegion`** — not on its container, not on any
    row. A `"polite"` region on a container wrapping multiple variants makes TalkBack compose
    `CONTENT_CHANGE_TYPE_SUBTREE` and re-read every mounted notice plus the always-present
    medical-advice disclaimer on any single descendant change, and `correctionNotice` mutates
    on every serving adjustment. It owns one edge-guarded imperative announcer keyed on the
    notice **content string**, not the notice kind.

13. **Each new component calls `useTheme()` itself and takes `reducedMotion` as a prop.**
    Repo convention — `MicronutrientSection`, `ScanFlagBadge`, `VerificationBadge` all do
    this. Do not thread `theme` through props.

14. **Each new component owns its own `StyleSheet.create`.** Do not create a shared style
    module.

15. **`FallbackImage` REJECTS naming props at the type level.** `accessibilityLabel`, `alt`
    and `aria-label` are all in its `Omit<ImageProps, …>`; both branches are explicitly
    decorative. Passing a label is a compile error by design. An image that genuinely needs a
    name takes an `accessible` group wrapper at the call site (`CapturedPhotos` is the
    reference shape).

16. **Do not reintroduce an `accessible={true}` wrapper around the "Heads up" badges.** A
    structural test in `NutritionDetailScreen.test.tsx` walks up from a badge and requires no
    labelled ancestor. A red there means the grouping decision needs re-making, not that the
    test is wrong. Collapse a group only when its label is a **superset** of what its children
    say.

17. **`importantForAccessibility="no"` excludes only the view it is set on.** Its subtree
    stays in the Android accessibility tree. `"no-hide-descendants"` is the only value that
    excludes the subtree, and `accessibilityElementsHidden` is the iOS half. A child's own
    `accessible={false}` does not save you.

18. **`client/camera/` is off-limits** for all of Phase 2. So is the Today page and the
    three-valued `ocrText: string | null | undefined` contract.

19. **The screen gets LONGER, not shorter.** The user explicitly asked for more information
    per scan. Any change that trims content to reduce scroll is wrong for this screen.

20. **Do not touch `client/hooks/useNutritionLookup.ts`.** Everything 2c needs is already on
    its return object: `nutrition`, `validatedData`, `isBeverage`, `isPer100g`,
    `servingQuantity`, `logGate`. Adding a derived field there would put band selection behind
    a hook boundary where it cannot be unit-tested as a pure function.

21. **The `showManualSearch` card stays exactly where it is, unchanged.** It appears nowhere
    in the spec's file map. It is not a notice (it is an interactive recovery form), it is not
    part of the panel, and it renders between the serving controls and the summary card. Do
    not relocate it, restyle it, or fold it into `NoticeStack`.

22. **`ScanConflictPrompt` keeps its own component and its current position.** It is
    interactive — it offers a source choice — and must not be collapsed into a passive
    `NoticeStack` row.

23. **`error` renders through `InlineError`**, not as a `NoticeStack` row. Error messages
    require `assertive` (`docs/rules/accessibility.md`) and `InlineError` is the canonical
    component. It fires its own iOS-gated announce internally
    (`client/components/InlineError.tsx:24-28`), so it must be **excluded** from the
    `NoticeStack` announcer or iOS hears it twice.

24. **The micronutrient sentinel-string gate is out of scope.**
    `nutrition.productName !== "Unknown Product" && !== "Product Not Found"` is fragile and
    stays as-is. If a task touches that condition it must be a deliberate, stated change —
    never an incidental one.

25. **Preserve the `!itemId` gating on every section that has it today.** The saved-item view
    keeps its existing omissions (no serving controls, no notices, no verification panel, no
    log button). Those gates are correct.

26. **TDD is required.** Write the failing test, run it and see it fail for the stated reason,
    implement, run it green, commit. A test that passes before the implementation is a test
    that is not testing the implementation.

27. **The todo for this slice carries `priority: high`** so `scripts/todo-automerge-guard.sh`
    never arms auto-merge. 2c's device pass is a human gate CI cannot represent.

---

## The one correctness rule this slice turns on

**Found while writing this plan. It is not in the spec, and it is the same defect shape the
spec's Decision 8 exists to prevent — reintroduced in a new place.**

`recalculateNutrition` (`client/hooks/useNutritionLookup.ts:254-300`) writes serving-scaled
values into `nutrition`:

```
nutrition.sugar = per100g.sugar × (servingSizeGrams / 100) × servingQuantity
```

`resolveBasis` returns `factor = 100 / parseServingBasis(nutrition.servingSize).quantity` —
derived from the **label's one-serving string**, which the serving controls never rewrite.
Multiply them out:

```
computed per-100 = per100g.sugar × (servingSizeGrams × servingQuantity / parsedQuantity)
```

That equals the true per-100 **only when `servingSizeGrams × servingQuantity == parsedQuantity`**
— i.e. only in the default state. Concretely:

| User action                                  | Multiplier applied to the computed per-100 | Effect                    |
| -------------------------------------------- | ------------------------------------------ | ------------------------- |
| Quantity 1, default serving                  | 1.0                                        | correct                   |
| Quantity 2                                   | **2.0**                                    | a MEDIUM sugar bands HIGH |
| Picks the 100 g chip on a 30 g label serving | **3.3**                                    | a LOW sugar bands HIGH    |

Both **over-warn**, which is the direction Global Constraint 4 forbids, and nothing on screen
says the number is derived.

### The rule that makes the whole class impossible

**Band from `validatedData`, never from `nutrition`.**

- `nutrition` is display state. It is serving-scaled and it is what the user reads.
- `validatedData.per100g` / `validatedData.perServing` are the un-scaled lookup payload. They
  are invariant to the serving controls.

This is spec-aligned rather than a deviation: basis resolution rule 1 already names
`validatedData.per100g` as the trustworthy denominator. The split it produces is exactly the
one the spec states for the macro strip — **the value answers "how much", the band answers
"is that a lot"** — so the panel shows the serving-scaled value beside a serving-invariant
band, and that is correct rather than a compromise.

### Why the saved-item path is different, and why that is safe

On the saved-item path `validatedData` stays `null` — the `existingItem` effect calls only
`setNutrition` and `setIsLoading` (verified: `useNutritionLookup.ts:806-810`; the
`setValidatedData` at `:787` is inside `handleManualSearch`, a different branch). There,
`nutrition` is the per-serving source and is safe to band from, because
`showServingControls` is `!itemId && …` so no control that could scale it ever renders.

**That safety must be a guard, not an accident.** The adapter takes `itemId` and branches on
it in ONE place, with a test pinning each branch — rather than each call site deciding.

### The discriminating test

**Changing the serving quantity must not change any band tag.** Render the scan path, assert
the sugar tag at quantity 1, re-render at quantity 2, assert the _same_ tag and a _different_
displayed value. That single test pins the fix and is the one that would have caught the bug.
It is Task 3, Step 1.

### The coupling this forces — decide it here, not in review

A serving-invariant band **cannot apply the FSA per-portion HIGH override on the scan path.**
The override needs the actual portion weight (`servingSizeGrams × servingQuantity`), and by
construction any band that reads that number moves with the user's serving choice.

**Decision: skip the per-portion override in the panel. Pass no `portionGrams` to
`concernBand`.** Skipping can only fail toward under-warning, which Global Constraint 4
permits and prefers.

Residual, stated once so a reviewer does not raise it as a gap: `server/services/universal-flags.ts`
_does_ apply the override when emitting `nutrient:*` flags, so `flags[]` and the panel can
disagree on a large-portion product. This is invisible on screen, because Task 8 stops
rendering scalar nutrient flags entirely — the panel becomes their sole surface.

---

## Decisions this plan settles

Four things the spec explicitly delegates to implementation. Each is settled here with its
reasoning, so no task has to stop and ask.

### D1 — Concern-LOW and benefit greens SHARE a colour token, and differ by icon

The spec asks whether they share (Tokens section) and argues they should not if `LOW` and
`EXCELLENT` must be distinguishable at a glance.

They share **`badgeSuccessText`** and are distinguished by **icon** and by **tag text**.

- Both are good news. Green meaning "good" in both places is coherent, not confusing.
- `badgeSuccessText` already exists and is already WCAG-verified in **both** themes
  (`client/constants/theme.ts:51` light `#00742E` 4.63:1 / 4.96:1; `:108` dark `#4CAF7D`
  5.42:1 / 4.63:1). A second green would need four new contrast obligations — 4.5:1 as text
  and 3:1 as a graphical object, in each theme — to encode a distinction the tag text already
  carries unambiguously.
- Distinguishability is preserved on two non-colour channels: `check-circle` vs `award`, and
  `LOW` vs `GOOD`/`EXCELLENT`.

### D2 — The band indicator is a dot; the tag is a pill; `BadgeSeverityVisuals` stays whole

The spec asks whether the indicator carries the severity icon or the tag text is the sole
non-colour channel.

**Both channels ship.** Each banded row renders a 12 pt coloured dot in a fixed left column
**and** a tag pill (icon + text) at the right, at `BADGE_SEVERITY_FILL_OPACITY`.

- The dot is what makes the panel scannable down a column — that is the traffic-light
  affordance the design session approved.
- The pill keeps `BadgeSeverityVisuals` whole (colour **and** icon), which is the contract
  `AllergenBadge` and `ScanFlagBadge` both depend on. Colour-only entries would break the
  module's invariant.
- WCAG: the pill's text is 1.4.3 at 4.5:1 (same shape as every existing badge case); the dot
  is a graphical object at 1.4.11 3:1. Both get cases in `badge-contrast.test.ts` (Task 1).
- The dot is `accessible={false}` + `importantForAccessibility="no"` and its meaning is rolled
  into the row's group label. It never gets `accessibilityRole="checkbox"`/`"radio"`/`"switch"`
  — it is not a `Pressable`, and announcing a toggle affordance that does nothing is worse
  than silence.

### D3 — The Nutri-Score RING survives in the summary card; the chip leaves `FlagSections`

The spec says the grade appears twice under this design and instructs implementation to decide
which survives.

The ring survives, because the spec's own file map defines the summary card as carrying it and
that is the layout the user approved. The chip is removed from `FlagSections`.

Consequences, all handled in Task 8:

- The ring inherits the chip's a11y reasoning **verbatim**: a collapsed subtree announces only
  the group label and the grade letter is not in it, so the ring renders **outside** the
  card's `accessible` group, exactly as the chip does outside the "Heads up" group today.
- The grade is only available on the scan path (no column, no live OFF read on saved items).
  The card renders without it — the spec already states this under Deferred.
- **`partitionScanFlags` lifts to the screen.** The summary card renders above `FlagSections`
  but needs `partition.nutriScore?.grade`, and a second `partitionScanFlags` call would be
  exactly the duplicated flag composition the spec forbids. The screen calls it once and
  passes `personal` / `universal` arrays down as props. This also reverses the layering
  inversion 2b introduced deliberately: `client/components/nutrition/` stops importing from
  `@/screens/`.

### D4 — Entrance delays are renumbered by final visual position

The spec calls the bottom-up ordering a bug. Current delays, verified in source:

| Element                                                   | Current delay           | New delay                     |
| --------------------------------------------------------- | ----------------------- | ----------------------------- |
| `ProductHero`                                             | (none)                  | (none — it is above the fold) |
| Summary card (replaces the calorie card at `:468`)        | 200                     | **200**                       |
| Nutrition panel (replaces Additional Nutrients at `:588`) | 500                     | **300**                       |
| "For you" (`FlagSections.tsx:45`)                         | 450                     | **400**                       |
| "Heads up" (`FlagSections.tsx:69`)                        | 475                     | **450**                       |
| `CapturedPhotos`                                          | (own delays, unchanged) | unchanged                     |
| `MicronutrientSection` (`:696`)                           | 600                     | **500**                       |

Delays now ascend with final visual position. `duration(400)` is unchanged everywhere.

---

## File Structure

**New — `client/components/nutrition/`**

| File                            | Responsibility                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nutrition-band-source.ts`      | **Pure.** `selectBandSource()` — the serving-invariance guard — plus `buildPanelRows()`, which returns the panel's rows AND the `NutrientBands` object `pickStandouts` consumes, from one derivation so the two cannot diverge. |
| `NutritionPanel-utils.ts`       | **Pure.** Row display metadata, band → visuals mapping, band → tag text, and `composeNutrientRowLabel()` (the screen-reader group label).                                                                                       |
| `NutritionPanel.tsx`            | The nutrient table: banded rows above a divider, unbanded rows below, in one card.                                                                                                                                              |
| `NutritionSummaryCard-utils.ts` | **Pure.** `composeStandoutLabel()` and the standout row's display copy ("Excellent source of fibre").                                                                                                                           |
| `NutritionSummaryCard.tsx`      | The verdict card: Nutri-Score ring, two promoted standout rows, fixed Calories · Carbs · Protein strip.                                                                                                                         |
| `NoticeStack-utils.ts`          | **Pure.** `buildNotices()` — collapses the advisory inputs into an ordered, severity-sorted row list, and derives the announcer's content key.                                                                                  |
| `NoticeStack.tsx`               | One position, one row treatment, one imperative announcer, no live region.                                                                                                                                                      |
| `LogActionBar-utils.ts`         | **Pure.** `deriveLogBarState()` — the `logGate` × acknowledgement × offline branch as data.                                                                                                                                     |
| `LogActionBar.tsx`              | The sticky bar. Owns the `logGate` branch, the acknowledgement state, and its own bottom inset.                                                                                                                                 |
| `__tests__/`                    | **Does not exist yet** — inherited obligation from 2b. Task 1 creates it.                                                                                                                                                       |

**Modified**

| File                                                      | Change                                                                                                                                                                                                                                                                       | Task |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `client/components/badge-severity-visuals.ts`             | Gains `CONCERN_LOW_VISUALS`, `BENEFIT_VISUALS`, `BENEFIT_NONE_VISUALS`; `BadgeSeverityColorKey` and `BadgeSeverityIcon` widen. Existing severity mappings unchanged.                                                                                                         | 1    |
| `client/components/__tests__/badge-contrast.test.ts`      | Gains panel band cases at 4.5:1 (tag text) and 3:1 (indicator dot).                                                                                                                                                                                                          | 1    |
| `client/components/nutrition/FlagSections.tsx`            | Takes `personal` / `universal` / `nutriScore` as props instead of `flags`; drops the `partitionScanFlags` import; drops `NutriScoreChip`; filters scalar nutrients by `flag.nutrient`; delays renumbered.                                                                    | 8    |
| `client/screens/NutritionDetailScreen.tsx`                | Calls `partitionScanFlags` once; renders the summary card and panel; deletes the calorie card, the Additional Nutrients block and their styles; renders `NoticeStack`, `InlineError` and the sticky bar; hands the ScrollView its measured bottom padding; skeleton updated. | 8, 9 |
| `client/screens/__tests__/NutritionDetailScreen.test.tsx` | Existing suite updated for the new structure; gains the serving-invariance wiring test and the announcer call-count test.                                                                                                                                                    | 8, 9 |

**Explicitly NOT modified:** `client/hooks/useNutritionLookup.ts`, `shared/lib/nutrition-bands.ts`,
`shared/constants/nutrition-bands.ts`, `server/**`, `client/screens/nutrition-detail-flags-utils.ts`,
`client/screens/nutrition-detail-utils.ts`, `client/camera/**`.

---

## Task 1: Band visuals and row presentation primitives

Pure, no React. Establishes the vocabulary every later task renders with, and creates the
`__tests__/` directory 2b deliberately left absent.

**Files:**

- Modify: `client/components/badge-severity-visuals.ts`
- Modify: `client/components/__tests__/badge-contrast.test.ts`
- Create: `client/components/nutrition/NutritionPanel-utils.ts`
- Create: `client/components/nutrition/__tests__/NutritionPanel-utils.test.ts`

**Interfaces:**

- Consumes: `ConcernBand`, `BenefitBand` from `@shared/lib/nutrition-bands`.
- Produces: `NUTRIENT_ROWS`, `bandTagText()`, `bandVisuals()`, `composeNutrientRowLabel()`,
  `CONCERN_LOW_VISUALS`, `BENEFIT_VISUALS`, `BENEFIT_NONE_VISUALS`.

- [ ] **Step 1: Write the failing tag-copy and label-composition tests**

Create `client/components/nutrition/__tests__/NutritionPanel-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import {
  NUTRIENT_ROWS,
  bandTagText,
  composeNutrientRowLabel,
} from "../NutritionPanel-utils";

describe("bandTagText", () => {
  it("uses the exact spec copy for every concern band", () => {
    expect(bandTagText({ group: "concern", band: "high" })).toBe("HIGH");
    expect(bandTagText({ group: "concern", band: "medium" })).toBe("MED");
    expect(bandTagText({ group: "concern", band: "low" })).toBe("LOW");
  });

  it("uses the exact spec copy for every benefit band", () => {
    expect(bandTagText({ group: "benefit", band: "excellent" })).toBe(
      "EXCELLENT",
    );
    expect(bandTagText({ group: "benefit", band: "good" })).toBe("GOOD");
    expect(bandTagText({ group: "benefit", band: "none" })).toBe("NONE");
  });

  it("returns null for an unknown band — an unbanded row shows no tag at all", () => {
    expect(bandTagText({ group: "concern", band: "unknown" })).toBeNull();
    expect(bandTagText({ group: "benefit", band: "unknown" })).toBeNull();
  });
});

describe("composeNutrientRowLabel", () => {
  it("spells the unit out as a word — VoiceOver reads a bare 'g' as 'gee'", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sugar,
        value: 39,
        tag: "HIGH",
      }),
    ).toBe("Sugar, 39 grams, high");
  });

  it("spells milligrams out too", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sodium,
        value: 680,
        tag: "MED",
      }),
    ).toBe("Sodium, 680 milligrams, medium");
  });

  it("composes without a band word when the row is unbanded", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sugar,
        value: 39,
        tag: null,
      }),
    ).toBe("Sugar, 39 grams");
  });

  it("says 'not recorded' when there is no value, and never says zero", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.saturatedFat,
        value: undefined,
        tag: null,
      }),
    ).toBe("Saturated fat, not recorded");
  });

  it("keeps a zero value distinct from not recorded", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.fibre,
        value: 0,
        tag: "NONE",
      }),
    ).toBe("Fibre, 0 grams, none");
  });

  it("rounds to one decimal, matching the rendered value", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sugar,
        value: 12.34,
        tag: "MED",
      }),
    ).toBe("Sugar, 12.3 grams, medium");
  });
});

describe("NUTRIENT_ROWS", () => {
  it("covers every nutrient the panel renders, in the two zones", () => {
    const banded = Object.values(NUTRIENT_ROWS).filter(
      (r) => r.zone === "banded",
    );
    const unbanded = Object.values(NUTRIENT_ROWS).filter(
      (r) => r.zone === "unbanded",
    );
    expect(banded.map((r) => r.key).sort()).toEqual([
      "fat",
      "fibre",
      "protein",
      "saturatedFat",
      "sodium",
      "sugar",
    ]);
    expect(unbanded.map((r) => r.key).sort()).toEqual([
      "caffeine",
      "cholesterol",
      "transFat",
    ]);
  });

  it("maps fibre's row to NutritionData's US spelling — 'fiber', not 'fibre'", () => {
    // The band layer says `fibre` (BenefitNutrient); NutritionData and
    // NutritionPer100g both say `fiber`. A typo here is silently `undefined`,
    // which renders as "Not recorded" on every product — a failure that looks
    // like missing data rather than a bug.
    expect(NUTRIENT_ROWS.fibre.sourceKey).toBe("fiber");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionPanel-utils.test.ts`
Expected: FAIL — `Failed to resolve import "../NutritionPanel-utils"`.

- [ ] **Step 3: Widen the badge severity visuals**

In `client/components/badge-severity-visuals.ts`, widen the two unions and append three
entries. Leave `BADGE_SEVERITY_FILL_OPACITY`, `HIGH_SEVERITY_VISUALS`,
`MEDIUM_SEVERITY_VISUALS` and `LOW_SEVERITY_VISUALS` untouched:

```ts
/** WCAG-safe badge text/icon color token (see client/constants/theme.ts). */
export type BadgeSeverityColorKey =
  | "badgeErrorText"
  | "badgeWarningText"
  | "badgeInfoText"
  | "badgeSuccessText"
  | "badgeNeutralText";

export type BadgeSeverityIcon =
  | "alert-triangle"
  | "alert-circle"
  | "info"
  | "check-circle"
  | "award"
  | "minus-circle";
```

Then, after `LOW_SEVERITY_VISUALS`:

```ts
/**
 * The three entries below serve NutritionPanel's traffic-light bands, not the
 * two severity badges above. They are here rather than in a panel-local module
 * so every WCAG-checked badge token stays enumerable from one place —
 * `__tests__/badge-contrast.test.ts` asserts against this file.
 *
 * CONCERN_LOW and BENEFIT deliberately SHARE `badgeSuccessText`. Both mean
 * "good news", a second green would need its own 4.5:1 (text) and 3:1
 * (graphical) verification in both themes, and the two are already separable
 * on two non-colour channels: the icon here, and the tag text ("LOW" vs
 * "GOOD"/"EXCELLENT") in NutritionPanel-utils.
 */

/** A concern nutrient in its LOW band — a good result about a bad thing. */
export const CONCERN_LOW_VISUALS: BadgeSeverityVisuals = {
  colorKey: "badgeSuccessText",
  icon: "check-circle",
};

/** A benefit nutrient at GOOD or EXCELLENT — actively good news. */
export const BENEFIT_VISUALS: BadgeSeverityVisuals = {
  colorKey: "badgeSuccessText",
  icon: "award",
};

/**
 * A benefit nutrient at zero. Grey, and NOT the same as "not recorded" — a
 * product with no fibre is a fact about the product; a product whose fibre we
 * never received is a fact about our data. Collapsing the two is the
 * fail-silent shape safety invariant 3 forbids.
 */
export const BENEFIT_NONE_VISUALS: BadgeSeverityVisuals = {
  colorKey: "badgeNeutralText",
  icon: "minus-circle",
};
```

- [ ] **Step 4: Write `NutritionPanel-utils.ts`**

Create `client/components/nutrition/NutritionPanel-utils.ts`:

```ts
/**
 * Presentation vocabulary for NutritionPanel's rows — pure, no React.
 *
 * Everything a row needs to render and to announce derives from here, so the
 * visible tag and the spoken label cannot drift apart: `composeNutrientRowLabel`
 * takes the SAME tag string the row displays.
 */
import type {
  ConcernBand,
  BenefitBand,
  ConcernNutrient,
  BenefitNutrient,
} from "@shared/lib/nutrition-bands";
import {
  HIGH_SEVERITY_VISUALS,
  MEDIUM_SEVERITY_VISUALS,
  CONCERN_LOW_VISUALS,
  BENEFIT_VISUALS,
  BENEFIT_NONE_VISUALS,
  type BadgeSeverityVisuals,
} from "@/components/badge-severity-visuals";
import type { NutritionPer100g } from "@/lib/serving-size-utils";

/** Fields every row reads. `NutritionData` and `NutritionPer100g` share all of these. */
type NutrientField = keyof NutritionPer100g;

interface RowBase {
  /** Visible row label. */
  label: string;
  /** Rendered unit, e.g. "g". */
  unit: string;
  /** Spoken unit — a bare "g" is read as "gee" by VoiceOver. */
  spokenUnit: string;
  /**
   * The field to read on the value source. Deliberately separate from `key`:
   * the band layer spells it `fibre` and the data layer spells it `fiber`, and
   * one of the two has to bridge. Typed against `NutritionPer100g` rather than
   * `NutritionData` so a row can never name `productName` or `barcode`.
   */
  sourceKey: NutrientField;
}

/**
 * A discriminated union rather than one flat interface, so a banded row's
 * `key` is compiler-checked against the band layer's own nutrient names. This
 * is what lets `buildPanelRows` call `concernBand(row.key, …)` with no cast —
 * and it means adding a seventh banded row with a name the band layer does not
 * know is a compile error rather than a silently unbanded row.
 */
export type NutrientRow =
  | (RowBase & { key: ConcernNutrient; zone: "banded"; group: "concern" })
  | (RowBase & { key: BenefitNutrient; zone: "banded"; group: "benefit" })
  | (RowBase & { key: NutrientField; zone: "unbanded"; group: "none" });

export type RowZone = NutrientRow["zone"];
export type RowGroup = NutrientRow["group"];

/**
 * Fixed render order. Banded rows first (the zone the panel bands), then the
 * three with no published traffic-light threshold. Order is a display
 * decision and is independent of `pickStandouts`' tie-break order.
 */
export const NUTRIENT_ROWS = {
  sugar: {
    key: "sugar",
    sourceKey: "sugar",
    label: "Sugar",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "concern",
  },
  saturatedFat: {
    key: "saturatedFat",
    sourceKey: "saturatedFat",
    label: "Saturated fat",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "concern",
  },
  fat: {
    key: "fat",
    sourceKey: "fat",
    label: "Total fat",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "concern",
  },
  sodium: {
    key: "sodium",
    sourceKey: "sodium",
    label: "Sodium",
    unit: "mg",
    spokenUnit: "milligrams",
    zone: "banded",
    group: "concern",
  },
  fibre: {
    key: "fibre",
    sourceKey: "fiber",
    label: "Fibre",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "benefit",
  },
  protein: {
    key: "protein",
    sourceKey: "protein",
    label: "Protein",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "benefit",
  },
  transFat: {
    key: "transFat",
    sourceKey: "transFat",
    label: "Trans fat",
    unit: "g",
    spokenUnit: "grams",
    zone: "unbanded",
    group: "none",
  },
  cholesterol: {
    key: "cholesterol",
    sourceKey: "cholesterol",
    label: "Cholesterol",
    unit: "mg",
    spokenUnit: "milligrams",
    zone: "unbanded",
    group: "none",
  },
  caffeine: {
    key: "caffeine",
    sourceKey: "caffeine",
    label: "Caffeine",
    unit: "mg",
    spokenUnit: "milligrams",
    zone: "unbanded",
    group: "none",
  },
} as const satisfies Record<string, NutrientRow>;

export type BandDescriptor =
  | { group: "concern"; band: ConcernBand }
  | { group: "benefit"; band: BenefitBand };

/**
 * Lookup tables rather than switches, deliberately. `Record<ConcernBand, …>`
 * makes a new band value a compile error AT THE TABLE; an exhaustive switch
 * with no `default` would instead fall off the end and return `undefined`
 * where `null` is expected — and this repo does not set `noImplicitReturns`,
 * so that is the shape that compiles locally and misbehaves at runtime. A
 * missing dot for a reason nobody can see is exactly the fail-silent outcome
 * safety invariant 3 exists to prevent.
 *
 * `null` means the row is unbanded: no tag AND no indicator dot.
 */
const CONCERN_TAG: Record<ConcernBand, string | null> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  unknown: null,
};

const BENEFIT_TAG: Record<BenefitBand, string | null> = {
  excellent: "EXCELLENT",
  good: "GOOD",
  none: "NONE",
  unknown: null,
};

const CONCERN_VISUALS: Record<ConcernBand, BadgeSeverityVisuals | null> = {
  high: HIGH_SEVERITY_VISUALS,
  medium: MEDIUM_SEVERITY_VISUALS,
  low: CONCERN_LOW_VISUALS,
  unknown: null,
};

const BENEFIT_BAND_VISUALS: Record<BenefitBand, BadgeSeverityVisuals | null> = {
  excellent: BENEFIT_VISUALS,
  good: BENEFIT_VISUALS,
  none: BENEFIT_NONE_VISUALS,
  unknown: null,
};

/** The non-colour channel for WCAG 1.4.1 — load-bearing text, not decoration. */
export function bandTagText(descriptor: BandDescriptor): string | null {
  return descriptor.group === "concern"
    ? CONCERN_TAG[descriptor.band]
    : BENEFIT_TAG[descriptor.band];
}

/** `null` for an unknown band — the row renders no dot and no pill. */
export function bandVisuals(
  descriptor: BandDescriptor,
): BadgeSeverityVisuals | null {
  return descriptor.group === "concern"
    ? CONCERN_VISUALS[descriptor.band]
    : BENEFIT_BAND_VISUALS[descriptor.band];
}

/** Matches the rendered value exactly — one decimal, no trailing ".0". */
function formatValue(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export interface RowLabelInput {
  row: NutrientRow;
  /** The DISPLAYED value. `undefined` means not recorded — never a zero. */
  value: number | undefined;
  /** The SAME tag string the row renders, so the two cannot drift. */
  tag: string | null;
}

/**
 * The row's `accessibilityLabel`. Each panel row is one `accessible` group, so
 * this is the whole of what a screen reader says about the row — the indicator
 * dot is `accessible={false}` and contributes nothing.
 */
export function composeNutrientRowLabel({
  row,
  value,
  tag,
}: RowLabelInput): string {
  if (value === undefined) return `${row.label}, not recorded`;
  const base = `${row.label}, ${formatValue(value)} ${row.spokenUnit}`;
  return tag === null ? base : `${base}, ${tag.toLowerCase()}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionPanel-utils.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Write the failing contrast cases**

In `client/components/__tests__/badge-contrast.test.ts`, add the import and two case builders.
Place the builders beside `verificationCases()` and register them wherever the existing
builders are consumed (follow the file's existing composition — do not restructure it):

```ts
import {
  CONCERN_LOW_VISUALS,
  BENEFIT_VISUALS,
  BENEFIT_NONE_VISUALS,
  BADGE_SEVERITY_FILL_OPACITY,
} from "../badge-severity-visuals";

/**
 * NutritionPanel's band tag renders as a pill at the shared severity fill
 * opacity, exactly like ScanFlagBadge — so its text sits against the same
 * composited background and takes the same 4.5:1 bar.
 */
function panelTagCases(): Case[] {
  return [
    { label: "NutritionPanel concern LOW tag", visuals: CONCERN_LOW_VISUALS },
    { label: "NutritionPanel benefit tag", visuals: BENEFIT_VISUALS },
    { label: "NutritionPanel benefit NONE tag", visuals: BENEFIT_NONE_VISUALS },
  ].map(({ label, visuals }) => ({
    label,
    colorKey: visuals.colorKey,
    opacity: BADGE_SEVERITY_FILL_OPACITY,
  }));
}
```

Then a second `describe` block, because the indicator takes a _different_ WCAG criterion:

```ts
/**
 * WCAG 1.4.11 — the indicator dot is a GRAPHICAL OBJECT, not text, so its bar
 * is 3:1 rather than 4.5:1, and it renders at FULL token strength (opacity 1)
 * directly on the surface rather than as a low-opacity fill. Naming only the
 * text criterion is what invites picking a lighter green that passes the wrong
 * test.
 */
const AA_GRAPHICAL_OBJECT_THRESHOLD = 3.0;

describe("NutritionPanel band indicator (WCAG 1.4.11 graphical object)", () => {
  const indicatorVisuals = [
    { label: "concern HIGH", visuals: HIGH_SEVERITY_VISUALS },
    { label: "concern MEDIUM", visuals: MEDIUM_SEVERITY_VISUALS },
    { label: "concern LOW", visuals: CONCERN_LOW_VISUALS },
    { label: "benefit GOOD/EXCELLENT", visuals: BENEFIT_VISUALS },
    { label: "benefit NONE", visuals: BENEFIT_NONE_VISUALS },
  ];

  for (const theme of themeNames) {
    for (const surface of surfaceNames) {
      for (const { label, visuals } of indicatorVisuals) {
        it(`${label} dot >= 3:1 on ${theme}/${surface}`, () => {
          const fg = Colors[theme][visuals.colorKey];
          const bg = Colors[theme][surface];
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(
            AA_GRAPHICAL_OBJECT_THRESHOLD,
          );
        });
      }
    }
  }
});
```

`HIGH_SEVERITY_VISUALS` / `MEDIUM_SEVERITY_VISUALS` must be added to the existing import from
`../badge-severity-visuals` if they are not already imported.

- [ ] **Step 7: Run the contrast suite**

Run: `npx vitest run client/components/__tests__/badge-contrast.test.ts`
Expected: PASS. Every token is already verified at 4.5:1 in both themes on both surfaces, so
3:1 clears with headroom — this suite pins that it _stays_ true if a token is ever retuned.

- [ ] **Step 8: Commit**

```bash
git add client/components/badge-severity-visuals.ts \
        client/components/__tests__/badge-contrast.test.ts \
        client/components/nutrition/NutritionPanel-utils.ts \
        client/components/nutrition/__tests__/NutritionPanel-utils.test.ts
git commit -m "feat(nutrition): band visuals and panel row presentation primitives"
```

---

## Task 2: The band source adapter

The correctness core of the slice. Pure, no React. Everything here exists to make Global
Constraint 1 structural rather than a rule people remember.

**Files:**

- Create: `client/components/nutrition/nutrition-band-source.ts`
- Create: `client/components/nutrition/__tests__/nutrition-band-source.test.ts`

**Interfaces:**

- Consumes: `resolveBasis`, `concernBand`, `benefitBand`, `Basis`, `NutrientBands` from
  `@shared/lib/nutrition-bands`; `NUTRIENT_ROWS` from `./NutritionPanel-utils`;
  `NutritionData` from `@/hooks/useNutritionLookup`; `ValidatedNutrition` from
  `@/lib/serving-size-utils`.
- Produces: `selectBandSource()`, `buildPanelRows()`, `PanelRowData`, `PanelData`.

- [ ] **Step 1: Write the failing serving-invariance test**

This is the test that pins the whole slice. Create
`client/components/nutrition/__tests__/nutrition-band-source.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { selectBandSource, buildPanelRows } from "../nutrition-band-source";
import type { NutritionData } from "@/hooks/useNutritionLookup";
import type { ValidatedNutrition } from "@/lib/serving-size-utils";

/** Cherry Coke: 39 g sugar per 355 ml can, 11.0 g per 100 ml → MEDIUM on the drink scale. */
const cherryCokeValidated: ValidatedNutrition = {
  per100g: {
    calories: 44,
    sugar: 11.0,
    sodium: 11,
    fat: 0,
    protein: 0,
    fiber: 0,
  },
  perServing: {
    calories: 156,
    sugar: 39,
    sodium: 39,
    fat: 0,
    protein: 0,
    fiber: 0,
  },
  servingInfo: {
    displayLabel: "1 can (355 mL)",
    grams: 355,
    wasCorrected: false,
  },
  isServingDataTrusted: true,
};

const cherryCokeNutrition: NutritionData = {
  productName: "Cherry Coke",
  servingSize: "1 can (355 mL)",
  calories: 156,
  sugar: 39,
  sodium: 39,
  fat: 0,
  protein: 0,
  fiber: 0,
};

describe("selectBandSource — serving invariance (the defect this module exists for)", () => {
  it("returns the SAME basis and values however the serving controls are set", () => {
    // `nutrition` is display state: recalculateNutrition multiplies it by
    // servingSizeGrams x servingQuantity. Two servings of the same can.
    const doubled: NutritionData = {
      ...cherryCokeNutrition,
      calories: 312,
      sugar: 78,
      sodium: 78,
    };

    const atOne = selectBandSource({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    const atTwo = selectBandSource({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: doubled,
      isBeverage: true,
    });

    expect(atTwo).toEqual(atOne);
    expect(atOne.values.sugar).toBe(11.0);
    expect(atOne.basis).toEqual({
      kind: "resolved",
      scale: "drink",
      factor: 1,
    });
  });

  it("bands Cherry Coke MEDIUM on the drink scale, not HIGH", () => {
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "medium" });
  });

  it("bands sugar MEDIUM even at quantity 2, while the DISPLAYED value doubles", () => {
    const doubled: NutritionData = { ...cherryCokeNutrition, sugar: 78 };
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: doubled,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "medium" });
    expect(sugar?.displayValue).toBe(78);
  });
});

describe("selectBandSource — path selection", () => {
  it("scan path with no validatedData yields an unknown basis, never a guess", () => {
    const source = selectBandSource({
      itemId: undefined,
      validatedData: null,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    expect(source.basis).toEqual({ kind: "unknown" });
    expect(source.values).toEqual({});
  });

  it("saved-item path bands from `nutrition`, which no control can scale there", () => {
    // Amy's chili: 680 mg sodium per 236 g serving = 288 mg/100 g -> MEDIUM.
    const source = selectBandSource({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Amy's Organic Chili",
        servingSize: "1 cup (236g)",
        sodium: 680,
      },
      isBeverage: null,
    });
    expect(source.basis).toEqual({
      kind: "resolved",
      scale: "food",
      factor: 100 / 236,
    });
    expect(source.values.sodium).toBe(680);
  });

  it("bands Amy's chili MEDIUM, not HIGH", () => {
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Amy's Organic Chili",
        servingSize: "1 cup (236g)",
        sodium: 680,
      },
      isBeverage: null,
    });
    const sodium = rows.find((r) => r.row.key === "sodium");
    expect(sodium?.band).toEqual({ group: "concern", band: "medium" });
  });

  it("holds a good per-100 payload and STILL renders unbanded when no scale resolves", () => {
    // The most counterintuitive outcome in the slice, and the one most likely
    // to be "fixed" later by defaulting to food. Food thresholds are roughly
    // DOUBLE drink thresholds, so defaulting halves the strictness applied to
    // every untagged drink. Unbanded is the correct answer.
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: {
        ...cherryCokeValidated,
        servingInfo: {
          displayLabel: "1 bottle",
          grams: null,
          wasCorrected: false,
        },
      },
      nutrition: { ...cherryCokeNutrition, servingSize: "1 bottle" },
      isBeverage: null, // no category signal, and "1 bottle" carries no unit
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "unknown" });
    expect(sugar?.hasValue).toBe(true);
  });

  it("saved item with an unparseable serving string renders unbanded, not defaulted", () => {
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Mystery Drink",
        servingSize: "1 bottle",
        sugar: 39,
      },
      isBeverage: null,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "unknown" });
    expect(sugar?.displayValue).toBe(39);
    expect(sugar?.hasValue).toBe(true);
  });
});

describe("buildPanelRows — the three states that must stay distinct", () => {
  const base = {
    itemId: undefined,
    isBeverage: false,
    validatedData: {
      ...cherryCokeValidated,
      servingInfo: { displayLabel: "30 g", grams: 30, wasCorrected: false },
    } as ValidatedNutrition,
  };

  it("no value at all -> hasValue false, displayValue undefined", () => {
    const { rows } = buildPanelRows({
      ...base,
      validatedData: {
        ...base.validatedData,
        per100g: { sugar: 10 },
      },
      nutrition: { productName: "X", servingSize: "30 g", sugar: 3 },
    });
    const satFat = rows.find((r) => r.row.key === "saturatedFat");
    expect(satFat?.hasValue).toBe(false);
    expect(satFat?.displayValue).toBeUndefined();
  });

  it("a zero value is NOT 'not recorded' — hasValue stays true", () => {
    const { rows } = buildPanelRows({
      ...base,
      validatedData: { ...base.validatedData, per100g: { fiber: 0 } },
      nutrition: { productName: "X", servingSize: "30 g", fiber: 0 },
    });
    const fibre = rows.find((r) => r.row.key === "fibre");
    expect(fibre?.hasValue).toBe(true);
    expect(fibre?.displayValue).toBe(0);
    expect(fibre?.band).toEqual({ group: "benefit", band: "none" });
  });

  it("a known value with an unresolved basis keeps hasValue true and bands unknown", () => {
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: { productName: "X", servingSize: "1 bottle", fiber: 5 },
      isBeverage: null,
    });
    const fibre = rows.find((r) => r.row.key === "fibre");
    // Same band as the absent case above, DIFFERENT hasValue. This pair is
    // what pins hasValue to raw-value presence rather than to the band.
    expect(fibre?.band).toEqual({ group: "benefit", band: "unknown" });
    expect(fibre?.hasValue).toBe(true);
  });
});

describe("buildPanelRows — bands feed pickStandouts from the SAME derivation", () => {
  it("emits a NutrientBands object whose hasValue matches the rows'", () => {
    const { rows, bands } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    for (const row of rows) {
      if (row.row.group === "concern") {
        expect(bands.concerns[row.row.key as "sugar"]?.hasValue).toBe(
          row.hasValue,
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/components/nutrition/__tests__/nutrition-band-source.test.ts`
Expected: FAIL — `Failed to resolve import "../nutrition-band-source"`.

- [ ] **Step 3: Write `nutrition-band-source.ts`**

Create `client/components/nutrition/nutrition-band-source.ts`:

```ts
/**
 * Selects the values a band may be computed from, and derives the panel's rows
 * and the summary card's `NutrientBands` from that ONE selection.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * NEVER band from `nutrition`. `nutrition` is display state:
 * `recalculateNutrition` writes
 *     nutrition.sugar = per100g.sugar x (servingSizeGrams / 100) x quantity
 * while `resolveBasis` derives its factor from the LABEL's one-serving string,
 * which the serving controls never rewrite. The two agree only in the default
 * state; at quantity 2 the computed per-100 doubles, and picking the 100 g chip
 * against a 30 g label serving inflates it 3.3x. Both OVER-warn, which is the
 * direction nutrient flags must never fail in.
 *
 * `validatedData.per100g` is the un-scaled lookup payload and is invariant to
 * the serving controls, so it is the only safe scan-path source.
 *
 * ── WHY THE SAVED-ITEM PATH IS DIFFERENT ──────────────────────────────────
 * There `validatedData` is null (the `existingItem` effect calls only
 * `setNutrition`), and `showServingControls` is gated on `!itemId`, so nothing
 * can scale `nutrition` — it IS the per-serving source. That safety is a
 * property of this branch, asserted by tests here, rather than an accident of
 * which components happen to render.
 *
 * ── WHAT THIS COSTS ───────────────────────────────────────────────────────
 * A serving-invariant band cannot apply the FSA per-portion HIGH override:
 * that needs the actual portion weight, which by definition moves with the
 * user's serving choice. So no `portionGrams` is passed to `concernBand`.
 * Skipping it can only fail toward under-warning, which is the established
 * direction. The server still applies the override when emitting `nutrient:*`
 * flags, but slice 2c stops rendering those, so the two never disagree on
 * screen.
 */
import {
  resolveBasis,
  concernBand,
  benefitBand,
  type Basis,
  type NutrientBands,
} from "@shared/lib/nutrition-bands";
import type { NutritionData } from "@/hooks/useNutritionLookup";
import type {
  ValidatedNutrition,
  NutritionPer100g,
} from "@/lib/serving-size-utils";
import {
  NUTRIENT_ROWS,
  type NutrientRow,
  type BandDescriptor,
} from "./NutritionPanel-utils";

export interface BandSourceInput {
  /** `undefined` = scan path, a number = saved-item path. */
  itemId: number | undefined;
  validatedData: ValidatedNutrition | null;
  nutrition: NutritionData | null;
  isBeverage: boolean | null;
}

export interface BandSource {
  /** Values on ONE consistent, un-scaled basis. Empty when unresolvable. */
  values: NutritionPer100g;
  basis: Basis;
}

export function selectBandSource(input: BandSourceInput): BandSource {
  const servingSize = input.nutrition?.servingSize;

  if (input.itemId === undefined) {
    // Scan path. `nutrition` may be serving-scaled at any moment, so the only
    // admissible source is the un-scaled per-100 payload. Without it there is
    // no denominator we can defend, and an unbanded panel is the honest result.
    if (!input.validatedData) return { values: {}, basis: { kind: "unknown" } };
    return {
      values: input.validatedData.per100g,
      basis: resolveBasis({
        valuesArePer100: true,
        servingSize,
        isBeverage: input.isBeverage,
      }),
    };
  }

  // Saved-item path. No serving control renders, so `nutrition` is the
  // un-scaled per-serving source and resolveBasis back-calculates from the
  // stored serving string — never from a `|| 100` default.
  if (!input.nutrition) return { values: {}, basis: { kind: "unknown" } };
  return {
    values: input.nutrition,
    basis: resolveBasis({
      valuesArePer100: false,
      servingSize,
      isBeverage: input.isBeverage,
    }),
  };
}

export interface PanelRowData {
  row: NutrientRow;
  /**
   * The SERVING-SCALED value the user reads, from `nutrition` — so the panel
   * agrees with the macro strip above it. `undefined` renders "Not recorded".
   */
  displayValue: number | undefined;
  /** `null` for an unbanded row (trans fat, cholesterol, caffeine). */
  band: BandDescriptor | null;
  /** From the BAND SOURCE's raw value. Never from `band === "unknown"`. */
  hasValue: boolean;
}

export interface PanelData {
  rows: PanelRowData[];
  /** The same derivation, shaped for `pickStandouts`. */
  bands: NutrientBands;
}

/**
 * One derivation, two consumers. The panel's rows and the summary card's
 * `NutrientBands` come out of the same pass, so a row that says "Not recorded"
 * can never pair with a standout that says otherwise.
 */
export function buildPanelRows(input: BandSourceInput): PanelData {
  const source = selectBandSource(input);
  const kcal = source.values.calories;

  const bands: NutrientBands = { concerns: {}, benefits: {} };
  const rows: PanelRowData[] = [];

  for (const row of Object.values(NUTRIENT_ROWS) as NutrientRow[]) {
    // Both reads use `sourceKey`, which is `keyof NutritionPer100g` — and
    // every one of those fields also exists on NutritionData, so the display
    // read needs no cast either.
    const sourceValue = source.values[row.sourceKey];
    const hasValue = typeof sourceValue === "number";
    const displayValue = input.nutrition?.[row.sourceKey];

    if (row.group === "concern") {
      // `row.key` is `ConcernNutrient` by the union's own discriminant — no
      // cast, and a mismatched row name would not compile.
      const band = concernBand(
        row.key,
        hasValue ? sourceValue : undefined,
        source.basis,
        // No portionGrams — see the module docblock. A portion-aware band
        // would move with the user's serving choice.
      );
      bands.concerns[row.key] = { band, hasValue };
      rows.push({
        row,
        displayValue,
        band: { group: "concern", band },
        hasValue,
      });
    } else if (row.group === "benefit") {
      const band = benefitBand(
        row.key,
        hasValue ? sourceValue : undefined,
        source.basis,
        kcal,
      );
      bands.benefits[row.key] = { band, hasValue };
      rows.push({
        row,
        displayValue,
        band: { group: "benefit", band },
        hasValue,
      });
    } else {
      // Unbanded zone: known value, no published standard to judge it against.
      // An unbanded row is NOT a green row — `band: null` renders no dot.
      rows.push({ row, displayValue, band: null, hasValue });
    }
  }

  return { rows, bands };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/components/nutrition/__tests__/nutrition-band-source.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the invariance test is non-vacuous**

Temporarily change `selectBandSource`'s scan-path branch to
`values: input.nutrition ?? {}` and re-run. Expected: the three
serving-invariance tests FAIL. **Revert the change immediately** and re-run to green. A test
that cannot fail is not protecting anything, and this is the one test the slice turns on.

- [ ] **Step 6: Register the module as a mutation target**

Add `client/components/nutrition/nutrition-band-source.ts` to `stryker.targets.mjs`. The
likeliest defect in this module is a branch inversion (`itemId === undefined` the wrong way
round, or `valuesArePer100` flipped), which coarse fixtures cannot see. Baseline with
`npm run mutation:explore` before setting a threshold — do **not** invent one.

- [ ] **Step 7: Commit**

```bash
git add client/components/nutrition/nutrition-band-source.ts \
        client/components/nutrition/__tests__/nutrition-band-source.test.ts \
        stryker.targets.mjs
git commit -m "feat(nutrition): serving-invariant band source adapter"
```

---

## Task 3: `NutritionPanel`

**Files:**

- Create: `client/components/nutrition/NutritionPanel.tsx`
- Create: `client/components/nutrition/__tests__/NutritionPanel.test.tsx`

**Interfaces:**

- Consumes: `PanelRowData` from `./nutrition-band-source`; `bandTagText`, `bandVisuals`,
  `composeNutrientRowLabel` from `./NutritionPanel-utils`.
- Produces: `<NutritionPanel rows={PanelRowData[]} reducedMotion?: boolean />`.

- [ ] **Step 1: Write the failing component tests**

Create `client/components/nutrition/__tests__/NutritionPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";

import { renderComponent } from "../../../../test/utils/render-component";
import { NutritionPanel } from "../NutritionPanel";
import { NUTRIENT_ROWS } from "../NutritionPanel-utils";
import type { PanelRowData } from "../nutrition-band-source";

function row(overrides: Partial<PanelRowData> & { row: PanelRowData["row"] }) {
  return {
    displayValue: undefined,
    band: null,
    hasValue: false,
    ...overrides,
  } as PanelRowData;
}

describe("NutritionPanel", () => {
  it("renders a banded row with its value, unit and tag", () => {
    const { queryByText } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "high" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByText("Sugar")).toBeTruthy();
    expect(queryByText("39 g")).toBeTruthy();
    expect(queryByText("HIGH")).toBeTruthy();
  });

  it("renders an UNBANDED row with the value and NO tag and NO indicator", () => {
    // Assert on the indicator and the value, not on the row label: a
    // label-only assertion passes in every row state.
    const { queryByText, container } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "unknown" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByText("39 g")).toBeTruthy();
    expect(queryByText("LOW")).toBeNull();
    expect(queryByText("HIGH")).toBeNull();
    expect(
      container.querySelector('[data-testid="band-indicator-sugar"]'),
    ).toBeNull();
  });

  it("an unbanded row is NOT rendered as a green LOW", () => {
    const { queryByTestId } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "unknown" },
            hasValue: true,
          }),
          row({
            row: NUTRIENT_ROWS.fat,
            displayValue: 1,
            band: { group: "concern", band: "low" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByTestId("band-indicator-sugar")).toBeNull();
    expect(queryByTestId("band-indicator-fat")).toBeTruthy();
  });

  it("renders a ZERO row as NONE, distinct from not-recorded", () => {
    const { queryByText } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.fibre,
            displayValue: 0,
            band: { group: "benefit", band: "none" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByText("0 g")).toBeTruthy();
    expect(queryByText("NONE")).toBeTruthy();
    expect(queryByText("Not recorded")).toBeNull();
  });

  it("renders a NOT-RECORDED row with an em dash and no value", () => {
    const { queryByText } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.saturatedFat,
            displayValue: undefined,
            band: { group: "concern", band: "unknown" },
            hasValue: false,
          }),
        ]}
      />,
    );
    expect(queryByText("Not recorded")).toBeTruthy();
    expect(queryByText("0 g")).toBeNull();
  });

  it("gives each row one accessible group carrying the composed label", () => {
    const { container } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sodium,
            displayValue: 680,
            band: { group: "concern", band: "medium" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(
      container.querySelector('[aria-label="Sodium, 680 milligrams, medium"]'),
    ).toBeTruthy();
  });

  it("hides the indicator from the a11y tree on BOTH platforms", () => {
    const { queryByTestId } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "high" },
            hasValue: true,
          }),
        ]}
      />,
    );
    const dot = queryByTestId("band-indicator-sugar");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing at all when given no rows", () => {
    const { container } = renderComponent(<NutritionPanel rows={[]} />);
    expect(container.textContent).toBe("");
  });
});
```

> **Note on the two `querySelector` assertions.** `renderComponent` returns the jsdom
> container; `data-testid` and `aria-label` are what `test/mocks/react-native.ts` maps
> `testID` and `accessibilityLabel` to. If the harness spells either differently, follow the
> harness — check an existing suite such as
> `client/components/__tests__/VerificationBadge.test.tsx` and match it rather than changing
> the mock.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "../NutritionPanel"`.

- [ ] **Step 3: Implement `NutritionPanel.tsx`**

Create `client/components/nutrition/NutritionPanel.tsx`. Requirements, all load-bearing:

- One `Card` containing both zones. Banded rows first, then a divider, then unbanded rows.
  The divider renders only when both zones have rows.
- Each row is `accessible` with `accessibilityLabel={composeNutrientRowLabel({ row, value: displayValue, tag })}`
  where `tag` is the **same string** passed to the rendered pill.
- **No interactive child inside a grouped row** — the group would swallow it.
- The indicator dot: 12 pt circle, `backgroundColor: theme[visuals.colorKey]`,
  `testID={`band-indicator-${row.key}`}`, `accessible={false}`,
  `importantForAccessibility="no"`, `accessibilityElementsHidden`. Rendered only when
  `bandVisuals(band)` is non-null. It has no children, so `"no"` is the correct scope here —
  `"no-hide-descendants"` is required only for a container with a subtree.
- The tag pill: `<Feather name={visuals.icon} size={12} accessible={false} />` plus the tag
  text, on `withOpacity(theme[visuals.colorKey], BADGE_SEVERITY_FILL_OPACITY)`, text colour
  `theme[visuals.colorKey]`. Rendered only when `bandTagText(band)` is non-null.
- Value cell: `{displayValue === undefined ? "Not recorded" : `${round1(displayValue)} ${row.unit}`}`.
  The not-recorded cell also renders a leading em dash `—` per the spec's tag table, in
  `theme.textSecondary`.
- Unbanded-zone rows are visually quieter (`theme.textSecondary` label, no dot column).
- Return `null` when `rows.length === 0`. **Do not** hide the panel when every row is
  unknown — a vanished panel reads as "nothing to worry about". Rows with no value still
  render as "Not recorded".
- The component owns its `StyleSheet.create` and calls `useTheme()` itself.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionPanel.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add client/components/nutrition/NutritionPanel.tsx \
        client/components/nutrition/__tests__/NutritionPanel.test.tsx
git commit -m "feat(nutrition): NutritionPanel traffic-light nutrient table"
```

---

## Task 4: `NutritionSummaryCard`

**Files:**

- Create: `client/components/nutrition/NutritionSummaryCard-utils.ts`
- Create: `client/components/nutrition/NutritionSummaryCard.tsx`
- Create: `client/components/nutrition/__tests__/NutritionSummaryCard.test.tsx`

**Interfaces:**

- Consumes: `Standout` and `pickStandouts` from `@shared/lib/nutrition-bands`;
  `NUTRIENT_ROWS`, `bandTagText`, `bandVisuals` from `./NutritionPanel-utils`;
  `NutriScoreChip`'s grade type.
- Produces:
  `<NutritionSummaryCard standouts calories protein carbs fat servingContextLabel nutriScoreGrade reducedMotion />`
  and `standoutCopy()`.

- [ ] **Step 1: Write the failing utils test**

Create the copy function first — it is the piece with exact strings. Append to
`client/components/nutrition/__tests__/NutritionPanel-utils.test.ts` is wrong; create
`client/components/nutrition/__tests__/NutritionSummaryCard-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { standoutCopy } from "../NutritionSummaryCard-utils";

describe("standoutCopy", () => {
  it("uses the spec's benefit copy verbatim", () => {
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "excellent",
        hasValue: true,
      }),
    ).toBe("Excellent source of fibre");
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "good",
        hasValue: true,
      }),
    ).toBe("Good source of fibre");
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "protein",
        band: "good",
        hasValue: true,
      }),
    ).toBe("Good source of protein");
  });

  it("names a zero benefit without implying it is good news", () => {
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "none",
        hasValue: true,
      }),
    ).toBe("No fibre");
  });

  it("distinguishes a promoted fibre row with NO recorded value", () => {
    // Rule 4 promotes fibre regardless of hasValue, so this state is reachable
    // and must not read as "no fibre".
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "unknown",
        hasValue: false,
      }),
    ).toBe("Fibre not recorded");
  });

  it("distinguishes a known fibre value we cannot place on a scale", () => {
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "unknown",
        hasValue: true,
      }),
    ).toBe("Fibre");
  });

  it("uses the concern copy for concern standouts", () => {
    expect(
      standoutCopy({
        group: "concern",
        nutrient: "sugar",
        band: "high",
        hasValue: true,
      }),
    ).toBe("High in sugar");
    expect(
      standoutCopy({
        group: "concern",
        nutrient: "saturatedFat",
        band: "medium",
        hasValue: true,
      }),
    ).toBe("Moderate saturated fat");
    expect(
      standoutCopy({
        group: "concern",
        nutrient: "sodium",
        band: "low",
        hasValue: true,
      }),
    ).toBe("Low in sodium");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionSummaryCard-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `NutritionSummaryCard-utils.ts`**

```ts
/**
 * Display copy for the summary card's two promoted standout rows. Pure.
 *
 * The `unknown` band splits on `hasValue`, and that split is the whole reason
 * `Standout` carries the flag: rule 4 promotes fibre regardless of band, so a
 * promoted fibre row for a product with NO recorded fibre and one for a
 * product whose fibre we simply cannot place on a scale both arrive with
 * `band: "unknown"`. Collapsing them would tell a user a product has no fibre
 * when we never received the number.
 */
import type { Standout } from "@shared/lib/nutrition-bands";

const NUTRIENT_WORD: Record<string, string> = {
  sugar: "sugar",
  saturatedFat: "saturated fat",
  sodium: "sodium",
  fat: "fat",
  fibre: "fibre",
  protein: "protein",
};

export function standoutCopy(standout: Standout): string {
  const word = NUTRIENT_WORD[standout.nutrient];

  if (standout.group === "concern") {
    switch (standout.band) {
      case "high":
        return `High in ${word}`;
      case "medium":
        return `Moderate ${word}`;
      case "low":
        return `Low in ${word}`;
      case "unknown":
        return standout.hasValue
          ? capitalise(word)
          : `${capitalise(word)} not recorded`;
    }
  }

  switch (standout.band) {
    case "excellent":
      return `Excellent source of ${word}`;
    case "good":
      return `Good source of ${word}`;
    case "none":
      return `No ${word}`;
    case "unknown":
      return standout.hasValue
        ? capitalise(word)
        : `${capitalise(word)} not recorded`;
  }
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionSummaryCard-utils.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing component test**

Create `client/components/nutrition/__tests__/NutritionSummaryCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";

import { renderComponent } from "../../../../test/utils/render-component";
import { NutritionSummaryCard } from "../NutritionSummaryCard";

const twoStandouts = [
  { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
  { group: "benefit", nutrient: "fibre", band: "good", hasValue: true },
] as const;

describe("NutritionSummaryCard", () => {
  it("renders the calorie figure and the fixed macro strip", () => {
    const { queryByText } = renderComponent(
      <NutritionSummaryCard
        standouts={[...twoStandouts]}
        calories={156}
        protein={2}
        carbs={39}
        fat={0}
      />,
    );
    expect(queryByText("156")).toBeTruthy();
    expect(queryByText("Protein")).toBeTruthy();
    expect(queryByText("Carbs")).toBeTruthy();
    expect(queryByText("Fat")).toBeTruthy();
  });

  it("renders both promoted standouts with their copy", () => {
    const { queryByText } = renderComponent(
      <NutritionSummaryCard
        standouts={[...twoStandouts]}
        calories={156}
        protein={2}
        carbs={39}
        fat={0}
      />,
    );
    expect(queryByText("High in sugar")).toBeTruthy();
    expect(queryByText("Good source of fibre")).toBeTruthy();
  });

  it("shows an em dash for an absent calorie value, never a zero", () => {
    const { queryByText } = renderComponent(
      <NutritionSummaryCard standouts={[]} calories={undefined} />,
    );
    expect(queryByText("—")).toBeTruthy();
    expect(queryByText("0")).toBeNull();
  });

  it("renders the Nutri-Score ring OUTSIDE the card's accessible group", () => {
    // Same reasoning the chip shipped with: a collapsed subtree announces only
    // the group label, and the grade letter is not in it.
    const { queryByTestId } = renderComponent(
      <NutritionSummaryCard
        standouts={[]}
        calories={156}
        nutriScoreGrade="b"
      />,
    );
    const ring = queryByTestId("nutri-score-ring");
    expect(ring).toBeTruthy();
    expect(ring?.closest("[aria-label]")).toBeNull();
  });

  it("renders without a ring when there is no grade (the saved-item path)", () => {
    const { queryByTestId } = renderComponent(
      <NutritionSummaryCard standouts={[]} calories={156} />,
    );
    expect(queryByTestId("nutri-score-ring")).toBeNull();
  });

  it("renders the serving context caption only when one is supplied", () => {
    const withCaption = renderComponent(
      <NutritionSummaryCard
        standouts={[]}
        calories={156}
        servingContextLabel="1 can (355 mL)"
      />,
    );
    expect(withCaption.queryByText("Per 1 can (355 mL)")).toBeTruthy();

    const without = renderComponent(
      <NutritionSummaryCard standouts={[]} calories={156} />,
    );
    expect(without.container.textContent).not.toContain("Per ");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionSummaryCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `NutritionSummaryCard.tsx`**

Requirements:

- Props: `standouts: Standout[]`, `calories?: number`, `protein?: number`, `carbs?: number`,
  `fat?: number`, `servingContextLabel?: string`, `nutriScoreGrade?: "a"|"b"|"c"|"d"|"e"`,
  `reducedMotion?: boolean`.
- **Reuse the existing calorie-card markup and styles verbatim** where it still applies:
  `styles.heroContext`, `calorieRow`, `calorieValue`, `macroTiles`, `macroTile`,
  `macroTileLabel`, `macroTileValue`, `macroTileUnit` all move from
  `NutritionDetailScreen.tsx:807-854` into this component's own `StyleSheet.create`. Keep the
  light/dark `macroTileLabel` colour comment — `textSecondary` fails AA at 4.31:1 on the
  light-mode tile fill, which is why it uses full `text` there.
- The serving caption renders only when `servingContextLabel` is supplied. The screen already
  gates it on `showServingControls`, which is the correct condition — a saved item stores
  already-scaled totals, so a "Per …" claim there misdescribes the numbers.
- Standout rows render above the macro strip, each with the dot + pill treatment from
  `bandVisuals` / `bandTagText`, and `standoutCopy` as the row's text.
- The Nutri-Score ring: `testID="nutri-score-ring"`, rendered **outside** any `accessible`
  group so VoiceOver reaches the grade letter. Give it its own `accessibilityLabel`
  (`Nutri-Score ${grade.toUpperCase()}`) exactly as `NutriScoreChip` does.
- `entering={reducedMotion ? undefined : FadeInUp.delay(200).duration(400)}` — 200 is
  unchanged from the calorie card it replaces (see D4).
- Calls `useTheme()` itself; takes `reducedMotion` as a prop.

- [ ] **Step 8: Run it green**

Run: `npx vitest run client/components/nutrition/__tests__/NutritionSummaryCard.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add client/components/nutrition/NutritionSummaryCard.tsx \
        client/components/nutrition/NutritionSummaryCard-utils.ts \
        client/components/nutrition/__tests__/NutritionSummaryCard.test.tsx \
        client/components/nutrition/__tests__/NutritionSummaryCard-utils.test.ts
git commit -m "feat(nutrition): NutritionSummaryCard verdict card with adaptive standouts"
```

---

## Task 5: `NoticeStack`

**Files:**

- Create: `client/components/nutrition/NoticeStack-utils.ts`
- Create: `client/components/nutrition/NoticeStack.tsx`
- Create: `client/components/nutrition/__tests__/NoticeStack-utils.test.ts`
- Create: `client/components/nutrition/__tests__/NoticeStack.test.tsx`

**Interfaces:**

- Produces: `buildNotices()`, `noticeAnnouncementKey()`,
  `<NoticeStack labelReadNotice correctionNotice showPer100gInfo suppressAnnounce reducedMotion />`.

- [ ] **Step 1: Write the failing utils test**

`client/components/nutrition/__tests__/NoticeStack-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { buildNotices, noticeAnnouncementKey } from "../NoticeStack-utils";

describe("buildNotices", () => {
  it("returns nothing when no advisory input is present", () => {
    expect(
      buildNotices({
        labelReadNotice: null,
        correctionNotice: null,
        showPer100gInfo: false,
      }),
    ).toEqual([]);
  });

  it("orders by severity — warnings before info", () => {
    const notices = buildNotices({
      labelReadNotice: "Label calories disagreed with our record.",
      correctionNotice: "Serving size looked implausible; corrected to 30 g.",
      showPer100gInfo: true,
    });
    expect(notices.map((n) => n.id)).toEqual([
      "label-read",
      "correction",
      "per-100g",
    ]);
    expect(notices.map((n) => n.severity)).toEqual([
      "warning",
      "warning",
      "info",
    ]);
  });

  it("carries the exact per-100g copy that shipped", () => {
    const [notice] = buildNotices({
      labelReadNotice: null,
      correctionNotice: null,
      showPer100gInfo: true,
    });
    expect(notice.body).toBe(
      "Values shown per 100g. Check package for actual serving size.",
    );
  });

  it("keeps each notice's title distinct from its body", () => {
    const notices = buildNotices({
      labelReadNotice: "reason A",
      correctionNotice: "reason B",
      showPer100gInfo: false,
    });
    expect(notices[0].title).toBe("Label not used");
    expect(notices[0].body).toBe("reason A");
    expect(notices[1].title).toBe("Serving size adjusted");
    expect(notices[1].body).toBe("reason B");
  });
});

describe("noticeAnnouncementKey", () => {
  it("keys on CONTENT, not on the notice kind", () => {
    // A discriminator-keyed announcer silently stops announcing when the
    // content mutates while the kind stays constant — which correctionNotice
    // does on every serving adjustment.
    const a = buildNotices({
      labelReadNotice: null,
      correctionNotice: "corrected to 30 g",
      showPer100gInfo: false,
    });
    const b = buildNotices({
      labelReadNotice: null,
      correctionNotice: "corrected to 45 g",
      showPer100gInfo: false,
    });
    expect(noticeAnnouncementKey(a)).not.toBe(noticeAnnouncementKey(b));
  });

  it("is stable for identical content", () => {
    const input = {
      labelReadNotice: "same",
      correctionNotice: null,
      showPer100gInfo: false,
    };
    expect(noticeAnnouncementKey(buildNotices(input))).toBe(
      noticeAnnouncementKey(buildNotices(input)),
    );
  });

  it("is null when there is nothing to announce", () => {
    expect(noticeAnnouncementKey([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run client/components/nutrition/__tests__/NoticeStack-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `NoticeStack-utils.ts`**

```ts
/**
 * Collapses the screen's advisory inputs into one ordered row list. Pure.
 *
 * `error` is deliberately NOT here: error messages require `assertive` and
 * render through `InlineError`, which fires its own iOS-gated announce. Routing
 * it through this module's announcer would make iOS hear it twice.
 *
 * `ScanConflictPrompt` is also absent — it is interactive (it offers a source
 * choice) and must not be flattened into a passive row.
 */
export type NoticeSeverity = "warning" | "info";

export interface Notice {
  id: "label-read" | "correction" | "per-100g";
  severity: NoticeSeverity;
  icon: "alert-triangle" | "zap" | "info";
  title: string;
  body: string;
}

export interface BuildNoticesInput {
  labelReadNotice: string | null;
  correctionNotice: string | null;
  showPer100gInfo: boolean;
}

/** Severity order is the render order: warnings lead. */
export function buildNotices(input: BuildNoticesInput): Notice[] {
  const notices: Notice[] = [];

  if (input.labelReadNotice) {
    notices.push({
      id: "label-read",
      severity: "warning",
      icon: "alert-triangle",
      title: "Label not used",
      body: input.labelReadNotice,
    });
  }
  if (input.correctionNotice) {
    notices.push({
      id: "correction",
      severity: "warning",
      icon: "zap",
      title: "Serving size adjusted",
      body: input.correctionNotice,
    });
  }
  if (input.showPer100gInfo) {
    notices.push({
      id: "per-100g",
      severity: "info",
      icon: "info",
      title: "Per 100g",
      body: "Values shown per 100g. Check package for actual serving size.",
    });
  }

  return notices;
}

/**
 * The announcer's edge guard. Keyed on the composed CONTENT rather than on the
 * set of notice ids: `correctionNotice`'s text mutates on every serving
 * adjustment while its id stays `"correction"`, so an id-keyed guard would
 * announce the first correction and silently skip every one after it. This is
 * the ProductChip precedent.
 */
export function noticeAnnouncementKey(notices: Notice[]): string | null {
  if (notices.length === 0) return null;
  return notices.map((n) => `${n.title}. ${n.body}`).join(" ");
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run client/components/nutrition/__tests__/NoticeStack-utils.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing component test, including the call-count guard**

`client/components/nutrition/__tests__/NoticeStack.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccessibilityInfo } from "react-native";

import { renderComponent } from "../../../../test/utils/render-component";
import { NoticeStack } from "../NoticeStack";

describe("NoticeStack", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders each notice's title and body", () => {
    const { queryByText } = renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo
      />,
    );
    expect(queryByText("Label not used")).toBeTruthy();
    expect(queryByText("Calories disagreed.")).toBeTruthy();
    expect(
      queryByText(
        "Values shown per 100g. Check package for actual serving size.",
      ),
    ).toBeTruthy();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = renderComponent(
      <NoticeStack
        labelReadNotice={null}
        correctionNotice={null}
        showPer100gInfo={false}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("carries NO live region on the container or any row", () => {
    // A "polite" region on a container wrapping multiple variants makes
    // TalkBack recompose the whole subtree on any descendant change.
    const { container } = renderComponent(
      <NoticeStack labelReadNotice="a" correctionNotice="b" showPer100gInfo />,
    );
    expect(container.querySelectorAll("[aria-live]").length).toBe(0);
  });

  it("announces once when notices appear", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("does NOT announce when suppressed — the acknowledge announce must win", () => {
    // iOS UIAccessibility.post(.announcement) does not queue: two calls in one
    // commit and one is dropped. The casualty must never be the log gate's
    // acknowledge announce, which exists to stop a screen-reader user logging
    // unreviewed values. Asserting the STRING alone would pass when both fire.
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    renderComponent(
      <NoticeStack
        labelReadNotice="Calories disagreed."
        correctionNotice={null}
        showPer100gInfo={false}
        suppressAnnounce
      />,
    );
    expect(announce).toHaveBeenCalledTimes(0);
  });

  it("re-announces when the content changes but the notice kind does not", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    const { rerender } = renderComponent(
      <NoticeStack
        labelReadNotice={null}
        correctionNotice="corrected to 30 g"
        showPer100gInfo={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    rerender(
      <NoticeStack
        labelReadNotice={null}
        correctionNotice="corrected to 45 g"
        showPer100gInfo={false}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("does not re-announce on a re-render with identical content", () => {
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    const props = {
      labelReadNotice: "same" as const,
      correctionNotice: null,
      showPer100gInfo: false,
    };
    const { rerender } = renderComponent(<NoticeStack {...props} />);
    rerender(<NoticeStack {...props} />);
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
```

> `rerender` is available: `renderComponent` returns React Testing Library's `render(...)`
> verbatim (`test/utils/render-component.tsx:29-34`), only injecting a theme wrapper. For a
> worked example of the same announce-on-change shape, see
> `client/components/__tests__/OfflineBanner.test.tsx`.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run client/components/nutrition/__tests__/NoticeStack.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `NoticeStack.tsx`**

Requirements:

- Props: `labelReadNotice: string | null`, `correctionNotice: string | null`,
  `showPer100gInfo: boolean`, `suppressAnnounce?: boolean`, `reducedMotion?: boolean`.
- Calls `buildNotices()`; returns `null` when the list is empty.
- **No `accessibilityLiveRegion` anywhere.** One `useEffect` keyed on
  `noticeAnnouncementKey(notices)` calls `AccessibilityInfo.announceForAccessibility(key)`
  when the key is non-null, changed, and `suppressAnnounce` is false. Ungated by platform —
  with no live region anywhere there is no double-announce risk, and iOS currently hears
  nothing at all.
- One row treatment for all three: icon + title + body, background
  `withOpacity(theme.warning, 0.1)` for `severity: "warning"` and
  `withOpacity(theme.info, 0.08)` for `"info"` — the two fills that ship today, so the visual
  change is consolidation rather than restyling.
- Style objects `correctionContainer` and `infoContainer` move here from
  `NutritionDetailScreen.tsx:799-806` and `:884-891`.

- [ ] **Step 8: Run it green**

Run: `npx vitest run client/components/nutrition/__tests__/NoticeStack.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 9: Commit**

```bash
git add client/components/nutrition/NoticeStack.tsx \
        client/components/nutrition/NoticeStack-utils.ts \
        client/components/nutrition/__tests__/NoticeStack.test.tsx \
        client/components/nutrition/__tests__/NoticeStack-utils.test.ts
git commit -m "feat(nutrition): NoticeStack with one content-keyed announcer, no live region"
```

---

## Task 6: `LogActionBar`

**Files:**

- Create: `client/components/nutrition/LogActionBar-utils.ts`
- Create: `client/components/nutrition/LogActionBar.tsx`
- Create: `client/components/nutrition/__tests__/LogActionBar-utils.test.ts`
- Create: `client/components/nutrition/__tests__/LogActionBar.test.tsx`

**Interfaces:**

- Consumes: `logGate` from `useNutritionLookup`'s return (shape:
  `{ kind: "needsAcknowledgement" | ...; buttonLabel: string }`).
- Produces: `deriveLogBarState()`,
  `<LogActionBar logGate productName isOffline offlineLabel isPending onAddToLog onLayout />`.

- [ ] **Step 1: Write the failing utils test**

`client/components/nutrition/__tests__/LogActionBar-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { deriveLogBarState } from "../LogActionBar-utils";

describe("deriveLogBarState", () => {
  it("shows the acknowledge button while the gate is unmet", () => {
    const state = deriveLogBarState({
      logGate: {
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      },
      acknowledged: false,
      productName: "Cherry Coke",
    });
    expect(state.mode).toBe("acknowledge");
    expect(state.label).toBe("Review values before logging");
    expect(state.accessibilityLabel).toBe(
      "Review values before logging. These values come from the product database, not the label you photographed.",
    );
  });

  it("shows the log button once acknowledged", () => {
    const state = deriveLogBarState({
      logGate: {
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      },
      acknowledged: true,
      productName: "Cherry Coke",
    });
    expect(state.mode).toBe("log");
    expect(state.label).toBe("Add to Today");
    expect(state.accessibilityLabel).toBe(
      "Add Cherry Coke to today's food log",
    );
  });

  it("shows the log button when the gate does not apply at all", () => {
    const state = deriveLogBarState({
      logGate: { kind: "open", buttonLabel: "Add to Today" },
      acknowledged: false,
      productName: "Cherry Coke",
    });
    expect(state.mode).toBe("log");
  });

  it("falls back to 'item' when there is no product name", () => {
    const state = deriveLogBarState({
      logGate: { kind: "open", buttonLabel: "Add to Today" },
      acknowledged: false,
      productName: undefined,
    });
    expect(state.accessibilityLabel).toBe("Add item to today's food log");
  });
});
```

> Verified against `client/screens/nutrition-detail-utils.ts:52-63`: `deriveLogGate` returns
> exactly `{ kind: "open" }` (when `ocrText === undefined`, or when `labelUsed`) or
> `{ kind: "needsAcknowledgement", buttonLabel: "Review values before logging" }`. The two
> strings above are that function's real output. **Do not change `deriveLogGate`** — the bar
> consumes it, it does not own it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run client/components/nutrition/__tests__/LogActionBar-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LogActionBar-utils.ts`**

Pure function returning `{ mode: "acknowledge" | "log"; label; accessibilityLabel; accessibilityHint }`.
The offline decoration (`offlineLabel(...)`) stays in the component — it depends on a hook.

- [ ] **Step 4: Run it green**

Run: `npx vitest run client/components/nutrition/__tests__/LogActionBar-utils.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing component test**

`client/components/nutrition/__tests__/LogActionBar.test.tsx` must cover:

1. Renders the acknowledge button first; pressing it swaps to the log button.
2. **Pressing acknowledge calls `AccessibilityInfo.announceForAccessibility` exactly once**
   with `"Values confirmed. Add to Today is now available."` — this announce exists because
   both branches render the same `Button` at the same JSX position with no `key`, so React
   swaps props on ONE node and the screen reader keeps focus there; a changed
   `accessibilityLabel` on an already-focused element is not re-spoken. Without it a
   screen-reader user hears nothing, re-activates the same node out of habit, and logs
   un-reviewed database values. **If the implementation changes the keys or the JSX positions,
   this calculus must be re-derived, not assumed.**
3. Calls `onLayout` with a measured height (assert the prop is wired, since the ScrollView's
   bottom padding depends on it).
4. Renders the offline caption when `isOffline` is true, and not otherwise.
5. `onAddToLog` fires on the log button press and NOT on the acknowledge press.

- [ ] **Step 6: Run it to verify it fails, then implement `LogActionBar.tsx`**

Requirements:

- Owns `acknowledgedUnverified` state **and the effect that resets it**, moved verbatim from
  `NutritionDetailScreen.tsx:260-263` **together with its 25-line comment**. The dependency
  list stays `[logGate.kind, nutrition?.productName]` — two _primitives_, deliberately not the
  objects, because `useNutritionLookup` returns fresh objects each render and depending on
  them would reset the acknowledgement every render and leave the log button permanently
  unreachable. `productName` (not `barcode`) is the field that discriminates the
  manual-search transition. Take `logGateKind: string` and `productName: string | undefined`
  as props so the primitives cross the boundary as primitives.
- Absolutely positioned at the bottom, `paddingBottom: insets.bottom + Spacing.md` — **the
  bar owns the inset**.
- `onLayout={(e) => onLayout(e.nativeEvent.layout.height)}` so the ScrollView can pad by the
  measured height.
- Controls stay ≥ 44 pt.
- No motion. The log action must stay immediately actionable.
- Styles `buttonContainer` / `addButton` move here from `NutritionDetailScreen.tsx:875-880`.

- [ ] **Step 7: Run it green and commit**

```bash
git add client/components/nutrition/LogActionBar.tsx \
        client/components/nutrition/LogActionBar-utils.ts \
        client/components/nutrition/__tests__/LogActionBar.test.tsx \
        client/components/nutrition/__tests__/LogActionBar-utils.test.ts
git commit -m "feat(nutrition): sticky LogActionBar owning the log gate and its bottom inset"
```

---

## Task 7: Screen integration A — card and panel in, Additional Nutrients out

The first of two screen rewrites. This one changes what the screen _shows_; Task 8 changes how
it _announces and anchors_. Splitting them keeps each reviewable.

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx`
- Modify: `client/components/nutrition/FlagSections.tsx`
- Modify: `client/screens/__tests__/NutritionDetailScreen.test.tsx`

- [ ] **Step 1: Write the failing wiring test — the one pure tests cannot cover**

Add to `client/screens/__tests__/NutritionDetailScreen.test.tsx`. Pure-function tests never
execute the call site, so the serving-invariance guarantee needs a rendered check:

```tsx
describe("nutrition panel wiring", () => {
  it("renders the saved-item sugar row UNBANDED — no indicator, no tag", () => {
    // itemId set, `nutrition` holding per-serving values, servingSizeGrams
    // null. Asserting on the indicator and value rather than the row label:
    // a label-only assertion passes in every row state.
    const { queryByTestId, queryByText } = renderNutritionDetail({
      itemId: 42,
      nutrition: {
        productName: "Mystery Drink",
        servingSize: "1 bottle",
        sugar: 39,
      },
    });
    expect(queryByText("39 g")).toBeTruthy();
    expect(queryByTestId("band-indicator-sugar")).toBeNull();
    expect(queryByText("HIGH")).toBeNull();
    expect(queryByText("LOW")).toBeNull();
  });

  it("does NOT change a band tag when the serving quantity changes", () => {
    // The whole slice turns on this. See "The one correctness rule" in the plan.
    const { queryByText, setServingQuantity } = renderNutritionDetail({
      barcode: "5449000000996",
    });
    expect(queryByText("MED")).toBeTruthy();
    const before = queryByText(/\d+(\.\d+)? g/)?.textContent;
    setServingQuantity(2);
    expect(queryByText("MED")).toBeTruthy();
    expect(queryByText(/\d+(\.\d+)? g/)?.textContent).not.toBe(before);
  });

  it("no longer renders the Additional Nutrients section", () => {
    const { queryByText } = renderNutritionDetail({ barcode: "5449000000996" });
    expect(queryByText("Additional Nutrients")).toBeNull();
  });

  it("does not render sugar / saturated-fat / sodium as Heads up badges", () => {
    const { queryByText } = renderNutritionDetail({
      barcode: "5449000000996",
      flags: [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "sugar",
          title: "High in sugar",
        },
        {
          id: "nutrient:caffeine",
          kind: "nutrient",
          severity: "info",
          tier: "nutrition",
          nutrient: "caffeine",
          title: "Contains caffeine",
        },
      ],
    });
    expect(queryByText("High in sugar")).toBeNull();
    // Caffeine ships as kind:"nutrient" too. A `kind !== "nutrient"` filter
    // would delete this, and the panel's caffeine row (unbanded, value only)
    // does not replace it.
    expect(queryByText("Contains caffeine")).toBeTruthy();
  });
});
```

> `renderNutritionDetail` and its serving-quantity hook are described here by intent, not by
> signature. **Read the existing suite's helpers first and extend them** — do not invent a
> parallel harness. The suite already mocks `useNutritionLookup`; the quantity change is a
> re-render with different mocked `nutrition` values plus the same `validatedData`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: FAIL on all four — the panel does not exist yet and the badges still render.

- [ ] **Step 3: Narrow and re-prop `FlagSections`**

Change its props from `flags: ScanFlag[]` to `personal: ScanFlag[]`, `universal: ScanFlag[]`.
Drop the `partitionScanFlags` import (reversing 2b's deliberate layering inversion) and drop
`NutriScoreChip` and its import. Add the scalar filter:

```ts
/**
 * The three scalar nutrients NutritionPanel now bands. Filtering on the
 * `nutrient` FIELD, not on `kind`: the caffeine flag also ships as
 * `kind: "nutrient"` (server/services/universal-flags.ts:151-169), and the
 * panel's caffeine row is unbanded — value only — so it does not carry the
 * "High in caffeine" warning. A kind-based filter would delete it silently.
 *
 * "nutrient" stays in UNIVERSAL_KINDS in nutrition-detail-flags-utils.ts:
 * partitionScanFlags warn-and-drops unmodelled kinds, so removing it there
 * would swallow these flags rather than relocate them.
 */
const PANEL_OWNED_NUTRIENTS = new Set<NutrientKind>([
  "sugar",
  "saturated_fat",
  "sodium",
]);

const universalToShow = universal
  .filter((f) => !(f.nutrient && PANEL_OWNED_NUTRIENTS.has(f.nutrient)))
  .slice(0, 6);
```

Renumber the two delays per D4: `450 → 400` ("For you"), `475 → 450` ("Heads up"). Update the
component docblock — the "SLICE 2c will narrow this" paragraph is now history and should
describe what the component _does_, keeping the `UNIVERSAL_KINDS` warning.

- [ ] **Step 4: Rewrite the screen's display region**

In `client/screens/NutritionDetailScreen.tsx`:

1. Call `partitionScanFlags(flags)` once at the top of the component. Pass
   `partition.personal` / `partition.universal` to `FlagSections` and
   `partition.nutriScore?.grade` to `NutritionSummaryCard`.
2. Call `buildPanelRows({ itemId, validatedData, nutrition, isBeverage })` once. Pass
   `pickStandouts(bands)` to the summary card and `rows` to the panel.
3. **Delete** the `Animated.View` calorie card (`:468-559`) and replace it with
   `<NutritionSummaryCard …/>`.
4. **Delete** the entire Additional Nutrients block (`:581-690`) and replace it with
   `<NutritionPanel rows={rows} reducedMotion={reducedMotion} />` in the same position.
5. **Delete** the now-orphaned styles: `calorieCard`, `heroContext`, `calorieRow`,
   `calorieValue`, `macroTiles`, `macroTile`, `macroTileLabel`, `macroTileValue`,
   `macroTileUnit`, `additionalNutrients`, `sectionTitle`, `nutrientsList`, `nutrientRow`,
   `nutrientLabel`. This also removes the screen's half of the triplicated
   `sectionTitle`/`additionalNutrients` pair.
6. **Delete** the now-unused imports: `Shadows`, `roundToOneDecimal`, and `Card` **only if**
   the `showManualSearch` block no longer needs it (it does — keep `Card`).
7. Renumber `MicronutrientSection`'s delay `600 → 500` (D4).
8. **Update `NutritionDetailSkeleton`** (`:65-172`). It still previews the deleted layout —
   an "Additional nutrients title" plus three nutrient rows. Replace those with a summary-card
   block and six panel rows so the loading state previews the layout that actually arrives.
   While there, add the Android half to `:73`: the skeleton `View` has a subtree, so it needs
   `importantForAccessibility="no-hide-descendants"` beside its existing
   `accessibilityElementsHidden` — `accessibilityElementsHidden` is iOS-only and Android
   ignores it entirely, so TalkBack currently walks the whole skeleton.

- [ ] **Step 5: Run the screen suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS. Existing assertions that referenced "Additional Nutrients" rows must be
**rewritten to the panel's structure, not deleted** — if an assertion no longer has a
counterpart, say so explicitly in the task report rather than dropping it silently.

- [ ] **Step 6: Run the full client suite for collateral**

Run: `npx vitest run client/`
Expected: PASS. `FlagSections`' prop change and the `NutriScoreChip` removal are the likely
collateral sites.

- [ ] **Step 7: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx \
        client/components/nutrition/FlagSections.tsx \
        client/screens/__tests__/NutritionDetailScreen.test.tsx
git commit -m "feat(nutrition): summary card + traffic-light panel replace the calorie card and Additional Nutrients"
```

---

## Task 8: Screen integration B — notices, errors, and the sticky bar

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx`
- Modify: `client/screens/__tests__/NutritionDetailScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to the screen suite:

1. **The announcer collision guard, by call count.** With the log gate unmet AND a notice
   present, pressing acknowledge fires `announceForAccessibility` **exactly once**, with the
   acknowledge string. A test asserting only that the string was announced passes when both
   fire — which is the exact collision being guarded.
2. The four notices render inside one `NoticeStack`, and none of them renders on the
   saved-item path (`itemId` set).
3. `error` renders through `InlineError` (assert `aria-live="assertive"` is present exactly
   once and that the `NoticeStack` container carries no `aria-live` at all).
4. The ScrollView's `paddingBottom` reflects the bar's measured height rather than
   `insets.bottom` — assert the ScrollView does **not** apply `insets.bottom` itself, so the
   inset is counted once.
5. The sticky bar renders inside the `accessibilityViewIsModal` root and is absent on the
   saved-item path.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`

- [ ] **Step 3: Wire the notices and the error**

1. Replace the inline `labelReadNotice` block (`:326-347`), the `correctionNotice` block
   (`:349-370`) and the per-100g banner (`:567-579`) with a single
   `<NoticeStack labelReadNotice={labelReadNotice} correctionNotice={correctionNotice} showPer100gInfo={isPer100g} suppressAnnounce={…} reducedMotion={reducedMotion} />`,
   rendered in ONE position, still gated on `!itemId`.
2. Replace the inline `error` block (`:388-402`) with `<InlineError message={error} />`.
   Delete the now-orphaned `warningContainer` and `infoContainer` styles.
3. Wire `suppressAnnounce` so the `NoticeStack` announcer and the acknowledge announce are
   **mutually exclusive**. The acknowledge announce always wins — it is the one that stops a
   screen-reader user logging unreviewed values.

- [ ] **Step 4: Wire the sticky bar and the inset handoff**

1. Delete the `!itemId` button block (`:724-775`) and render `<LogActionBar …/>` as an
   absolutely-positioned sibling **after** the ScrollView, **inside** the
   `accessibilityViewIsModal` `ThemedView`.
2. Hold the measured bar height in state: `const [barHeight, setBarHeight] = useState(0)`.
3. Change the ScrollView's `paddingBottom` from `insets.bottom + Spacing["3xl"]` to
   `barHeight + Spacing["3xl"]` on **both** branches. **Remove `insets.bottom` from the
   ScrollView** — the bar owns it now, and leaving both double-counts.
4. The loading branch has no bar, so its `paddingBottom` stays `insets.bottom + Spacing["3xl"]`.
   Leave it, and add a one-line comment saying why the two branches differ.
5. Verify `useSafeAreaInsets` is still used by the screen; if the loading branch is its only
   remaining consumer, keep the import.

- [ ] **Step 5: Run the screen suite and the full client suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Then: `npx vitest run client/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx \
        client/screens/__tests__/NutritionDetailScreen.test.tsx
git commit -m "feat(nutrition): NoticeStack, InlineError and sticky LogActionBar with a single bottom inset"
```

---

## Verification CI cannot represent

**A device pass on BOTH themes is a merge precondition.** This is why the todo carries
`priority: high` and never auto-merges. Run it on iOS (VoiceOver) and Android (TalkBack) —
`docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md`
carries the technique, including that **`uiautomator dump --compressed` is the only dump that
answers "does a screen reader reach this"**; the default dump lists nodes regardless of
accessibility importance and cannot tell a fixed subtree exclusion from a broken one.

Checklist, from the spec:

- [ ] Each panel row announces **once**, with the unit spoken as a word and the band included.
- [ ] The photo tiles still announce once each (unchanged from #742).
- [ ] The sticky bar does not occlude the last row at **all three** `LogActionBar` heights —
      normal, gated, and with the offline caption. Not just the default.
- [ ] The bar's position in the VoiceOver focus order matches what the spec's Accessibility
      section states. It is an absolutely-positioned sibling after the ScrollView, so it
      becomes the **last** stop on a screen this slice deliberately lengthens — confirm that
      is what actually happens.
- [ ] Nutri-Score is announced **once**, not twice (D3 removed the chip; confirm nothing else
      renders a grade).
- [ ] The three display states are visually distinct on device: a zero row, an unbanded row,
      and a "Not recorded" row.
- [ ] Reduce Motion on: values still update, nothing is stuck at a stale figure.

**Known harness limit, stated rather than papered over:** jsdom cannot observe `accessible`
subtree collapse in either direction, so no test can prove the panel rows announce as single
groups
(`docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`).
That check is device-only. The composed row _label_ is assertable in jsdom and is covered in
Task 3 — the harness limit concerns collapse, not label props, and must not be used to defer
the label assertions.

Fixture for the device pass: barcode `5449000000996` (Coca-Cola) exercises the summary card,
the panel, `FlagSections` and `VerificationPanel` in one screen. Reach it via
`ocrecipes://nutrition/5449000000996` — the simulator has no camera.

---

## Self-review notes

Run against the spec after writing, recorded here so a reviewer can check the same ground.

**Spec coverage.** Every 2c row of the spec's file map has a task: `NutritionSummaryCard` (4),
`NutritionPanel` (3), `LogActionBar` (6), `NoticeStack` (5), `badge-severity-visuals.ts` (1),
`NutritionDetailScreen.tsx` (7, 8). The `FlagSections` narrowing is Task 7; the animation
ordering fix is D4, applied across Tasks 4, 7. "Deletes Additional Nutrients" is Task 7 Step 4.

**Two spec items are deliberately NOT tasks**, both because they are already satisfied:
`shared/lib/nutrition-bands.ts` and `shared/constants/nutrition-bands.ts` shipped in 2a, and
`useNutritionLookup` already exposes `isBeverage` and `validatedData` (Global Constraint 20).

**One spec statement this plan contradicts, deliberately and with reasoning:** the spec's
Testing section proposes a wiring test that renders the saved-item path and asserts the sugar
row is unbanded. That test is here (Task 7, Step 1) — but the plan adds the
**serving-quantity invariance** test beside it, because the saved-item test alone does not
cover the scan path, which is where the defect described in "The one correctness rule"
actually bites.

**Type consistency.** `NUTRIENT_ROWS` keys use the band layer's spelling (`fibre`) and carry
`sourceKey` for the data layer's (`fiber`). `BandDescriptor` is the single band-carrying shape
across `NutritionPanel-utils`, `nutrition-band-source` and `NutritionPanel`. `Standout` comes
from `@shared/lib/nutrition-bands` unchanged and is not restated.

**Placeholder scan: clean.** The two items this plan originally deferred to implementation
were both resolved before it was handed over — `deriveLogGate`'s kinds and button label are
pinned from `client/screens/nutrition-detail-utils.ts:52-63`, and `renderComponent`'s
`rerender` is confirmed at `test/utils/render-component.tsx:29-34`. The only remaining
"follow the harness" note is Task 3's, on how `test/mocks/react-native.ts` spells `testID`
and `accessibilityLabel` in the jsdom tree — that is a lookup against an existing suite, not
an unmade decision.

**The residual risk worth naming.** Task 7 rewrites the largest region of a screen whose
existing suite is 34 KB, and 2b's experience was that **three of that slice's four review
defects were in the PLAN, not the implementation**. The mitigation here is that Task 7's
tests are written against the spec's stated outcomes rather than against this plan's prose,
and that Step 5 requires any existing assertion without a counterpart to be reported
explicitly rather than dropped.
