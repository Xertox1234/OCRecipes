# Nutrition Detail Redesign — Slice 2b (Extraction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve four presentational regions out of the 1236-line `NutritionDetailScreen.tsx` into `client/components/nutrition/`, and replace the hand-rolled header inset with `useHeaderContentInset` — with **zero visual delta and zero behavioural delta**.

**Architecture:** Pure extraction. Every moved region keeps its JSX, its animation timings, its accessibility labels, and its guarding comments byte-for-byte. Each new component owns its own `StyleSheet.create` holding the exact style objects it moved. The screen keeps everything else, including the "Additional Nutrients" card that Slice 2c will delete. No new behaviour, no new props beyond what the moved JSX already read, no renaming.

**Tech Stack:** React Native / Expo, TypeScript strict, Vitest + jsdom via `renderComponent` (`test/utils/render-component`), `react-native-reanimated` (mocked in tests).

**Predecessor:** Slice 2a merged as PR #747 (squash `3ef9b00d`). This plan starts from `main` at or after `4eaa2d2d`.

---

## Global Constraints

Every task's requirements implicitly include this section. These are copied from
`docs/superpowers/specs/2026-07-31-nutrition-detail-redesign-design.md` ("Slices",
"Invariants that must survive the move") and from facts verified in source while writing
this plan.

1. **Zero visual delta is the gate.** If a change alters a single rendered pixel, it does
   not belong in 2b. When in doubt, transcribe rather than improve.
2. **Animation delays move VERBATIM. Do not renumber, reorder, or normalise them.** The
   current ordering is bottom-up and _is_ a bug — flags enter at `delay(450)`/`delay(475)`
   while the calorie card enters at `delay(200)`. **Fixing it is Slice 2c's job.** An
   implementer who "corrects" the sequence while extracting has broken this slice's only
   claim.
3. **`FlagSections` is a verbatim move, scalar nutrient flags included.** The narrowing to
   non-scalar flags is 2c's, once the panel that replaces them exists. Narrowing here would
   delete the sugar / saturated-fat / sodium badges with nothing rendering in their place.
4. **Comments move with the code they guard.** Every block comment inside a moved region is
   load-bearing reasoning (the Nutri-Score-outside-the-group rationale, the
   `accessible`-wrapper rationale, the `resizeMode="contain"` rationale, the `capturedPhoto`
   `maxWidth: "50%"` rationale). A moved region that arrives without its comment has lost the
   reason it is shaped that way.
5. **`accessibilityViewIsModal` stays on BOTH branches** — the loading branch
   (`NutritionDetailScreen.tsx:292`) and the main branch (`:310`). The screen is
   `presentation: "modal"`, and VoiceOver navigates behind it without this. The loading
   branch is exactly what an extraction drops silently.
6. **The inset swap is `useHeaderContentInset(Spacing.xl)` and nothing more.** Do **not**
   adopt `ScreenScrollView` — that is a larger behavioural change and is not what the spec's
   fix specifies. Do **not** fix this with `contentInsetAdjustmentBehavior`: it is an
   iOS-only prop that no-ops on Android and would leave the bug live there.
7. **Do not move `client/screens/nutrition-detail-utils.ts` or
   `client/screens/nutrition-detail-flags-utils.ts`.** They are not in the spec's 2b file
   map, they have co-located passing test suites, and moving them changes import paths for
   zero gain.
8. **Each new component calls `useTheme()` itself and takes `reducedMotion` as a prop.**
   This is the established repo convention — `MicronutrientSection` takes
   `reducedMotion?: boolean` while calling `useTheme()` internally; `ScanFlagBadge` and
   `VerificationBadge` both call `useTheme()` internally. Do not thread `theme` through props.
9. **Each new component owns its own `StyleSheet.create` containing verbatim copies of the
   style objects it moved.** Do **not** create a shared style module. `sectionTitle` and
   `additionalNutrients` are deliberately duplicated into `FlagSections` and
   `CapturedPhotos`; the screen keeps its own copies because the Additional Nutrients card
   (`:803-912`) still uses both. 2c collapses the duplication when it deletes that card.
10. **Delete style keys from the screen once they are moved and unused.** `StyleSheet.create`
    keys are not use-checked by ESLint or tsc, so an orphaned key is silent dead code. The
    exact deletion list is given per task.
11. **No new component-level test files in 2b.** The gate is the screen-level suite. A unit
    test of an extracted component proves the component works in isolation; the risk in an
    extraction is the **wiring**, and only a screen-level render exercises that. This is the
    same lesson as
    `docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md`.
12. **`client/camera/` is off-limits** for the whole of Phase 2.
13. **The todo/PR for this slice carries `priority: high`** so `scripts/todo-automerge-guard.sh`
    never arms auto-merge. Every path here is on the guard's safe-path allowlist, so the
    guard alone would not stop it.
14. Commit messages use conventional-commit form, scope `nutrition`.

## Verified facts this plan depends on

Checked in source while writing this plan — do not re-derive, and do not accept a
contradicting claim without re-verifying:

- **`useHeaderContentInset(extra)` is literally `useHeaderHeight() + extra`.**
  `client/hooks/useHeaderContentInset.ts:15-18` is a three-line wrapper. The swap is
  arithmetically identical **by construction**, not by coincidence — which is what clears
  the zero-visual-delta bar. Its own unit test exists at
  `client/hooks/__tests__/useHeaderContentInset.test.ts`.
- **`@react-navigation/elements` is aliased to a test mock** (`vitest.config.ts:137` →
  `test/mocks/react-navigation-elements.ts`) whose `useHeaderHeight` returns a constant `88`.
  `react-native-safe-area-context` is likewise aliased; `useSafeAreaInsets()` returns all
  zeroes.
- **`partition` and `universalToShow` are read ONLY inside the flags region** (lines
  379-444). Nothing else in the screen touches them, so `FlagSections` can own
  `partitionScanFlags`, the `.slice(0, 6)`, and `headsUpSummaryLabel` outright.
- **`sectionTitle` is used 4×** (`:386`, `:410`, `:708`, `:816`) and **`additionalNutrients`
  3×** (`:384`, `:408`, `:814`). The `:816`/`:814` pair belongs to the Additional Nutrients
  card, which stays in 2b.
- **`NutritionDetailScreen.test.tsx` has no coverage of any of it.** Its four `describe`
  blocks cover the Additional Nutrients card, the flag sections, the log gate, and the
  captured photos. **Nothing renders the loading branch** (`isLoading` is hard-coded `false`
  in `baseHookReturn`), nothing asserts `accessibilityViewIsModal`, nothing asserts the
  product name / brand / serving-size block, and nothing asserts the verification badge
  renders. "Existing tests stay green" is therefore **not** a sufficient gate on its own —
  Task 1 exists to make it one.
- **No test anywhere in `client/` asserts `accessibilityViewIsModal`**, so its observability
  in this harness is unproven. Task 1 settles that with a two-sided assertion.

## File Structure

**New — all under `client/components/nutrition/` (directory does not exist yet)**

| File                    | Responsibility                                                                              | Moved from                          |
| ----------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `ProductHero.tsx`       | Product image card, product name, brand, serving-size line.                                 | `NutritionDetailScreen.tsx:322-367` |
| `FlagSections.tsx`      | "For you" and "Heads up" sections. Owns the partition, the 6-flag cap, and the group label. | `:379-444`                          |
| `CapturedPhotos.tsx`    | The nutrition-label and product-front photo tiles.                                          | `:681-787`                          |
| `VerificationPanel.tsx` | Verification badge + the retroactive front-label CTA.                                       | `:932-976`                          |

**Modified**

| File                                                      | Change                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `client/screens/NutritionDetailScreen.tsx`                | Four regions replaced by component calls; 11 style keys deleted; `useHeaderHeight` → `useHeaderContentInset`; unused imports removed. |
| `client/screens/__tests__/NutritionDetailScreen.test.tsx` | Gains the Task 1 characterisation suites.                                                                                             |

**Unchanged, and deliberately so:** `client/screens/nutrition-detail-utils.ts`,
`client/screens/nutrition-detail-flags-utils.ts`, every component under
`client/components/` that these regions render (`FallbackImage`, `ScanFlagBadge`,
`NutriScoreChip`, `VerificationBadge`, `ThemedText`).

## A note on TDD in a pure refactor

The project requires strict TDD, but 2b introduces no new behaviour, so there is nothing to
drive with a red test. The equivalent discipline for a refactor is **characterisation
testing**, which inverts the usual order:

- Task 1's tests are written against **current** behaviour and must **PASS on unmodified
  code**. A failing characterisation test means the _test_ is wrong, not the code.
- The "verify it fails first" step is replaced by a **non-vacuity check**: temporarily break
  the source, confirm the new test fails, then revert the break. A characterisation test that
  cannot fail is worse than no test, because it reports safety it never checked.
- Tasks 2-6 are red-free by design. Their gate is that the Task 1 suite plus the four
  pre-existing suites stay green.

This is the same shape Slice 2a used for its Task 2 constant move, where seven
characterisation tests were committed before the constants were touched.

---

### Task 1: Characterisation tests for the untested regions

**Files:**

- Modify: `client/screens/__tests__/NutritionDetailScreen.test.tsx` (append new `describe` blocks; change nothing that exists)

**Interfaces:**

- Consumes: the module-scoped `baseHookReturn(nutrition, flags)` helper and the
  `mockRoute` / `mockUseNutritionLookup` hoisted mocks already in the file.
- Produces: a green suite that fails loudly if Tasks 2-6 drop the loading branch,
  `accessibilityViewIsModal`, the product-hero text, or the verification panel.

**Context:** `baseHookReturn` hard-codes `isLoading: false`, so no existing test has ever
rendered the loading branch. `mockRoute.params` defaults to `{ itemId: 42 }`, and the
verification section is gated on `!itemId && barcode && nutrition`, so it has never rendered
either. An `afterEach` in the file already restores `mockRoute.params` to the `itemId`
default — new suites that reassign it need no manual cleanup.

- [ ] **Step 1: Write the loading-branch characterisation test**

Append to `client/screens/__tests__/NutritionDetailScreen.test.tsx`:

```tsx
/**
 * Characterisation suites (Slice 2b). These pin behaviour that already exists
 * but had NO coverage, so the extraction in Tasks 2-6 has something to fail
 * against. They must PASS on unmodified code — a red test here means the test
 * is wrong, not the screen.
 */
describe("NutritionDetailScreen — loading branch (2b characterisation)", () => {
  function renderLoading() {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke" }),
      isLoading: true,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  it("renders the skeleton and announces Loading", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { queryByText } = renderLoading();

      expect(announceSpy).toHaveBeenCalledWith("Loading");
      // Negative control: the loading branch returns EARLY, so no main-branch
      // content may be in the tree. Without this, a component that rendered
      // both branches would still pass the announcement assertion.
      expect(queryByText("Cherry Coke")).toBeNull();
    } finally {
      announceSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Write the modal-flag test with a two-sided assertion**

`accessibilityViewIsModal` reaches the DOM through `mockComponent`'s `...rest` spread
(`test/mocks/react-native.ts:52-97`), so whether jsdom can observe it is **unproven** — no
test in `client/` asserts it today. This test is written so that an unobservable attribute
fails **loudly at authoring time** rather than passing vacuously.

```tsx
describe("NutritionDetailScreen — modal focus containment (2b characterisation)", () => {
  /**
   * The screen is `presentation: "modal"` (RootStackNavigator.tsx:246) and
   * VoiceOver navigates BEHIND it without accessibilityViewIsModal. Both
   * branches carry it; the loading branch is the one an extraction drops
   * silently.
   */
  function modalNodes(container: HTMLElement) {
    return container.querySelectorAll("[accessibilityviewismodal]");
  }

  it("sets accessibilityViewIsModal on the main branch", () => {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ productName: "Cherry Coke" }),
    );

    const { container } = renderComponent(<NutritionDetailScreen />);

    expect(modalNodes(container).length).toBe(1);
  });

  it("sets accessibilityViewIsModal on the loading branch too", () => {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke" }),
      isLoading: true,
    });

    const { container } = renderComponent(<NutritionDetailScreen />);

    expect(modalNodes(container).length).toBe(1);
  });
});
```

**If both assertions report `0`,** the harness drops the attribute and the test can never
fail — that is a finding, not a passing test. In that case: delete this `describe`, and in
its place leave a comment in the test file recording that `accessibilityViewIsModal` is
**not observable in jsdom** (citing
`docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`),
so the prop's survival is a **diff-review obligation** rather than a test. Report this in
your task report either way — do not silently adjust the assertion until it passes.

- [ ] **Step 3: Write the product-hero characterisation test**

```tsx
describe("NutritionDetailScreen — product hero (2b characterisation)", () => {
  function renderHero(nutrition: Record<string, unknown>) {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue(baseHookReturn(nutrition));
    return renderComponent(<NutritionDetailScreen />);
  }

  it("renders product name, brand and serving size", () => {
    const { queryByText } = renderHero({
      productName: "Cherry Coke",
      brandName: "Coca-Cola",
      servingSize: "1 can (355 ml)",
    });

    expect(queryByText("Cherry Coke")).toBeTruthy();
    expect(queryByText("Coca-Cola")).toBeTruthy();
    expect(queryByText("Serving size: 1 can (355 ml)")).toBeTruthy();
  });

  it("falls back to Unknown Product and omits an absent brand", () => {
    const { queryByText } = renderHero({ productName: "" });

    expect(queryByText("Unknown Product")).toBeTruthy();
    expect(queryByText("Coca-Cola")).toBeNull();
  });

  it("labels the image by product name, and says so when there is no image", () => {
    const { queryByLabelText } = renderHero({
      productName: "Cherry Coke",
      imageUrl: "https://example.test/coke.png",
    });

    expect(queryByLabelText("Image of Cherry Coke")).toBeTruthy();
  });

  it("announces a missing product image rather than staying silent", () => {
    const { queryByLabelText } = renderHero({ productName: "Cherry Coke" });

    expect(queryByLabelText("No product image available")).toBeTruthy();
  });
});
```

- [ ] **Step 4: Write the verification-panel characterisation test**

The panel renders only under `!itemId && barcode && nutrition`, and the CTA additionally
requires `verificationLevel !== "unverified" && !hasFrontLabelData`.

```tsx
describe("NutritionDetailScreen — verification panel (2b characterisation)", () => {
  function renderVerification(overrides: Record<string, unknown>) {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke" }),
      ...overrides,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  it("offers the front-label CTA for a verified product with no front-label data", () => {
    const { queryByText } = renderVerification({
      verificationLevel: "verified",
      hasFrontLabelData: false,
    });

    expect(queryByText("Add product details")).toBeTruthy();
    expect(queryByText("Scan front of package")).toBeTruthy();
  });

  it("withholds the CTA once front-label data exists", () => {
    const { queryByText } = renderVerification({
      verificationLevel: "verified",
      hasFrontLabelData: true,
    });

    expect(queryByText("Add product details")).toBeNull();
  });

  it("withholds the CTA for an unverified product", () => {
    const { queryByText } = renderVerification({
      verificationLevel: "unverified",
      hasFrontLabelData: false,
    });

    expect(queryByText("Add product details")).toBeNull();
  });
});
```

- [ ] **Step 5: Run the new suites — expect PASS on unmodified code**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: every test passes, including the four pre-existing `describe` blocks.

A failure here means the characterisation test is wrong. Fix the test, not the screen — 2b
changes no behaviour, so any behaviour these tests describe is by definition correct.

- [ ] **Step 6: Prove each new suite is non-vacuous**

This replaces the usual "verify it fails" step. For **each** of the four new suites, make a
temporary edit to `NutritionDetailScreen.tsx`, confirm the suite goes red, then **revert the
edit**:

| Suite              | Temporary break                                              | Expected failure                  |
| ------------------ | ------------------------------------------------------------ | --------------------------------- |
| loading branch     | change `if (isLoading)` to `if (false)`                      | the announce assertion fails      |
| modal flag         | delete `accessibilityViewIsModal` from `:310`                | main-branch count is `0`, not `1` |
| product hero       | change `"Unknown Product"` to `"X"` at `:349`                | the fallback assertion fails      |
| verification panel | change `!hasFrontLabelData` to `hasFrontLabelData` at `:938` | both CTA assertions flip          |

Record the outcome of each in your task report. If a suite cannot be made to fail, say so —
it is not a gate and must not be counted as one.

- [ ] **Step 7: Confirm the tree is clean of the temporary breaks**

Run: `git diff --stat client/screens/NutritionDetailScreen.tsx`
Expected: **no output.** `NutritionDetailScreen.tsx` must be untouched by this task. If it
shows changes, a Step 6 revert was missed.

- [ ] **Step 8: Commit**

```bash
git add client/screens/__tests__/NutritionDetailScreen.test.tsx
git commit -m "test(nutrition): characterise the regions slice 2b extracts

The screen suite had no coverage of the loading branch, accessibilityViewIsModal,
the product hero, or the verification panel — precisely the regions 2b moves.
Committed before the move so a behaviour change fails loudly rather than passing
a suite that never looked."
```

---

### Task 2: Extract `ProductHero`

**Files:**

- Create: `client/components/nutrition/ProductHero.tsx`
- Modify: `client/screens/NutritionDetailScreen.tsx` (replace `:322-367`; delete 5 style keys; prune imports)

**Interfaces:**

- Consumes: `NutritionData` from `@/hooks/useNutritionLookup`.
- Produces:

  ```ts
  interface ProductHeroProps {
    nutrition: NutritionData | null | undefined;
    showServingControls: boolean;
    reducedMotion?: boolean;
  }
  export function ProductHero(props: ProductHeroProps): React.JSX.Element;
  ```

  **Take the whole `nutrition` object, not four separate fields.** The moved JSX contains
  four subtly different null-handling expressions (`?? undefined`, `|| "Unknown Product"`,
  `? … : null`, `&& !showServingControls`). Passing the object lets them move verbatim;
  passing extracted fields would require re-deriving each one's `null`/`undefined` handling,
  which is exactly where a behavioural delta creeps in.

- [ ] **Step 1: Create the component**

```tsx
import React from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { NutritionData } from "@/hooks/useNutritionLookup";

interface ProductHeroProps {
  nutrition: NutritionData | null | undefined;
  /**
   * Suppresses the serving-size line when `ServingControls` is rendering the
   * same information below. Passed in rather than re-derived: the screen owns
   * the condition — see `showServingControls` in
   * `client/screens/NutritionDetailScreen.tsx` (currently `:265`) rather than
   * restating it here, where it can drift out of sync with the real logic.
   */
  showServingControls: boolean;
  reducedMotion?: boolean;
}

export function ProductHero({
  nutrition,
  showServingControls,
  reducedMotion,
}: ProductHeroProps) {
  const { theme } = useTheme();

  return (
    <>
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(400)}
        style={[
          styles.imageCard,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <FallbackImage
          source={{ uri: nutrition?.imageUrl ?? undefined }}
          style={styles.productImage}
          fallbackIcon="image"
          fallbackIconSize={30}
          resizeMode="contain"
          accessibilityLabel={
            nutrition?.imageUrl
              ? `Image of ${nutrition.productName || "product"}`
              : "No product image available"
          }
        />
      </Animated.View>

      <Animated.View
        entering={reducedMotion ? undefined : FadeInUp.delay(100).duration(400)}
      >
        <ThemedText type="h2" style={styles.productName}>
          {nutrition?.productName || "Unknown Product"}
        </ThemedText>
        {nutrition?.brandName ? (
          <ThemedText
            type="small"
            style={[styles.brandName, { color: theme.textSecondary }]}
          >
            {nutrition.brandName}
          </ThemedText>
        ) : null}
        {nutrition?.servingSize && !showServingControls ? (
          <ThemedText
            type="small"
            style={[styles.servingSize, { color: theme.textSecondary }]}
          >
            Serving size: {nutrition.servingSize}
          </ThemedText>
        ) : null}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  imageCard: {
    height: 150,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: Spacing.lg,
  },
  productImage: {
    width: "100%",
    height: 150,
  },
  productName: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  brandName: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  servingSize: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
});
```

**The fragment wrapper is required.** The two `Animated.View`s are siblings directly under
the `ScrollView`; wrapping them in a new `View` would introduce a layout box that does not
exist today and break the zero-visual-delta bar.

- [ ] **Step 2: Replace the region in the screen**

Delete lines `322-367` (the two `Animated.View` blocks) and put in their place:

```tsx
<ProductHero
  nutrition={nutrition}
  showServingControls={showServingControls}
  reducedMotion={reducedMotion}
/>
```

Add the import alongside the other component imports:

```tsx
import { ProductHero } from "@/components/nutrition/ProductHero";
```

- [ ] **Step 3: Delete the moved style keys from the screen**

Remove these five keys from `NutritionDetailScreen.tsx`'s `StyleSheet.create`:
`imageCard`, `productImage`, `productName`, `brandName`, `servingSize`.

Verify none is still referenced:

```bash
grep -n "styles\.\(imageCard\|productImage\|productName\|brandName\|servingSize\)" client/screens/NutritionDetailScreen.tsx
```

Expected: **no output.**

- [ ] **Step 4: Prune now-unused imports from the screen**

`FallbackImage` is still used by the captured-photo tiles at this point in the plan, so it
**stays**. `FadeIn` may now be unused — check before removing:

```bash
grep -n "FadeIn\b\|FallbackImage\|BorderRadius" client/screens/NutritionDetailScreen.tsx
```

Remove an import only if it has zero remaining references. Do not remove `FadeInUp` (still
used by later regions) and do not remove `BorderRadius` without checking — other style keys
use it.

- [ ] **Step 5: Run the screen suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS, including the Task 1 product-hero suite. That suite renders the real screen,
so it now exercises `ProductHero` through its real call site — which is the wiring check a
component-level unit test could not give.

- [ ] **Step 6: Commit**

```bash
git add client/components/nutrition/ProductHero.tsx client/screens/NutritionDetailScreen.tsx
git commit -m "refactor(nutrition): extract ProductHero from NutritionDetailScreen"
```

---

### Task 3: Extract `FlagSections`

**Files:**

- Create: `client/components/nutrition/FlagSections.tsx`
- Modify: `client/screens/NutritionDetailScreen.tsx` (replace `:379-444`; delete locals at `:274` and `:280`; prune imports)

**Interfaces:**

- Consumes: `ScanFlag` (the element type of the `flags` array returned by
  `useNutritionLookup`); `partitionScanFlags` and `headsUpSummaryLabel` from
  `@/screens/nutrition-detail-flags-utils`.
- Produces:
  ```ts
  interface FlagSectionsProps {
    flags: ScanFlag[];
    reducedMotion?: boolean;
  }
  export function FlagSections(
    props: FlagSectionsProps,
  ): React.JSX.Element | null;
  ```

**Why this component takes raw `flags` and not the partition.** `partition` (`:274`) and
`universalToShow` (`:280`) are read **nowhere else in the screen** — verified by grep, every
reference sits between lines 379 and 434. Moving the partition, the `.slice(0, 6)` and
`headsUpSummaryLabel` into this one file puts the "one array feeds both the announced group
label and the rendered badges" invariant in a single place where both consumers are visible.
Leaving the slice in the screen would keep the two call sites in different files, which is
the desync the invariant warns about.

**Scalar nutrient flags stay.** This is a verbatim move (Global Constraint 3).

- [ ] **Step 1: Create the component**

```tsx
import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import { NutriScoreChip } from "@/components/NutriScoreChip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  partitionScanFlags,
  headsUpSummaryLabel,
} from "@/screens/nutrition-detail-flags-utils";
import type { ScanFlag } from "@shared/types/scan-flags";

interface FlagSectionsProps {
  flags: ScanFlag[];
  reducedMotion?: boolean;
}

/**
 * "For you" (personal/allergen) and "Heads up" (universal + Nutri-Score).
 *
 * Owns the partition and the six-flag cap deliberately: ONE array must feed
 * both the announced group label and the rendered badges, and keeping the
 * slice in the same file as both consumers is what stops them desyncing.
 *
 * SLICE 2c will narrow this to non-scalar flags only, once NutritionPanel
 * exists to render the sugar / saturated-fat / sodium rows. Narrowing it
 * before then deletes those badges with nothing in their place. When that
 * change lands, "nutrient" must STAY in UNIVERSAL_KINDS — partitionScanFlags
 * warn-and-drops unmodelled kinds, so removing it there swallows the flags
 * rather than relocating them.
 */
export function FlagSections({ flags, reducedMotion }: FlagSectionsProps) {
  const { theme } = useTheme();

  const partition = partitionScanFlags(flags);
  const universalToShow = partition.universal.slice(0, 6);

  return (
    <>
      {partition.personal.length > 0 ? (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(450).duration(400)
          }
          style={styles.additionalNutrients}
        >
          <ThemedText type="h4" style={styles.sectionTitle}>
            For you
          </ThemedText>
          <View style={{ gap: Spacing.sm }}>
            {partition.personal.map((f) => (
              <ScanFlagBadge key={f.id} flag={f} />
            ))}
          </View>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Informational only — not medical advice.
          </ThemedText>
        </Animated.View>
      ) : null}

      {partition.universal.length > 0 || partition.nutriScore ? (
        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(475).duration(400)
          }
          style={styles.additionalNutrients}
        >
          <ThemedText type="h4" style={styles.sectionTitle}>
            Heads up
          </ThemedText>
          <View style={{ gap: Spacing.sm }}>
            {/* The Nutri-Score chip renders OUTSIDE this wrapper — an
                accessible={true} group collapses its subtree into a
                single VoiceOver/TalkBack node using only this label, so
                anything nested inside that isn't reflected in
                headsUpSummaryLabel's text (the grade letter isn't) would
                be silently dropped from the announcement. The badges'
                titles ARE all in the composed label, so only they are
                grouped here. */}
            {partition.universal.length > 0 ? (
              <View
                accessible={true}
                accessibilityLabel={headsUpSummaryLabel(universalToShow)}
                style={{ gap: Spacing.sm }}
              >
                {universalToShow.map((f) => (
                  <ScanFlagBadge key={f.id} flag={f} />
                ))}
              </View>
            ) : null}
            {partition.nutriScore?.grade ? (
              <NutriScoreChip grade={partition.nutriScore.grade} />
            ) : null}
          </View>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Informational only — not medical advice.
          </ThemedText>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // Verbatim copies. The screen keeps its own — the Additional Nutrients card
  // still uses both, until 2c deletes it.
  additionalNutrients: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
});
```

The `ScanFlag` import path above is **verified**: `nutrition-detail-flags-utils.ts:13` and
`ScanFlagBadge.tsx:17` both import it from `@shared/types/scan-flags`. Use it as written.

- [ ] **Step 2: Replace the region in the screen**

Delete lines `379-444` and put in their place:

```tsx
<FlagSections flags={flags} reducedMotion={reducedMotion} />
```

- [ ] **Step 3: Delete the now-dead locals and imports**

Delete from `NutritionDetailScreen.tsx`:

- `const partition = partitionScanFlags(flags);` (`:274`) **and its preceding comment**
- `const universalToShow = partition.universal.slice(0, 6);` (`:280`) **and its preceding comment**
- the `partitionScanFlags, headsUpSummaryLabel` import block (`:42-45`)
- the `ScanFlagBadge` and `NutriScoreChip` imports, **if** nothing else in the screen uses them

Verify:

```bash
grep -n "partition\|universalToShow\|ScanFlagBadge\|NutriScoreChip" client/screens/NutritionDetailScreen.tsx
```

Expected: **no output.** Keep `styles.additionalNutrients` and `styles.sectionTitle` in the
screen — the Additional Nutrients card still uses both.

- [ ] **Step 4: Run the screen suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS, including the pre-existing `"For you / Heads up flags (Task 13)"` suite —
four tests that already cover this region, including the 6-flag summary-label cap.

- [ ] **Step 5: Commit**

```bash
git add client/components/nutrition/FlagSections.tsx client/screens/NutritionDetailScreen.tsx
git commit -m "refactor(nutrition): extract FlagSections, moving the 6-flag cap in with both its consumers"
```

---

### Task 4: Extract `CapturedPhotos`

**Files:**

- Create: `client/components/nutrition/CapturedPhotos.tsx`
- Modify: `client/screens/NutritionDetailScreen.tsx` (replace `:681-787`; delete 4 style keys)

**Interfaces:**

- Produces:
  ```ts
  interface CapturedPhotosProps {
    nutritionImageUri?: string;
    frontImageUri?: string;
    reducedMotion?: boolean;
  }
  export function CapturedPhotos(
    props: CapturedPhotosProps,
  ): React.JSX.Element | null;
  ```

**This region is device-verified accessibility work (iOS VoiceOver, PR #745).** The label
belongs on the wrapper, not the `<Image>`, and the group label must contain the caption's
words. The two long block comments explaining why are **not** commentary — they are the
record of a decision that took a device pass to settle. They move with the JSX.

The "PROVISIONAL LAYOUT" paragraph inside the section comment is still accurate — 2c
redesigns this presentation. Keep it, and keep its warning that the route plumbing, a11y
labels and tests survive the redesign while the JSX does not.

- [ ] **Step 1: Read the full region before writing anything**

Read `client/screens/NutritionDetailScreen.tsx:681-787` in full. It contains two nearly
identical tiles (nutrition label, product front) with **different** label strings and
captions. Transcribe both; do not factor them into a loop or a shared sub-component — that
is a structural change, and this slice permits none.

- [ ] **Step 2: Create the component**

Move lines `681-787` verbatim into the component body, converting the outer
`{nutritionImageUri || frontImageUri ? (…) : null}` into an early return:

```tsx
export function CapturedPhotos({
  nutritionImageUri,
  frontImageUri,
  reducedMotion,
}: CapturedPhotosProps) {
  const { theme } = useTheme();

  if (!nutritionImageUri && !frontImageUri) return null;

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInUp.delay(250).duration(400)}
      style={styles.capturedPhotos}
    >
      {/* … the heading, the row, and BOTH tiles, verbatim … */}
    </Animated.View>
  );
}
```

`!a && !b` is the exact negation of `a || b`, so the early return renders in precisely the
cases the ternary did — including when a URI is the empty string.

The component's `StyleSheet.create` takes verbatim copies of `capturedPhotos`,
`capturedPhotoRow`, `capturedPhoto` (**with its seven-line `maxWidth: "50%"` comment**),
`capturedPhotoImage`, and `sectionTitle`.

**This plan deliberately does not paste the ~100 lines of tile JSX.** Retyping them here
would make _this document_ the transcription risk, and a plan-level typo is invisible to
every downstream check. Copy the region out of the file, then prove the copy was faithful
with Step 3 — a mechanical gate is stronger than either of us transcribing carefully.

- [ ] **Step 3: Prove the move was verbatim**

Before editing the screen, snapshot the original region; after writing the component, compare
the two with indentation and blank lines normalised away:

```bash
BASE=$(git rev-parse HEAD)   # the commit from Task 3, before this task's edit

git show "$BASE:client/screens/NutritionDetailScreen.tsx" \
  | sed -n '701,787p' | sed 's/^[[:space:]]*//' | grep -v '^$' \
  > /tmp/photos-before.txt

sed 's/^[[:space:]]*//' client/components/nutrition/CapturedPhotos.tsx \
  | grep -v '^$' > /tmp/photos-after.txt

diff /tmp/photos-before.txt /tmp/photos-after.txt
```

The diff will show the component's imports, its props interface, its docblock and its
`StyleSheet` as additions — those are expected. What it must **NOT** show is any change to a
line that exists in both: no altered string literal, no altered `accessibilityLabel`, no
altered `resizeMode`, no dropped comment line, no changed `delay(250)`. Read every `<` line
in the diff and account for it. A `<` line with a near-identical `>` twin is a transcription
error, which is exactly what this step exists to catch.

Paste the diff's `<`-side lines and your accounting for each into your task report.

- [ ] **Step 4: Replace the region in the screen**

Delete lines `681-787` — **including the section comment above the JSX**, which moves into
the component's docblock — and put in their place:

```tsx
<CapturedPhotos
  nutritionImageUri={nutritionImageUri}
  frontImageUri={frontImageUri}
  reducedMotion={reducedMotion}
/>
```

- [ ] **Step 5: Delete the moved style keys from the screen**

Remove `capturedPhotos`, `capturedPhotoRow`, `capturedPhoto`, `capturedPhotoImage`. **Keep
`sectionTitle`** — the Additional Nutrients card at `:816` still uses it.

```bash
grep -n "styles\.capturedPhoto" client/screens/NutritionDetailScreen.tsx
```

Expected: **no output.** (This one pattern is a prefix of all four keys, so a single grep
covers them.)

- [ ] **Step 6: Run the screen suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS, including the pre-existing `"captured photos"` suite — five tests, one of
which (`"exposes each photo as a single labelled node, not image plus caption"`) pins the
group-label containment by comparing the two strings off the DOM rather than matching
hand-written text. That test is the closest thing to a guard on the device-verified
behaviour; if it goes red, the wrapper shape changed.

- [ ] **Step 7: Commit**

```bash
git add client/components/nutrition/CapturedPhotos.tsx client/screens/NutritionDetailScreen.tsx
git commit -m "refactor(nutrition): extract CapturedPhotos with its device-verified a11y grouping"
```

---

### Task 5: Extract `VerificationPanel`

**Files:**

- Create: `client/components/nutrition/VerificationPanel.tsx`
- Modify: `client/screens/NutritionDetailScreen.tsx` (replace `:932-976`; delete 2 style keys)

**Interfaces:**

- Produces:
  ```ts
  interface VerificationPanelProps {
    verificationLevel: VerificationLevel;
    hasFrontLabelData: boolean;
    onAddProductDetails: () => void;
  }
  export function VerificationPanel(
    props: VerificationPanelProps,
  ): React.JSX.Element;
  ```
  `VerificationLevel` comes from `@shared/types/verification` — **verified**; it is what
  `VerificationBadge.tsx:17` and `useNutritionLookup.ts:22` both import. Import it; do not
  restate it as a string union. A local restatement of a type the canonical source owns is
  how PR #742's route-param bug happened.

**The navigation call stays in the screen.** The component receives
`onAddProductDetails: () => void`; the screen supplies
`() => navigation.navigate("Scan", { mode: "front-label", verifyBarcode: barcode })`. This
keeps `barcode` and the route shape with the screen that owns them, and matches how
`VerificationBadge` is written (it takes `level`, not a lookup).

The **outer** `{!itemId && barcode && nutrition && (…)}` guard stays in the screen — it reads
three pieces of screen state the component has no business knowing.

- [ ] **Step 1: Create the component**

```tsx
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { VerificationLevel } from "@shared/types/verification";

interface VerificationPanelProps {
  verificationLevel: VerificationLevel;
  hasFrontLabelData: boolean;
  /** The screen owns the navigation call — it holds `barcode` and the route shape. */
  onAddProductDetails: () => void;
}

export function VerificationPanel({
  verificationLevel,
  hasFrontLabelData,
  onAddProductDetails,
}: VerificationPanelProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.verificationSection}>
      <VerificationBadge level={verificationLevel} />

      {/* Retroactive front-label CTA for verified products without front-label data */}
      {verificationLevel !== "unverified" && !hasFrontLabelData && (
        <Pressable
          onPress={onAddProductDetails}
          accessibilityLabel="Scan front of package to add product details"
          accessibilityRole="button"
          style={[
            styles.verifyPrompt,
            { backgroundColor: withOpacity(theme.textSecondary, 0.06) },
          ]}
        >
          <Feather name="package" size={18} color={theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, fontWeight: "600" }}
            >
              Add product details
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Scan front of package
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  verificationSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  verifyPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
});
```

- [ ] **Step 2: Replace the region in the screen**

Replace lines `932-976` with:

```tsx
{
  /* Verification badge + CTA */
}
{
  !itemId && barcode && nutrition && (
    <VerificationPanel
      verificationLevel={verificationLevel}
      hasFrontLabelData={hasFrontLabelData}
      onAddProductDetails={() =>
        navigation.navigate("Scan", {
          mode: "front-label",
          verifyBarcode: barcode,
        })
      }
    />
  );
}
```

- [ ] **Step 3: Delete the moved style keys and prune imports**

Remove `verificationSection` and `verifyPrompt` from the screen's `StyleSheet.create`. Then
check whether `VerificationBadge`, `Pressable`, `Feather`, `withOpacity` and `BorderRadius`
still have references in the screen; remove only those that have none.

```bash
grep -n "VerificationBadge\|Pressable\|Feather\|withOpacity\|BorderRadius\|styles\.verif" client/screens/NutritionDetailScreen.tsx
```

`Feather` and `Pressable` are near-certain to survive (the manual-search and correction
blocks use them) — check, do not assume in either direction.

- [ ] **Step 4: Run the screen suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS, including the Task 1 verification suite and the pre-existing
`"does not render the obsolete Help verify this product CTA"` test.

- [ ] **Step 5: Commit**

```bash
git add client/components/nutrition/VerificationPanel.tsx client/screens/NutritionDetailScreen.tsx
git commit -m "refactor(nutrition): extract VerificationPanel, leaving navigation with the screen"
```

---

### Task 6: Swap `useHeaderHeight` for `useHeaderContentInset`

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx` (`:12`, `:180`, `:298`, `:316`)

**Interfaces:**

- Consumes: `useHeaderContentInset(extra?: number): number` from `@/hooks/useHeaderContentInset`.

**Why this is safe.** `client/hooks/useHeaderContentInset.ts:15-18` is:

```ts
export function useHeaderContentInset(extra: number = 0): number {
  const headerHeight = useHeaderHeight();
  return headerHeight + extra;
}
```

`useHeaderContentInset(Spacing.xl)` and `useHeaderHeight() + Spacing.xl` are therefore the
same expression, identical **by construction** rather than by measurement. That is what lets
a rule fix clear a zero-visual-delta bar. `docs/rules/react-native.md` prohibits the
hand-rolled form; six screens already use the hook.

**Both branches.** The loading branch (`:298`) and the main branch (`:316`) each hand-roll
the arithmetic. Fixing only one leaves the rule violation live in the branch nobody renders
in tests.

- [ ] **Step 1: Replace the hook call**

At `:180`:

```tsx
// before
const headerHeight = useHeaderHeight();
// after
const headerContentInset = useHeaderContentInset(Spacing.xl);
```

Rename the local rather than keeping `headerHeight` — the value's meaning changed (it now
_includes_ the spacing), and a name that still says "header height" invites the next reader
to add `Spacing.xl` to it a second time.

- [ ] **Step 2: Replace both `paddingTop` expressions**

At `:298` (loading branch) and `:316` (main branch):

```tsx
// before
paddingTop: headerHeight + Spacing.xl,
// after
paddingTop: headerContentInset,
```

- [ ] **Step 3: Swap the import**

At `:12`, replace:

```tsx
import { useHeaderHeight } from "@react-navigation/elements";
```

with:

```tsx
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
```

Place it with the other `@/hooks/*` imports, not where the navigation import was.

- [ ] **Step 4: Verify the old form is gone from this screen**

```bash
grep -n "useHeaderHeight\|headerHeight" client/screens/NutritionDetailScreen.tsx
```

Expected: **no output.**

- [ ] **Step 5: Confirm both call sites are converted**

```bash
grep -n "paddingTop" client/screens/NutritionDetailScreen.tsx
```

Expected: exactly **two** lines, both reading `paddingTop: headerContentInset,`. One match
means a branch was missed.

- [ ] **Step 6: Run the screen suite**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS. `@react-navigation/elements` is aliased to a mock returning `88`
(`vitest.config.ts:137`), and `useHeaderContentInset` reads through that same mock, so both
forms compute `88 + Spacing.xl` in tests exactly as they do on device.

- [ ] **Step 7: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx
git commit -m "fix(nutrition): read the header inset from useHeaderContentInset on both branches

Hand-rolled paddingTop: headerHeight + Spacing.xl violated docs/rules/react-native.md.
The hook is literally headerHeight + extra, so the swap is arithmetically identical."
```

---

## Slice-close checklist

Run after Task 6, before opening the PR.

- [ ] **The full client suite is green**, not just the one file:
      `npx vitest run client/`
- [ ] **`client/components/nutrition/` contains exactly four files** — `ProductHero.tsx`,
      `FlagSections.tsx`, `CapturedPhotos.tsx`, `VerificationPanel.tsx`. Anything else means
      scope crept.
- [ ] **No orphaned style keys.** For every key deleted from the screen, confirm zero
      references remain; for every key added to a component, confirm it is used.
- [ ] **Animation delays are unchanged.** `git diff main...HEAD | grep -E 'delay\('` — every
      hunk must show the same numbers on the `-` and `+` sides (`100`, `250`, `450`, `475`).
      A changed delay is a visual delta.
- [ ] **The screen got materially shorter** (~1236 → roughly 950 lines) and no new file
      exceeds ~200 lines.
- [ ] **Device pass on the simulator, both themes, before/after.** CI cannot see a visual
      delta; this slice's entire claim is that there isn't one. Check the header spacing at
      the top of the scroll, the product hero, the flag sections, the photo tiles, and the
      verification CTA. Use the dev-client build (`npx expo run:ios`) — Expo Go has no camera
      and cannot reach the scan route.
- [ ] **Report what the device pass did NOT cover.** Android/TalkBack is unverified for the
      whole of Phase 2; say so in the PR body rather than letting an iOS pass read as
      cross-platform.

## What 2b hands to 2c

Record these in the PR body — 2c's plan is written after this lands and will need them.

- `FlagSections` still renders scalar nutrient flags. 2c narrows it **and** must keep
  `"nutrient"` in `UNIVERSAL_KINDS`, because `partitionScanFlags` warn-and-drops unmodelled
  kinds.
- `sectionTitle` / `additionalNutrients` now exist in three places (screen, `FlagSections`,
  `CapturedPhotos` for `sectionTitle`). 2c deletes the Additional Nutrients card, which
  removes the screen's copies.
- The bottom inset is still counted once, by the ScrollView
  (`paddingBottom: insets.bottom + Spacing["3xl"]`). When 2c adds the sticky `LogActionBar`,
  **the bar** takes ownership of `insets.bottom` and the ScrollView's padding becomes the
  bar's **measured** height (via `onLayout`, never a constant) plus spacing. Leaving both is
  a double-count.
- `CapturedPhotos`'s JSX is provisional; its label strings, wrapper shape, and tests are not.
- The animation ordering bug is untouched and still bottom-up: `FadeIn` on the image,
  `delay(100)` hero text, `delay(250)` photos, `delay(450)`/`delay(475)` flags,
  `delay(600)` micronutrients — against a calorie card at `delay(200)`.

## Execution notes

**The plan file is gitignored** (`docs/superpowers/` is untracked), so `git worktree add`
will not carry it into a worktree. If this executes in a worktree, hand subagents the
**absolute path into the main checkout** (`/Users/williamtower/projects/OCRecipes/docs/superpowers/…`)
rather than a repo-relative one, and copy the SDD ledger out of the worktree before removing
it. Slice 2a lost a ledger to exactly this.

**2b and 2c both rewrite `NutritionDetailScreen.tsx`.** They are strictly sequential and must
never run in parallel worktrees.

**Tasks 2-5 each edit the file the next task edits.** Line numbers in this plan are relative
to `main` at `4eaa2d2d`; after Task 2 they shift. Every task's brief must instruct the
implementer to locate its region by its **content** (the JSX and the section comment quoted
in the task), never by the line numbers alone.
