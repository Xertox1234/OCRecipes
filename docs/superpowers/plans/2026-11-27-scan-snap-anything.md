# Snap Anything Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revive the auto-sorting camera as a "Snap anything" + menu item. One photo is classified, a found-style card says what it is, and Continue opens the matching screen. A barcode always ends in the three-step barcode flow.

**Architecture:**

- `Scan { mode: "smart" }` is a third kind of generic one-photo flow. Its shutter takes the existing `captureSmart` path: `SMART_PHOTO_INITIATED`, then `CLASSIFYING`, then `SMART_CONFIRMED` or `SMART_ERROR`.
- The ProductChip smart cards are restyled to match the barcode found card.
- `resolveSmartConfirmAction` gains a barcode hand-off. It replaces the screen with the barcode flow, which takes the number through the keypad's `MANUAL_BARCODE_ENTERED` path.

**Tech Stack:** Expo SDK 58 / React Native, Reanimated 4, React Navigation native stack, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-27-scan-snap-anything-design.md` (mockup `docs/superpowers/specs/2026-11-27-scan-snap-anything-mockups/snap-anything.html`)

## Global Constraints

- Every + menu item keeps opening its own screen. "Snap anything" is added, never a replacement.
- Nothing moves on without a tap: no auto-advance on the result card.
- No live barcode detection in `mode: "smart"`.
- Copy, verbatim:
  - Item: "Snap anything", subtitle "We'll work out what it is"
  - Title pill: "Snap anything"
  - Hint: "A meal, a label, a menu or a receipt — fit it in the frame"
  - Busy card: "Working out what this is…"
  - Unclear card: "Couldn't tell what this is", with **Retake** and "Pick it myself"
  - Barcode cards: "Looks like a barcode ✓" (number read) and "Looks like a barcode", sub-line "Couldn't read the number. Let's scan it live" (unreadable)
  - Buttons: "Not this" / "Continue →"
- Barcode hand-offs use `navigation.replace`, never `navigate`.
- Every `ScanPhase` switch stays exhaustive. No phase or action is added or removed.
- Colours come from `client/constants/theme.ts` only. Motion comes from existing `client/constants/animations.ts` configs and `getFoundCardActionBeats`. Reduced motion uses fade only.
- Accessibility:
  - Every card's appearance is announced through `announceTogether`, card content first.
  - Touch targets are 44 pt or more.
  - Labels never include the visible "✓".
- The `pickedIntent` path (PhotoIntent → Scan) is unchanged. An unknown `mode` keeps today's fallback.
- `lockedBarcode` is in-app only: dropped from deep links, as `intent` is.

## Review Focus

1. **The same screen refocuses** after a hand-off (back from the label screen): `lockedBarcode` must not re-lock. Test: Task 4 "consumes lockedBarcode once".
2. **The classifier says `has_barcode` but returns junk** ("12", letters, a 9-digit number): it must count as unreadable, so the hand-off goes to the live camera. It must never become a lookup of a bad number. Test: Task 2 "invalid barcode digits hand off as unreadable".
3. **A premium-locked type** (menu, ingredients, receipt): Continue still shows the upgrade card. The barcode hand-off is never gated. Test: Task 2 "barcode hand-off ignores premium gates" and the existing gate tests stay green.
4. **Continue tapped twice fast, or the user leaves mid-confirm:** there must be no double navigation, and nothing must happen after leaving. Test: Task 4 "double Continue navigates once".
5. **`non_food`, or a missing content type:** `non_food` shows the unclear card at once, without waiting for a Continue tap. A missing type stays "Looks like food ✓" → PhotoAnalysis log. Test: Task 2 "non_food is unclear".

---

### Task 1: Route, flow view and shutter for `mode: "smart"`

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx` (Scan params)
- Modify: `client/navigation/linking.ts` (Scan `parse`)
- Modify: `client/screens/scan-screen-utils.ts` (`getGenericFlowView`, `CaptureMode`, `huntingCaptures`)
- Modify: `client/screens/ScanScreen.tsx` (`captureMode` gains `isSmartMode`)
- Test: `client/screens/__tests__/scan-screen-utils.test.ts`

**Interfaces:**

- Produces:
  - `Scan` params: `mode?: "label" | "front-label" | "smart"` and `lockedBarcode?: string`. Document `lockedBarcode` as in-app only, validated by ScanScreen.
  - `CaptureMode.isSmartMode?: boolean`.
  - `getGenericFlowView({ mode: "smart" })` returns `{ title: "Snap anything", frame: "photo", hint: "A meal, a label, a menu or a receipt — fit it in the frame", tabs: [], showShutter: true, showSkip: false, exampleKey: null }`.
  - `getScanFlow({ mode: "smart" })` returns `"generic"`.
  - `getScanFlow({ lockedBarcode: "…" })` returns `"barcode"`.

- [ ] **Step 1: Write failing tests** in `scan-screen-utils.test.ts`:
  - `getScanFlow({ mode: "smart" })` is `"generic"`.
  - `getScanFlow({ lockedBarcode: "0064144043512" })` is `"barcode"`.
  - `getGenericFlowView({ mode: "smart" })` equals the object above.
  - `getCapturePlan({ type: "HUNTING" }, { isSmartMode: true })` is `{ capture: true, runStepOcr: false, route: "smart" }`.
  - `getCapturePlan({ type: "HUNTING" }, {})` keeps `capture: false` (barcode step 1 is unchanged).
- [ ] **Step 2: Run them to see them fail:** `npx vitest run client/screens/__tests__/scan-screen-utils.test.ts`. Expect failures on the new cases.
- [ ] **Step 3: Implement.**
  - `getScanFlow`'s `knownMode` accepts `"smart"`.
  - `getGenericFlowView` gets a `"smart"` branch before the intent fallback.
  - `huntingCaptures` returns true for `isSmartMode`.
  - In ScanScreen, `isSmartMode = route.params?.mode === "smart"` feeds `captureMode`, and is added to the `useMemo` deps.
  - In `linking.ts`, Scan's `parse` adds `lockedBarcode: () => undefined`. Update its comment to name it.
- [ ] **Step 4: Run the tests to see them pass.** Same command; expect PASS.
- [ ] **Step 5: Commit** with `feat(scan): Scan mode "smart" opens the one-photo snap-anything camera`.

### Task 2: Result copy and the barcode hand-off decision

**Files:**

- Modify: `client/screens/scan-screen-utils.ts` (`SmartConfirmAction`, `resolveSmartConfirmAction`)
- Modify: `client/camera/components/ProductChip-utils.ts` (new `getSmartResultCopy`)
- Test: `client/screens/__tests__/scan-screen-utils.test.ts`, `client/camera/components/__tests__/ProductChip-utils.test.ts`

**Interfaces:**

- Consumes: `normalizeTypedBarcode(raw: string): string | null` from `client/camera/shell/manual-barcode-utils.ts`.
- Produces:
  - `SmartConfirmAction` gains `| { kind: "barcodeHandoff"; barcode: string | null }`.
  - `resolveSmartConfirmAction` returns it when `classification.contentType === "has_barcode"`. That check runs before the premium gate and the OCR await. `barcode` is `normalizeTypedBarcode(classification.barcode ?? "")`.
  - `getSmartResultCopy(classification: Pick<PhotoAnalysisResponse, "contentType" | "barcode">): { kind: "found" | "unclear"; title: string; sub: string }`. Copy per `contentType`:
    - `prepared_meal`: "Looks like a meal ✓" / "We'll estimate what's on the plate"
    - `nutrition_label`: "Looks like a nutrition label ✓" / "We'll read the panel for you"
    - `restaurant_menu`: "Looks like a menu ✓" / "We'll pull out the dishes for you"
    - `raw_ingredients`: "Looks like ingredients ✓" / "We'll start a Cook & Track session"
    - `grocery_receipt` and `restaurant_receipt`: "Looks like a receipt ✓" / "You'll snap it in the receipt camera"
    - `has_barcode` with a valid number: "Looks like a barcode ✓", with the number as the sub-line
    - `has_barcode` without one: "Looks like a barcode" / "Couldn't read the number. Let's scan it live"
    - `non_food`: kind `"unclear"`, "Couldn't tell what this is" / "Try again, or pick what you're scanning"
    - missing `contentType`: "Looks like food ✓" / "We'll estimate what's on the plate"

- [ ] **Step 1: Write failing tests.**
  - `resolveSmartConfirmAction`:
    - "barcode hand-off carries a valid number": `{ contentType: "has_barcode", barcode: "0064144043512" }` gives `{ kind: "barcodeHandoff", barcode: "0064144043512" }`, and `recognizeText` is not called.
    - "invalid barcode digits hand off as unreadable": barcode values `"12"`, `"abc"`, `"123456789"` and `undefined` each give `barcode: null`.
    - "barcode hand-off ignores premium gates": with every premium feature false, it still returns `barcodeHandoff`.
  - `getSmartResultCopy`: one assertion per row of the copy list above, plus "non_food is unclear" (`kind: "unclear"`).
- [ ] **Step 2: Run both files to see them fail:** `npx vitest run client/screens/__tests__/scan-screen-utils.test.ts client/camera/components/__tests__/ProductChip-utils.test.ts`.
- [ ] **Step 3: Implement both functions.**
  - Leave `getRouteForContentType`'s `has_barcode` arm in place: it is now unreachable from the confirm path but still part of the exhaustive switch.
  - Fix `ScanScreen.tsx`'s `action.kind` switch so it compiles. Add a `case "barcodeHandoff"` that does nothing yet, commented "wired in Task 4".
- [ ] **Step 4: Run the same command to see it pass.**
- [ ] **Step 5: Commit** with `feat(scan): smart result copy and the barcode hand-off decision`.

### Task 3: Restyled busy, result and unclear cards

**Files:**

- Modify: `client/camera/components/ProductChip-utils.ts` (`ProductChipVariant` adds `"classifying"`; `getProductChipVariant` maps `CLASSIFYING` to it; `getChipAnnounceText`)
- Modify: `client/camera/components/ProductChip.tsx`
- Test: `client/camera/components/__tests__/ProductChip-utils.test.ts`, `client/camera/components/__tests__/ProductChip.test.tsx`, `client/camera/components/__tests__/ProductChip.a11y.test.tsx`

**Interfaces:**

- Consumes: `getSmartResultCopy` (Task 2) and `getFoundCardActionBeats` (existing).
- Produces: ProductChip props `onSmartPhotoConfirm` (Continue, existing), `onRetry` (Not this / Retake, existing), and a new optional `onPickItMyself?: () => void`.

- [ ] **Step 1: Write failing tests.**
  - Utils:
    - `getProductChipVariant({ type: "CLASSIFYING", … })` is `"classifying"`.
    - `getChipAnnounceText("classifying", …)` is `"Working out what this is…"`.
    - The smart_photo announce is the copy's `title` without "✓", followed by `sub`.
    - The smart_error announce is `"Couldn't tell what this is"`.
  - Render:
    - `CLASSIFYING` shows "Working out what this is…" and no buttons.
    - A menu result shows "Looks like a menu ✓" with buttons labelled "Not this" and "Continue". The spoken label has no "✓" or "→".
    - Not this calls `onRetry`, and Continue calls `onSmartPhotoConfirm`.
    - A `non_food` result shows the unclear layout: Retake calls `onRetry`, and "Pick it myself" calls `onPickItMyself`.
    - `SMART_ERROR` shows the same unclear layout.
    - While `isSmartConfirming`, Continue is busy and disabled (`accessibilityState`), as today.
  - A11y test: every new button is 44 pt or more tall.
- [ ] **Step 2: Run the three files to see them fail:** `npx vitest run client/camera/components/__tests__/ProductChip`.
- [ ] **Step 3: Implement.**
  - Replace the `smart_photo` and `smart_error` render blocks with the found-card layout: `foundRow` with a thumbnail of `phase.imageUri`, then `cardTitle` / `cardSub`, then `ChipButton` ghost "Not this" plus accent "Continue →" inside the `actionRowStyle` row.
  - The unclear layout uses accent "Retake" plus link "Pick it myself" in `actionLinkStyle`.
  - Add a `classifying` block: an `ActivityIndicator` (`CameraColors` / theme token, not `SPINNER_COLOR`'s black) and the busy title.
  - Start the action beats for `smart_photo` and `smart_error` as for `barcode_lock`. Widen the effect's `variant === "barcode_lock"` check to those three variants.
  - Remove the confidence label from the card (the spec's card has none). Keep `getChipConfidenceLabel` / `getChipConfidenceColor` exported, because they are unused but recorded: owner rule, do not delete.
- [ ] **Step 4: Run the same command to see it pass.**
- [ ] **Step 5: Commit** with `feat(scan): snap-anything busy, result and unclear cards in the found-card style`.

### Task 4: ScanScreen wiring (hold, hand-offs, pick it myself)

**Files:**

- Modify: `client/screens/ScanScreen.tsx`
- Test: `client/screens/__tests__/ScanScreen.test.tsx` (or `ScanScreen.guided.test.tsx`, wherever the smart-confirm tests live; follow that file's mocks)

**Interfaces:**

- Consumes: the `barcodeHandoff` action (Task 2), ProductChip's `onPickItMyself` (Task 3), and the existing `onManualBarcode`, `releaseTempUri` and `rearmScan`.

- [ ] **Step 1: Write failing tests** (render ScanScreen as the existing smart-confirm tests do):
  - "hands a read barcode to the barcode flow": a `has_barcode` classification with `"0064144043512"`, then Continue, calls `navigation.replace("Scan", { lockedBarcode: "0064144043512" })`.
  - "hands an unreadable barcode to the live camera": Continue calls `navigation.replace("Scan", undefined)`.
  - "locks a lockedBarcode on arrival": rendering with `lockedBarcode: "0064144043512"` and focus dispatches `MANUAL_BARCODE_ENTERED` with that barcode and fetches the product.
  - "consumes lockedBarcode once": blur then refocus does not dispatch it again.
  - "ignores an invalid lockedBarcode": `"12"` dispatches nothing.
  - "pick it myself carries the photo": it calls `navigation.replace("PhotoIntent", { imageUri })` and releases the temp URI, so it is not deleted.
  - "double Continue navigates once".
  - "holds the feed while classifying": `CameraShell` receives `feedHeld` true in `CLASSIFYING`, `SMART_CONFIRMED` and `SMART_ERROR`. It still receives true in `BARCODE_LOCKED`.
  - "no live barcode scanning in snap anything": `CameraView` gets an empty `barcodeTypes` for `mode: "smart"`.
- [ ] **Step 2: Run the file to see it fail:** `npx vitest run client/screens/__tests__/ScanScreen.test.tsx`.
- [ ] **Step 3: Implement.**
  - `case "barcodeHandoff"`: `navigation.replace("Scan", action.barcode ? { lockedBarcode: action.barcode } : undefined)`. The temp photo stays tracked, so the blur cleanup deletes it.
  - Arrival: a `consumedLockedBarcodeRef` holds the number. In the focus effect, after `CAMERA_READY`, if `normalizeTypedBarcode(route.params?.lockedBarcode ?? "")` is set and differs from the ref, record it in the ref and call `onManualBarcode` with it.
  - `onPickItMyself`: read `imageUri` from `scanPhaseRef` (`SMART_CONFIRMED` or `SMART_ERROR`), call `releaseTempUri(imageUri)`, then `navigation.replace("PhotoIntent", { imageUri })`.
  - `feedHeld` covers `BARCODE_LOCKED | CLASSIFYING | SMART_CONFIRMED | SMART_ERROR`.
  - Pass `onPickItMyself` to `ProductChip`.
- [ ] **Step 4: Run the same command to see it pass.**
- [ ] **Step 5: Commit** with `feat(scan): snap anything hands barcodes to the three-step flow; pick it myself keeps the photo`.

### Task 5: The + menu: Snap anything, and Scan Menu opens the menu camera

**Files:**

- Modify: `client/components/home/action-config.ts`
- Test: `client/components/home/__tests__/action-config.test.ts`, plus any test asserting the scanning group's length or order (`grep -rn "scan-barcode" client --include=*.test.*`)
- Archive: `todos/P3-2026-11-26-smart-scan-auto-classify-unused.md` to `todos/archive/`. Set `status: done`, tick both criteria, and in Updates say "revived as Snap anything (spec 2026-11-27); removal not done".

**Interfaces:**

- Produces: `HOME_ACTIONS` entry `{ id: "snap-anything", group: "scanning", icon: "aperture", label: "Snap anything", subtitle: "We'll work out what it is" }`, first in the scanning group.

- [ ] **Step 1: Write failing tests:**
  - `snap-anything` navigates to `Scan` with `{ mode: "smart" }`.
  - `scan-menu` navigates to `Scan` with `{ intent: "menu" }`.
  - `HOME_ACTIONS.filter(a => a.group === "scanning")[0].id` is `"snap-anything"`.
  - Every scanning action other than `snap-anything` keeps its existing destination (one assertion each; this is the owner's condition).
- [ ] **Step 2: Run to see it fail:** `npx vitest run client/components/home/__tests__/action-config.test.ts`.
- [ ] **Step 3: Implement** the entry and the two `navigateAction` arms.
- [ ] **Step 4: Run the same command to see it pass,** then run any other suite found by the grep above.
- [ ] **Step 5: Commit** with `feat(home): Snap anything in the + menu; Scan Menu opens the menu camera`, together with the todo archive.

## Not covered by this plan

- Device or simulator check: the simulator has no camera. That waits on the owner's phone check, with an OTA only on the owner's ask.
- Example cards or tips for this camera, and the photo library button (both stage 2).
