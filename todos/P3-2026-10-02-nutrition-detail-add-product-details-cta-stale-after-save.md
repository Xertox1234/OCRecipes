---
title: 'NutritionDetail still shows the "Add product details" CTA after the front label was saved — read the #1220 query-cache signal in a focus effect'
status: in-progress
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, client, client-state]
github_issue:
---

# Hide NutritionDetail's "Add product details" CTA once the front label is saved

## Summary

`NutritionDetailScreen` offers an "Add product details" CTA while `hasFrontLabelData` is false. That flag is a once-per-lookup snapshot from `useNutritionLookup`; the front-label flow the CTA starts (Scan → FrontLabelConfirm → `pop(2)`) lands back on the still-mounted screen without re-running the lookup, so the CTA stays until the product is scanned again. Read FrontLabelConfirm's query-cache "saved" signal in a focus effect, exactly as #1220 did for `LabelAnalysisScreen`, and pin it with a return-after-save test.

## Background

Noticed during the `/todo` sweep PR #1220 (front-label CTA stale after save; `todos/archive/P3-2026-09-24-front-label-cta-stale-after-save.md`), whose scope contract covered only `LabelAnalysisScreen` + its verification test (+ `FrontLabelConfirmScreen` for the save signal). `NutritionDetailScreen` has the same CTA fed by the same server flag and was outside that contract, so it was deferred as an adjacent gap rather than fixed in that PR. Verified 2026-10-02 against `main` ec26b972 by code read (triage item J2) and upheld by an adversarial re-check: the mechanism is unambiguous (effect deps, a single reader of the signal) and the impact is cosmetic — the only 409 in `server/routes/verification.ts` is at :107 (the label-verification `/submit` route); the front-label confirm handler at :319 returns only 404/400 (:331-353), so a repeat save is accepted and the stale button merely looks like the save did not work. Low severity, auto-filed per the CLAUDE.md Medium/Low rule; filing approved by the owner 2026-10-02.

Plain words: after someone adds a product's front-label details and comes back to that product's nutrition page, the button inviting them to add those details is still there until they scan the product again, which looks like the save did not work.

## Acceptance Criteria

- [ ] After a successful front-label save, `pop(2)` back to a still-mounted `NutritionDetailScreen` for that barcode no longer renders the "Add product details" CTA (`VerificationPanel`'s `!hasFrontLabelData` branch), with no new navigation params, context, store, or server call.
- [ ] Regaining focus with NO saved signal (Retake, or backing out of the front-label flow) keeps the CTA — control test.
- [ ] A saved signal for a DIFFERENT barcode keeps the CTA — per-product control test.
- [ ] The label-verify CTA ("Help verify this product") and the `verificationLevel` badge are untouched: the OR applies only to `hasFrontLabelData`, and the existing verification-panel tests at `client/screens/__tests__/NutritionDetailScreen.test.tsx:1068-1156` stay green unchanged.
- [ ] `client/screens/__tests__/NutritionDetailScreen.test.tsx`'s `@react-navigation/native` mock (lines 71-74) gains a `useFocusEffect` that captures the callback (not a no-op); the new tests invoke it to simulate the refocus and assert `focusEffectCb.current` is a function first (the vacuity control from `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx:265-273`). The hide test is red before the screen change and green after.
- [ ] The whole `NutritionDetailScreen.test.tsx` file still passes once the screen imports `frontLabelSavedKey` (the transitive native-module imports named in Implementation Notes are mocked).

## Implementation Notes

Mechanism (all line numbers at ec26b972):

- `client/components/nutrition/VerificationPanel.tsx:73` renders the CTA when `verificationLevel !== "unverified" && !hasFrontLabelData`.
- `hasFrontLabelData` is fetched once per lookup by `client/hooks/nutrition-lookup-outcome.ts:342-346` (`GET /api/verification/:code`), inside the effect at `client/hooks/useNutritionLookup.ts:349-378` whose deps are `[barcode, imageUri, ocrText]` — none changes on a focus return, and neither the hook nor the screen has any `useFocusEffect` / `useIsFocused` / `getQueryData` today (the hook's only `refetch` hit, :528, is a comment).
- `client/screens/NutritionDetailScreen.tsx:214` destructures the flag from the hook (call at :246) and :587 passes it to `VerificationPanel`; :588-593 is the CTA's `navigation.navigate("Scan", { mode: "front-label", verifyBarcode: barcode })`. `client/screens/ScanScreen.tsx:586` navigates on to `FrontLabelConfirm`, whose confirm `onSuccess` (`client/screens/FrontLabelConfirmScreen.tsx:178-191`) pins `gcTime` (:183), writes `setQueryData<boolean>(frontLabelSavedKey(barcode), true)` (:184) and then `navigation.pop(2)` (:191). All of these are root-stack screens (`client/navigation/RootStackNavigator.tsx:259` Scan, :271 NutritionDetail with `presentation: "modal"` at :275, :426 FrontLabelConfirm), so the pop lands on the mounted NutritionDetail. Today the signal's only reader is `client/screens/LabelAnalysisScreen.tsx:347`.

Screen change — `client/screens/NutritionDetailScreen.tsx` (696 lines; keep the addition to roughly 15 lines, no refactor):

1. Imports: add `useCallback` to the React import (:1), `useFocusEffect` to the `@react-navigation/native` import (:12), `import { useQueryClient } from "@tanstack/react-query";`, and `import { frontLabelSavedKey } from "./FrontLabelConfirmScreen";` (the helper exported at `client/screens/FrontLabelConfirmScreen.tsx:58-59`; the same screen-to-screen import `client/screens/LabelAnalysisScreen.tsx:65` uses).
2. After the hook destructure (:210-246): `const queryClient = useQueryClient();` and `const [frontLabelSavedHere, setFrontLabelSavedHere] = useState(false);`, then mirror `client/screens/LabelAnalysisScreen.tsx:343-356`:

   ```tsx
   useFocusEffect(
     useCallback(() => {
       if (!barcode) return;
       setFrontLabelSavedHere(
         queryClient.getQueryData<boolean>(frontLabelSavedKey(barcode)) ===
           true,
       );
     }, [queryClient, barcode]),
   );
   ```

   Assign the read value rather than only ever setting `true`: `useFocusEffect` re-runs when the callback identity changes while the screen is focused (`docs/solutions/conventions/usefocuseffect-refires-on-callback-identity-change-while-focused-2026-09-25.md`), so should the mounted instance ever receive a different `barcode` param (ScanScreen reaches this screen with `navigation.navigate`, `client/screens/ScanScreen.tsx:1007`, which updates params on a route already in the stack), the state self-corrects instead of carrying a stale `true` across products. The read is idempotent, so the refire is harmless.

3. `:587` becomes `hasFrontLabelData={hasFrontLabelData || frontLabelSavedHere}`. Keep `verificationLevel` and both `on*` props as they are.
4. Carry the comment from `client/screens/LabelAnalysisScreen.tsx:335-342` in one or two lines: the flag is a per-lookup snapshot, the flow pop(2)s back onto this mounted screen, FrontLabelConfirm publishes the save to the query cache first. No new query key, no `QUERY_KEYS` entry (`client/App.tsx:56-58` persists those first elements — the reason the #1220 archive note kept the key out of `client/lib/query-keys.ts`), no `invalidateQueries` (the hook does not read this value through `useQuery`), and no change to the `gcTime` handling (`docs/rules/hooks.md:9`; the writer already pins it).

Test change — `client/screens/__tests__/NutritionDetailScreen.test.tsx` (1923 lines; add to the existing "verification panel (2b characterisation)" describe at :1058, or a sibling describe right after it):

1. Hoisted block (:30-38): add `focusEffectCb: { current: null as (() => void) | null }`; reset it to `null` in the `afterEach` at :44-47.
2. Navigation mock (:71-74): add `useFocusEffect: (cb: () => void) => { focusEffectCb.current = cb; }` — copy `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx:36-52`. A capturing mock never invokes the callback by itself, so the other ~55 tests in the file are unaffected; a bare `() => {}` no-op (the shape `client/screens/__tests__/LabelAnalysisScreen.test.tsx:40` uses) would make the refocus unobservable here. Without ANY `useFocusEffect` in this factory every render in the file throws once the screen imports it — the exact failure the #1220 squash message (ed268522) warns about.
3. Transitive-import trap: importing `frontLabelSavedKey` pulls `FrontLabelConfirmScreen.tsx`'s module graph into this suite — `expo-file-system/legacy` (`client/screens/FrontLabelConfirmScreen.tsx:19`) and `@/lib/photo-upload` (:31; `client/lib/photo-upload.ts:1` imports `expo-file-system/legacy` itself and :2 imports `./token-storage`, which imports AsyncStorage at `client/lib/token-storage.ts:1`). Neither is aliased in `vitest.config.mts` or `test/setup.ts`, and the root `__mocks__/` holds only `express-rate-limit.ts`; every suite that reaches `expo-file-system/legacy` mocks it explicitly because the real module hits a native module at import time under jsdom (`client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx:77-78`). Add the two module mocks `client/screens/__tests__/LabelAnalysisScreen.test.tsx:58-65` carries: `vi.mock("@/lib/photo-upload", () => ({ uploadFrontLabelPhoto: vi.fn(), confirmFrontLabel: vi.fn() }))` and `vi.mock("expo-file-system/legacy", () => ({ deleteAsync: vi.fn().mockResolvedValue(undefined) }))`. Run the single file (`npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`) before touching the screen to confirm the baseline, and again right after adding the import, before writing any test.
4. The new tests need a handle on the `QueryClient` to seed the signal; `renderComponent` (`test/utils/render-component.tsx:11-23`) creates one internally and does not expose it, so use `createQueryWrapper()` from `test/utils/query-wrapper.ts:8-20` plus `render(<NutritionDetailScreen />, { wrapper })` (import `render` from `@testing-library/react` next to `act, fireEvent` at :13), with `mockRoute.params = { barcode: "06772408", ocrText: null }` and `mockUseNutritionLookup.mockReturnValue({ ...baseHookReturn({ productName: "Cherry Coke" }), verificationLevel: "verified", hasFrontLabelData: false })` exactly as `renderVerification` at :1059-1066 does. Import `frontLabelSavedKey` from `../FrontLabelConfirmScreen` as `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx:13-15` does.
5. Tests, mirroring `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx:275-317` with the signal seeded directly (the writer side — `setQueryData` plus the `gcTime` pin — is already pinned by that suite's :322-333, so this file does not need to render `FrontLabelConfirmScreen`):
   - hides the CTA once the user returns from saving this product's front label: render; `expect(queryByText("Add product details")).toBeTruthy()` (control); `queryClient.setQueryData(frontLabelSavedKey("06772408"), true)`; `expect(focusEffectCb.current).toBeTypeOf("function")`; `act(() => focusEffectCb.current?.())`; `expect(queryByText("Add product details")).toBeNull()`. Red before the fix on the `toBeTypeOf` line.
   - keeps the CTA on a refocus with no save.
   - keeps the CTA when the saved front label belongs to another barcode (`frontLabelSavedKey("0000000000017")`).

Not in scope: re-reading the server flag (no endpoint refreshes it per user; the #1220 archive explains why the cache signal was chosen), the confidence-banner announce gap in `FrontLabelConfirmScreen` (triage item J1, its own P2 todo), and any change to `useNutritionLookup`.

## Scope Contract

- **Mechanisms to use:** the existing per-barcode query-cache signal (`frontLabelSavedKey`, written by `FrontLabelConfirmScreen`) read in a `useFocusEffect(useCallback(...))`, one local `useState` boolean OR-ed into the existing `hasFrontLabelData` prop, and the existing test harness (`createQueryWrapper`, the hoisted-mock pattern). Nothing new.
- **Files in scope:** `client/screens/NutritionDetailScreen.tsx`, `client/screens/__tests__/NutritionDetailScreen.test.tsx`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None open. #1220 (ed268522, merged 2026-10-01) supplies the signal, the `gcTime` pin and the reader pattern this mirrors.

## Risks

- `client/screens/NutritionDetailScreen.tsx` (696 lines) and its test file (1923 lines) are both past the 600-line maintainability threshold already; the fix is additive and small, so do not take a file split on this todo — keep the change to the lines named above.
- If the two module mocks in Implementation Notes step 3 are not enough to load `FrontLabelConfirmScreen`'s graph under this suite, the alternative is to relocate `FRONT_LABEL_SAVED_KEY` + `frontLabelSavedKey` (`client/screens/FrontLabelConfirmScreen.tsx:55-59`) into the existing pure module `client/screens/front-label-confirm-utils.ts` (its only import is a type) and point `FrontLabelConfirmScreen.tsx`, `client/screens/LabelAnalysisScreen.tsx:65` and `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx:13-15` at it. That is out of contract: disclose it under "Out of contract" in the PR body with the failing import as the reason, per `docs/AI_WORKFLOW.md` → Tier handling.
- The capturing `useFocusEffect` mock never auto-fires, so a screen that mounts with the signal already set (the same product scanned again later in the session) is not covered here; in that case the server's product-level `hasFrontLabelData` is already true, so the OR changes nothing.
- Code-read finding only; nobody ran the flow on a device. The three tests above are the verification.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.
