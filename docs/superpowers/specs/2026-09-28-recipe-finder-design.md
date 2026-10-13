# Recipe Finder — local-first recipe requests in Coach Pro and RecipeChef

**Date:** 2026-09-28 · **Status:** design approved in chat; advisor review applied (5 fixes); awaiting user spec review · **Path:** architectural
**Supersedes:** "PR B" (Coach → RecipeChef handoff / Spoonacular cards) from the 2026-09-28 session.

## 1. Why

- **RecipeChef always generates.** On 2026-09-28, the Home → Generate Recipe drawer produced a generated recipe for "Mediterranean" without offering any existing recipe. That's because its system prompt says to always add a JSON recipe (`server/services/recipe-chat.ts:170-172`).
- **Coach Pro can't show a recipe.**
  - Its only recipe tool, `search_recipes`, is Spoonacular-only (`coach-tools.ts:562-571`) and returns no macros.
  - Its `recipe_card` needs `calories`, `protein` and `recipeId`, and the #1087 prompt rule forbids estimating them. So recipe answers come back as bold prose.
- **The goal:** a recipe request in either chat should first offer existing community recipes, then Spoonacular, then generation, with a short clarifying step when nothing fits. The whole flow stays inside the chat.

## 2. Decisions (user rulings, 2026-09-28 — do not re-ask)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Both chats behave identically.** One shared flow in Coach Pro and RecipeChef.                                                                                                                                                                                                                                                                                                                                                  |
| D2  | **Local means community only.** Public community recipes via the existing search index. Not meal-plan or private chat-saved recipes. The catalog will grow as content agents add community recipes daily after launch.                                                                                                                                                                                                           |
| D3  | **3–5 close matches first**, shown as tappable items. Tapping one opens that recipe's detail page (viewing a result, not leaving the flow).                                                                                                                                                                                                                                                                                      |
| D4  | **Every list offers the same buttons:** _Search Spoonacular_, _Generate_, _None of these_.                                                                                                                                                                                                                                                                                                                                       |
| D5  | **The whole flow is in the chat.** Spoonacular results appear as a list in the chat, not by opening Recipe Browser. _Generate_ makes a recipe card in the chat, as RecipeChef does today, with Save on the card.                                                                                                                                                                                                                 |
| D6  | **After _None of these_:** ask 2–3 clarifying questions → search the community again → if still nothing, generate in the chat.                                                                                                                                                                                                                                                                                                   |
| D7  | **Tiers:** Coach Pro and RecipeChef only. Free Coach is unchanged, with a prose answer.                                                                                                                                                                                                                                                                                                                                          |
| D8  | **Approach 2: the server runs the flow.** The server owns the steps; the AI fills specific ones. The model does not orchestrate, and there are no tool loops.                                                                                                                                                                                                                                                                    |
| D9  | **A per-user cap of 10 Spoonacular list searches a day**, as a server setting that can be changed.                                                                                                                                                                                                                                                                                                                               |
| D10 | **The flow repeats for a new request after a recipe card** ("now a dessert" gets a new list). Refinements of the current recipe ("make it spicier") still update it in place. The user expects the experience to repeat.                                                                                                                                                                                                         |
| D11 | **Spoonacular results open as a preview, with nothing saved.** The preview page shows the recipe from `GET /api/meal-plan/catalog/:id`, with nutrition. **Save** on the preview runs the existing catalog save (`POST /api/meal-plan/catalog/:id/save` → `storage.createMealPlanRecipe`, which normalizes every catalog save, `server/storage/meal-plan-recipes-crud.ts:115-121`) and adds the recipe to the user's own recipes. |

## 3. Architecture

### 3.1 Server module `server/services/recipe-finder/`

It has small, single-purpose step functions, each testable in isolation.

| Step                                       | Contract                                                                                 | Implementation                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extractQuery(text, context)`              | Returns `RecipeQuery {q, cuisine?, diet?, maxPrepTime?, mealType?}`                      | One small, JSON-mode AI call. On error or timeout it returns `{q: rawText}`.                                                                                                                                                                                                                                                                                 |
| `findCommunity(query, userId, excludeIds)` | Returns 0–5 `FinderItem`s above the close-match threshold                                | `searchRecipes({…query, source: "community", safeForMe: true})` (`server/services/recipe-search.ts:152`). **If the filtered search returns nothing, it retries once with `q` only** (plus `safeForMe`) before declaring no matches. Structured filters like `cuisine` hit a column that is often null, and would otherwise zero out a small catalog.         |
| `findOnline(query, user)`                  | Returns 0–5 `FinderItem`s (title, image, readyInMinutes; no nutrition), or `unavailable` | `searchCatalogRecipes` (`server/services/recipe-catalog.ts:209`) with intolerances. No `addRecipeNutrition`. **No list cache in production.** `cachedFetch` is a dev-only record/replay cache (`server/services/dev-api-cache.ts:21-50`), so each list search costs a point. Only the _detail_ fetch is cached, for 60 minutes.                              |
| `askClarifying(request, history)`          | Returns 2–3 `{question, options[]}`                                                      | A JSON-mode AI call. On failure it returns fixed questions (time, cuisine, diet).                                                                                                                                                                                                                                                                            |
| `classifyTurn(message, currentRecipe)`     | Returns `new_request` \| `refine_current` \| `other`                                     | One small, JSON-mode AI call, run only on messages sent **after a recipe card exists** in the conversation. **On error or timeout it returns `new_request`.** Showing a list by mistake is recoverable (tap Generate, or type again); silently rewriting the user's recipe is not.                                                                           |
| `generate(request, answers, user)`         | Returns the recipe card                                                                  | The existing RecipeChef generation path (`generateRecipeChatResponse`), reused, with the flow's refined request as input. **It applies the `recipeGeneration` premium check and the 20/day generation limit itself.** Today those live only in the recipe/remix chat route (`server/routes/chat.ts:317-329`), so the Coach path would otherwise bypass both. |

The module also exports the flow's state-transition function. It's pure: `(finderState, input, stepResults) → next`, and the table-driven tests target it.

### 3.2 Message type

- A new assistant-message metadata kind, `recipe_results`: `{source: "community"|"spoonacular", items: FinderItem[], actions: FinderAction[]}`.
  - It's stored like RecipeChef's recipe metadata today (`shared/schemas/recipe-chat.ts`).
  - Coach registers it as a new block type in `shared/schemas/coach-blocks.ts`.
- Clarifying messages carry `{questions: {question, options[]}[]}`.
- Both kinds also carry `finder: {flowId, stage: "results"|"clarifying", query, round, shownIds}`.
- **Plain-text fallback.** Every flow message's `content` is readable on its own, e.g. "Here are 4 community recipes: 1. Mediterranean Quinoa Salad (20 min) …". An app version without the new component still shows something sensible.

### 3.3 Entry points

- **RecipeChef (per D8 and D10):**
  - The flow runs on a conversation's **first user message**, and on every message **while a flow is active** (stage `results` or `clarifying`).
  - After a **recipe card exists**, each message goes through `classifyTurn`:
    - **`new_request`** ("now a dessert", "something with salmon instead") **starts the flow again from the top**: a new list with the same three buttons.
    - **`refine_current`** ("make it spicier", "swap the chicken for tofu", "double it for 8") refines the card on screen, as today.
    - **`other`** ("thanks!", "how long does it keep?") gets a normal chat reply.
  - **Remix mode** never enters the flow.
- **Coach Pro, after a generated card:** the same `classifyTurn` routing, so both chats behave identically (D1). Before a card exists, Coach's intent classifier (below) decides as usual.
- **Coach Pro:** `coach-intent-classifier.ts` gains a `recipe_request` intent, which routes to the module (`CoachIntent` is at line 1). Free Coach is unchanged.
- **Coach's existing `search_recipes` tool is retired** from `TOOL_DEFINITIONS` (`coach-tools.ts`). If it stayed, the model could still call it on any message the classifier doesn't route to `recipe_request`, and produce the prose "couldn't find" answer this feature replaces. In Coach, recipe discovery goes only through the finder.

### 3.4 Button actions

- A tap sends a structured action, `{type: "search_online"|"generate"|"none_of_these"|"answers", flowId, answers?}`, to each chat's existing authenticated send-message endpoint.
- The server derives the next step from the latest stored `finder` state, never from the action's text.
- Actions never come from route params: after #1147/#1148, links cannot trigger them.

## 4. Flow

```
request → extractQuery → findCommunity
  ├─ 1–5 matches → LIST(community)   [Search Spoonacular][Generate][None of these]
  └─ 0 matches   → "No community recipes matched." + same three buttons
[Search Spoonacular] → findOnline → LIST(spoonacular)  [Generate][None of these]
[Generate]           → generate → recipe card in chat
[None of these]      → askClarifying → questions + single-select chips (+ free text)
   answers → extractQuery(request + answers) → findCommunity(excluding shownIds)
      ├─ matches → LIST  [Search Spoonacular][Generate][None of these → generate]
      └─ none    → generate

after a recipe card: each message → classifyTurn
   ├─ new_request    → back to the top (new list)
   ├─ refine_current → refine the card, as today
   └─ other          → normal chat reply
```

- **There is at most one clarifying round.** A second _None of these_ generates, so the flow can't loop.
- **Only the latest flow message's buttons are active.** Older ones render disabled. The server ignores a stale `flowId`, and a repeated action is idempotent.
- **Typed input:**
  - _Clarifying stage:_ the text counts as answers. The chips are optional shortcuts, and partial answers are fine.
  - _Results stage:_ the text refines the search, re-running `extractQuery` on the original request plus the addition.
  - _Otherwise:_ RecipeChef follows the §3.3 rule, and Coach's intent classifier decides.
- **Close match:**
  - Keep only hits scoring **at least a fixed fraction of the best hit's score**. The cut-off is relative because MiniSearch scores aren't normalized, and an absolute cut-off drifts as the catalog grows.
  - Add a small absolute floor, so a lone weak hit isn't shown.
  - Both values are **measured**, not guessed (see §7).

## 5. Client

- **Shared components** live in `client/components/recipe-finder/`. `RecipeChatScreen` renders them from message metadata, and Coach's block renderer (`client/components/coach/blocks/index.tsx`) renders them as a block. Both chats draw the same component.
- **The generated card is RecipeChef's existing `client/components/recipe-chat/RecipeCard.tsx`, in both chats.**
  - In Coach it renders from the generated message's metadata, which has the same `recipe` shape as RecipeChef's. It does **not** use Coach's `recipe_card` block, which requires a `recipeId` and macros that a fresh generation doesn't have.
  - **Save** uses the existing chat-recipe save (`server/routes/recipe-chat.ts` → `storage.saveRecipeFromChat`). That checks conversation and message ownership only (`server/storage/recipe-from-chat.ts:35-54`). The plan must confirm the route accepts a `type: "coach"` conversation, and extend it if not (§9).
- **`RecipeResultsList`:**
  - **Header:** "From the community" / "From Spoonacular".
  - **Rows:**
    - a thumbnail, or a neutral placeholder icon, never an empty grey box;
    - the title;
    - a meta line, e.g. "20 min · 350 cal", with calories only when known;
    - a chevron.
  - **Buttons:** _Generate_ is filled (`theme.accentSolid`); _Search Spoonacular_ and _None of these_ are outlined (`theme.link`).
- **Row tap:**
  - A community row opens `FeaturedRecipeDetail {recipeId, recipeType: "community"}`.
  - A Spoonacular row opens the same online-recipe detail that Recipe Browser uses (see §9 open item 1).
- **Clarifying UI:** the questions appear as chat text. Under each question is a row of single-select chips. **Search with these** sends the chosen answers; typing a reply also works.
- **Progress text:** the thinking bubble shows "Searching community recipes…", "Searching Spoonacular…" or "Creating your recipe…".
- **Accessibility:**
  - The list is announced as a list, with "Found N community recipes" when it arrives.
  - Each row is one button labelled "Title, N minutes, N calories. Opens recipe."
  - Chips expose their selected state, and disabled old buttons announce as disabled.
  - Touch targets are at least 44pt.

## 6. Errors, quota, premium

| Failure                                   | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractQuery` AI error or timeout        | Search the raw text with no filters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Search index not ready (boot)             | Treated as 0 matches, with all three buttons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SPOONACULAR_API_KEY` unset               | _Search Spoonacular_ hidden (same check as `/api/meal-plan/catalog/config`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Spoonacular 402 (quota), error or timeout | "Spoonacular isn't available right now. Try Generate or a community pick." Never shown as "no results".                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Per-user cap reached (D9)                 | The same "not available right now" message. **The count is stored in the database, not in memory.** The in-memory rate limiters (`server/routes/_rate-limiters.ts:129`) reset on every deploy, and production restarted 13 times on 2026-09-28. The check and the record happen atomically, in one transaction, following the existing daily-limit precedent (`server/storage/chat.ts:312`). The plan chooses between counting the user's `source: "spoonacular"` `recipe_results` messages from today (no migration) and a small dedicated usage table. |
| `askClarifying` failure                   | Fixed questions: time, cuisine, diet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Generation failure                        | The existing RecipeChef error and Retry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Daily generation limit (20/day premium)   | _Generate_ explains the limit. Community and Spoonacular stay usable. The limit is enforced in the `generate` step for **both** chats; today only RecipeChef's route enforces it.                                                                                                                                                                                                                                                                                                                                                                        |

- **Quota:** production's Spoonacular key is on about 200 points/day, shared by all users (measured 2026-09-28: `x-api-quota-left 198.93` after one search). List searches cost about 1 point each, and **repeat searches are not cached in production** (`cachedFetch` is dev-only). The per-user cap is the real bound. Nutrition is fetched only on detail open, where the 60-minute detail cache applies.
- **Allergies:** community search uses `safeForMe`, Spoonacular gets intolerances, and generation keeps its allergen warning.
- **Premium:** each action is also checked on the server. _Search Spoonacular_ needs `catalogSave`; _Generate_ needs `recipeGeneration`. If an account lacks one, that button shows a lock and opens the upgrade screen.

## 7. Testing

- **The state-transition table** covers every stage × input × outcome → next step: the round cap, stale `flowId`, double taps, and each §6 fallback. It is written first.
- **Step functions** are tested with the AI and Spoonacular mocked, and every fallback is forced.
- **The close-match threshold is measured against a gold set.**
  - The set is realistic requests, each marked right, wrong or none against a fixture copy of the community catalog, following `docs/solutions/logic-errors/food-name-matcher-whole-words-gold-set-2026-09-27.md`.
  - The chosen cut-off and its per-query scores go in the PR.
- **`classifyTurn` is measured against a gold set of realistic follow-ups,** each labelled with its correct class. Examples: "make it spicier", "swap chicken for tofu", "double it for 8", "now a dessert", "something vegan instead", "what about breakfast?", "can I freeze this", "thanks!". The measured accuracy goes in the PR, and the fallback path (`new_request`) is tested by forcing a failure.
- **Routes:**
  - each action through the real endpoint;
  - premium allow and deny for each gated action;
  - the per-user Spoonacular cap.
- **Client:**
  - `RecipeResultsList`: rows, placeholder image, accessibility labels, disabled old buttons;
  - chips: selection, _Search with these_, typed answers;
  - both chats render the same component.
- **Device:** a Maestro run of the whole flow in both chats before the flag is turned on.

## 8. Rollout

1. **PR 0 (independent): the recipe image bug.**
   - The server saves `metadata.imageUrl` (`server/routes/chat.ts:533`) while the card reads `metadata.recipe.imageUrl` (`RecipeCard.tsx:115`). So the picture disappears after refetch.
   - A null image (15s timeout) shows the same empty skeleton.
   - The fix is to read the right field and add a real "no image" state.
2. **PR 1 (server):**
   - the `recipe-finder` module;
   - the message types;
   - the actions;
   - the Coach intent;
   - the RecipeChef entry, and `classifyTurn` routing after a card in both chats;
   - the premium check and daily limit inside `generate`;
   - the database-backed Spoonacular cap;
   - retiring Coach's `search_recipes` tool, only while the flag is on, so Coach keeps today's behavior with the flag off.

   All of it sits behind `RECIPE_FINDER_ENABLED`, off by default, so merging changes nothing.

3. **PR 2 (client):** the shared components, wired into both chats, then a preview OTA.
4. **PR 3: flip the flag** in Railway after the user's on-device check. Turning it off again is one variable.

Server merges auto-deploy, but client changes need an OTA. The flag plus the text fallback (§3.2) keep the two independent.

## 9. Open items: resolved 2026-09-28 by reading the code

Each resolution below is binding for the plan; the original questions follow.

- **R1 (item 1, Spoonacular detail): a pre-existing HIGH bug.**
  - `RecipeBrowserScreen.tsx:553-560` sends a Spoonacular ID to `FeaturedRecipeDetail` as a _community_ ID, and that screen only fetches `/api/recipes/:id` or `/api/meal-plan/recipes/:id`. The result is a 404 or an unrelated recipe.
  - Coach's `RecipeCard` "View" (`blocks/RecipeCard.tsx:43-50`) is broken the same way.
  - Nothing in the client calls `GET /api/meal-plan/catalog/:id`.
  - **Fix (per D11):** add a `recipeType: "catalog"` branch to `FeaturedRecipeDetailScreen` that fetches `/api/meal-plan/catalog/:id` and shows a Save button (`useSaveCatalogRecipe`). Recipe Browser, Coach's `RecipeCard` and the finder all use it.
- **R2 (item 2, response delivery):** both chats share `POST /api/chat/conversations/:id/messages` (`server/routes/chat.ts:266`).
  - **RecipeChef:** branch before `generateRecipeChatResponse`, write one SSE `{finder: …}` event, and fall through to the shared `{done:true}`. Persist `{metadataVersion:1, finder:{…}}` via `createChatMessage`. The client adds a `finder` case to `useSendMessage`'s `processLine`, and extends `usePendingAssistantBridge`'s `isPresent`.
  - **Coach Pro:** return early in `handleCoachChat` after `classifyIntent` (`coach-pro-chat.ts:530`). Yield short `content`, persist `{blocks:[finderBlock]}` with `turnKey`, then yield `{type:"blocks"}`, mirroring the cached-response path (746-761, 819-876).
  - **Request field:** a new optional body field, `finderAction`, carries button actions. The existing `screenContext` field can't: it's free text, sanitized and capped at 200 characters.
  - **⚠ The quota trap:** `createChatMessageWithLimitCheck` (`chat.ts:345`) counts **every** recipe-chat message against the daily generation limit before anything is streamed. Finder steps (list, buttons, questions) must branch **before** that check. Only a **Generate** step counts against the limit, in both chats (§6).
- **R3 (item 3, threshold):** `searchRecipes` sorts by MiniSearch score and then **throws the scores away** (`recipe-search.ts:209-218, 365-371`). The plan adds an opt-in `includeScores` that returns them.
  - **Community rows always have `cuisine: null` and a null prep time** (`search-index.ts:128,135`). A `cuisine` filter only matches through diet tags, and `maxPrepTime` **excludes every community recipe**.
  - So for community searches, the finder **puts cuisine into `q` and never sends `maxPrepTime`**. Time preferences only shape clarifying questions and generation.
- **R4 (item 4, intent):** `classifyIntent` is pure regex, first match wins (`coach-intent-classifier.ts:126`).
  - `recipe_request` goes **after the safety rules and before the vague and general_fact rules**.
  - The `"meal ideas"` → vague test (:149) changes on purpose.
  - Five `evals/datasets/coach-cases.json` expectations flip to `recipe_request`. `personalization-screen-context-recipe-01` ("Is this a good recipe for me today?") must **not** route.
  - `getSystemPromptTemplateVersion`'s hard-coded intent list (`nutrition-coach.ts:492`) must include the new intent.
- **R5 (item 5, Coach save):** `POST /api/chat/conversations/:id/save-recipe` checks ownership only, not conversation type (`server/routes/recipe-chat.ts:46-137`), and the metadata schema tolerates extra keys. A Coach message whose top-level metadata also carries `{metadataVersion:1, recipe, allergenWarning, imageUrl}` saves with **no server change**. The Coach client needs a Save call (`useSaveRecipeFromChat`).
- **R6 (item 6, Coach blocks):** add `recipeResultsSchema` and `recipeQuestionsSchema` to `coachBlockSchema` (`shared/schemas/coach-blocks.ts:286`). Otherwise the client's `filterValidBlocks` silently drops them. Add `BlockRenderer` cases and fixture entries. They're built by the server, so there's no prompt listing.
- **LLM helper:** there is no shared JSON helper. The finder's AI steps follow `server/services/food-nlp.ts:74-105`: `MODEL_FAST`, `response_format: json_object`, `OPENAI_TIMEOUT_FAST_MS`, `sanitizeUserInput`, `SYSTEM_PROMPT_BOUNDARY`, and `validateAiResponse(data, zodSchema)`.

### Original open items

1. **Spoonacular detail navigation.** `RecipeBrowserScreen.tsx:555-559` opens `spoonacular` items on `FeaturedRecipeDetail` with `recipeType: "community"`. Verify whether online results are imported as community rows first. If they aren't, the finder needs the real online-detail route. (A related suspected bug: Coach's `RecipeCard` "View" sends `{recipeId, source}`, `blocks/RecipeCard.tsx:43-48`.)
2. **Streaming.** How the flow's non-streamed messages (lists, questions) fit each chat's SSE path. RecipeChef streams through `useSendMessage`; Coach streams blocks. The plan must pick one response shape per chat.
3. **Close-match threshold.** Measured per §7; the gold-set fixture needs the community catalog's content (public recipes, not user data).
4. **`recipe_request` intent rules.** Which phrasings route to the flow versus the existing Coach tools (e.g. "log this recipe" must not). Decide with test cases.
5. **Coach save path.** Confirm that save-from-chat accepts a Coach conversation and a Coach message's metadata shape (§5). Extend the route if it filters by `type`.
6. **Server-built Coach blocks.** The server builds lists and questions, not the model, so they bypass Coach's AI block parser (`coach-pro-chat.ts:524`). They need their own way to attach to the message's blocks.
7. **Old-client guard.**
   - After the flag flips, an app without the new component sees the text list but no buttons. In the results stage, typed text only refines, so that app has no path to Generate.
   - The guard: the server also treats typed _"generate"_ and _"none of these"_ (exact short phrases) as their button actions.
   - Before launch, the §8 order limits this; the guard covers anyone who skips the OTA.
8. **PR 0 direction.** The minimal fix is for the card to read `metadata.imageUrl ?? metadata.recipe.imageUrl`, which matches the schema (`imageUrl` is top-level in `recipeChatMetadataSchema`), plus a real "no image" state for `null`.

## 10. Out of scope

- Searching meal-plan or private chat-saved recipes (D2).
- Free Coach (D7).
- Changes to recipe generation itself, the search index, or detail screens.
- Content agents that populate the community catalog.
