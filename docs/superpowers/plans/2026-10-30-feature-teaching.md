# Feature Teaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Home Discover carousel with in-context tooltips, two action toasts and Coach teaching prompts that push camera, voice and import over typing.

**Architecture:** One small storage module remembers, per signed-in user, which tips were seen, which features were used and how many foods were typed. One hook decides whether a tip may show (eligible, unseen, unused, and no other tip on screen). One presentational `FeatureTip` callout is placed by each screen next to the control it points at. Toasts use the existing `useToast` action button. Coach teaching prompts are answered on the client.

**Tech Stack:** Expo / React Native, TypeScript, AsyncStorage, TanStack Query, Vitest + Testing Library (jsdom RN mocks).

**Spec:** `docs/superpowers/specs/2026-10-30-feature-teaching-design.md`

## Global Constraints

- Current design only: `client/constants/theme.ts` tokens and existing components. No gradients, emoji, ✨, or ALL-CAPS "TRY THIS" labels (spec anti-goals; owner ruling 2026-10-29).
- Each tip shows **once**, never after its feature was used, **at most one tip on screen at a time**.
- Free users only get tips for features they have; a tip is never an upgrade ad. The only upgrade path is the Coach Pro prompt.
- Coach teaching prompts and the Pro prompt are answered on the client: no AI call, no daily coach message spent.
- Tip copy (exact):
  - T1 Pro: "Scan a barcode, label, receipt or menu." · T1 free: "Scan a barcode or nutrition label."
  - T2: "Snap it instead."
  - T3: "Add a whole shop from the receipt."
  - T4: "Paste a link or snap a cookbook page."
  - S1: "Logging is faster with the camera" · button "Try it"
  - S2: "Next time, import it from a link or photo" · button "Import"
- Accessibility: every tip is announced (`AccessibilityInfo.announceForAccessibility`) when it appears, has a close button labelled "Dismiss tip", and respects reduced motion (no travel; fade only).
- Strict TDD: failing test first per task. Never run `npm ci`/`npm install` in the shared checkout.

## Review Focus

- **User switch on one phone:** user B must not inherit user A's seen/used tips or typed-log count (per-user owner check, cleared on sign-out) — Task 1 test `ignores another user's saved state`.
- **Premium still loading:** tips must not flash the wrong tier's copy or show a Pro tip to a free user before `isPremiumResolved` — Task 2 test `stays hidden until premium status resolves`.
- **Offline / queued Quick Log:** a typed log that is queued offline still counts once, and a failed log does not count — Task 5 test `counts only successful or queued typed logs`.
- **No scans left today:** S1 must not fire when `useCanScanToday().canScan` is false — Task 5 test `skips the camera toast when no scans are left`.
- **Two tips competing** (T2 visible on Quick Log while S1 would fire): the toast waits for the next qualifying log rather than stacking — Task 2 test `refuses a second tip while one is on screen`.

---

### Task 1: Feature-tip storage

**Files:**

- Create: `client/lib/feature-tips-storage.ts`
- Modify: `client/hooks/useAuth.ts` (sign-out cleanup, next to `clearHomeActionsState`, line ~87)
- Test: `client/lib/__tests__/feature-tips-storage.test.ts`

**Interfaces:**

- Produces:
  - `type TipId = "home-scan" | "quicklog-camera" | "pantry-receipt" | "plan-import" | "toast-camera" | "toast-import"`
  - `type TaughtFeature = "scan" | "receiptScan" | "import"`
  - `initFeatureTipsCache(userId: string | null): Promise<void>` — same owner-check shape as `initHomeActionsCache` in `client/lib/home-actions-storage.ts`
  - `hasSeenTip(id: TipId): boolean` · `markTipSeen(id: TipId): Promise<void>`
  - `hasUsedFeature(f: TaughtFeature): boolean` · `markFeatureUsed(f: TaughtFeature): Promise<void>`
  - `incrementTypedLogCount(): Promise<number>` (returns the new count)
  - `clearFeatureTipsState(): Promise<boolean>`

- [ ] **Step 1: Write failing tests** — `marks a tip seen and remembers it after re-init`, `marks a feature used`, `increments the typed-log count from zero`, `ignores another user's saved state` (init as "1", mark seen, init as "2" → `hasSeenTip` false), `clears everything on sign-out`. Mock AsyncStorage the way `client/lib/__tests__/home-actions-storage.test.ts` does.
- [ ] **Step 2: Run** `npx vitest run client/lib/__tests__/feature-tips-storage.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the module with one AsyncStorage key `@ocrecipes_feature_tips` holding `{ owner, seen: TipId[], used: TaughtFeature[], typedLogs: number }` and an in-memory cache read synchronously (pattern: `discovery-storage.ts`). Call `clearFeatureTipsState()` in `useAuth`'s sign-out cleanup beside `clearHomeActionsState()`, and `initFeatureTipsCache(userId)` beside `initHomeActionsCache(userId)` in `client/hooks/useHomeActions.ts`.
- [ ] **Step 4: Run** the test file — expect PASS.
- [ ] **Step 5: Commit** — `feat(tips): remember seen tips, used features and typed logs per user`

### Task 2: `useFeatureTip` hook (eligibility + one-at-a-time)

**Files:**

- Create: `client/hooks/useFeatureTip.ts`
- Test: `client/hooks/__tests__/useFeatureTip.test.ts`

**Interfaces:**

- Consumes: Task 1 storage functions.
- Produces:
  - `useFeatureTip(id: TipId, opts: { feature: TaughtFeature; eligible: boolean; ready?: boolean }): { visible: boolean; dismiss: () => void }`
  - `claimTipSlot(id: TipId): boolean` / `releaseTipSlot(id: TipId): void` (module-level single slot; exported for the toasts in Task 5)
- Rules: `visible` only when `ready !== false`, `eligible`, not seen, feature not used, and the slot is free. Becoming visible claims the slot, calls `markTipSeen` and announces the tip text is left to `FeatureTip` (Task 3). `dismiss` and unmount release the slot.

- [ ] **Step 1: Write failing tests** — `shows an eligible unseen tip`, `never shows a seen tip`, `never shows once the feature was used`, `stays hidden until premium status resolves` (`ready: false`), `refuses a second tip while one is on screen`, `frees the slot on dismiss and on unmount`.
- [ ] **Step 2: Run** `npx vitest run client/hooks/__tests__/useFeatureTip.test.ts` — FAIL.
- [ ] **Step 3: Implement** the hook; mark seen when it first becomes visible (a tip counts as shown even if the person ignores it).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(tips): decide when a feature tip may show`

### Task 3: `FeatureTip` callout component

**Files:**

- Create: `client/components/FeatureTip.tsx`
- Test: `client/components/__tests__/FeatureTip.test.tsx`

**Interfaces:**

- Produces: `FeatureTip({ text, visible, onDismiss, pointer, style, testID }: { text: string; visible: boolean; onDismiss: () => void; pointer: "up" | "down"; style?: StyleProp<ViewStyle>; testID?: string })` — renders nothing when `visible` is false. The parent positions it (absolute or in flow) next to its control.

- [ ] **Step 1: Write failing tests** — `renders the text when visible`, `renders nothing when hidden`, `announces the text once when it appears` (mock `AccessibilityInfo.announceForAccessibility`), `calls onDismiss from the "Dismiss tip" button`, `has no entrance travel under reduced motion` (mock `useAccessibility` → `reducedMotion: true`; assert no `entering` translate).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** a themed callout: `theme.backgroundSecondary` surface, `theme.text` body text, a small triangle pointer (`pointer`), a 44pt-hit-area close icon (`Feather "x"`, label "Dismiss tip"); fade-in (`FadeIn`) only, none when reduced motion. Not `accessible` as a group (its close button must stay reachable — `docs/rules/accessibility.md`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(tips): add the FeatureTip callout`

### Task 4: Remove Discover; For You to the top; T1 on Home

**Files:**

- Delete: `client/components/home/DiscoveryCard.tsx`, `DiscoveryCarousel.tsx`, `discovery-cards-config.ts`, `client/hooks/useDiscoveryCards.ts`, `client/lib/discovery-storage.ts` and their tests (`client/components/home/__tests__/DiscoveryCard.test.tsx`, `DiscoveryCarousel.test.tsx`, `discovery-cards-config.test.ts`, `client/hooks/__tests__/useDiscoveryCards.test.ts`, `client/lib/__tests__/discovery-storage.test.ts`)
- Modify: `client/screens/HomeScreen.tsx` (~line 666 block; order becomes For You (`RecipeCarousel`) → `RecentActionsRow` → `CuratedRecipeCarousel` → sections)
- Modify: `client/screens/__tests__/HomeScreen.test.tsx`
- Modify: the scan entry points to record use: `client/screens/ScanScreen.tsx` (mount → `markFeatureUsed("scan")`), `client/screens/ReceiptCaptureScreen.tsx` (mount → `"receiptScan"`), `client/screens/meal-plan/RecipeImportScreen.tsx`, `RecipePhotoImportScreen.tsx`, `RecipeTextImportScreen.tsx` (mount → `"import"`)

**Interfaces:**

- Consumes: Tasks 1–3. T1 uses `useFeatureTip("home-scan", { feature: "scan", eligible: true, ready: isPremiumResolved })`; copy picks T1 Pro vs free by `isPremium` from `usePremiumContext()`.
- T1 placement: rendered by `HomeScreen` as an absolute `FeatureTip pointer="down"` anchored above the ScanFAB's position (the FAB is drawn by `client/navigation/MainTabNavigator.tsx`, bottom-right; read its offset from `client/components/ScanFAB.tsx` styles rather than guessing).

- [ ] **Step 1: Write failing tests** in `HomeScreen.test.tsx` — `does not render Discover cards`, `renders For You before the recent actions row`, `shows the free scan tip to a free user` (text "Scan a barcode or nutrition label."), `shows the full scan tip to a Pro user`, `does not show the scan tip once the camera was used`. And a mount test per marked screen: `marks the camera as used when the scan screen opens` (ScanScreen), likewise receipt and the three import screens.
- [ ] **Step 2: Run** the touched test files — FAIL.
- [ ] **Step 3: Implement**: delete the Discover files, reorder Home, add T1, add the five `markFeatureUsed` calls (in a mount `useEffect`).
- [ ] **Step 4: Run** `npx vitest run client/screens client/components/home client/hooks` — PASS; `grep -rn "Discovery" client` returns nothing.
- [ ] **Step 5: Commit** — `feat(home): replace Discover with an in-context scan tip; For You first`

### Task 5: Quick Log tip T2 and camera toast S1

**Files:**

- Modify: `client/screens/QuickLogScreen.tsx` (camera button ~241–255), `client/components/home/QuickLogDrawer.tsx` (camera button ~340)
- Modify: `client/hooks/useQuickLogSession.ts` (log mutation `onSuccess` ~290 and the offline enqueue branch ~230)
- Tests: `client/hooks/__tests__/useQuickLogSession.test.ts` (or a new `useQuickLogSession.teaching.test.ts`), `client/screens/__tests__/QuickLogScreen.test.tsx`

**Interfaces:**

- Consumes: Tasks 1–3; `useCanScanToday()` from `client/hooks/usePremiumFeatures.ts`; `useToast()`.
- T2: `useFeatureTip("quicklog-camera", { feature: "scan", eligible: inputText.trim().length > 0 })`, `FeatureTip pointer` toward the camera button, on both the screen and the drawer.
- S1: after a log succeeds (or is queued offline) whose items all have `sourceType === "text"`, call `incrementTypedLogCount()`; when it returns `>= 3`, the camera is unused, `toast-camera` unseen, `canScan` true and `claimTipSlot("toast-camera")` succeeds → `markTipSeen("toast-camera")`, `toast.info("Logging is faster with the camera", { action: { label: "Try it", onPress: () => navigation.navigate("Scan") } })`, then `releaseTipSlot`.

- [ ] **Step 1: Write failing tests** — `shows the camera tip once the person starts typing`, `counts only successful or queued typed logs` (a voice log and a failed log don't count), `shows the camera toast on the third typed log`, `skips the camera toast when no scans are left`, `never shows the camera toast twice`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as above. Keep the counter in the hook's success path, not in the screen, so the screen and the drawer share it.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(quick-log): teach the camera after typed logs`

### Task 6: Pantry tip T3, plan Import tip T4, import toast S2

**Files:**

- Modify: `client/screens/meal-plan/PantryScreen.tsx` (receipt button ~419, inside `features.receiptScanner`)
- Modify: `client/components/meal-plan/AddItemMenuSheet.tsx` (Import row ~103)
- Modify: `client/components/recipe-wizard/WizardShell.tsx` (after `createMutation.mutateAsync` succeeds, ~238)
- Tests: `client/screens/meal-plan/__tests__/PantryScreen.header.test.tsx` (existing; the receipt button is in the list header), `client/components/meal-plan/__tests__/AddItemMenuSheet.test.tsx`, `client/components/recipe-wizard/__tests__/WizardShell.test.tsx`

**Interfaces:**

- Consumes: Tasks 1–3; `usePremiumFeature("receiptScanner")`, `usePremiumFeature("urlImport")`; `useToast()`.
- T3: `useFeatureTip("pantry-receipt", { feature: "receiptScan", eligible: receiptScanner })`.
- T4: `useFeatureTip("plan-import", { feature: "import", eligible: urlImport })` — import tips are Pro-only (spec: shown only to people whose plan includes the import).
- S2: on a successful wizard save, if `urlImport`, import unused, `toast-import` unseen and the slot is free → `toast.info("Next time, import it from a link or photo", { action: { label: "Import", onPress: () => navigate to RecipeImport } })` (use the same navigation `ImportRecipeSheet`/`RecipeEntryHubScreen` use for `RecipeImport`).

- [ ] **Step 1: Write failing tests** — `shows the receipt tip to Pro users only`, `shows the import tip to Pro users only`, `shows the import toast after a hand-built recipe is saved`, `does not show the import toast to a free user`, `does not show the import toast once import was used`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(meal-plan): teach receipt scanning and recipe import`

### Task 7: Coach teaching prompts and Pro prompt (free NutriCoach)

**Files:**

- Modify: `client/screens/ChatScreen.tsx` (`SUGGESTED_PROMPTS` ~82, `SuggestedPrompts` ~119–165)
- Create: `client/screens/coach-teaching-prompts.ts` (prompt definitions + their fixed answers)
- Test: `client/screens/__tests__/ChatScreen.teaching-prompts.test.tsx`

**Interfaces:**

- Produces: `type SuggestedPrompt = { text: string; kind: "ask" } | { text: string; kind: "teach"; answer: string; actionLabel: string; target: "Scan" } | { text: string; kind: "pro"; answer: string }`; `SUGGESTED_PROMPTS: SuggestedPrompt[]` with exactly four entries: two `ask` (keep "What should I eat today?" and "How can I hit my protein goal?"), one `teach` ("What's the fastest way to log a meal?" → answer about pointing the camera at a barcode or label, action "Open camera" → `Scan`), one `pro` (a question only Coach Pro can answer, e.g. "How did my week go?", answer explaining Coach Pro looks at your logged week and offers the upgrade).
- `ask` keeps today's behaviour (`handleSend`). `teach` and `pro` render the fixed answer as a local assistant message with a button; they never call `handleSend` (no AI, no daily message). The `pro` item shows a small "Pro" badge and its button opens the existing upgrade (`UpgradeModal`, as `HomeScreen` uses it).

- [ ] **Step 1: Write failing tests** — `shows four prompts with one Pro badge`, `answers the teaching prompt without sending a message` (`handleSend`/the send mutation not called), `opens the camera from the teaching answer`, `opens the upgrade from the Pro answer`, `still sends an ordinary prompt to the coach`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; write final copy for the two answers in plain words (no emoji, no ALL CAPS).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(coach): teaching and Pro prompts answered in the app`

### Task 8: Coach Pro feature chip

**Files:**

- Modify: `client/components/coach/CoachDashboard.tsx` (chips ~170–185)
- Test (create): `client/components/coach/__tests__/CoachDashboard.feature-chip.test.tsx` — no CoachDashboard test exists yet

**Interfaces:**

- Consumes: Task 1 (`hasUsedFeature`). "Used" lives on the phone, so the chip is added on the client (spec: follows from storage).
- Adds at most **one** chip after the server chips: the first unused of `import` → "Help me import a recipe", `receiptScan` → "Help me scan a receipt". Tapping sends it as a normal Coach Pro message (existing `initialMessage` path). No chip when both are used.

- [ ] **Step 1: Write failing tests** — `adds one feature chip for an unused feature`, `adds no feature chip when both are used`, `never adds more than one feature chip`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(coach): suggest one unused feature in Coach Pro`

### Task 9: Simulator check

- [ ] **Step 1:** On the iOS simulator (local server), as a **free** and a **Pro** test user, in light and dark: Home shows For You first and the T1 tip once with the tier's copy; Quick Log shows T2 once typing starts; three typed logs show S1 once; Pantry and the plan sheet tips show only for Pro; saving a hand-built recipe shows S2 for Pro; NutriCoach's teaching and Pro prompts answer without spending a message; VoiceOver reads each tip and reaches "Dismiss tip". Screenshot each; note anything not verified.
- [ ] **Step 2:** Fix what fails (back through the owning task's test first).
