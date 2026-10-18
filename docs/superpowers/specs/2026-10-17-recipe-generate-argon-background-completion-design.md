# Recipe generation on Gemini 4 Argon, with the sheet that lets go

**Date:** 2026-10-17
**Status:** owner questions answered 2026-10-17; awaiting approval of this document
**Amends:** `2026-10-06-openrouter-model-routing-design.md` (adds a second switched row and a client-side completion pattern). Related memory: gpt-4o retirement (OpenAI direct 2027-01-14, Azure via OpenRouter 2027-04-14).

## 1. Intent and why

gpt-4o, which writes every generated recipe today, retires. The owner also wants less predictable recipes: the eval's creativity score for gpt-4o is 6.7 out of 10 and the same dish comes back three times out of three for the same request.

On 2026-10-17 the `recipe-generate` row was measured against Gemini candidates (12 eval cases × 3 samples, judge `anthropic/claude-sonnet-4.6`, paired against a same-session gpt-4o control):

| Candidate                    | Creativity | Diff vs gpt-4o (95% CI)  | Dietary | Real assertion fails | p50 / p90 / max latency |
| ---------------------------- | ---------- | ------------------------ | ------- | -------------------- | ----------------------- |
| gpt-4o control               | 6.72       | —                        | 9.22    | 0 of 36              | 4.0 s / 4.5 s / 33 s    |
| **Gemini 4 Argon, default**  | **8.69**   | **+1.97 (1.64 to 2.28)** | 9.72    | 0 of 36              | 11.2 s / 12.4 s / 13 s  |
| Gemini 3.8 Flash, low effort | 8.31       | +1.58 (1.28 to 1.83)     | 9.53    | 0 of 36              | 5.4 s / 6.2 s / 9 s     |

The owner chose **Argon** (better recipes) and accepted its 11–13 s wait on one condition: the generation sheet must not hold the user in a locked modal for it. Today the sheet (`client/components/RecipeGenerationModal.tsx`) disables every control, says "This may take a few seconds while we create your recipe...", and refuses to close until the response arrives. On success it just closes with a haptic; the recipe is already in Saved items (server side), but nothing tells the user that.

So this project has two halves that ship together:

1. `recipe-generate` moves to `google/gemini-4-argon`.
2. Tapping **Generate** closes the sheet at once. The recipe keeps generating. When it lands, the user gets a toast ("Recipe ready — tap to open") and an unread dot on the **Profile** tab, where Saved items live. The toast's action opens the recipe.

## 2. Goals, non-goals, anti-goals

**Goals**

- Generated recipes come from Gemini 4 Argon via OpenRouter on the already-pinned Google Vertex host.
- The user never waits inside the sheet. Generate = tap, sheet gone, carry on.
- A finished recipe is announced (toast) and findable (dot on Profile → Saved items), whichever screen the user is on, including if they left the photo-analysis screen.
- Failure is announced quietly (error toast). A server-side failure saves nothing (already true); a lost response after the server saved is handled per §5.

**Non-goals**

- The coach's and RecipeChef's recipe cards. They use the `recipe-chat` row and get their own eval run first (todo `P2-2026-10-17-recipe-chat-row-model-eval-before-switch.md`). The coach conversation stays on GPT-6 Luna (ruling 2026-10-06).
- Persisting meal-plan drafts server side. The meal-plan "generate with AI" screen **is** in scope (owner, 2026-10-17: "background process"), but its draft stays on the device (§5b). Server-side drafts are a possible follow-up, not this project.
- Cooking-session recipe generation (`/api/cooking/sessions/:id/recipe`) and inspired-recipe "Make" (`/api/inspired/suggestions/:id/make`). Both already let the user keep using the app; they just get the slower, better model. The dev-only `server/scripts/seed-recipes.ts` also calls this row and moves with it; harmless.
- Streaming the recipe, progress bars, or a skeleton. The sheet is gone; there is nothing to animate.
- Changing the direct-OpenAI fallback model (see §4).

**Anti-goals** (a failure even if it "works")

- A recipe that violates a stated allergy. Any model change must keep the safety-category eval cases at or above the control. In the 2026-10-17 runs **neither model produced a real allergen violation**: Argon passed 9 of 9 safety samples; gpt-4o's 7 of 9 were two "coconut milk" hits from the over-broad dairy regex on the multi-allergy case (the harness defect in §3), not unsafe recipes.
- A toast or dot that fires after the user signed out, or for the next user. Mirror the coach's send-time token check (see §5).
- The user tapping Generate twice because the sheet closed "too fast" with no feedback. One haptic on the tap and the sheet dismissing is the feedback. Note the server does **not** stop a second submit: the limits are 20 per day (premium) and 3 per minute, so two taps mean two recipes, two daily units and two toasts. Owner ruling 2026-10-17: **one at a time** (§5, "Single-flight").

## 3. Constraints

- **One review pass per PR; strict TDD; feature branch; CI is the gate.** Project rules, unchanged.
- **Pinned hosts.** `hostForModel` pins `google/*` to `google-vertex`, which the privacy policy already names. No policy change for this project.
- **Argon accepts the parameters recipe generation already sends.** Verified by probe on 2026-10-17: `temperature: 0.85`, `max_completion_tokens: 2000`, `response_format: json_object` all accepted through OpenRouter on the Vertex host; `finish_reason: stop`; reported `reasoning_tokens: 0` with or without `reasoning_effort: low`. No adapt block is needed. (Gemini 3.8 Flash is different: thinking is mandatory and must be set to `low` or the 2000-token cap truncates the JSON. Not this project's model, but the builder should know why.)
- **Output cap: raise it to 4000 in PR 3.** Argon writes about 335 words per recipe against gpt-4o's 217 and used up to ~900 output tokens in the eval, so 2000 holds today. But the cap is shared with any thinking tokens, and this session found Gemini 3.8 Flash silently truncating JSON against it. Argon reports zero reasoning tokens as served today; Google can change that default. A higher cap costs nothing when unused (you pay for tokens produced, not the ceiling), so `max_completion_tokens` in `recipe-generation.ts` goes to 4000 in the same PR as the model row. Do not lower it.
- **The eval baseline refresh is a separate, owner-approved step** after the switch lands: trigger `evals-nightly.yml` with `rebaseline` for `recipe-generation`, or run `eval:compare --suite recipe-generation --write-baseline` locally and commit. The nightly compare is a no-regression gate; a better score passes without a refresh, so there is no rush.
- **Known eval-harness defect.** Three forbidden-term regexes in `evals/datasets/recipe-generation-cases.json` match plant milks and nut butters (todo `P2-2026-10-17-recipe-eval-dairy-regex-plant-milk-false-positives.md`). A re-run after the switch may show "new assertion failures" that are these false positives. Read the flagged ingredient lines before treating them as a regression.

## 4. The model row (decided)

In `server/lib/ai-models.ts`:

```ts
"recipe-generate": { model: "google/gemini-4-argon", fallback: "gpt-4o", json: true, vision: false },
```

- **Fallback stays `gpt-4o`** (owner ruling 2026-10-17: leave it, revisit nearer the retirement date with whatever is available then). The direct-OpenAI fallback path sends the row's params unchanged (`{ ...params, model: row.fallback }` in `ai-client.ts`), and `temperature` would 400 on any GPT-6 model, so moving it is not a one-word change. The direct client's gpt-4o shutdown is 2027-01-14.
- `server/lib/__tests__/ai-models.test.ts` has "switched rows are exactly the approved ones" and "every other row is its fallback with the openai/ prefix and no adapt". Extend the approved list with this row; the other assertions should pass untouched.
- No prompt change. The system prompt's "less obvious dish" instruction is what Argon is responding to.

## 5. The client completion pattern (decided)

Build on the coach's "reply keeps running + toast + dot" pattern, shipped in #1216. The pieces and their coach counterparts:

| Piece                            | Coach counterpart                                                                                                                                                                                                    | This project                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Request that outlives the screen | `useSendMessage(id, { notifyWhenAway })` in `client/hooks/useChat.ts`                                                                                                                                                | A hook (builder names it) that owns the `/api/recipes/generate` mutation. Correction after the builder check: nothing is needed to keep the callbacks alive — `PhotoAnalysisScreen` mounts the sheet unconditionally (closing hides it, no unmount), and TanStack v5 fires a `useMutation`'s `onSuccess`/`onError` even after its observer unmounts. Hoist the mutation into a hook for testability and so the success handling lives next to the unread/toast logic, not because the sheet would drop it. |
| Durable unread signal            | `client/hooks/useCoachUnreadReplies.ts` (ids in the query cache under a sentinel key with `gcTime: Infinity`, so `queryClient.clear()` on logout wipes it)                                                           | Same shape: a sentinel key holding the ids of recipes generated while away. Cleared when the recipe is opened **or** when Saved items is viewed (`SavedItemsScreen` focus).                                                                                                                                                                                                                                                                                                                                |
| Toast with an action             | `CoachReplyToastBridge` in `MainTabNavigator.tsx`, fed by a module-level emitter (`subscribeToCoachReplyReady`), per `docs/solutions/design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md` | A second bridge beside it. Toast: `info("Recipe ready — tap to open", { action: { label: "Open", onPress: openGeneratedRecipe } })`.                                                                                                                                                                                                                                                                                                                                                                       |
| Opening the thing                | `openCoachConversation` spells out the nested route via `navigationRef`                                                                                                                                              | `FeaturedRecipeDetail` is a **root-stack** screen, so `navigationRef.navigate("FeaturedRecipeDetail", { recipeId, recipeType: "community" })` is enough — the same params `SavedItemsScreen` uses.                                                                                                                                                                                                                                                                                                         |
| Dot on the tab                   | Coach tab composes `hasPending                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | hasUnreadCoachReply` into one dot with an accessibility label | Profile tab gets the same dot, label "Profile, new recipe". The Profile tab has no dot today; copy the Coach tab's rendering. |
| Not after sign-out               | send-time auth-token comparison at `done`                                                                                                                                                                            | Same check before marking unread or emitting the toast.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Single-flight (owner ruling 2026-10-17)**

- The hook tracks at most one pending generation per entry point (photo sheet; meal-plan screen). While one is pending, the sheet's Generate button is disabled with the caption "A recipe is on its way" if the user reopens it, and the meal-plan screen's Generate button likewise. A same-frame double-tap ref (the #1489 pattern) guards the first tap itself.
- The pending state lives in the same query-cache sentinel area as the unread ids, so it clears on logout with everything else.

**The sheet (`RecipeGenerationModal.tsx`) after the change**

- Tap Generate → medium haptic (exists) → call the hook → `onClose()` immediately. The `isGenerating` lock, the in-sheet spinner, and the "This may take a few seconds" caption go away. The error banner and its iOS VoiceOver announcement go away too; errors now arrive as the error toast.
- Form reset (servings, diets, time, share) happens on submit, not on success, since the sheet is gone by then.
- `onComplete` on `PhotoAnalysisScreen` currently closes the sheet and fires a success haptic. The success haptic moves to the hook's success path (so it fires when the recipe lands, together with the toast). `onComplete` becomes unnecessary; the builder removes or repurposes it.

**Success path (hook)**

1. Invalidate `["/api/saved-items"]` and `["/api/saved-items/count"]` (exists).
2. If the auth token still matches the one captured at submit: mark the recipe id unread, emit "recipe ready".
3. Success haptic.

**Failure path (hook)** — my call after the builder check

- Error haptic (exists) and an error toast with the server's message where it is user-facing (daily limit reached, premium required) or a generic one otherwise. No dot. The server's early limit check runs **before** the AI call, so limit errors arrive within a second of the sheet closing.
- The client cannot always tell whether the server saved: `apiRequest` is a bare `fetch` with no timeout, the server commits the recipe and the Saved-items row **before** replying, and iOS may drop the socket if the app is backgrounded during the 11–13 s. So: the hook gives the request its own deadline of 60 s (matching `OPENAI_TIMEOUT_HEAVY_MS`), and on **any** error or timeout other than a 4xx it still invalidates `["/api/saved-items"]` and `["/api/saved-items/count"]` and words the toast as "Couldn't confirm the recipe — check Saved items". A 4xx (limit, premium, validation) keeps the plain error copy, because the server did not save.
- `SavedItemsScreen` refetches on focus (it has no focus refetch today and a 5-minute default `staleTime`), so a recipe whose response was lost shows up as soon as the user looks.

### 5b. The meal-plan "generate with AI" screen (owner: background too; mechanism is my call)

`RecipeAIGenerateScreen` posts to `/api/meal-plan/recipes/generate`, which returns an **unsaved** draft, and today replaces itself with `RecipeCreate` prefilled with that draft (`navigation.replace("RecipeCreate", { prefill: result, returnToMealPlan })`). Nothing is saved until the user saves the editor.

After the change:

- Tap Generate → haptic → the hook starts the request → the screen pops back to where the user came from (the meal plan).
- On success the hook keeps the draft in the query cache under a sentinel key (gcTime Infinity, wiped on logout like the unread ids) and emits "draft ready". Toast: "Recipe draft ready — tap to review", action opens `RecipeCreate` with `{ prefill, returnToMealPlan }` and clears the held draft. **`RecipeCreate` is nested** in `MealPlanStackNavigator` under the `MealPlanTab` tab, so a bare `navigationRef.navigate("RecipeCreate")` would be silently dropped. The builder adds an `openRecipeCreate` helper that spells out `Main → MealPlanTab → RecipeCreate` with `pop: true` at both levels, mirroring `openCoachConversation` and `docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`.
- No tab dot for drafts: there is no list the dot could point at. Instead, while a draft is held, reopening `RecipeAIGenerateScreen` shows a "Your draft is ready — Review" banner above the form, so a missed toast is recoverable.
- Failure: same error-toast rules as §5. There is no "check Saved items" variant, because this route never saves; a lost response means the draft is gone, the same as leaving the screen today.
- The draft lives only on the device. If the app is killed before the user taps Review, it is lost. Persisting drafts server side would remove that and is left as a follow-up todo if the owner wants it.

**Timing the user sees:** tap → sheet closes (instant) → about 11–13 s later: haptic + toast + dot. If they are still on the photo-analysis screen, the same toast shows there; the toast provider is app-wide.

## 6. Rollout (my call, owner can change)

Three PRs, each with one review pass:

1. **Photo sheet first:** the completion pattern (§5) against today's gpt-4o. Merges independently; the only visible change is that the sheet no longer waits, and the user now gets told when the recipe lands (a gap today).
2. **Meal-plan screen second:** §5b, reusing the hook, emitter and bridge from PR 1.
3. **Model row last:** the one-line table change plus the test update. Nothing else.

Order matters: shipping the model first would give users the 13-second locked sheet in between. PRs 1 and 2 may be one PR if the builder finds the shared pieces make the split artificial; keep PR 3 separate regardless.

After PR 3 lands: owner-approved baseline refresh (§3). Owner also cooks from a few generated recipes before the nightly compare is treated as the only signal.

## 7. Owner rulings (2026-10-17)

0. A second Generate while one is in flight: **one at a time.** (§5 Single-flight.)
1. Meal-plan "generate with AI" screen: **background process too.** Mechanism (device-held draft, toast + banner, no server-side draft) is my call — §5b.
2. Direct-OpenAI fallback: **leave on gpt-4o for now**; revisit nearer the retirement date with whatever is available then.

## 8. Left to the builder

- Hook, emitter, and sentinel-key names; file placement next to `useCoachUnreadReplies.ts`.
- Test structure: the coach pattern has tests under `client/hooks/__tests__/` and `client/navigation/__tests__/MainTabNavigator.test.tsx`; mirror them.
- Exact dedupe behaviour if the same recipe id is emitted twice.
- Whether the Profile dot and the Coach dot share a small component or stay as two copies (prefer the smaller diff).
- Removing now-dead strings and the iOS live-region announcement from the sheet.
- The 60 s client deadline: React Native's fetch does not reliably expose `AbortSignal.timeout` (Hermes gaps are a known class here), so use `AbortController` + `setTimeout`.
- The sheet's iOS VoiceOver announcement goes away, so the error toast must carry the announcement. `Toast.tsx` already calls `announceForAccessibility` and sets a polite live region; confirm the error variant announces on iOS.
- Tapping the toast's Open while `PhotoAnalysisScreen` (a root `presentation: "modal"` route) is still up: `FeaturedRecipeDetail` is root-stack, so a push on top may be fine, but it is the same path the bare-navigate solution doc covers; test it on the simulator, and use `pop: true` if the modal should dismiss first.
- Confirm `FeaturedRecipeDetailScreen` renders `imageUrl: null` gracefully: the toast fires on the 201 while the hero image is still generating (5–30 s), and "tap to open" makes an immediate open likely. Same exposure as today, just more visible.
