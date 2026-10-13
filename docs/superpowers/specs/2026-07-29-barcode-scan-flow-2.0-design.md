# Barcode Scan Flow 2.0 — Design

**Date:** 2026-07-29
**Status:** Approved design, not yet planned
**Base:** `main` @ `97936b05` (after #729 VisionCamera 5.1.1 + MLKit 9, and #734 unreadable-label surfacing)

## Summary

The barcode scan flow presents a three-step sequence (barcode → nutrition label →
front of package) that users do not complete, produces artifacts nothing consumes,
shows database calorie values that contradict the label the user just
photographed, ends on a screen with a dead call-to-action, and returns the user to
the camera after they log an item.

Each complaint traces to a specific boundary defect. None of them is a broken
component in isolation, which is why CI is green: every unit is correct and the
contracts _between_ units are wrong. Unit tests structurally cannot catch this
class of defect, and the fix is therefore mostly about contracts, not internals.

This design fixes all five, and restructures `NutritionDetailScreen` enough that
the visual redesign is a structural change rather than a restyle bolted onto a
1058-line file.

## The five defects, with located causes

### D1 — "All three steps are not being followed"

`client/camera/components/ProductChip.tsx` renders step 1's primary
call-to-action as **"Looks right →"**, wired to `onConfirm` →
`dispatch({ type: "CONFIRM_PRODUCT" })`. From `BARCODE_LOCKED` the reducer sends
that straight to `SESSION_COMPLETE`
(`client/camera/reducers/scan-phase-reducer.ts`), ending the session. The route to
step 2 exists only as caption text beneath it: _"Point at the Nutrition Facts
panel to continue."_

**The loudest control on the screen is the skip button, and the intended happy
path is an unlabeled implicit gesture.** This is an affordance inversion, not a
state-machine bug.

`useAutoAdvanceTimer` is **not** implicated. It fires only from
`STEP2_REVIEWING` (→ `STEP_CONFIRMED`) and `STEP3_REVIEWING` (→
`CONFIRM_PRODUCT`), i.e. only after the user has already captured a photo. It
never skips a step.

### D2 — Both step photos are discarded

`SESSION_COMPLETE` carries `nutritionImageUri`, `frontImageUri`, and `ocrText`.
`client/screens/ScanScreen.tsx` navigates to `NutritionDetail` with only
`{ barcode, ocrText }`. Both photographs the user deliberately took are dropped at
the navigation boundary.

This is the mechanical reason steps 2 and 3 _feel_ pointless: they produce
artifacts that nothing downstream reads.

### D3 — Wrong calories despite a photographed label

`client/hooks/useNutritionLookup.ts` gates the label override on a three-way
conjunction:

```
calories != null
  && (totalSugars != null || totalFat != null)
  && servingSize != null
```

Any single failure silently falls back to the product-database value. Since #734
that fallback at least announces itself via `labelReadNotice` — but the notice is
**advisory only** and does not prevent the wrong number from being logged.

Which conjunct fails in practice is unresolved; see Open Items.

### D4 — Dead "Help verify this product" call-to-action

`client/screens/NutritionDetailScreen.tsx` renders a CTA navigating to `Scan` with
`mode: "label"` — asking the user for the nutrition-label photo that step 2 of the
main flow already collects. It is a leftover from a pre-three-step flow.

### D5 — "Add to Today" returns to the camera

`client/hooks/useNutritionLookup.ts` calls `navigation.goBack()` in the
add-to-log mutation's `onSuccess`. `NutritionDetail` was pushed from inside the
scan `fullScreenModal` stack, so `goBack()` pops back to `ScanScreen` — the live
camera — rather than dismissing the modal and landing on Today.

## Decisions

Settled with the user before this design was written. Not open for
re-litigation during implementation.

1. **The label step is smart-required.** When the database already holds verified
   data for the barcode, offer a fast path. When it is unverified or missing, the
   label step is required to continue, with no skip in the primary position.
2. **An unparseable label shows the database value but blocks one-tap logging.**
   Not the current advisory-notice-only behavior, and not refusing to show a
   number at all.
3. **Step 3 is for product identity** — brand, product name, net weight — via the
   existing front-label pipeline. Not merely a log thumbnail.
4. **The Today page redesign is out of scope.** This work ends at successfully
   landing on Today.
5. **Approach: fix in place plus extract the result screen.** No new
   `ScanSession` model; the reducer is extended additively, never restructured.

## Non-goals

- The `client/camera/` capture path — `CameraView`, the frame processors, barcode
  tracking, focus/zoom. The VisionCamera 5.1.1 + MLKit 9 work landed in #729 and
  three of its acceptance criteria remain device-unverified. Do not touch it.
- The three-valued `ocrText: string | null | undefined` contract from #734.
  `undefined` = no label step ran, `null` = captured but unreadable, string =
  readable. Collapsing any of these re-introduces D3's silent path.
- The Today page's own layout and content.
- The `returnAfterLog` confirm-card path in `ScanScreen`, which bypasses
  `NutritionDetail` entirely and is unaffected by this work.
- Replacing the OCR engine or the barcode scanner.

## Architecture

### The mechanical constraint on step 1

There is currently **no "advance to step 2" action**. Taking a photo while in
`BARCODE_LOCKED` _is_ the advance. A primary button therefore cannot advance the
step — the user must physically reposition the camera over the nutrition panel
first. The button's honest job is to acknowledge the product and hand control back
to the camera with clear coaching.

That requires one additive phase:

```
                    ┌── PROCEED_TO_LABEL ──▶ LABEL_PROMPTED ──capture──▶ STEP2_REVIEWING
BARCODE_LOCKED ─────┤                        (chip collapsed, reticle
                    │                         armed, coach: "Frame the
                    │                         Nutrition Facts panel")
                    └── CONFIRM_PRODUCT ───▶ SESSION_COMPLETE
                        (barcode-only; now reached from the
                         SECONDARY control, not the primary)
```

`CONFIRM_PRODUCT` from `BARCODE_LOCKED` keeps its current behavior byte for byte.
It simply stops being wired to the primary button. Every existing transition is
unchanged; the reducer gains one `case`, and the four phase-driven `-utils`
switches each gain one branch.

### Step 1 chip becomes verification-aware

`GET /api/nutrition/barcode/:barcode` already returns `verificationLevel`
(`server/routes/nutrition.ts:154`), and `ScanScreen`'s `fetchProductInfo` already
calls that exact endpoint. **No server change is required.**

The client-side plumbing is three edits, and "no server work" should not be read as
"no work" — `fetchProductInfo` currently discards the field:

1. `client/camera/types/scan-phase.ts` — add `verificationLevel?: VerificationLevel`
   to `ProductSummary`.
2. `client/screens/ScanScreen.tsx` — `fetchProductInfo` builds its `PRODUCT_LOADED`
   payload from `{ name, brand, imageUri, safetyFlag, topFlag }` and **does not read
   `data.verificationLevel`** today. Add it. No new action is needed —
   `PRODUCT_LOADED` already carries the whole `ProductSummary`.
3. `ProductChip` / `ProductChip-utils.ts` — branch the primary/secondary pair on it.

**The chip renders before the product arrives.** `PRODUCT_LOADED` applies only from
`BARCODE_LOCKED`, and `ProductChip`'s own doc comment notes the product name can
arrive _after_ the chip is shown. So `verificationLevel` is legitimately `undefined`
during that window, and the chip must handle it rather than assume presence.

**While verification is unknown, show the unverified branch**
(`Scan Nutrition Facts →` as primary). That fails toward capturing the label, which
is the safe direction: offering `Use verified data →` before the verification state
has loaded would let a user one-tap past the label step on a product whose data is
actually unverified — reintroducing D3 through a race.

| Database state        | Primary action                                | Secondary action                              |
| --------------------- | --------------------------------------------- | --------------------------------------------- |
| verified data exists  | `Use verified data →` (`CONFIRM_PRODUCT`)     | Photograph label instead (`PROCEED_TO_LABEL`) |
| unverified or missing | `Scan Nutrition Facts →` (`PROCEED_TO_LABEL`) | Use database data anyway (`CONFIRM_PRODUCT`)  |

The secondary control must remain genuinely reachable in both rows. A user may be
offline, holding a damaged or missing label, or navigating by screen reader.
Removing the barcode-only escape hatch would be a regression, not a fix.

When a screen reader is active, both controls are explicit buttons — this already
matches how `ProductChip` handles `step2_review`, which falls back from
auto-advance to explicit Confirm/Edit buttons under `screenReaderEnabled`.

### Data flow: the whole session payload crosses the boundary

`ScanScreen`'s `SESSION_COMPLETE` effect passes the **entire payload** rather
than cherry-picking two fields:

```
SESSION_COMPLETE { barcode, nutritionImageUri?, frontImageUri?, ocrText? }
        │
        ▼
NutritionDetail route params  ← extended in RootStackParamList
        │
        ├─ ocrText ─────────▶ label-vs-database override (existing)
        ├─ nutritionImageUri ▶ shown as evidence beside the values
        └─ frontImageUri ────▶ front-label identity analysis + log thumbnail
```

Fixing D2 at the cause rather than adding two more ad-hoc params is why this is a
payload pass-through, not two new fields.

### Step 3 without the Edit detour

`FrontLabelConfirmScreen` already self-heals when launched with `sessionId: null`:
it runs the AI upload in the background and populates its own extraction (see its
`useEffect` guarded on `route.params.sessionId !== null`). The pipeline is not
broken — it is merely **unreachable from the happy path**, because the only
navigation into it is `onEditStep3`, the Edit button inside step 3's ~1s
auto-advance window.

On `SESSION_COMPLETE` with a `frontImageUri` present, the result screen fires the
same background analysis and surfaces brand / product name / net weight as a
**correction proposal** when it disagrees with the database name. Confirmation
persists through the existing `confirmFrontLabel` path.

This matters beyond cosmetics: `server/storage/verification.ts` persists
`frontLabelData` and computes a composite verification score
(`count + frontLabelCount * 0.5`), and `server/routes/public-api.ts` exposes
`frontLabel` (PII-stripped) through the Verified Product API. A front-label
capture feeds the sellable product database, and the happy path currently skips
it.

### Where the wrong-calorie harm actually stops

A derived `logGate` on the result screen, with three states:

| Situation                   | `ocrText`                          | Behavior                                                                                                                                              |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label parsed and used       | string, gate passed                | Log normally, one tap                                                                                                                                 |
| Label captured but unusable | `null`, or string failing the gate | Button becomes `Review values before logging`; opens inline editable macros prefilled from the database. Logging unlocks only after explicit confirm. |
| Barcode-only session        | `undefined`                        | Log normally, one tap                                                                                                                                 |

The third row is deliberate and load-bearing. Gating the barcode-only path would
warn on the happy path and train users to dismiss the warning — which is exactly
how D3 became invisible in the first place. #734's `labelReadNotice` already
encodes this same distinction and must stay aligned with it.

The gate must function offline. Database values are already available on the
offline path via the existing enqueue mechanism, so the inline editor operates on
cached values without a network round trip.

## Components

### Changed

| File                                                                 | Change                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/camera/types/scan-phase.ts`                                  | Add `LABEL_PROMPTED` phase and `PROCEED_TO_LABEL` action. Add `verificationLevel?: VerificationLevel` to `ProductSummary` (optional — see the load-race note above).                                                                                         |
| `client/camera/reducers/scan-phase-reducer.ts`                       | One new `case` for `PROCEED_TO_LABEL`; accept a capture from `LABEL_PROMPTED` into `STEP2_REVIEWING`. No existing transition altered.                                                                                                                        |
| `client/camera/components/ProductChip.tsx`                           | `barcode_lock` variant gains the two-action layout above, branching on `verificationLevel`. Relabel so the primary always advances.                                                                                                                          |
| `client/camera/components/ProductChip-utils.ts`                      | Variant for `LABEL_PROMPTED`; helper deriving which primary/secondary pair to show.                                                                                                                                                                          |
| `client/camera/components/CoachHint-utils.ts`                        | Copy for `LABEL_PROMPTED` ("Frame the Nutrition Facts panel").                                                                                                                                                                                               |
| `client/camera/components/ScanReticle-utils.ts`, `StepPill-utils.ts` | One branch each for the new phase.                                                                                                                                                                                                                           |
| `client/screens/ScanScreen.tsx`                                      | Pass the whole `SESSION_COMPLETE` payload on navigate. Add `verificationLevel` to `fetchProductInfo`'s `PRODUCT_LOADED` payload (currently dropped). Wire the new primary/secondary actions. Remove the now-redundant `onEditStep3` empty-extraction detour. |
| `client/navigation/RootStackNavigator.tsx`                           | `NutritionDetail` params gain `nutritionImageUri?`, `frontImageUri?`.                                                                                                                                                                                        |
| `client/hooks/useNutritionLookup.ts`                                 | Replace `goBack()` with `navigation.reset({ index: 0, routes: [{ name: "Main", params: { screen: "HomeTab" } }] })`. Expose `logGate` derived state.                                                                                                         |
| `client/screens/NutritionDetailScreen.tsx`                           | Reduced to composition (~250 lines). Dead "Help verify this product" CTA removed.                                                                                                                                                                            |

### New

| File                                                  | Purpose                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client/components/nutrition/ProductHero.tsx`         | Product image (front photo when available), name, brand, serving context.                                                   |
| `client/components/nutrition/NutritionFactsPanel.tsx` | Redesigned macro presentation, plus the captured label photo as evidence.                                                   |
| `client/components/nutrition/FlagSections.tsx`        | "For you" allergen and "Heads up" universal flag groups, moved wholesale — no logic change.                                 |
| `client/components/nutrition/VerificationPanel.tsx`   | Replaces D4's dead CTA with real state: what is verified, what is missing, and an action that is not a duplicate of step 2. |
| `client/components/nutrition/LogActionBar.tsx`        | The `logGate`-aware log control and the inline macro editor.                                                                |
| `client/components/nutrition/*-utils.ts`              | Pure helpers for the above, per the established `*-utils.ts` convention so Vitest can cover them directly.                  |

Flag partitioning logic (`partitionScanFlags`, `pickTopFlag`,
`toRecipeAllergenA11ySuffix`) moves **without modification**. This repo has
already been bitten twice by duplicated flag composition desyncing across display
surfaces; the extraction must relocate call sites, never fork the logic.

## Error handling

| Failure                                          | Behavior                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| OCR throws                                       | Existing `logger.error` plus `labelReadNotice`. Session proceeds; step-2 photo is still captured. |
| OCR returns nothing usable                       | `ocrText: null` → `logGate` blocks one-tap logging.                                               |
| Front-label AI analysis fails                    | Non-fatal. The identity section is simply absent. Logging is unaffected.                          |
| Offline                                          | Existing enqueue path. The `logGate` and inline editor operate on cached database values.         |
| Barcode not found                                | Existing manual-search fallback, unchanged.                                                       |
| Front-label proposal conflicts with the database | Presented as a proposal requiring confirmation, never auto-applied.                               |

## Testing

Written test-first, per the project's TDD requirement.

**Reducer** — `PROCEED_TO_LABEL` from `BARCODE_LOCKED`; capture from
`LABEL_PROMPTED` → `STEP2_REVIEWING`; `CONFIRM_PRODUCT` from `BARCODE_LOCKED`
still reaches `SESSION_COMPLETE` unchanged (regression guard on the preserved
escape hatch); `ocrText` normalization unchanged across the new path.

**Route payload** — a regression test asserting the navigate payload carries
`nutritionImageUri` and `frontImageUri`. This is the direct guard on D2 and must
fail against the current code.

**`ProductChip-utils`** — variant for the new phase; the verified vs. unverified
primary/secondary pairing; screen-reader mode yields explicit buttons.

**`logGate`** — all three rows of the table above, explicitly including that a
barcode-only session is **not** gated.

**Post-log navigation** — lands on Today, not the camera. Guards D5.

**Section components** — render tests via `renderComponent` from
`test/utils/render-component` (not `@testing-library/react-native` directly).

**Accessibility** — the new chip layout keeps both actions reachable; the inline
macro editor is screen-reader navigable; no double-announcement introduced
alongside #734's composed `announceForAccessibility` utterance.

## Open items

**Which `labelReady` conjunct fails on real labels.** Unresolved. The prior is
`servingSize`: `SERVING_SIZE_PATTERN` requires the literal string "serving size",
and the bilingual `SERVING_PER_PATTERN` fallback requires a g/ml token. A canned-drink
label reading "Serving Size 1 can" therefore fails both — the first because MLKit may
split that line, the second because "1 can" carries no gram or millilitre token.

This does **not** block the design. §"Where the wrong-calorie harm actually
stops" is correct regardless of which conjunct fails — the gate is keyed on the
gate's _outcome_, not its cause. What the capture informs is a bounded, separate
work item: which parser patterns to widen.

Resolution path: branch `wip/device-probe` (off `main`, DO NOT MERGE) carries
`client/lib/device-probe.ts`, which logs the parsed gate fields, a per-field
pass/fail mark, an explicit `BLOCKING GATE(S)` line, and the full OCR text. One
device run against a product with a known-wrong database record resolves it. If
no `[device-probe]` line appears at all, the user never reached step 2 — which is
D1, not D3.

_(The post-log navigator call was an open item during design and is now
resolved — see "Post-log dismissal" below.)_

## Post-log dismissal — resolved mechanism

The established pattern in this codebase is
`navigation.reset({ index: 0, routes: [{ name: "Main" }] })`, used three times in
`ScanScreen.tsx` alone (lines 305, 635, 703) and again in
`FeaturedRecipeDetailScreen` and `RecipeChatScreen`. The tab is named **`HomeTab`**
(`client/navigation/MainTabNavigator.tsx`), not `Home`.

**`safeGoBack` is deliberately NOT used here, and the reason is the bug itself.**
`ScanScreen`'s `returnAfterLog` path wraps its reset in
`safeGoBack(navigation, () => navigation.reset(...))` because in that mode
`NutritionDetail` was never opened — `ScanScreen` is the top of the modal stack, so
`goBack()` correctly dismisses it and the reset is only a fallback.

From `NutritionDetail`, `canGoBack()` is true and `goBack()` pops to the live
camera. That is precisely D5. So the add-to-log success handler must reset
**unconditionally**:

```ts
navigation.reset({
  index: 0,
  routes: [{ name: "Main", params: { screen: "HomeTab" } }],
});
```

Naming `HomeTab` explicitly rather than relying on Main's default tab keeps the
landing correct if tab order ever changes. This is also correct for the deep-link
entry (`ocrecipes://nutrition/:barcode`): after logging an item, landing on Today
is the desired outcome regardless of how the screen was reached.

## Suggested implementation phasing

One spec, but the plan should slice it in two. The halves share only the route
payload contract, and the first delivers user-visible value on its own.

**Phase 1 — flow correctness (D1, D2, D3-gate, D5).** The additive reducer phase,
the verification-aware chip, the full payload pass-through, the `logGate`, and the
post-log reset. This is where the wrong-calorie harm stops and where the three
steps start being followed. Ship it before touching the result screen's layout.

**Phase 2 — result screen (D4, redesign).** The five extracted section components,
the `VerificationPanel` replacing the dead CTA, and the front-label identity
surface. Depends on Phase 1's payload contract for `nutritionImageUri` /
`frontImageUri`.

Keep the reducer change in its own commit within Phase 1 so it can be reverted
independently of everything else, per the camera-regression risk below.

## Risks

**Touching phase-driven switches risks the camera work.** Mitigated by making
every reducer change additive and asserting the preserved `CONFIRM_PRODUCT`
transition in a regression test. Three of #729's acceptance criteria (Android
barcode, tap-to-focus, close-range lens) are still device-unverified; a scan-flow
regression would be hard to distinguish from those. Implement the reducer change
in its own commit so it can be reverted independently.

**Extracting `NutritionDetailScreen` risks flag-display desync.** Mitigated by
relocating flag logic without forking it, and by keeping the existing
announced-count parity tests passing.

**The new phase adds a step users must pass through.** Mitigated by the
verified-data fast path, which means repeat scans of known-good products are not
slower than today.
