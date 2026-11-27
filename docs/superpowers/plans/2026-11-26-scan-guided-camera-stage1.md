# Guided Scan Camera — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Project CLAUDE.md governs process weight and review policy where they differ.)

**Goal:** Ship the shared guided camera shell and the guided 3-step barcode flow. This includes example cards, step tabs, the found card, typing a barcode, the "?" help sheet and the one-time tips carousel. Generic camera buttons move to the Photo Food Log route.

**Architecture:** `ScanScreen` keeps its `scanPhase` reducer. The reducer is _extended_ (skip, rescan, redo, typed barcode, resume-on-same-barcode). A pure view-model function maps `(phase, flow)` to what the shell shows: the tab states, frame shape, hint, whether there's a shutter, and whether the tabs can be tapped. Presentational components under `client/camera/shell/` render that view. `ProductChip`'s barcode-lock and step-review variants are restyled into the found / captured cards. Example-card counts and the carousel flag live in the existing `client/lib/feature-tips-storage.ts`.

**Tech Stack:** Expo SDK 58 / React Native, Reanimated 4, `react-native-svg` 15.16 (example art), `@gorhom/bottom-sheet` 5 (help sheet), `expo-haptics` via `useHaptics`, Vitest + `@testing-library/react` (jsdom), AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-11-26-scan-guided-camera-design.md`. Mockups: `docs/superpowers/specs/2026-11-26-scan-guided-camera-mockups/step-tabs-v2.html` and `tips.html`.

**Stages:** Stage 1 is this plan.

- Stage 2 (its own plan, written after this merges): the label / photo / menu example cards and frames, the photo-library button, the direct `Scan {intent:"menu"}` route, and the new "Photo: more options" + item.
- Stage 3: receipt and batch.

**Deviation from the spec's staging, for the owner:** the generic camera callers move to `Scan {intent:"log"}` in **stage 1**, not stage 2. Stage 1 removes the shutter from plain `Scan`, and without the move, those buttons could no longer take a photo. Until stage 2, they get a generic single-step look: a title pill, the big frame and the shutter, with no example card.

## Global Constraints

- Every color comes from `client/constants/theme.ts`: `CameraColors`, and `accentSolid` / `successSolid` for fills. A new token is added there with a one-line intent. The only hardcoded hex values allowed are the existing worklet ones (`CONFIDENCE_COLORS`, `DONE_COLOR`), each with a `// hardcoded —` reason.
- Animations use `client/constants/animations.ts` configs, as in the spec's motion-plan table. A new spring comes from crafting-ui `scripts/springs.mjs` with `mass` written.
- Touch targets are ≥ 44pt. Every control has an `accessibilityLabel` and a role. Live-region and announcement behavior per `getScanOverlayA11y` and the existing `StepPill` announcements are carried over.
- Reduced motion is followed live through `useAccessibility()` (`reducedMotion`). It drops travel and scale and keeps the color and state changes.
- Copy, verbatim from the spec and mockups: "Barcode found ✓", "Not this", "Next: nutrition →", "Label captured ✓", "Front captured ✓", "Retake", "Skip", "Got it", "Show the example again →", "Tips for every scan", "Get the best scan", "Scan now", "New product: earlier photos cleared", "We don't know this one yet. The label and front photos will fill it in", "It scans by itself", "Line the barcode up inside the frame", "Fit the whole panel in the frame", "Fit the front of the package in the frame".
- The step tabs read **Barcode · Nutrition · Front**, and Front carries the sub-label "optional". `returnAfterLog` shows the Barcode tab only.
- Example cards show for the first **3** scans of a flow, then only through "?". The tips carousel shows **once ever**, before the first scan.
- Photo-step auto-advance takes **1500 ms**. A screen reader disables it, as today.
- TDD per CLAUDE.md: a failing test first, and only that file runs (`npx vitest run <file>`). Do not run the full suite, `check:types` or `lint` ad hoc.
- Exhaustive `switch` over `ScanPhase["type"]` with **no `default`**, matching the file convention, so a new phase is a `tsc` error.
- No edits to `ios/` / `android/` (Expo CNG). This ships as an OTA, which the owner publishes on request.

## Review Focus

1. **Redo the barcode, then scan a different product:** the carried nutrition photo is deleted (temp file discarded), the notice shows, and no photo of product A reaches `NutritionDetail` for product B. Covered by Task 1 (`resume dropped on different barcode`) and Task 8 (`discards carried photo and toasts on a different barcode`).
2. **A slow product lookup lands after "Not this", or after typing a different number:** a `PRODUCT_LOADED` for the old barcode must not attach to the new lock. The existing barcode-match guard must still hold through RESCAN and MANUAL_BARCODE_ENTERED. Covered by Task 1.
3. **A screen-reader user on the found card and the captured card:** no auto-advance; every button is reachable and labelled; tab state changes are announced ("Barcode step complete"). Covered by Task 3 and Task 5.
4. **Typed barcode input that is non-numeric, too short or too long:** the submit stays disabled and nothing is dispatched. Valid lengths are 8, 12, 13 and 14 digits (EAN-8, UPC-A, EAN-13, GTIN-14). Covered by Task 7.
5. **Storage not yet loaded at the first scan** (`isFeatureTipsReady()` false): the carousel and example cards must not flash, then vanish, or show twice. Treat the counts as unknown and decide once ready. Covered by Task 2.

---

### Task 1: Extend the scan-phase reducer

**Files:**

- Modify: `client/camera/types/scan-phase.ts` (the phase union and `ScanAction`)
- Modify: `client/camera/reducers/scan-phase-reducer.ts`
- Modify: `client/camera/hooks/useAutoAdvanceTimer.ts` (`AUTO_ADVANCE_MS` 1000 → 1500)
- Test: `client/camera/reducers/__tests__/scan-phase-reducer.test.ts`

**Interfaces:**

- Produces, as type changes:
  - `STEP2_CONFIRMED.nutritionImageUri` and `STEP3_REVIEWING.nutritionImageUri` become optional (`?: string`), and `ocrText` becomes `?: string | null` on both. Absent means the nutrition step was skipped. This keeps `SESSION_COMPLETE`'s three-valued `ocrText` contract.
  - `HUNTING` and `BARCODE_TRACKING` gain `resume?: ResumablePhase`.
  - Export `type ResumablePhase = Extract<ScanPhase, { type: "LABEL_PROMPTED" | "STEP2_CONFIRMED" }>`.
  - Export `const MANUAL_ENTRY_BOUNDS = { x: 0.5, y: 0.5, width: 0, height: 0 }`.
- Produces, as new `ScanAction`s:
  - `{ type: "SKIP_STEP" }`
  - `{ type: "RESCAN" }`
  - `{ type: "REDO_STEP"; step: "barcode" | "nutrition" }`
  - `{ type: "MANUAL_BARCODE_ENTERED"; barcode: string }`

- [ ] **Step 1: Write the failing tests** in `scan-phase-reducer.test.ts`:
  - `SKIP_STEP from LABEL_PROMPTED → STEP2_CONFIRMED with no nutritionImageUri and no ocrText key`
  - `SKIP_STEP from STEP2_CONFIRMED → SESSION_COMPLETE carrying any nutrition photo` (and, from a skipped-nutrition STEP2_CONFIRMED, `SESSION_COMPLETE` has neither `nutritionImageUri` nor `ocrText`)
  - `STEP_PHOTO_CAPTURED from a skipped-nutrition STEP2_CONFIRMED → STEP3_REVIEWING without nutritionImageUri`
  - `RESCAN from BARCODE_LOCKED → HUNTING`; `RESCAN is ignored in every other phase`
  - `REDO_STEP barcode from LABEL_PROMPTED → HUNTING with resume = that LABEL_PROMPTED`
  - `REDO_STEP barcode from STEP2_CONFIRMED → HUNTING with resume = that STEP2_CONFIRMED`
  - `REDO_STEP nutrition from STEP2_CONFIRMED → LABEL_PROMPTED (barcode and product kept)`
  - `REDO_STEP is ignored in BARCODE_LOCKED, STEP2_REVIEWING, STEP3_REVIEWING and SESSION_COMPLETE` (the tabs are tappable only in live-camera phases)
  - `resume survives FIRST_BARCODE_DETECTED, BARCODE_UPDATED and BARCODE_LOST`
  - `BARCODE_LOCKED with resume of the same barcode → returns the resume phase unchanged`
  - `BARCODE_LOCKED with resume of a different barcode → plain BARCODE_LOCKED (resume dropped)`
  - `CAMERA_READY and RESET drop resume`
  - `MANUAL_BARCODE_ENTERED from HUNTING → BARCODE_LOCKED { barcode, bounds: MANUAL_ENTRY_BOUNDS }`, and it obeys `resume` the same way BARCODE_LOCKED does (same barcode → resume phase)
  - `MANUAL_BARCODE_ENTERED is ignored outside HUNTING / BARCODE_TRACKING`
  - `PRODUCT_LOADED for the pre-RESCAN barcode does not attach after MANUAL_BARCODE_ENTERED of a different barcode` (Review Focus 2)

- [ ] **Step 2: Run `npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts`.** Expected: the new tests FAIL (unknown action types / missing fields).

- [ ] **Step 3: Implement the type changes and the reducer branches.** `BARCODE_LOCKED` and `MANUAL_BARCODE_ENTERED` share one private helper, `lockOrResume(barcode, bounds, resume)`. Update `useAutoAdvanceTimer` to 1500 ms. Fix every `tsc` fallout from the optional `nutritionImageUri` in `ScanScreen.tsx` / `scan-screen-utils.ts` (`buildNutritionDetailParams` already omits absent keys; keep it that way). The `RETAKE_STEP` from `STEP3_REVIEWING` copies `nutritionImageUri` / `ocrText` only when present.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): reducer grows skip, rescan, redo and typed-barcode steps`.

---

### Task 2: Example-card counts and the carousel flag in feature-tips storage

**Files:**

- Modify: `client/lib/feature-tips-storage.ts`
- Test: `client/lib/__tests__/feature-tips-storage.test.ts`

**Interfaces:**

- Produces:
  - `TipId` gains `"scan-tips-carousel"`.
  - `TipState` gains `exampleViews: Record<string, number>`. When loading an older saved blob, a missing key reads as `{}`.
  - `export function getExampleViewCount(key: ScanExampleKey): number`
  - `export async function incrementExampleViewCount(key: ScanExampleKey): Promise<number>`
  - `export type ScanExampleKey = "barcode" | "barcode-nutrition" | "barcode-front"`. Stage 2 adds keys here.
  - `export const EXAMPLE_CARD_SHOWS = 3`
  - `export function shouldShowExampleCard(key: ScanExampleKey): boolean | null` returns `null` while `!isFeatureTipsReady()`.

- [ ] **Step 1: Write the failing tests:**
  - `getExampleViewCount is 0 for an unseen key`
  - `incrementExampleViewCount persists and returns the new count`
  - `shouldShowExampleCard is true for counts 0–2 and false at 3`
  - `shouldShowExampleCard is null before the cache is ready` (Review Focus 5)
  - `an old saved blob without exampleViews loads with {}`
  - `clearFeatureTipsState resets exampleViews`
  - `a second account on the same phone does not inherit exampleViews` (the existing owner rule)

- [ ] **Step 2: Run `npx vitest run client/lib/__tests__/feature-tips-storage.test.ts`.** Expected: FAIL.

- [ ] **Step 3: Implement** inside the existing cache/persist pattern. No new AsyncStorage key.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): remember how often each scan example card was seen`.

---

### Task 3: The barcode-flow view model and frame shapes

**Files:**

- Create: `client/camera/shell/barcode-flow.ts`
- Modify: `client/camera/components/ScanReticle-utils.ts` (frame shapes)
- Test: `client/camera/shell/__tests__/barcode-flow.test.ts`, `client/camera/components/__tests__/ScanReticle-utils.test.ts`

**Interfaces:**

- Produces in `ScanReticle-utils.ts`:
  - `export type FrameShape = "barcode" | "label" | "front" | "photo"`
  - `export const FRAME_SIZES: Record<FrameShape, { width: number; height: number }>`
    - `barcode` = the existing `BARCODE_RETICLE` (260×160)
    - `label` = the existing `LABEL_RETICLE` (200×270)
    - `front` = 240×260
    - `photo` = 280×300
  - `getReticleTarget(phase, w, h, shape?: FrameShape)` centers on `FRAME_SIZES[shape]` when `shape` is given. `BARCODE_TRACKING` still follows the bounds.
- Produces in `barcode-flow.ts`:
  - `export type StepTabState = "upcoming" | "active" | "done"`
  - `export interface StepTabView { id: "barcode" | "nutrition" | "front"; label: string; sublabel?: string; state: StepTabState; tappable: boolean }`
  - `export interface FlowView { tabs: StepTabView[]; frame: FrameShape; hint: string; showShutter: boolean; showSkip: boolean; exampleKey: ScanExampleKey | null }`
  - `export function getBarcodeFlowView(phase: ScanPhase, opts: { returnAfterLog: boolean }): FlowView`
  - `export function getPhotosDiscardedByLock(prev: ScanPhase, next: ScanPhase): string[]` returns the URIs to delete when a lock dropped a `resume`: prev is HUNTING / BARCODE_TRACKING with `resume`, next is a plain `BARCODE_LOCKED` of a different barcode.

- [ ] **Step 1: Write the failing tests** in `barcode-flow.test.ts`. Each assertion uses the copy and values from Global Constraints:
  - `HUNTING → barcode tab active, frame "barcode", hint "Line the barcode up inside the frame", showShutter false, showSkip false, exampleKey "barcode"`
  - `LABEL_PROMPTED → barcode done + tappable, nutrition active, frame "label", hint "Fit the whole panel in the frame", showShutter true, showSkip true, exampleKey "barcode-nutrition"`
  - `STEP2_CONFIRMED → barcode and nutrition done + tappable, front active with sublabel "optional", frame "front", showSkip true, exampleKey "barcode-front"`
  - `STEP2_CONFIRMED with skipped nutrition → nutrition tab state "upcoming" and tappable true` (a skipped step isn't ✓, but the user can go back and take it)
  - `BARCODE_LOCKED, STEP2_REVIEWING and STEP3_REVIEWING → no tab is tappable`
  - `returnAfterLog → tabs has only the barcode tab, in every phase`
  - `SESSION_COMPLETE → every tab done, none tappable`
  - `getPhotosDiscardedByLock returns the resume nutrition URI for a different barcode, [] for the same barcode, [] without resume`

  In `ScanReticle-utils.test.ts`, add `getReticleTarget with shape "front" centers a 240×260 target`.

- [ ] **Step 2: Run both test files.** Expected: FAIL.

- [ ] **Step 3: Implement.** Exhaustive switches with no default. Smart-scan phases map to the generic single-step view: frame "photo", shutter true, no tabs. They are unreachable from the barcode flow but must compile.

- [ ] **Step 4: Run both test files.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): barcode-flow view model and step-shaped frames`.

---

### Task 4: Step tabs component (replaces StepPill)

**Files:**

- Create: `client/camera/shell/StepTabs.tsx`
- Delete: `client/camera/components/StepPill.tsx`, `StepPill-utils.ts` and its test. They are superseded: their announcements move here. List this in the PR body.
- Modify: `client/camera/index.ts` (exports)
- Test: `client/camera/shell/__tests__/StepTabs.test.tsx`

**Interfaces:**

- Consumes: `StepTabView[]` (Task 3)
- Produces: `export function StepTabs(props: { tabs: StepTabView[]; onRedo: (id: "barcode" | "nutrition") => void }): JSX.Element`

- [ ] **Step 1: Write the failing tests:**
  - `renders one tab per StepTabView with its label and sublabel`
  - `active tab has accessibilityState { selected: true }`
  - `done tab label reads "Barcode, done"`
  - `tapping a tappable done tab calls onRedo with its id`
  - `a non-tappable tab is accessibilityState disabled and its press does nothing`
  - `each tab's min height ≥ 44`
  - `announces "<label> step complete" when a tab turns done` (carried over from StepPill). Mock `AccessibilityInfo.announceForAccessibility` and assert it fires on iOS.

- [ ] **Step 2: Run `npx vitest run client/camera/shell/__tests__/StepTabs.test.tsx`.** Expected: FAIL.

- [ ] **Step 3: Implement** with `PressableScale`.
  - Active fill: `accentSolid`. Done text and icon: the herb green. Muted: `CameraColors` overlay.
  - The ✓ pops with `stepCheckSpringConfig`; reduced motion changes the color only.
  - Press dims the tab (it doesn't scale), and a redo gives `haptics.selection()`.
  - Feather icons: `maximize` (barcode), `file-text` (nutrition), `package` (front).
  - Follow `interaction-feel` and `expo-animation`.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): step tabs show and redo barcode-flow steps`.

---

### Task 5: Example card, example art, and restyled found / captured cards

**Files:**

- Create: `client/camera/shell/ExampleCard.tsx`
- Create: `client/camera/shell/example-art.tsx`. It holds three SVG components, `BarcodeExampleArt`, `NutritionLabelExampleArt` and `PackageFrontExampleArt`, drawn in house in the theme palette. The nutrition art shows a readable Nutrition Facts panel, like the mockup.
- Modify: `client/camera/components/ProductChip.tsx` and `ProductChip-utils.ts`. Restyle `barcode_lock`, `step2_review` and `step3_review`.
- Test: `client/camera/shell/__tests__/ExampleCard.test.tsx`, plus the existing `ProductChip.test.tsx`, `ProductChip.a11y.test.tsx` and `ProductChip-utils.test.ts`

**Interfaces:**

- Produces:
  - `export function ExampleCard(props: { exampleKey: ScanExampleKey; onDismiss: () => void }): JSX.Element`. The title, body and art per key come from a `const EXAMPLE_CONTENT: Record<ScanExampleKey, { title: string; body: string; Art: ComponentType }>` in the same file:
    - `barcode`: "Scan the barcode" / "Line it up inside the frame. It scans by itself. No tap needed."
    - `barcode-nutrition`: "Photo the nutrition label" / "We check the numbers against the real package, so your log is accurate."
    - `barcode-front`: "Photo the front (optional)" / "Helps with the name, brand and size when the barcode isn't in our database."
  - `ProductChip` gains the prop `onRescan: () => void`.
  - The `barcode_lock` variant renders:
    - the title "Barcode found ✓", then the product name and brand (a skeleton line while `product` is undefined), then `ScanFlagBadge` when `product.topFlag` is set;
    - the buttons **[Not this]** (→ `onRescan`) and **[primary]**;
    - **secondary** as a text link.

    Primary and secondary come from the existing `getBarcodeLockActions(verificationLevel)`, which keeps the verified fast path. Inside the new look, the unverified primary label becomes "Next: nutrition →".

  - Not-in-database (the lookup returned no product): the body reads "We don't know this one yet. The label and front photos will fill it in", and the primary is "Next: nutrition →".
  - `step2_review` / `step3_review` render "Label captured ✓" / "Front captured ✓" with **Retake**. Explicit Confirm appears only when a screen reader is on, as today.

- [ ] **Step 1: Write the failing tests:**
  - ExampleCard: `renders the title and body for each ScanExampleKey`; `"Got it" calls onDismiss`; `"Got it" min height ≥ 44 and role button`.
  - ProductChip:
    - `barcode_lock shows "Barcode found ✓" and the product name`
    - `barcode_lock with product undefined shows a skeleton and no name text`
    - `"Not this" calls onRescan`
    - `unverified primary reads "Next: nutrition →"`
    - `verified primary still reads "Use verified data →"`
    - `topFlag renders ScanFlagBadge`
    - `step2_review shows "Label captured ✓" and Retake`
    - `step3_review shows "Front captured ✓"`
  - Update any existing assertion on the old copy to the new copy, and say so in the commit body.

- [ ] **Step 2: Run the four test files.** Expected: the new assertions FAIL.

- [ ] **Step 3: Implement.**
  - The card enters with `bannerEntrySpring` plus `overshootClamping: true`; reduced motion fades it only.
  - The example card fades in over a dim (`contentRevealTimingConfig`).
  - Keep the a11y focus trap and the announce strings (`getChipAnnounceText`), updated to the new copy.
  - Apply `crafting-ui` part 2 (concept → controls) and `interaction-feel`.

- [ ] **Step 4: Run the four test files.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): example cards and a found card that names what it caught`.

---

### Task 6: "?" help sheet and the one-time tips carousel

**Files:**

- Create: `client/camera/shell/HelpSheet.tsx`, `client/camera/shell/TipsCarousel.tsx`
- Test: `client/camera/shell/__tests__/HelpSheet.test.tsx`, `client/camera/shell/__tests__/TipsCarousel.test.tsx`

**Interfaces:**

- Produces:
  - `export function HelpSheet(props: { visible: boolean; stepTitle: string; stepHint: string; showTypeNumberTip: boolean; onShowExample: () => void; onClose: () => void }): JSX.Element` is built on `@gorhom/bottom-sheet`. It has:
    - the step title and hint;
    - "Show the example again →";
    - "Tips for every scan": "Hold still for a moment", "Use plenty of light, or tap ⚡", "Fill the frame, nothing cut off", and "Barcode won't read? Type the number" only when `showTypeNumberTip`.
  - `export function TipsCarousel(props: { onDone: () => void }): JSX.Element`. It's a light-theme screen (`useTheme()`), with 3 pages and dots, Next, and "Scan now" on the last page. Page 1 is "Get the best scan" with the three general tips. Pages 2–3 cover "Barcodes scan by themselves" and "Labels and fronts need a tap". The builder writes the wording in the spec's tone.

- [ ] **Step 1: Write the failing tests:**
  - HelpSheet: `shows step title and hint`; `"Show the example again →" calls onShowExample`; `type-number tip only when showTypeNumberTip`.
  - TipsCarousel: `Next advances the page and the last page shows "Scan now"`; `"Scan now" calls onDone`; `page dots expose "Page 1 of 3"`.

- [ ] **Step 2: Run both test files.** Expected: FAIL.

- [ ] **Step 3: Implement.** The sheet uses a no-bounce spring and can be dragged closed. The carousel pages follow gesture velocity (a physics spring with `mass` written), and reduced motion crossfades them.

- [ ] **Step 4: Run both test files.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): help sheet and first-scan tips carousel`.

---

### Task 7: Type-the-number sheet

**Files:**

- Create: `client/camera/shell/ManualBarcodeSheet.tsx`, `client/camera/shell/manual-barcode-utils.ts`
- Test: `client/camera/shell/__tests__/manual-barcode-utils.test.ts`, `client/camera/shell/__tests__/ManualBarcodeSheet.test.tsx`

**Interfaces:**

- Produces:
  - `export function normalizeTypedBarcode(raw: string): string | null` strips spaces and dashes, and returns the digits only when the length is 8, 12, 13 or 14. Otherwise it returns `null`.
  - `export function ManualBarcodeSheet(props: { visible: boolean; onSubmit: (barcode: string) => void; onClose: () => void }): JSX.Element` has a numeric keyboard and a submit button that stays disabled until the input normalizes.

- [ ] **Step 1: Write the failing tests:**
  - `normalizeTypedBarcode("0 32601 03105 3") → "032601031053"`
  - `rejects letters → null`
  - `rejects 7 and 15 digits → null`
  - `accepts 8, 12, 13 and 14`
  - Sheet: `submit disabled for "123"`; `submit calls onSubmit with normalized digits`; `field visible with keyboard up` (the input is not covered: use a keyboard-avoiding container).

- [ ] **Step 2: Run both test files.** Expected: FAIL.

- [ ] **Step 3: Implement** using the project's text field component (`FocusField`) per `interaction-feel`.

- [ ] **Step 4: Run both test files.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): type a barcode when it won't scan`.

---

### Task 8: CameraShell and the ScanScreen wiring

**Files:**

- Create: `client/camera/shell/CameraShell.tsx`. It's the layout only: top bar (✕ · title pill or nothing · ?), the frame slot, the hint line, the tabs slot, and the controls row (left · shutter or spacer · right).
- Modify: `client/screens/ScanScreen.tsx`, `client/screens/scan-screen-utils.ts`
- Test: `client/screens/__tests__/scan-screen-utils.test.ts`, and a new `client/screens/__tests__/ScanScreen.guided.test.tsx` (reuse the mocks from the existing `ScanScreen.test.tsx`)

**Interfaces:**

- Consumes everything from Tasks 1–7.
- Produces:
  - `getCapturePlan`'s `CaptureMode` gains `hasIntent?: boolean`. `HUNTING` with no `isLabelMode`, `isFrontLabelMode` or `hasIntent` returns `{ capture: false, … }`: the barcode flow's step 1 has no shutter.
  - `getShutterBlockedReason("HUNTING")` in the barcode flow is "Scanning the barcode automatically. No photo needed." It gets the mode too (a signature change: `getShutterBlockedReason(phase, mode?)`).
  - `export function getScanFlow(params: RootStackParamList["Scan"]): "barcode" | "generic"`. The result is `"barcode"` when there is no `mode` and no `intent` (with or without `returnAfterLog` / `verifyBarcode`), and `"generic"` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `scan-screen-utils.test.ts`:
    - `getCapturePlan HUNTING without mode or intent → capture false`
    - `getCapturePlan HUNTING with hasIntent → capture true, route smart`
    - `getShutterBlockedReason matches getCapturePlan for every phase × {barcode flow, intent}` (extend the existing parity test)
    - `getScanFlow` for each param shape
  - `ScanScreen.guided.test.tsx`, with the camera mocked the way existing ScanScreen tests do:
    - `first-ever scan shows TipsCarousel before the example card`
    - `"Scan now" then shows the barcode ExampleCard`
    - `"Got it" increments the barcode example count`
    - `4th scan shows no example card`
    - `"?" opens HelpSheet; "Show the example again →" shows the card`
    - `typed barcode dispatches MANUAL_BARCODE_ENTERED and fetches the product`
    - `"Not this" returns to scanning and the next sighting can lock` (the `hasLockedRef` reset)
    - `discards carried photo and toasts on a different barcode` (Review Focus 1): mock `discardTempUri` and the toast, assert both
    - `Skip on the Front step navigates to NutritionDetail`
    - `returnAfterLog shows only the Barcode tab`

- [ ] **Step 2: Run both test files.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `ScanScreen` renders `CameraShell` with:
    - `StepTabs` from `getBarcodeFlowView`;
    - `ScanReticle` with `shape = view.frame`;
    - `CoachHint` fed `view.hint`, keeping its 5 s / 10 s escalation and adding "Type the number" at 15 s;
    - the shutter only when `view.showShutter`;
    - the keypad on the right in step 1, and Skip on the right in steps 2–3.
  - Gate the carousel, then the example card, on `hasSeenTip("scan-tips-carousel")` / `shouldShowExampleCard`. Wait while they return `null`. Increment the count on "Got it".
  - Run `getPhotosDiscardedByLock` on every phase change: discard the returned URIs and show the toast "New product: earlier photos cleared".
  - Keep the existing focus-trap, announcement, quota-pill and `returnAfterLog` paths.
  - Move `ScanScreen` toward the existing `react-hooks` and React-Compiler rules noted in the file, and don't add new bailouts.

- [ ] **Step 4: Run both test files.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): guided barcode flow in the shared camera shell`.

---

### Task 9: Generic camera callers → Photo Food Log, and the record of the retired smart path

**Files:**

- Modify:
  - `client/components/home/action-config.ts` (`photo-food-log` → `navigate("Scan", { intent: "log" })`)
  - `client/screens/QuickLogScreen.tsx`
  - `client/screens/ChatScreen.tsx`
  - `client/hooks/useCameraTeachingToast.ts`
  - `client/hooks/useHistoryData.ts`

  Each one moves `navigate("Scan")` → `navigate("Scan", { intent: "log" })`.

- Keep unchanged:
  - `scan-barcode` (plain `Scan`, the barcode flow)
  - `QuickLogDrawer`'s `returnAfterLog`
  - NutritionDetail / LabelAnalysis `mode` / `verifyBarcode` callers
  - CoachChat's validated params
- Create: `todos/P3-2026-11-26-smart-scan-auto-classify-unused.md` per `todos/README.md`. It lists the phases, the reducer actions and the ProductChip variants (`CLASSIFYING`, `SMART_CONFIRMED`, `SMART_ERROR`, `SMART_PHOTO_INITIATED`, `smart_photo`, `smart_error`, plus `resolveSmartConfirmAction`) as unreachable, with the note: record, don't delete, per the owner's rule.
- Test: `client/components/home/__tests__/action-config.test.ts` and `client/hooks/__tests__/useCameraTeachingToast.test.ts`, updated.

- [ ] **Step 1: Write the failing tests:**
  - `photo-food-log navigates to Scan with { intent: "log" }`
  - `scan-barcode navigates to Scan with no params`
  - `camera teaching toast "Try it" opens Scan { intent: "log" }`

  Then grep every `navigate("Scan"` (LSP references on the `Scan` route first) and list each caller in the PR body as one of: moved to `intent:"log"`, kept as barcode, or kept with params.

- [ ] **Step 2: Run the test files.** Expected: FAIL.

- [ ] **Step 3: Implement** the call-site changes. `ScanScreen` with `intent:"log"` already routes the captured photo to the intent destination. Confirm that in `getPhotoIntentDestination` / the `"smart"` capture route with an intent present, and the generic look (title pill "Photo food log", `photo` frame, shutter) comes from `getScanFlow === "generic"`.

- [ ] **Step 4: Run the test files.** Expected: PASS.

- [ ] **Step 5: Commit** with `feat(scan): camera buttons that mean "take a photo" open Photo Food Log`.

---

### Task 10: Look at it, then stop (crafting-ui, verify-ui, review)

**Files:** none new. Fixes go back into the files of the task that owns them.

- [ ] **Step 1:** Run `verify-ui` in the iOS simulator on:
  - the TipsCarousel (light and dark);
  - each ExampleCard;
  - the HelpSheet;
  - the ManualBarcodeSheet with the keyboard up;
  - StepTabs in each state (use a deep link and a mocked phase if the camera blocks it);
  - an iPhone SE-size device;
  - large text at `MAX_FONT_SCALE_CONSTRAINED`.

  Expected: no clipped text, no overlap, and targets ≥ 44pt.

- [ ] **Step 2:** Run crafting-ui's look pass. Record the simulator across carousel → card → Got it → sheet, then run `node <crafting-ui>/scripts/frames.mjs video <recording>` and critique with `references/critique.md` (at most 2 rounds). A blank frame or text over text in the found moment blocks done.

- [ ] **Step 3:** Write the owner's device checklist into the PR body: live barcode lock → found card, typed number, Not this, redo barcode (same and different product), skip nutrition then front, auto-advance at 1.5 s, VoiceOver pass. The sim has no camera.

- [ ] **Step 4:** Do the review pass with `mobile-reviewer` (the roster per `docs/AI_WORKFLOW.md` → Review Policy). Because this PR is large and from the main session, also run `/code-review medium` per the trial (memory: code-review trial). Then do one confirmation pass after in-place fixes, and `/codify`.

- [ ] **Step 5:** `npm run preflight:fast`, push, open the PR with the device checklist, and follow `land` for the merge. An OTA goes out only when the owner asks.
