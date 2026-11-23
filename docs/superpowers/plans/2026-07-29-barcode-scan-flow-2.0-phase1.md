# Barcode Scan Flow 2.0 — Phase 1 (Flow Correctness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three-step barcode scan flow actually followable, stop discarding the photos it captures, prevent a wrong database calorie count from being logged in one tap, and land the user on Today after logging instead of back in the camera.

**Architecture:** Additive only. One new `ScanPhase` (`LABEL_PROMPTED`) and one new action (`PROCEED_TO_LABEL`) let step 1's primary button advance the flow instead of ending it; no existing transition changes. Pure logic goes into `*-utils.ts` siblings so Vitest covers it directly, following the established convention. The `client/camera/` capture path is untouched.

**Tech Stack:** React Native / Expo, TypeScript strict, Vitest, React Navigation v7, TanStack Query v5.

**Spec:** `docs/superpowers/specs/2026-07-29-barcode-scan-flow-2.0-design.md`

## Global Constraints

- **`client/camera/` capture path is OFF-LIMITS** — `CameraView.tsx`, `CameraView.ios.tsx`, `useCameraFocusAndZoom.ts`, frame processors, barcode tracking. PR #729 (VisionCamera 5.1.1 + MLKit 9) landed 2026-07-29 with three device-only acceptance criteria still unverified; a regression here would be indistinguishable from those. The reducer, types, and `*-utils.ts` files under `client/camera/` ARE in scope.
- **Never collapse the three-valued `ocrText` contract.** `undefined` = no label step ran (barcode-only), `null` = a label was photographed but unreadable, `string` = readable text. This is load-bearing (PR #734); collapsing any value re-introduces the silent wrong-calorie path.
- **TDD is mandatory** — failing test first, verified failing, then minimal implementation. Project rule.
- **Do NOT run `test:run`, `check:types`, or `lint` ad-hoc for self-verification.** CI is the source of truth. Run only the specific test file named in each task.
- **Commits run lint-staged only.** Every push runs `preflight:fast`. Do not `--no-verify`.
- **Never commit to `main`.** Work on a feature branch off `main`; open a PR.
- Colors come from `useTheme()`. `client/camera/` overlay components are the documented exception and use hardcoded overlay-safe values — match the surrounding style there.
- `theme.accentSolid` for solid fills carrying white text; `theme.link` for text/border colors. They differ in dark mode.

## Files

| File                                            | Responsibility                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `client/camera/types/scan-phase.ts`             | MODIFY — add `LABEL_PROMPTED` phase, `PROCEED_TO_LABEL` action, `verificationLevel` on `ProductSummary`. |
| `client/camera/reducers/scan-phase-reducer.ts`  | MODIFY — one new case; accept capture from the new phase.                                                |
| `client/camera/components/CoachHint-utils.ts`   | MODIFY — copy for the new phase (exhaustive switch, fails to compile until handled).                     |
| `client/camera/components/ScanReticle-utils.ts` | MODIFY — label-shaped reticle for the new phase.                                                         |
| `client/camera/components/StepPill-utils.ts`    | MODIFY — step dots for the new phase.                                                                    |
| `client/camera/components/ProductChip-utils.ts` | MODIFY — new `getBarcodeLockActions`; fix the misleading `barcode_lock` announcement.                    |
| `client/camera/components/ProductChip.tsx`      | MODIFY — two-action `barcode_lock` layout.                                                               |
| `client/screens/scan-screen-utils.ts`           | MODIFY — new `buildProductSummary` and `buildNutritionDetailParams` pure helpers.                        |
| `client/screens/ScanScreen.tsx`                 | MODIFY — wire the above; pass the whole session payload.                                                 |
| `client/screens/nutrition-detail-utils.ts`      | MODIFY — new `deriveLogGate` pure helper.                                                                |
| `client/hooks/useNutritionLookup.ts`            | MODIFY — expose `logGate`; replace `goBack()` with a reset to Today.                                     |
| `client/screens/NutritionDetailScreen.tsx`      | MODIFY — gate the log button; delete the dead "Help verify this product" CTA.                            |
| `client/navigation/RootStackNavigator.tsx`      | MODIFY — `NutritionDetail` params gain the two image URIs.                                               |

**Note on plan/spec location:** `docs/superpowers/` is gitignored (`.gitignore:100`). Neither the spec nor this plan will appear in a commit — that is the established project convention (all prior specs and plans are untracked). Do not `git add -f` them.

---

## Task 1: Add the `LABEL_PROMPTED` phase and `PROCEED_TO_LABEL` action

Step 1 currently has no "advance to step 2" action at all — taking a photo while in `BARCODE_LOCKED` _is_ the advance. So the primary button cannot advance the step; it can only acknowledge the product and hand control back to the camera. This task creates the state that makes that possible.

**Files:**

- Modify: `client/camera/types/scan-phase.ts`
- Modify: `client/camera/reducers/scan-phase-reducer.ts`
- Test: `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `ScanPhase` variant `{ type: "LABEL_PROMPTED"; barcode: string; product?: ProductSummary }` and `ScanAction` variant `{ type: "PROCEED_TO_LABEL" }`. Tasks 2, 4, and 5 depend on both names exactly as spelled.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("scanPhaseReducer", …)` block in `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`:

```ts
// The primary CTA in BARCODE_LOCKED used to dispatch CONFIRM_PRODUCT, which
// ends the session — so "Looks right →" was the SKIP button and steps 2/3
// never ran. PROCEED_TO_LABEL is the advance that button needs.
it("PROCEED_TO_LABEL transitions BARCODE_LOCKED → LABEL_PROMPTED, carrying the product", () => {
  const state: ScanPhase = {
    type: "BARCODE_LOCKED",
    barcode: "06772408",
    bounds: BOUNDS,
    product: { name: "Cherry Coke", brand: "Coca-Cola" },
  };

  expect(scanPhaseReducer(state, { type: "PROCEED_TO_LABEL" })).toEqual({
    type: "LABEL_PROMPTED",
    barcode: "06772408",
    product: { name: "Cherry Coke", brand: "Coca-Cola" },
  });
});

it("PROCEED_TO_LABEL is a no-op from any phase other than BARCODE_LOCKED", () => {
  const hunting: ScanPhase = { type: "HUNTING" };
  expect(scanPhaseReducer(hunting, { type: "PROCEED_TO_LABEL" })).toBe(hunting);

  const step2: ScanPhase = {
    type: "STEP2_REVIEWING",
    barcode: "123",
    imageUri: "file://a.jpg",
    ocrText: "Calories 140",
  };
  expect(scanPhaseReducer(step2, { type: "PROCEED_TO_LABEL" })).toBe(step2);
});

it("STEP_PHOTO_CAPTURED from LABEL_PROMPTED → STEP2_REVIEWING with normalized ocrText", () => {
  const state: ScanPhase = {
    type: "LABEL_PROMPTED",
    barcode: "06772408",
    product: { name: "Cherry Coke" },
  };

  const result = scanPhaseReducer(state, {
    type: "STEP_PHOTO_CAPTURED",
    imageUri: "file://panel.jpg",
    ocrText: "  Calories 140  ",
  });

  expect(result).toEqual({
    type: "STEP2_REVIEWING",
    barcode: "06772408",
    product: { name: "Cherry Coke" },
    imageUri: "file://panel.jpg",
    ocrText: "Calories 140",
  });
});

it("an unreadable capture from LABEL_PROMPTED still yields ocrText null, not empty string", () => {
  const state: ScanPhase = {
    type: "LABEL_PROMPTED",
    barcode: "06772408",
  };

  const result = scanPhaseReducer(state, {
    type: "STEP_PHOTO_CAPTURED",
    imageUri: "file://blurry.jpg",
    ocrText: "   \n ",
  });

  expect(result).toMatchObject({ type: "STEP2_REVIEWING", ocrText: null });
});

// REGRESSION GUARD. The barcode-only escape hatch must survive this change —
// a user may be offline, holding a damaged label, or navigating by screen
// reader. CONFIRM_PRODUCT from BARCODE_LOCKED keeps its exact old behavior;
// it just stops being wired to the PRIMARY button.
it("CONFIRM_PRODUCT from BARCODE_LOCKED still ends the session (barcode-only path preserved)", () => {
  const state: ScanPhase = {
    type: "BARCODE_LOCKED",
    barcode: "06772408",
    bounds: BOUNDS,
    product: { name: "Cherry Coke" },
  };

  expect(scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" })).toEqual({
    type: "SESSION_COMPLETE",
    barcode: "06772408",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts`

Expected: FAIL. TypeScript will reject `"LABEL_PROMPTED"` and `"PROCEED_TO_LABEL"` as not assignable to `ScanPhase` / `ScanAction`.

- [ ] **Step 3: Add the phase and action to the types**

In `client/camera/types/scan-phase.ts`, add `verificationLevel` to `ProductSummary` (needed by Task 3, declared here so the type exists once):

```ts
  /**
   * Server-reported verification state for this barcode, from
   * `GET /api/nutrition/barcode/:barcode`. OPTIONAL on purpose: the chip
   * renders before the product fetch resolves (see ProductChip's note that the
   * name can arrive after the chip is shown), so `undefined` means "not loaded
   * yet" and callers must treat it as unverified — never as verified.
   */
  verificationLevel?: VerificationLevel;
```

Add the import at the top of the file, alongside the existing type imports:

```ts
import type { VerificationLevel } from "@shared/types/verification";
```

If that module path does not export `VerificationLevel`, locate the existing declaration instead — `client/hooks/useNutritionLookup.ts` already imports it for its `verificationLevel` state — and import from the same place. Do not redeclare the union.

Add the new phase to the `ScanPhase` union, immediately after the `BARCODE_LOCKED` variant:

```ts
  | {
      /**
       * The user confirmed the scanned product and asked to photograph its
       * nutrition panel. The chip is collapsed and the camera is live; the
       * NEXT capture completes step 2.
       *
       * This phase exists because taking a photo in BARCODE_LOCKED *is* the
       * advance to step 2 — there was no action representing "I want to do
       * step 2", so step 1's primary button had to be wired to
       * CONFIRM_PRODUCT, which ends the session instead.
       */
      type: "LABEL_PROMPTED";
      barcode: string;
      product?: ProductSummary;
    }
```

Add the new action to the `ScanAction` union, immediately after `CONFIRM_PRODUCT`:

```ts
  | { type: "PROCEED_TO_LABEL" }
```

- [ ] **Step 4: Add the reducer cases**

In `client/camera/reducers/scan-phase-reducer.ts`, add a new `case` immediately after the closing of `case "CONFIRM_PRODUCT":`:

```ts
    case "PROCEED_TO_LABEL":
      if (state.type !== "BARCODE_LOCKED") return state;
      return {
        type: "LABEL_PROMPTED",
        barcode: state.barcode,
        product: state.product,
      };
```

Then extend `case "STEP_PHOTO_CAPTURED"` to accept the new phase. Change the existing guard:

```ts
      if (state.type === "BARCODE_LOCKED") {
```

to:

```ts
      // LABEL_PROMPTED is the normal route here now; BARCODE_LOCKED is retained
      // so a capture taken before the chip's primary button is pressed still
      // completes step 2 rather than being silently dropped.
      if (state.type === "BARCODE_LOCKED" || state.type === "LABEL_PROMPTED") {
```

The body is unchanged — it already reads only `state.barcode`, `state.product`, `action.imageUri`, and `action.ocrText`, all of which `LABEL_PROMPTED` provides.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts`

Expected: PASS, all tests in the file including the pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add client/camera/types/scan-phase.ts \
        client/camera/reducers/scan-phase-reducer.ts \
        client/camera/reducers/__tests__/scan-phase-reducer.test.ts
git commit -m "feat(scan): add LABEL_PROMPTED phase so step 1's primary button can advance

Taking a photo in BARCODE_LOCKED *is* the advance to step 2, so there was no
action meaning \"I want to do step 2\" — step 1's primary CTA had to dispatch
CONFIRM_PRODUCT, which ends the session. That made \"Looks right →\" the skip
button while the coach hint below it said to frame the nutrition panel.

Additive: one new phase, one new action, no existing transition altered. The
barcode-only escape hatch (CONFIRM_PRODUCT from BARCODE_LOCKED) is unchanged and
now covered by an explicit regression test."
```

---

## Task 2: Handle the new phase in the four phase-driven utils

Four switches key off `phase.type`. They fail differently, and the difference matters: one will not compile until handled, three have a `default` and will silently do the wrong thing. Enumerate them deliberately rather than waiting for a visual bug.

**Files:**

- Modify: `client/camera/components/CoachHint-utils.ts`
- Modify: `client/camera/components/ScanReticle-utils.ts`
- Modify: `client/camera/components/StepPill-utils.ts`
- Modify: `client/camera/components/ProductChip-utils.ts`
- Test: `client/camera/components/__tests__/CoachHint-utils.test.ts`
- Test: `client/camera/components/__tests__/ScanReticle-utils.test.ts`
- Test: `client/camera/components/__tests__/StepPill-utils.test.ts`
- Test: `client/camera/components/__tests__/ProductChip-utils.test.ts`

**Interfaces:**

- Consumes: the `LABEL_PROMPTED` phase from Task 1.
- Produces: `getProductChipVariant({ type: "LABEL_PROMPTED" })` returns `null` (chip hidden). Task 4 relies on that.

- [ ] **Step 1: Write the failing tests**

In `client/camera/components/__tests__/CoachHint-utils.test.ts`, add inside the existing describe block:

```ts
it('returns "Now frame the Nutrition Facts panel" for LABEL_PROMPTED', () => {
  expect(getCoachMessage({ type: "LABEL_PROMPTED", barcode: "123" }, 0)).toBe(
    "Now frame the Nutrition Facts panel",
  );
});

// ACCESSIBILITY-LOAD-BEARING, and the reason is not obvious.
//
// CoachHint announces via `useEffect(…, [message])` on iOS and relies on
// `accessibilityLiveRegion="polite"` on Android. NEITHER re-fires when the
// string is unchanged. If LABEL_PROMPTED reused BARCODE_LOCKED's exact copy,
// a screen-reader user who presses "Scan Nutrition Facts →" would get the
// chip silently unmounting and NO announcement at all — no confirmation their
// tap did anything.
//
// So these two strings MUST differ. Do not "simplify" this by folding
// LABEL_PROMPTED into the BARCODE_LOCKED case arm.
it("uses copy distinct from BARCODE_LOCKED so the transition re-announces", () => {
  const locked = getCoachMessage(
    { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
    0,
  );
  const prompted = getCoachMessage(
    { type: "LABEL_PROMPTED", barcode: "123" },
    0,
  );
  expect(prompted).not.toBe(locked);
  expect(prompted).toBeTruthy();
});
```

If `BOUNDS` is not already declared in that test file, copy the constant from `ProductChip-utils.test.ts`: `const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };`

In `client/camera/components/__tests__/ScanReticle-utils.test.ts`, add:

```ts
it("uses the label-shaped reticle for LABEL_PROMPTED, not the barcode one", () => {
  const target = getReticleTarget(
    { type: "LABEL_PROMPTED", barcode: "123" },
    400,
    800,
  );
  expect(target).toEqual({ cx: 200, cy: 400, ...LABEL_RETICLE });
});
```

Ensure `LABEL_RETICLE` and `getReticleTarget` are imported in that file; add them to the existing import if absent.

In `client/camera/components/__tests__/StepPill-utils.test.ts`, add:

```ts
it("LABEL_PROMPTED shows step 1 done and step 2 active", () => {
  const phase: ScanPhase = { type: "LABEL_PROMPTED", barcode: "123" };
  expect(getStepDotState(phase, 0)).toBe("done");
  expect(getStepDotState(phase, 1)).toBe("active");
  expect(getStepDotState(phase, 2)).toBe("idle");
});

it("still shows the step pill during LABEL_PROMPTED", () => {
  expect(shouldShowStepPill({ type: "LABEL_PROMPTED", barcode: "123" })).toBe(
    true,
  );
});
```

In `client/camera/components/__tests__/ProductChip-utils.test.ts`, add to the `getProductChipVariant` describe block:

```ts
// Deliberate, not incidental: LABEL_PROMPTED means "chip collapsed, go frame
// the panel". A null variant hides the chip, which is exactly the intent — so
// assert it rather than leaving it to the `default` arm by accident.
it("returns null for LABEL_PROMPTED so the chip collapses out of the way", () => {
  expect(
    getProductChipVariant({ type: "LABEL_PROMPTED", barcode: "123" }),
  ).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run client/camera/components/__tests__/CoachHint-utils.test.ts \
                client/camera/components/__tests__/ScanReticle-utils.test.ts \
                client/camera/components/__tests__/StepPill-utils.test.ts \
                client/camera/components/__tests__/ProductChip-utils.test.ts
```

Expected: FAIL.

- `CoachHint-utils` — a **compile error**: its switch is exhaustive with no `default`, so adding a union member makes the function's return type include `undefined`.
- `ScanReticle-utils` — returns `BARCODE_RETICLE` via `default` (wrong shape, no compile error).
- `StepPill-utils` — returns `"idle"` for all three dots via `default` (wrong, no compile error).
- `ProductChip-utils` — this one already **passes** via `default: return null`. That is expected; the test locks the behavior in so a future `default` removal cannot silently start showing the chip.

- [ ] **Step 3: Handle the phase in each util**

`client/camera/components/CoachHint-utils.ts` — add `LABEL_PROMPTED` as its own arm with **distinct** copy. Do NOT share the `BARCODE_LOCKED` arm:

```ts
    case "BARCODE_LOCKED":
      return "Frame the Nutrition Facts panel";
    // Distinct copy from BARCODE_LOCKED on purpose. CoachHint announces via
    // useEffect(…, [message]) on iOS and accessibilityLiveRegion="polite" on
    // Android — neither re-fires on an unchanged string. Sharing the arm would
    // leave a screen-reader user with no announcement at all when the chip
    // collapses after they press "Scan Nutrition Facts →". "Now" also confirms
    // to sighted users that the tap registered.
    case "LABEL_PROMPTED":
      return "Now frame the Nutrition Facts panel";
```

`client/camera/components/ScanReticle-utils.ts` — add to the label-reticle group in `getReticleTarget`:

```ts
    case "BARCODE_LOCKED":
    case "LABEL_PROMPTED":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
      return { ...center, ...LABEL_RETICLE };
```

`getConfidenceFromPhase` needs no change — its `default` returns `1.0`, which is correct for a locked barcode.

`client/camera/components/StepPill-utils.ts` — add to the step-1-done group in `getStepDotState`:

```ts
    case "BARCODE_LOCKED":
    case "LABEL_PROMPTED":
    case "STEP2_REVIEWING":
      if (stepIndex === 0) return "done";
      if (stepIndex === 1) return "active";
      return "idle";
```

`shouldShowStepPill` needs no change — it works by excluding the smart-photo phases, and `LABEL_PROMPTED` is not one.

`client/camera/components/ProductChip-utils.ts` — no code change. Add a comment above the `default` arm of `getProductChipVariant` recording the intent:

```ts
    // LABEL_PROMPTED intentionally falls here: a null variant hides the chip,
    // which is what "chip collapsed, go frame the panel" means. Covered by test.
    default:
      return null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run client/camera/components/__tests__/CoachHint-utils.test.ts \
                client/camera/components/__tests__/ScanReticle-utils.test.ts \
                client/camera/components/__tests__/StepPill-utils.test.ts \
                client/camera/components/__tests__/ProductChip-utils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/camera/components/CoachHint-utils.ts \
        client/camera/components/ScanReticle-utils.ts \
        client/camera/components/StepPill-utils.ts \
        client/camera/components/ProductChip-utils.ts \
        client/camera/components/__tests__/
git commit -m "feat(scan): handle LABEL_PROMPTED in the four phase-driven utils

Three of the four switches carry a \`default\`, so they compiled fine and would
have silently rendered the wrong thing: a barcode-shaped reticle instead of the
label frame, and all step dots idle. Only CoachHint-utils' exhaustive switch
failed loudly.

ProductChip-utils needs no code change — its \`default: return null\` already
hides the chip, which is the intent. Locked in with a test and a comment so a
later refactor can't silently start rendering it."
```

---

## Task 3: Plumb `verificationLevel` into `ProductSummary`

`fetchProductInfo` already calls `GET /api/nutrition/barcode/:barcode`, and that endpoint already returns `verificationLevel` (`server/routes/nutrition.ts:154`). No server change is needed — but the client currently **discards** the field, so "no server work" is not "no work". Extracting the mapping into a pure helper makes it testable, per the project's `*-utils.ts` convention.

**Files:**

- Modify: `client/screens/scan-screen-utils.ts`
- Modify: `client/screens/ScanScreen.tsx`
- Test: `client/screens/__tests__/scan-screen-utils.test.ts`

**Interfaces:**

- Consumes: `ProductSummary.verificationLevel` from Task 1.
- Produces: `buildProductSummary(data, flags): ProductSummary` exported from `client/screens/scan-screen-utils.ts`. Task 4 does not call it directly; Task 4 consumes the `verificationLevel` field it populates.

- [ ] **Step 1: Write the failing test**

Add to `client/screens/__tests__/scan-screen-utils.test.ts` (create the describe block; the file already exists):

```ts
describe("buildProductSummary", () => {
  const flags: ScanFlag[] = [];

  it("carries verificationLevel through from the barcode response", () => {
    const result = buildProductSummary(
      {
        productName: "Cherry Coke",
        brandName: "Coca-Cola",
        imageUrl: "https://cdn/x.jpg",
        verificationLevel: "verified",
      },
      flags,
    );

    expect(result).toMatchObject({
      name: "Cherry Coke",
      brand: "Coca-Cola",
      imageUri: "https://cdn/x.jpg",
      verificationLevel: "verified",
    });
  });

  // A response with no verificationLevel must NOT be treated as verified.
  // Leaving it undefined lets the chip default to the label-required branch.
  it("leaves verificationLevel undefined when the response omits it", () => {
    const result = buildProductSummary({ productName: "Mystery Bar" }, flags);
    expect(result.verificationLevel).toBeUndefined();
  });

  it("falls back to a placeholder name and drops absent optional fields", () => {
    const result = buildProductSummary({}, flags);
    expect(result.name).toBe("Unknown product");
    expect(result.brand).toBeUndefined();
    expect(result.imageUri).toBeUndefined();
  });
});
```

Add to the file's imports:

```ts
import { buildProductSummary } from "../scan-screen-utils";
import type { ScanFlag } from "@shared/types/scan-flags";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/screens/__tests__/scan-screen-utils.test.ts`

Expected: FAIL with `buildProductSummary is not a function` / no exported member.

- [ ] **Step 3: Implement the helper**

Add to `client/screens/scan-screen-utils.ts`:

```ts
/**
 * Map a `GET /api/nutrition/barcode/:barcode` response into the `ProductSummary`
 * the scan chip renders.
 *
 * Extracted from ScanScreen's `fetchProductInfo` so the mapping is unit-testable
 * — in particular so the `verificationLevel` pass-through has a regression test.
 * That field was silently dropped before, which is why step 1 could not tell a
 * verified product from an unverified one.
 *
 * The flag helpers must stay the SHARED ones (`pickTopSafetyFlag` /
 * `pickTopDisplayFlag`) rather than being re-derived here — a prior refactor
 * updated one call site only and desynced two display surfaces.
 */
export function buildProductSummary(
  data: {
    productName?: string;
    brandName?: string;
    imageUrl?: string;
    verificationLevel?: VerificationLevel;
  },
  flags: ScanFlag[],
): ProductSummary {
  return {
    name: data.productName ?? "Unknown product",
    brand: data.brandName ?? undefined,
    imageUri: data.imageUrl ?? undefined,
    safetyFlag: pickTopSafetyFlag(flags),
    topFlag: pickTopDisplayFlag(flags),
    verificationLevel: data.verificationLevel,
  };
}
```

Add the needed imports to `scan-screen-utils.ts`, matching what `ScanScreen.tsx` already imports:

```ts
import type { ProductSummary } from "@/camera/types/scan-phase";
import type { ScanFlag } from "@shared/types/scan-flags";
import {
  pickTopSafetyFlag,
  pickTopDisplayFlag,
} from "@shared/types/scan-flags";
import type { VerificationLevel } from "@shared/types/verification";
```

Use the same import specifiers `ScanScreen.tsx` uses for `pickTopSafetyFlag` / `pickTopDisplayFlag` and `VerificationLevel`; copy them verbatim from that file rather than guessing paths.

- [ ] **Step 4: Use the helper in `ScanScreen`**

In `client/screens/ScanScreen.tsx`'s `fetchProductInfo`, replace the inline `dispatch({ type: "PRODUCT_LOADED", product: { … } })` object with the helper. The local `safetyFlag` variable is still used by the haptic below, so keep it:

```ts
const safetyFlag = pickTopSafetyFlag(flags);
dispatch({
  type: "PRODUCT_LOADED",
  product: buildProductSummary(data, flags),
});
```

Delete the now-unused local `topFlag` variable if TypeScript reports it unused. Add `buildProductSummary` to the existing import from `@/screens/scan-screen-utils`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run client/screens/__tests__/scan-screen-utils.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/screens/scan-screen-utils.ts \
        client/screens/ScanScreen.tsx \
        client/screens/__tests__/scan-screen-utils.test.ts
git commit -m "feat(scan): carry verificationLevel into ProductSummary

The barcode endpoint has always returned verificationLevel and fetchProductInfo
has always thrown it away, so step 1 had no way to tell a verified product from
an unverified one. Extracted the response→ProductSummary mapping into a pure
helper so the pass-through is covered, and so the shared flag helpers stay the
single source for flag composition."
```

---

## Task 4: Verification-aware step 1 — the D1 fix

This is the defect the user reported first. `ProductChip`'s `barcode_lock` variant renders **"Looks right →"** as its primary button, wired to `CONFIRM_PRODUCT`, which ends the session — while the caption underneath says "Point at the Nutrition Facts panel to continue" and `getCoachMessage` says "Frame the Nutrition Facts panel". The loudest control is the skip.

**Files:**

- Modify: `client/camera/components/ProductChip-utils.ts`
- Modify: `client/camera/components/ProductChip.tsx`
- Modify: `client/screens/ScanScreen.tsx`
- Test: `client/camera/components/__tests__/ProductChip-utils.test.ts`

**Interfaces:**

- Consumes: `ProductSummary.verificationLevel` (Task 1, populated Task 3); `PROCEED_TO_LABEL` (Task 1).
- Produces: `getBarcodeLockActions(verificationLevel): BarcodeLockActions` where

  ```ts
  type BarcodeLockAction = {
    label: string;
    intent: "proceedToLabel" | "confirmProduct";
  };
  type BarcodeLockActions = {
    primary: BarcodeLockAction;
    secondary: BarcodeLockAction;
  };
  ```

  `ProductChip.tsx` maps `intent` to the callback props. No later task consumes this.

- [ ] **Step 1: Write the failing tests**

Add to `client/camera/components/__tests__/ProductChip-utils.test.ts`:

```ts
describe("getBarcodeLockActions", () => {
  it("offers the fast path as primary when the product is already verified", () => {
    const actions = getBarcodeLockActions("verified");
    expect(actions.primary).toEqual({
      label: "Use verified data →",
      intent: "confirmProduct",
    });
    expect(actions.secondary).toEqual({
      label: "Photograph label instead",
      intent: "proceedToLabel",
    });
  });

  it("requires the label step as primary when the data is unverified", () => {
    const actions = getBarcodeLockActions("unverified");
    expect(actions.primary).toEqual({
      label: "Scan Nutrition Facts →",
      intent: "proceedToLabel",
    });
    expect(actions.secondary).toEqual({
      label: "Use database data anyway",
      intent: "confirmProduct",
    });
  });

  // The chip renders BEFORE the product fetch resolves, so this is a real
  // runtime state, not a defensive branch. Defaulting to the verified fast path
  // would let a user one-tap past the label step on a product whose data is
  // actually unverified — reintroducing the wrong-calorie bug through a race.
  it("treats an unloaded verificationLevel as unverified, never as verified", () => {
    expect(getBarcodeLockActions(undefined)).toEqual(
      getBarcodeLockActions("unverified"),
    );
  });

  // `VerificationLevel` is `"unverified" | "single_verified" | "verified"`
  // (shared/types/verification.ts). Only the fully-verified state earns the fast
  // path — matching how NutritionDetailScreen already gates on `!== "verified"`.
  it("requires the label step for single_verified, not just unverified", () => {
    expect(getBarcodeLockActions("single_verified")).toEqual(
      getBarcodeLockActions("unverified"),
    );
  });

  // The old announcement told screen-reader users that tapping views details.
  // It ended the session instead.
  it("announces the barcode_lock chip as an action on the product, not a detail view", () => {
    const phase: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product: { name: "Cherry Coke" },
    };
    expect(getChipAnnounceText("barcode_lock", phase)).toBe(
      "Product found, choose how to continue",
    );
  });
});
```

Add `getBarcodeLockActions` to the file's import from `../ProductChip-utils`.

**Before writing the "partial" case, confirm the `VerificationLevel` union's members** — read the type declaration `useNutritionLookup.ts` imports. If `"partial"` is not a member, substitute an actual non-`"verified"` member. Do not invent one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/camera/components/__tests__/ProductChip-utils.test.ts`

Expected: FAIL — `getBarcodeLockActions` is not exported, and the announce assertion fails against the current `"Product found, tap to view details"`.

- [ ] **Step 3: Implement the helper and fix the announcement**

Add to `client/camera/components/ProductChip-utils.ts`:

```ts
export type BarcodeLockAction = {
  label: string;
  intent: "proceedToLabel" | "confirmProduct";
};

export type BarcodeLockActions = {
  primary: BarcodeLockAction;
  secondary: BarcodeLockAction;
};

/**
 * Which action step 1 offers as primary, and which as secondary.
 *
 * The whole point: the PRIMARY control must ADVANCE the flow. It used to be
 * "Looks right →" wired to CONFIRM_PRODUCT, which ends the session — so the
 * loudest button on screen was the skip, and the only route to step 2 was an
 * unlabeled implicit gesture described in caption text.
 *
 * `undefined` (product fetch still in flight) deliberately resolves to the
 * unverified branch. Failing toward capturing the label is the safe direction;
 * offering the verified fast path before verification has loaded would let a
 * user one-tap past step 2 on unverified data.
 *
 * The secondary action must stay genuinely reachable in BOTH branches — a user
 * may be offline, holding a damaged or missing label, or navigating by screen
 * reader. Removing the barcode-only escape hatch would be a regression.
 */
export function getBarcodeLockActions(
  verificationLevel: VerificationLevel | undefined,
): BarcodeLockActions {
  if (verificationLevel === "verified") {
    return {
      primary: { label: "Use verified data →", intent: "confirmProduct" },
      secondary: {
        label: "Photograph label instead",
        intent: "proceedToLabel",
      },
    };
  }
  return {
    primary: { label: "Scan Nutrition Facts →", intent: "proceedToLabel" },
    secondary: {
      label: "Use database data anyway",
      intent: "confirmProduct",
    },
  };
}
```

Import `VerificationLevel` into `ProductChip-utils.ts` using the same specifier as Task 3.

In the same file, change `getChipAnnounceText`'s `barcode_lock` arm:

```ts
    case "barcode_lock":
      return "Product found, choose how to continue";
```

- [ ] **Step 4: Render the two actions in `ProductChip`**

In `client/camera/components/ProductChip.tsx`, replace the whole `variant === "barcode_lock"` block:

```tsx
{
  variant === "barcode_lock" && (
    <>
      <TouchableOpacity
        style={styles.btnPrimary}
        onPress={
          barcodeLockActions.primary.intent === "proceedToLabel"
            ? onProceedToLabel
            : onConfirm
        }
        accessibilityLabel={barcodeLockActions.primary.label}
        accessibilityRole="button"
      >
        <Text style={styles.btnPrimaryText}>
          {barcodeLockActions.primary.label}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.btnSecondary}
        onPress={
          barcodeLockActions.secondary.intent === "proceedToLabel"
            ? onProceedToLabel
            : onConfirm
        }
        accessibilityLabel={barcodeLockActions.secondary.label}
        accessibilityRole="button"
      >
        <Text style={styles.btnSecondaryText}>
          {barcodeLockActions.secondary.label}
        </Text>
      </TouchableOpacity>
    </>
  );
}
```

Both actions are now real buttons in every mode, so the old `styles.caption` line ("Point at the Nutrition Facts panel to continue") is removed — the coach hint already carries that guidance, and a caption is not a control.

**`barcode_lock` needs NO `screenReaderEnabled` branch — do not add one.** The `step2_review` and `step3_review` variants have one because they auto-advance on a ~1s timer, which VoiceOver's hear-then-locate-then-act loop cannot beat, so they fall back to explicit Confirm/Edit buttons. `barcode_lock` never auto-advanced and now presents two labelled `accessibilityRole="button"` controls unconditionally, so it is already the accessible form. Adding a branch would duplicate the layout for no behavioral difference.

Derive `barcodeLockActions` near the component's other derived values, before the return. The level lives on `ProductSummary`, so read it off the product — there is no phase-level field:

```tsx
const barcodeLockActions = getBarcodeLockActions(
  phase.type === "BARCODE_LOCKED"
    ? phase.product?.verificationLevel
    : undefined,
);
```

`phase.product` is itself optional (the chip renders before the fetch resolves), so `?.` is required — and the resulting `undefined` correctly resolves to the label-required branch.

Add `onProceedToLabel: () => void;` to the props interface and to the destructured parameter list, and add `getBarcodeLockActions` to the import from `./ProductChip-utils`.

- [ ] **Step 5: Wire the new callback in `ScanScreen`**

In `client/screens/ScanScreen.tsx`, on the `<ProductChip …>` element, add alongside the existing `onConfirm`:

```tsx
        onProceedToLabel={() => dispatch({ type: "PROCEED_TO_LABEL" })}
```

Leave `onConfirm` exactly as it is — it still dispatches `CONFIRM_PRODUCT`, now reached from whichever control the verification branch assigns it to.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run client/camera/components/__tests__/ProductChip-utils.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/camera/components/ProductChip-utils.ts \
        client/camera/components/ProductChip.tsx \
        client/screens/ScanScreen.tsx \
        client/camera/components/__tests__/ProductChip-utils.test.ts
git commit -m "fix(scan): make step 1's primary button advance instead of skip

\"Looks right →\" was wired to CONFIRM_PRODUCT, which ends the session, while the
caption below it and the coach hint both told the user to frame the nutrition
panel. The loudest control was the skip button and the happy path was an
unlabeled implicit gesture.

Now the primary action advances: \"Scan Nutrition Facts →\" when the database
record is unverified, \"Use verified data →\" when it is already verified. The
barcode-only escape hatch stays reachable as an explicit secondary button in
both branches. An unloaded verificationLevel resolves to the unverified branch
so a slow product fetch cannot let a user one-tap past the label step.

Also fixes the screen-reader announcement, which promised a detail view."
```

---

## Task 5: Stop discarding the captured photos — the D2 fix

`SESSION_COMPLETE` carries `nutritionImageUri`, `frontImageUri`, and `ocrText`, but `ScanScreen` navigates with only `{ barcode, ocrText }`. Both photographs the user deliberately took are dropped at the navigation boundary — which is the mechanical reason steps 2 and 3 feel pointless.

**Files:**

- Modify: `client/screens/scan-screen-utils.ts`
- Modify: `client/navigation/RootStackNavigator.tsx`
- Modify: `client/screens/ScanScreen.tsx`
- Test: `client/screens/__tests__/scan-screen-utils.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `buildNutritionDetailParams(phase): { barcode: string; ocrText?: string | null; nutritionImageUri?: string; frontImageUri?: string }`. Task 6 relies on `ocrText` keeping its three-valued shape.

- [ ] **Step 1: Write the failing tests**

Add to `client/screens/__tests__/scan-screen-utils.test.ts`:

```ts
describe("buildNutritionDetailParams", () => {
  // THE REGRESSION GUARD for the discarded-photos bug. The user photographed a
  // nutrition panel and a package front; both were dropped at the navigate.
  it("carries both captured photos through to NutritionDetail", () => {
    const params = buildNutritionDetailParams({
      type: "SESSION_COMPLETE",
      barcode: "06772408",
      nutritionImageUri: "file://panel.jpg",
      frontImageUri: "file://front.jpg",
      ocrText: "Calories 140",
    });

    expect(params).toEqual({
      barcode: "06772408",
      ocrText: "Calories 140",
      nutritionImageUri: "file://panel.jpg",
      frontImageUri: "file://front.jpg",
    });
  });

  it("preserves ocrText null — a captured but unreadable label", () => {
    const params = buildNutritionDetailParams({
      type: "SESSION_COMPLETE",
      barcode: "06772408",
      nutritionImageUri: "file://blurry.jpg",
      ocrText: null,
    });

    expect(params.ocrText).toBeNull();
    expect(params.nutritionImageUri).toBe("file://blurry.jpg");
    expect(params.frontImageUri).toBeUndefined();
  });

  // A barcode-only session never promised a label. ocrText must stay undefined
  // — distinct from null — or the detail screen will warn on the happy path.
  it("leaves ocrText undefined for a barcode-only session", () => {
    const params = buildNutritionDetailParams({
      type: "SESSION_COMPLETE",
      barcode: "06772408",
    });

    expect(params).toEqual({ barcode: "06772408" });
    expect("ocrText" in params).toBe(false);
  });
});
```

Add `buildNutritionDetailParams` to the import from `../scan-screen-utils`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/screens/__tests__/scan-screen-utils.test.ts`

Expected: FAIL — `buildNutritionDetailParams` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `client/screens/scan-screen-utils.ts`:

```ts
/**
 * Build the `NutritionDetail` route params from a completed scan session.
 *
 * Passes the WHOLE payload rather than cherry-picking fields. The previous
 * navigate sent only `{ barcode, ocrText }`, so the nutrition-panel and
 * package-front photos the user deliberately captured were discarded at the
 * navigation boundary — steps 2 and 3 produced artifacts nothing consumed.
 *
 * Keys are omitted rather than set to `undefined` so the three-valued `ocrText`
 * contract survives: absent = no label step ran, `null` = captured but
 * unreadable, string = readable.
 */
export function buildNutritionDetailParams(
  phase: Extract<ScanPhase, { type: "SESSION_COMPLETE" }>,
): {
  barcode: string;
  ocrText?: string | null;
  nutritionImageUri?: string;
  frontImageUri?: string;
} {
  const params: {
    barcode: string;
    ocrText?: string | null;
    nutritionImageUri?: string;
    frontImageUri?: string;
  } = { barcode: phase.barcode };

  if ("ocrText" in phase && phase.ocrText !== undefined) {
    params.ocrText = phase.ocrText;
  }
  if (phase.nutritionImageUri !== undefined) {
    params.nutritionImageUri = phase.nutritionImageUri;
  }
  if (phase.frontImageUri !== undefined) {
    params.frontImageUri = phase.frontImageUri;
  }
  return params;
}
```

Add `import type { ScanPhase } from "@/camera/types/scan-phase";` to `scan-screen-utils.ts` if not already present.

- [ ] **Step 4: Extend the route params**

In `client/navigation/RootStackNavigator.tsx`, extend the `NutritionDetail` entry in `RootStackParamList`:

```ts
  NutritionDetail: {
    barcode?: string;
    imageUri?: string;
    itemId?: number;
    // STEP2 nutrition-label OCR, for label-vs-DB override. Three-valued:
    // `undefined` = no label step ran, `null` = a label was photographed but
    // unreadable (surfaced to the user), string = recognised text.
    ocrText?: string | null;
    /** STEP2 capture — shown as evidence beside the values it produced. */
    nutritionImageUri?: string;
    /** STEP3 capture — package front, for product identity and the log thumbnail. */
    frontImageUri?: string;
  };
```

Copy the existing `barcode` / `imageUri` / `itemId` members verbatim from the file rather than retyping them from this plan; only the three commented members are additions.

- [ ] **Step 5: Use the helper in `ScanScreen`**

In `client/screens/ScanScreen.tsx`, in the `SESSION_COMPLETE` effect, replace the navigate call:

```tsx
const timer = setTimeout(() => {
  void refreshScanCount();
  navigation.navigate("NutritionDetail", buildNutritionDetailParams(scanPhase));
}, 700);
```

`scanPhase` is already narrowed to `SESSION_COMPLETE` by the guard at the top of that effect. Remove the now-obsolete inline `ocrText: "ocrText" in scanPhase ? … : undefined` expression and its comment. Add `buildNutritionDetailParams` to the existing `scan-screen-utils` import.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run client/screens/__tests__/scan-screen-utils.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/screens/scan-screen-utils.ts \
        client/navigation/RootStackNavigator.tsx \
        client/screens/ScanScreen.tsx \
        client/screens/__tests__/scan-screen-utils.test.ts
git commit -m "fix(scan): stop discarding the photos steps 2 and 3 capture

SESSION_COMPLETE carried nutritionImageUri and frontImageUri, but the navigate
to NutritionDetail sent only { barcode, ocrText } — so both photographs the user
deliberately took were dropped at the navigation boundary. That is the
mechanical reason steps 2 and 3 felt pointless: they produced artifacts nothing
downstream read.

Passes the whole session payload through one helper instead of cherry-picking
fields, with keys omitted rather than set to undefined so the three-valued
ocrText contract survives."
```

---

## Task 6: Block one-tap logging of an unusable label — the D3 fix

This is where the wrong-calorie harm actually stops. Since PR #734 an unparseable label at least announces itself via `labelReadNotice`, but the notice is advisory only — the wrong database number can still be logged in one tap.

**Scoping note:** Phase 1 delivers the _gate_ — logging requires an explicit second, informed action. The full inline editable macro form is Phase 2's `LogActionBar`, because it needs the extracted section components. The gate alone is what prevents the bad write.

**Files:**

- Modify: `client/screens/nutrition-detail-utils.ts`
- Modify: `client/hooks/useNutritionLookup.ts`
- Modify: `client/screens/NutritionDetailScreen.tsx`
- Test: `client/screens/__tests__/nutrition-detail-utils.test.ts`

**Interfaces:**

- Consumes: `ocrText`'s three-valued shape via route params (Task 5).
- Produces: `deriveLogGate({ ocrText, labelUsed }): LogGate` where

  ```ts
  type LogGate =
    | { kind: "open" }
    | { kind: "needsAcknowledgement"; buttonLabel: string };
  ```

  `useNutritionLookup` re-exports the result as `logGate`.

- [ ] **Step 1: Write the failing tests**

Add to `client/screens/__tests__/nutrition-detail-utils.test.ts`:

```ts
describe("deriveLogGate", () => {
  it("stays open when the label was read and used", () => {
    expect(deriveLogGate({ ocrText: "Calories 140", labelUsed: true })).toEqual(
      { kind: "open" },
    );
  });

  it("requires acknowledgement when a label was captured but unreadable", () => {
    expect(deriveLogGate({ ocrText: null, labelUsed: false })).toEqual({
      kind: "needsAcknowledgement",
      buttonLabel: "Review values before logging",
    });
  });

  it("requires acknowledgement when a label was read but the values were unusable", () => {
    expect(
      deriveLogGate({ ocrText: "Nutrition Facts", labelUsed: false }),
    ).toEqual({
      kind: "needsAcknowledgement",
      buttonLabel: "Review values before logging",
    });
  });

  // Load-bearing. A barcode-only session never promised to use a label, so
  // gating it would warn on the happy path and train the user to dismiss the
  // warning — which is exactly how the silent wrong-calorie path stayed
  // invisible. `undefined` means no label step ran.
  it("stays open for a barcode-only session", () => {
    expect(deriveLogGate({ ocrText: undefined, labelUsed: false })).toEqual({
      kind: "open",
    });
  });

  it("stays open for a barcode-only session even if labelUsed is somehow true", () => {
    expect(deriveLogGate({ ocrText: undefined, labelUsed: true })).toEqual({
      kind: "open",
    });
  });
});
```

Add `import { deriveLogGate } from "../nutrition-detail-utils";` to that file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/screens/__tests__/nutrition-detail-utils.test.ts`

Expected: FAIL — `deriveLogGate` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `client/screens/nutrition-detail-utils.ts`:

```ts
export type LogGate =
  | { kind: "open" }
  | { kind: "needsAcknowledgement"; buttonLabel: string };

/**
 * Whether the user may log this item in one tap.
 *
 * The label step exists for products whose database record is wrong, which is
 * exactly when a silent fallback does the most damage. When a photographed label
 * could not be used, the database value is still shown — but logging it now
 * takes a second, informed action instead of one tap.
 *
 * A barcode-only session (`ocrText === undefined`) is NEVER gated. It never
 * promised to use a label, and warning on the happy path would train the user to
 * dismiss the warning — the same dynamic that kept the wrong-calorie fallback
 * invisible in the first place.
 */
export function deriveLogGate(params: {
  ocrText: string | null | undefined;
  labelUsed: boolean;
}): LogGate {
  const { ocrText, labelUsed } = params;
  if (ocrText === undefined) return { kind: "open" };
  if (labelUsed) return { kind: "open" };
  return {
    kind: "needsAcknowledgement",
    buttonLabel: "Review values before logging",
  };
}
```

- [ ] **Step 4: Expose the gate from the hook**

In `client/hooks/useNutritionLookup.ts`:

Track whether the label was actually used. The existing lookup already computes `labelReady`; hoist that outcome into state so the render can read it. Add near the other `useState` declarations:

```ts
/**
 * True when a photographed label was parsed AND accepted by the readiness
 * gate, i.e. the values on screen came from the package rather than the
 * database. Drives `logGate`.
 */
const [labelUsed, setLabelUsed] = useState(false);
```

In the lookup effect, reset it alongside the other per-lookup resets (next to the existing `setLabelReadNotice(null)`):

```ts
setLabelUsed(false);
```

and set it where `labelReady` is computed, immediately after the existing `if (ocrText !== undefined && !labelReady) { … }` block:

```ts
setLabelUsed(labelReady);
```

Derive the gate and return it. Add before the `return {` block:

```ts
const logGate = deriveLogGate({ ocrText, labelUsed });
```

and add to the returned object:

```ts
    logGate,
```

Add `import { deriveLogGate } from "@/screens/nutrition-detail-utils";` — match the import style already used in that file for sibling helpers.

- [ ] **Step 5: Gate the button in `NutritionDetailScreen`**

In `client/screens/NutritionDetailScreen.tsx`, add `logGate` to the destructured `useNutritionLookup(...)` result. Add local acknowledgement state near the component's other `useState` calls:

```tsx
// Reset whenever the gate itself changes (a new lookup, a source toggle), so
// an acknowledgement can never carry over onto different numbers.
const [acknowledgedUnverified, setAcknowledgedUnverified] = useState(false);
useEffect(() => {
  setAcknowledgedUnverified(false);
}, [logGate.kind]);
```

Replace the `!itemId ? ( … )` log-button block with:

```tsx
{
  !itemId ? (
    <View style={styles.buttonContainer}>
      {logGate.kind === "needsAcknowledgement" && !acknowledgedUnverified ? (
        <Button
          onPress={() => setAcknowledgedUnverified(true)}
          accessibilityLabel={`${logGate.buttonLabel}. These values come from the product database, not the label you photographed.`}
          accessibilityHint="Confirms you have checked these values against the package"
          style={styles.addButton}
        >
          {logGate.buttonLabel}
        </Button>
      ) : (
        <Button
          onPress={handleAddToLog}
          loading={addToLogMutation.isPending}
          accessibilityLabel={offlineLabel(
            `Add ${nutrition?.productName || "item"} to today's food log`,
          )}
          accessibilityHint="Saves this item to your daily nutrition tracking"
          style={styles.addButton}
        >
          {offlineLabel("Add to Today")}
        </Button>
      )}
      {isOffline && (
        <ThemedText
          type="small"
          style={{
            color: theme.textSecondary,
            textAlign: "center",
            marginTop: Spacing.xs,
          }}
        >
          You&apos;re offline. This will sync when you reconnect.
        </ThemedText>
      )}
    </View>
  ) : null;
}
```

The gate works offline unchanged: it reads only `ocrText` and `labelUsed`, and the existing offline enqueue path is untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run client/screens/__tests__/nutrition-detail-utils.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/screens/nutrition-detail-utils.ts \
        client/hooks/useNutritionLookup.ts \
        client/screens/NutritionDetailScreen.tsx \
        client/screens/__tests__/nutrition-detail-utils.test.ts
git commit -m "fix(scan): block one-tap logging when a photographed label was unusable

PR #734 made the silent database fallback announce itself, but the notice is
advisory — the wrong value could still be logged in one tap. On a product whose
OpenFoodFacts record is wrong by ~3.8x, that is the actual harm.

Logging now takes a second informed action when a label was captured and could
not be used. A barcode-only session is never gated: it never promised to use a
label, and warning on the happy path would train the user to dismiss the
warning, which is how the silent fallback stayed invisible."
```

---

## Task 7: Land on Today after logging, not the camera — the D5 fix

`useNutritionLookup`'s add-to-log success handler calls `navigation.goBack()`. `NutritionDetail` was pushed from inside the scan `fullScreenModal` stack, so `goBack()` pops to `ScanScreen` — the live camera.

**Do NOT reach for `safeGoBack` here.** `ScanScreen`'s `returnAfterLog` path wraps its reset in `safeGoBack` correctly, because in _that_ mode `NutritionDetail` never opened and `ScanScreen` is the modal's top, so `goBack()` dismisses properly. From `NutritionDetail`, `canGoBack()` is true and `goBack()` is the bug. The reset must be unconditional.

**Files:**

- Modify: `client/hooks/useNutritionLookup.ts`
- Test: `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

The existing `useNutritionLookup.labelRead.test.tsx` already mocks `@react-navigation/native` with `mockGoBack`. Extend that mock to also expose `reset`, then assert on it. Change the hoisted mock block:

```ts
const { mockGoBack, mockReset, mockApiRequest } = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockReset: vi.fn(),
  mockApiRequest: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack, reset: mockReset }),
}));
```

Add a new describe block to the same file:

```ts
describe("useNutritionLookup — post-log navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          productName: "Cherry Coke",
          barcode: "06772408",
          per100g: { calories: 11.11 },
          perServing: { calories: 39.4 },
          servingInfo: {
            displayLabel: "355 mL",
            grams: 355,
            wasCorrected: false,
          },
          isServingDataTrusted: true,
        }),
      }),
    );
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // NutritionDetail is pushed from inside the scan fullScreenModal, so goBack()
  // pops to the live camera. Logging an item must land the user on Today.
  it("resets to Main/HomeTab after a successful log, never goBack", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "06772408" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.handleAddToLog();

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: "Main", params: { screen: "HomeTab" } }],
      }),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx`

Expected: FAIL — `mockReset` was never called; `mockGoBack` was.

- [ ] **Step 3: Replace the navigation call**

In `client/hooks/useNutritionLookup.ts`, in the add-to-log mutation's `onSuccess`, replace:

```ts
navigation.goBack();
```

with:

```ts
// NOT goBack(), and NOT safeGoBack(). NutritionDetail is pushed from
// inside the scan fullScreenModal, so canGoBack() is true and goBack()
// lands the user back on the live camera. (ScanScreen's returnAfterLog
// path CAN use safeGoBack because NutritionDetail never opened there, so
// ScanScreen is the modal's top.) Dismiss the whole stack onto Today.
navigation.reset({
  index: 0,
  routes: [{ name: "Main", params: { screen: "HomeTab" } }],
});
```

If TypeScript rejects the `reset` payload against the hook's `useNavigation()` generic, widen it the way `ScanScreen.tsx` does for its own three `navigation.reset({ index: 0, routes: [{ name: "Main" }] })` calls — copy that file's typing approach rather than casting to `any`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx`

Expected: PASS, including the pre-existing label-read tests in that file.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useNutritionLookup.ts \
        client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx
git commit -m "fix(scan): land on Today after logging, not back in the camera

NutritionDetail is pushed from inside the scan fullScreenModal, so goBack() pops
to ScanScreen — the live camera. Tapping \"Add to Today\" appeared to do nothing
but return you to the scanner.

Resets onto Main/HomeTab unconditionally. Deliberately NOT safeGoBack: that
helper is correct in ScanScreen's returnAfterLog path, where NutritionDetail
never opened and ScanScreen is the modal's top, but from NutritionDetail its
canGoBack() branch reproduces the exact bug."
```

---

## Task 8: Delete the dead "Help verify this product" CTA — the D4 fix

`NutritionDetailScreen` renders a CTA navigating to `Scan` with `mode: "label"` — asking for the nutrition-label photo that step 2 of the main flow already collects. It predates the three-step flow.

Phase 2 replaces it with a `VerificationPanel` showing real state. Phase 1 removes the misleading control. Per the project's minimal-changes rule, removing UI means removing the rendering only — leave the `mode: "label"` route param and its handling in `ScanScreen` intact, since the retroactive front-label CTA below still uses the same mechanism.

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx`
- Test: `client/screens/__tests__/NutritionDetailScreen.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `client/screens/__tests__/NutritionDetailScreen.test.tsx`, inside the existing describe block:

```tsx
it("does not render the obsolete Help verify this product CTA", () => {
  const { queryByText } = renderComponent(<NutritionDetailScreen />);
  expect(queryByText("Help verify this product")).toBeNull();
});
```

Match the existing file's rendering helper and mock setup exactly — read the top of that test file and reuse its established pattern for providing route params and the mocked `useNutritionLookup`. Do not introduce `@testing-library/react-native` directly; this project uses `renderComponent` from `test/utils/render-component`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`

Expected: FAIL — the text is found, because the CTA still renders.

- [ ] **Step 3: Remove the CTA**

In `client/screens/NutritionDetailScreen.tsx`, delete the entire `verificationLevel !== "verified" && ( … )` `Pressable` block containing "Help verify this product" and "Scan the nutrition label to confirm data".

Keep everything else in `styles.verificationSection`: the `<VerificationBadge level={verificationLevel} />` and the retroactive front-label CTA (`verificationLevel !== "unverified" && !hasFrontLabelData`) both stay.

If `styles.verifyPrompt` is still referenced by the surviving front-label CTA, leave the style. If TypeScript or lint reports any import or style as now-unused, remove it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx \
        client/screens/__tests__/NutritionDetailScreen.test.tsx
git commit -m "fix(scan): remove the obsolete Help verify this product CTA

It navigated to Scan with mode: \"label\" — asking the user for the nutrition
label photo that step 2 of the main flow already collects. A leftover from
before the three-step flow existed.

Rendering only, per the minimal-changes rule: the mode: \"label\" route param and
its ScanScreen handling stay, because the retroactive front-label CTA below uses
the same mechanism. Phase 2 replaces this slot with a VerificationPanel showing
real verification state."
```

---

## Phase 1 wrap-up

- [ ] **Push and open the PR**

```bash
git push -u origin <branch>
```

`preflight:fast` runs on push and writes the HEAD pass-stamp that gates PR creation. Then open the PR against `main`.

The PR description must state which acceptance checks are **device-only and unverified**, because none of Phase 1's behavior is provable in the simulator's camera:

- Step 1's two-button layout on a real barcode lock, in both the verified and unverified branches.
- That the primary button now advances to the label capture rather than ending the session.
- That a completed 3-step session reaches `NutritionDetail` with both photos present.
- That an unusable label produces the two-step log gate, and that a barcode-only scan does **not**.
- That logging lands on Today.

Do NOT arm auto-merge. This touches the scan flow while three of PR #729's device acceptance criteria remain unverified.

---

## Not in Phase 1

**Phase 2 — result screen** gets its own plan after Phase 1 lands, because it depends on Phase 1's route-param contract being real rather than planned. It covers: extracting `ProductHero`, `NutritionFactsPanel`, `FlagSections`, `VerificationPanel`, and `LogActionBar` from the 1058-line `NutritionDetailScreen`; the front-label identity proposal from `frontImageUri`; showing `nutritionImageUri` as evidence; and the full inline macro editor behind Task 6's gate.

**The visual redesign cannot be planned to this fidelity yet.** "The overall design of the Nutrition Facts screen is poor" is a design problem, and the spec names components without specifying what the screen should look like. The _extraction_ is mechanical and plannable; deciding the new layout, hierarchy, and typography needs a design pass first — the `frontend-design` skill, or the existing Claude Design project (DesignSync projectId `6c1a1ebf…`, whose CSS mirrors `theme.ts` tokens). Attempting to specify it in a plan would produce invented styling nobody approved.

**Parser widening** is a separate bounded work item, gated on the device OCR capture from branch `wip/device-probe`. The prior is that `servingSize` is the failing conjunct: `SERVING_SIZE_PATTERN` needs the literal string "serving size", and the bilingual `SERVING_PER_PATTERN` fallback needs a g/ml token, so a canned-drink label reading "Serving Size 1 can" fails both. Task 6's gate is correct regardless of which conjunct fails, because it keys on the gate's outcome rather than its cause.
