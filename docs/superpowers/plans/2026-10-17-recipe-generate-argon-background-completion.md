# Recipe Generation on Argon with Background Completion — Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`, and the `recipe-generate` row in `server/lib/ai-models.ts` uses Gemini 4 Argon. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping Generate closes the sheet at once; the recipe finishes in the background and the user is told by a toast and a Profile-tab dot; then `recipe-generate` moves to Gemini 4 Argon.

**Architecture:** Mirror the shipped coach pattern (#1216): a query-cache sentinel store for durable "unread / pending / held draft" state, a module-level emitter that out-of-tree code publishes to, and a toast bridge inside `MainTabNavigator` that listens and offers an "Open" action. The two generation mutations move out of their screens into hooks that own the success/failure handling. The model switch is a one-row table change plus its test, in its own PR, after both client PRs.

**Tech Stack:** React Native / Expo, TanStack Query v5, React Navigation (`navigationRef`), Vitest + Testing Library (`test/utils/query-wrapper.ts`, `test/utils/render-component.tsx`), Express + OpenRouter (`server/lib/ai-models.ts`).

**Spec:** `docs/superpowers/specs/2026-10-17-recipe-generate-argon-background-completion-design.md`

## Global Constraints

- Three PRs in this order: PR 1 = Tasks 1–6 (photo sheet), PR 2 = Tasks 7–10 (meal-plan screen), PR 3 = Task 11 (model row + cap). Never ship PR 3 before PR 1 (spec §6). PR 1 and PR 2 may be merged into one if the builder finds the split artificial; PR 3 stays separate.
- Strict TDD per task; one review pass per PR; branch off `main`; never commit to `main`. Commits run lint-staged; pushes run `preflight:fast`; PR creation needs the fresh HEAD stamp.
- Single-flight per entry point (spec §5): at most one pending generation for `"photo"` and one for `"mealPlan"`.
- Copy, verbatim: toast `"Recipe ready — tap to open"`, action label `"Open"`; pending caption `"A recipe is on its way"`; soft failure `"Couldn't confirm the recipe — check Saved items"`; draft toast `"Recipe draft ready — tap to review"`, action label `"Review"`; draft banner `"Your draft is ready"` with button `"Review"`; Profile tab label `"Profile, new recipe"` when unread, `"Profile"` otherwise.
- Client request deadline: 60 000 ms via `AbortController` + `setTimeout` (not `AbortSignal.timeout`).
- Sign-out guard: capture `await tokenStorage.get()` at submit; before marking unread or emitting, re-read and compare; stay silent on mismatch or read failure (same as `useChat.ts` ~line 567).
- All sentinel keys are pinned with `queryClient.setQueryDefaults(key, { gcTime: Infinity })` so logout's `queryClient.clear()` wipes them.
- `FeaturedRecipeDetail` is root-stack: `navigationRef.navigate("FeaturedRecipeDetail", { recipeId, recipeType: "community" })`. `RecipeCreate` is nested: `navigationRef.navigate("Main", { screen: "MealPlanTab", params: { screen: "RecipeCreate", params, pop: true } }, { pop: true })`.
- Model row (PR 3): `"recipe-generate": { model: "google/gemini-4-argon", fallback: "gpt-4o", json: true, vision: false }`; `max_completion_tokens` in `server/services/recipe-generation.ts` becomes `4000`. No prompt change. No adapt block.
- Do not edit `PINNED_HOSTS`, `.claude/hooks/**`, or the eval datasets in these PRs.

## Review Focus

1. **Sign-out during the 11–13 s.** Expected: no toast, no dot, no haptic for the next user. Pinned in Task 2 (`stays silent when the auth token changed since submit`).
2. **Response lost after the server saved** (backgrounded app, dropped socket, 60 s deadline). Expected: Saved items refreshes and the toast says "check Saved items"; nothing is lost. Pinned in Task 2 (`on a non-4xx failure still invalidates saved items and shows the soft toast`) and Task 4 (`refetches on focus`).
3. **Daily limit or premium rejection (4xx) a second after the sheet closed.** Expected: plain error toast with the server's message, no dot, pending cleared so the user can try again tomorrow. Pinned in Task 2 (`on a 4xx shows the server message and clears pending without touching saved items`).
4. **Two taps on Generate** (same frame, or sheet reopened while pending). Expected: one request. Pinned in Task 5 (`ignores a second tap in the same frame`, `disables Generate with the pending caption while a generation is in flight`).
5. **"Open" tapped while the photo modal is still up, on a recipe whose hero image has not arrived.** Expected: the recipe screen opens over or instead of the modal and renders with no image. Pinned in Task 3 (`navigates to FeaturedRecipeDetail with the recipe id`) plus a simulator check listed in Task 6.

---

### Task 1: Generated-recipe notice store and emitter

**Files:**

- Create: `client/hooks/useGeneratedRecipeNotices.ts`
- Test: `client/hooks/__tests__/useGeneratedRecipeNotices.test.ts`

**Interfaces:**

- Consumes: `tokenStorage` is NOT used here; pure query-cache + emitter, modelled on `client/hooks/useCoachUnreadReplies.ts`.
- Produces (all exported):
  - `UNREAD_GENERATED_RECIPES_KEY = ["__unreadGeneratedRecipes"] as const` — `number[]`
  - `PENDING_RECIPE_GENERATION_KEY = ["__pendingRecipeGeneration"] as const` — `Record<GenerationEntry, boolean>`
  - `type GenerationEntry = "photo" | "mealPlan"`
  - `getUnreadGeneratedRecipeIds(qc: QueryClient): number[]`
  - `markGeneratedRecipeUnread(qc: QueryClient, recipeId: number): void` (idempotent)
  - `clearGeneratedRecipeUnread(qc: QueryClient, recipeId: number): void`
  - `clearAllGeneratedRecipesUnread(qc: QueryClient): void`
  - `useHasUnreadGeneratedRecipe(): boolean` (same `useQuery` + `skipToken` + `select` shape as `useHasUnreadCoachReply`)
  - `setPendingGeneration(qc: QueryClient, entry: GenerationEntry, pending: boolean): void`
  - `isPendingGeneration(qc: QueryClient, entry: GenerationEntry): boolean`
  - `usePendingGeneration(entry: GenerationEntry): boolean`
  - `subscribeToGeneratedRecipeReady(listener: (recipeId: number) => void): () => void`
  - `noteGeneratedRecipeReady(qc: QueryClient, recipeId: number): void` — marks unread, then notifies listeners.

- [ ] **Step 1: Write the failing tests**

```ts
// client/hooks/__tests__/useGeneratedRecipeNotices.test.ts
describe("unread generated recipes", () => {
  it("records a recipe once, however many times it is noted", …)        // mark 7 twice → ids [7]
  it("clears one id and keeps the others", …)                             // mark 7, 8; clear 7 → [8]
  it("clears all ids at once", …)
  it("useHasUnreadGeneratedRecipe flips true on mark and false on clear", …) // renderHook with createQueryWrapper
});
describe("pending generation", () => {
  it("tracks photo and mealPlan independently", …)                        // set photo true → isPending(mealPlan) false
  it("usePendingGeneration re-renders when the flag changes", …)
});
describe("ready emitter", () => {
  it("noteGeneratedRecipeReady marks unread and calls every subscriber with the id", …)
  it("an unsubscribed listener is not called", …)
});
describe("logout", () => {
  it("queryClient.clear() empties unread, pending and leaves hooks reporting false", …)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/hooks/__tests__/useGeneratedRecipeNotices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/hooks/useGeneratedRecipeNotices.ts`**

Copy the structure of `useCoachUnreadReplies.ts` (pin keys with `setQueryDefaults`, `Set` of listeners, `useQuery` with `skipToken`). Pending store: one object keyed by entry; `setPendingGeneration` merges.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/hooks/__tests__/useGeneratedRecipeNotices.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useGeneratedRecipeNotices.ts client/hooks/__tests__/useGeneratedRecipeNotices.test.ts
git commit -m "feat(recipes): unread/pending store and ready emitter for background recipe generation"
```

---

### Task 2: Background generation hook for the photo sheet

**Files:**

- Create: `client/hooks/useGenerateRecipeInBackground.ts`
- Test: `client/hooks/__tests__/useGenerateRecipeInBackground.test.ts`

**Interfaces:**

- Consumes: Task 1 (`setPendingGeneration`, `noteGeneratedRecipeReady`); `apiRequest(method, route, data, init, authToken?)` from `@/lib/query-client`; `ApiError` (`.status: number`, message `"<status>: <server text>"`) from `@/lib/api-error`; `tokenStorage.get(): Promise<string | null>` from `@/lib/token-storage`; `useToast()` from `@/context/ToastContext` (`error(message, { haptic?: boolean })`); `useHaptics().notification(Haptics.NotificationFeedbackType.Success | Error)`; `useQueryClient()`.
- Produces:
  - `interface GenerateRecipeInput { productName: string; barcode?: string | null; servings: number; dietPreferences: string[]; timeConstraint?: string; shareToPublic: boolean }`
  - `useGenerateRecipeInBackground(): { start: (input: GenerateRecipeInput) => void }`
  - Exported constant `RECIPE_GENERATION_DEADLINE_MS = 60_000`.
  - Exported helpers reused by Task 8: `withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms?: number): Promise<T>` and `serverMessageOf(err: unknown): string` (text after the first `": "` of an `ApiError` message, else a generic `"Couldn't generate the recipe"`).

- [ ] **Step 1: Write the failing tests** (mock `@/lib/query-client` `apiRequest` as in `RecipeGenerationModal.saved-items.test.tsx`; mock `@/lib/token-storage`; mock `@/context/ToastContext` with `{ useToast: () => mockToast }`; use `createQueryWrapper`)

```ts
it("sets photo pending on start and clears it on success", …)
it("on success invalidates /api/saved-items and /api/saved-items/count, marks the recipe unread and notifies subscribers", …)
  // apiRequest resolves { json: async () => ({ id: 42, … }) }; expect subscriber called with 42
it("stays silent when the auth token changed since submit", …)
  // tokenStorage.get: first "tok-A" at submit, then "tok-B"; expect no mark, no subscriber call, pending cleared
it("on a 4xx shows the server message and clears pending without touching saved items", …)
  // apiRequest rejects new ApiError("429: Daily recipe generation limit reached", code, 429)
  // expect mockToast.error called with "Daily recipe generation limit reached"; invalidateQueries not called
it("on a non-4xx failure still invalidates saved items and shows the soft toast", …)
  // reject with ApiError("502: …", code, 502) → expect toast "Couldn't confirm the recipe — check Saved items" and both invalidations
it("aborts after the deadline and treats it as a soft failure", …)
  // vi.useFakeTimers(); apiRequest never resolves but observes init.signal; advance 60_000 → signal.aborted true
it("ignores start() while photo is already pending", …)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/hooks/__tests__/useGenerateRecipeInBackground.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

`useMutation` with `meta: { silentError: true }`. `start` returns early if `isPendingGeneration(qc, "photo")`. `mutationFn`: capture `token = await tokenStorage.get()`, create `AbortController`, `setTimeout(abort, RECIPE_GENERATION_DEADLINE_MS)`, call `apiRequest("POST", "/api/recipes/generate", input, { signal }, token)`, clear the timer in `finally`, return `{ recipe: await res.json() as CommunityRecipe, token }`. `onSuccess`: invalidate both keys; `tokenStorage.get()` → if equal to `token`, `noteGeneratedRecipeReady(qc, recipe.id)` and success haptic. `onError`: if `err instanceof ApiError && err.status >= 400 && err.status < 500` → `toast.error(messageWithoutStatusPrefix)`; else invalidate both keys and `toast.error("Couldn't confirm the recipe — check Saved items")`. `onSettled`: `setPendingGeneration(qc, "photo", false)`. The server message is the text after the first `": "` in `ApiError.message`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/hooks/__tests__/useGenerateRecipeInBackground.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useGenerateRecipeInBackground.ts client/hooks/__tests__/useGenerateRecipeInBackground.test.ts
git commit -m "feat(recipes): background recipe generation hook with deadline, sign-out guard and soft failure"
```

---

### Task 3: Toast bridge and Profile-tab dot

**Files:**

- Modify: `client/navigation/MainTabNavigator.tsx` (bridge beside `CoachReplyToastBridge` ~line 118; mount beside `<CoachReplyToastBridge />` ~line 316; Profile `Tab.Screen` options ~line 300)
- Test: `client/navigation/__tests__/MainTabNavigator.test.tsx`

**Interfaces:**

- Consumes: Task 1 (`subscribeToGeneratedRecipeReady`, `noteGeneratedRecipeReady`, `useHasUnreadGeneratedRecipe`); `navigationRef`; `useToast().info(message, { action: { label, onPress } })`.
- Produces: `function openGeneratedRecipe(recipeId: number): void` (module scope, exported for tests), `function GeneratedRecipeToastBridge(): null`, Profile tab dot `testID="profile-tab-dot"`.

- [ ] **Step 1: Write the failing tests** (extend the existing file; it already mocks `useToast` → `mockToast` and `navigationRef`, and has `renderWithClient` + `settle`)

```ts
describe("MainTabNavigator — Profile tab dot", () => {
  it("shows no dot and the plain label by default", …)                   // queryAllByTestId("profile-tab-dot") → []; label "Profile"
  it("shows the dot and says so in the label while a generated recipe is unread", …) // noteGeneratedRecipeReady(qc, 42); settle
  it("drops the dot once all unread recipes are cleared", …)
});
describe("MainTabNavigator — generated recipe toast bridge", () => {
  it("shows 'Recipe ready — tap to open' with an Open action when a recipe lands", …)
    // expect mockToast.info toHaveBeenCalledWith("Recipe ready — tap to open", expect.objectContaining({ action: expect.objectContaining({ label: "Open" }) }))
  it("navigates to FeaturedRecipeDetail with the recipe id when Open is pressed", …)
    // call action.onPress(); expect navigationRef.navigate("FeaturedRecipeDetail", { recipeId: 42, recipeType: "community" })
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/navigation/__tests__/MainTabNavigator.test.tsx`
Expected: FAIL on the new cases only.

- [ ] **Step 3: Implement**

Copy `CoachReplyToastBridge` → `GeneratedRecipeToastBridge`; copy the Coach tab's dot `View` into the Profile tab's `tabBarIcon` driven by `useHasUnreadGeneratedRecipe()`; `tabBarAccessibilityLabel: hasUnreadGeneratedRecipe ? "Profile, new recipe" : "Profile"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/navigation/__tests__/MainTabNavigator.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/navigation/MainTabNavigator.tsx client/navigation/__tests__/MainTabNavigator.test.tsx
git commit -m "feat(nav): recipe-ready toast bridge and Profile tab unread dot"
```

---

### Task 4: Clearing the unread mark

**Files:**

- Modify: `client/screens/FeaturedRecipeDetailScreen.tsx` (after `const { recipeId, recipeType, type } = route.params;` ~line 100)
- Modify: `client/screens/SavedItemsScreen.tsx`
- Test: `client/screens/__tests__/SavedItemsScreen.test.tsx`; `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx` (exists — add the case there).

**Interfaces:**

- Consumes: Task 1 (`clearGeneratedRecipeUnread`, `clearAllGeneratedRecipesUnread`, `markGeneratedRecipeUnread`); `useFocusEffect` from `@react-navigation/native` (pattern: `client/screens/ChatScreen.tsx:316`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```ts
// SavedItemsScreen.test.tsx
it("clears all unread generated recipes and refetches on focus", …)
  // mark 42; render; expect ids [] after focus; expect the saved-items query's refetch called (spy on QueryClient.prototype.invalidateQueries or refetchQueries with ["/api/saved-items"])
// FeaturedRecipeDetailScreen
it("clears this recipe's unread mark when opened as a community recipe", …)
  // mark 42 and 43; render with { recipeId: 42, recipeType: "community" }; expect ids [43]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/screens/__tests__/SavedItemsScreen.test.tsx client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

`SavedItemsScreen`: `useFocusEffect(useCallback(() => { clearAllGeneratedRecipesUnread(qc); void qc.invalidateQueries({ queryKey: ["/api/saved-items"] }); }, [qc]))`. `FeaturedRecipeDetailScreen`: `useEffect(() => { if (resolvedRecipeType === "community") clearGeneratedRecipeUnread(qc, recipeId); }, …)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/screens/FeaturedRecipeDetailScreen.tsx client/screens/SavedItemsScreen.tsx client/screens/__tests__/
git commit -m "feat(recipes): clear the new-recipe mark on open and on Saved items focus"
```

---

### Task 5: The sheet lets go

**Files:**

- Modify: `client/components/RecipeGenerationModal.tsx` (mutation block lines ~73–126; `handleClose` ~134; `isGenerating` usages; status caption ~511; error banner)
- Modify: `client/screens/PhotoAnalysisScreen.tsx:778-790` (drop `onComplete`)
- Test: `client/components/__tests__/RecipeGenerationModal.saved-items.test.tsx` (rewrite), `client/components/__tests__/RecipeGenerationModal.tiles.test.tsx` (keep passing), `client/screens/__tests__/PhotoAnalysisScreen.test.tsx` (keep passing)

**Interfaces:**

- Consumes: Task 2 (`useGenerateRecipeInBackground().start(input)`), Task 1 (`usePendingGeneration("photo")`).
- Produces: `RecipeGenerationModalProps` loses `onComplete`; everything else unchanged.

- [ ] **Step 1: Write the failing tests** (mock `@/hooks/useGenerateRecipeInBackground` → `{ useGenerateRecipeInBackground: () => ({ start: mockStart }) }`)

```ts
it("starts generation with the form values and closes the sheet immediately on Generate", …)
  // press Generate → mockStart called once with { productName, servings: 2, dietPreferences: [], shareToPublic: false, … } and onClose called synchronously
it("ignores a second tap in the same frame", …)                       // two fireEvent.press without awaiting → mockStart once
it("disables Generate with the pending caption while a generation is in flight", …)
  // setPendingGeneration(qc, "photo", true); render → button disabled; getByText("A recipe is on its way")
it("resets the form on submit so reopening starts fresh", …)         // select a diet, press Generate, re-render visible → diet unselected
it("no longer renders the waiting caption or an inline error banner", …)
  // queryByText(/This may take a few seconds/) null
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/components/__tests__/RecipeGenerationModal.saved-items.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the `useMutation` block with `const { start } = useGenerateRecipeInBackground(); const isPending = usePendingGeneration("photo");`. `handleGenerate`: same-frame guard via `const tappedRef = useRef(false)` reset in `requestAnimationFrame`; medium haptic; `start({...})`; reset the four form states; `onClose()`. `handleClose` becomes `onClose` directly. Generate button `disabled={isPending}` and, when pending, shows the caption `"A recipe is on its way"` in place of the button label's spinner. Delete the `isGenerating` lock on the other controls, the status caption, the error banner and the iOS `announceForAccessibility`. Remove `onComplete` from props and from `PhotoAnalysisScreen` (keep `onClose`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/components/__tests__/RecipeGenerationModal client/screens/__tests__/PhotoAnalysisScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/components/RecipeGenerationModal.tsx client/components/__tests__/ client/screens/PhotoAnalysisScreen.tsx
git commit -m "feat(recipes): Generate closes the sheet at once; single-flight with pending caption"
```

---

### Task 6: PR 1 — push, simulator check, review

**Files:** none new.

- [ ] **Step 1: Push the branch** (`preflight:fast` runs on push). Expected: `✔` lines, HEAD stamp written.
- [ ] **Step 2: Simulator check** (use the `verify-ui` skill or `simctl`): photo-scan → Generate → sheet closes; after the recipe lands, toast + Profile dot; tap Open with the photo modal still up → recipe opens (image may be empty); open Saved items → dot clears. Note the result in the PR body.
- [ ] **Step 3: Open the PR** via `mcp__github__create_pull_request` with the spec path in the body. One review pass per `docs/AI_WORKFLOW.md` → Review Policy (`code-reviewer` + `mobile-reviewer`).

---

### Task 7: Held-draft store and draft emitter

**Files:**

- Modify: `client/hooks/useGeneratedRecipeNotices.ts`
- Test: `client/hooks/__tests__/useGeneratedRecipeNotices.test.ts`

**Interfaces:**

- Produces (exported):
  - `HELD_RECIPE_DRAFT_KEY = ["__heldRecipeDraft"] as const`
  - `interface HeldRecipeDraft { prefill: ImportedRecipeData; returnToMealPlan?: { mealType: string; plannedDate: string } }`
  - `setHeldRecipeDraft(qc, draft: HeldRecipeDraft | null): void`, `getHeldRecipeDraft(qc): HeldRecipeDraft | null`, `useHeldRecipeDraft(): HeldRecipeDraft | null`
  - `subscribeToRecipeDraftReady(listener: (draft: HeldRecipeDraft) => void): () => void`
  - `noteRecipeDraftReady(qc, draft: HeldRecipeDraft): void` — holds, then notifies.

- [ ] **Step 1: Write the failing tests** — `it("holds one draft, replacing any earlier one", …)`, `it("noteRecipeDraftReady holds the draft and notifies subscribers", …)`, `it("useHeldRecipeDraft returns null after setHeldRecipeDraft(null)", …)`, `it("queryClient.clear() drops the held draft", …)`.
- [ ] **Step 2: Run** `npx vitest run client/hooks/__tests__/useGeneratedRecipeNotices.test.ts` — Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** in the same file, same patterns as Task 1.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(recipes): held-draft store and draft-ready emitter"`

---

### Task 8: Background draft hook for the meal-plan screen

**Files:**

- Modify: `client/hooks/useRecipeGenerate.ts` (replace its body; keep the file name so the one call site's import stays)
- Test: `client/hooks/__tests__/useRecipeGenerate.test.ts` (create)

**Interfaces:**

- Consumes: Task 7 (`noteRecipeDraftReady`), Task 1 (`setPendingGeneration("mealPlan")`), same request/toast/haptic/token helpers as Task 2.
- Produces: `useRecipeGenerate(): { start: (prompt: string, returnToMealPlan?: { mealType: string; plannedDate: string }) => void }`.

- [ ] **Step 1: Write the failing tests** — mirror Task 2's cases with `entry: "mealPlan"`, route `/api/meal-plan/recipes/generate`, body `{ prompt }`, success → `noteRecipeDraftReady` called with `{ prefill: <json>, returnToMealPlan }` and no saved-items invalidation; non-4xx failure → `toast.error("Couldn't generate the recipe")` (no "check Saved items" variant, spec §5b); sign-out guard; deadline; single-flight.
- [ ] **Step 2: Run** `npx vitest run client/hooks/__tests__/useRecipeGenerate.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** — same shape as Task 2; extract the shared deadline/token/4xx-message helpers into `client/hooks/useGenerateRecipeInBackground.ts` exports (`withDeadline`, `serverMessageOf`) rather than duplicating.
- [ ] **Step 4: Run** both hook test files — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(meal-plan): AI recipe draft generates in the background"`

---

### Task 9: Draft toast bridge and nested open helper

**Files:**

- Modify: `client/navigation/MainTabNavigator.tsx`
- Test: `client/navigation/__tests__/MainTabNavigator.test.tsx`

**Interfaces:**

- Consumes: Task 7 (`subscribeToRecipeDraftReady`, `noteRecipeDraftReady`, `setHeldRecipeDraft`).
- Produces: `function openRecipeCreate(draft: HeldRecipeDraft): void` (exported for tests) — `navigationRef.navigate("Main", { screen: "MealPlanTab", params: { screen: "RecipeCreate", params: { prefill: draft.prefill, returnToMealPlan: draft.returnToMealPlan }, pop: true } }, { pop: true })`, then `setHeldRecipeDraft(qc, null)`; `function RecipeDraftToastBridge(): null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows 'Recipe draft ready — tap to review' with a Review action when a draft lands", …)
it("Review spells out Main → MealPlanTab → RecipeCreate with pop at both levels and clears the held draft", …)
  // expect navigationRef.navigate toHaveBeenCalledWith("Main", { screen: "MealPlanTab", params: { screen: "RecipeCreate", params: { prefill, returnToMealPlan }, pop: true } }, { pop: true })
```

- [ ] **Step 2: Run** the file — Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** beside the other two bridges; mount `<RecipeDraftToastBridge />` next to them.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(nav): draft-ready toast with a nested-route Review action"`

---

### Task 10: The meal-plan screen lets go

**Files:**

- Modify: `client/screens/meal-plan/RecipeAIGenerateScreen.tsx` (`handleGenerate` ~line 74; `isDisabled` ~88; add the banner above the form)
- Test: `client/screens/meal-plan/__tests__/RecipeAIGenerateScreen.test.tsx` (create; the directory exists — follow `CookbookCreateScreen.test.tsx` there for how screens are rendered with a mocked `navigation` prop)

**Interfaces:**

- Consumes: Task 8 (`useRecipeGenerate().start`), Task 1 (`usePendingGeneration("mealPlan")`), Task 7 (`useHeldRecipeDraft`), Task 9 (`openRecipeCreate`).

- [ ] **Step 1: Write the failing tests**

```ts
it("starts the draft with the trimmed prompt and returnToMealPlan, then goes back", …)   // mockStart called; navigation.goBack called
it("disables Generate with the pending caption while a draft is in flight", …)           // setPendingGeneration(qc, "mealPlan", true)
it("shows the 'Your draft is ready' banner with a Review button while a draft is held", …) // setHeldRecipeDraft(qc, draft); press Review → openRecipeCreate(draft)
it("ignores a second tap in the same frame", …)
```

- [ ] **Step 2: Run** `npx vitest run client/screens/meal-plan/__tests__/RecipeAIGenerateScreen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** — `handleGenerate` becomes synchronous: guard, `haptics.selection()`, `start(trimmed, returnToMealPlan)`, `navigation.goBack()`. Remove the inline `isError` state. Banner: a `Card` with `"Your draft is ready"` and a `"Review"` button, rendered only when `useHeldRecipeDraft()` is non-null.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(meal-plan): Generate returns to the plan; draft banner for a missed toast"`
- [ ] **Step 6: PR 2** — push (preflight), simulator check (generate from the meal plan → back on the plan → toast → Review opens the editor prefilled; kill the toast, reopen the generate screen → banner → Review), open the PR, one review pass.

---

### Task 11: The model row and the output cap (PR 3)

**Files:**

- Modify: `server/lib/ai-models.ts:56`
- Modify: `server/services/recipe-generation.ts:174` (`max_completion_tokens: 2000` → `4000`)
- Test: `server/lib/__tests__/ai-models.test.ts` (`SWITCHED` map ~line 29); `server/services/__tests__/recipe-generation.test.ts` (exists; nothing asserts the cap today — add the case there).

**Interfaces:**

- Produces: `AI_FEATURES["recipe-generate"] = { model: "google/gemini-4-argon", fallback: "gpt-4o", json: true, vision: false }`.

- [ ] **Step 1: Write the failing tests** — add to `SWITCHED`: `"recipe-generate": { model: "google/gemini-4-argon", fallback: "gpt-4o", json: true, vision: false }`; in the recipe-generation service test, `it("sends a 4000-token output cap", …)` asserting the `aiChat` mock was called with `expect.objectContaining({ max_completion_tokens: 4000 })`.
- [ ] **Step 2: Run** `npx vitest run server/lib/__tests__/ai-models.test.ts server/services/__tests__/recipe-generation.test.ts` — Expected: FAIL ("switched rows are exactly the approved ones" and the cap test).
- [ ] **Step 3: Implement** the two one-line changes.
- [ ] **Step 4: Run** — Expected: PASS, including "every row's model has a pinned OpenRouter host".
- [ ] **Step 5: Commit** — `git commit -m "feat(ai): recipe-generate on Gemini 4 Argon; raise the output cap to 4000"`
- [ ] **Step 6: PR 3** — push, open the PR with the eval table from the spec §1 in the body, one review pass (`code-reviewer` + `ai-reviewer`). After merge: owner-approved baseline refresh (`evals-nightly.yml` with `rebaseline`, or `eval:compare --suite recipe-generation --write-baseline`), and note in the PR that the dairy-regex false positives (todo `P2-2026-10-17-recipe-eval-dairy-regex-plant-milk-false-positives.md`) may show as "new assertion failures" until that todo lands.
