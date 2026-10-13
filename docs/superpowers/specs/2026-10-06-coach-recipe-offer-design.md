# Coach Recipe Offer: the coach offers, you adjust, then it generates

**Status:** design approved in chat 2026-10-06; spec-review round 1 (verdict: revise) applied 2026-10-06; awaiting owner review
**Supersedes:** `todos/P2-2026-10-07-coach-recipe-from-own-suggestion.md` (regex-patch plan)
**Amends:** Recipe Finder spec `2026-09-28-recipe-finder-design.md`. Ruling "Approach 2" (no model tool loops for recipes) was reopened by the owner on 2026-10-06. The server still owns every step; the model makes one judgement, "offer a recipe for this dish".

## 1. Problem

Coach Pro decides whether a message is a recipe request with a regex (`classifyIntent` → `RECIPE_REQUEST_PATTERNS`), and it runs that regex before any model has read the conversation. As a result:

- Phrasings miss: "turn that into a recipe", "make me a recipe for…", "come up with…". There are 6 ❌ rows in the todo's probe table.
- Referents can't be resolved. "That" means the coach's previous suggestion, which a regex cannot see.
- Model-drawn recipes still leak. With `RECIPE_FINDER_ENABLED` on (prod), `search_recipes` is already filtered out of the Pro tools (`nutrition-coach.ts` ~649). But a regex miss still reaches the Pro tool loop, and the Pro block instructions still let the model draw its own `recipe_card`. That bypasses the finder's daily limit, claim/refund and save flow. With the finder flag off, `search_recipes` is live too.

Separately, generation fires immediately. There is no step where the user can set servings, spice or time, and no visible sign that their allergies are being honoured.

## 2. Goals

1. A recipe ask in Coach Pro is recognised from the whole conversation, including "turn that into a recipe".
2. The app **always asks** before making a recipe: an offer with **[Yes] [Search] [No]**.
3. Every **new** generation goes through one **adjust card**: prefilled, allergies shown and locked, 1–2 dish-specific follow-ups, then **[Generate]**. Refining an on-screen card is the one exception (§3).
4. RecipeChef gives the same experience (offer → card).
5. One recipe path: the regex router, `search_recipes` and model-drawn `recipe_card` are retired, after the flag has been on a while (§9).

Out of scope: free Coach (unchanged), post-generation rescaling on the recipe card, Android Maestro (parked).

## 3. User experience

```
User:  I have company this weekend and want spaghetti and meatballs for eight
       adults. Can you make this into a recipe for me?

Coach: I can make this into a recipe right here in the chat. Want me to get started?
       I can also search OCRecipes for something similar.
       [ Yes ]  [ Search ]  [ No ]

 Yes    → adjust card
 Search → community results list (existing). Its Generate button → adjust card
 No     → flow closes; chat continues; nothing claimed

┌ Spaghetti & meatballs ───────────────────┐
│ Servings     [ − ]  8  [ + ]             │
│ Spice        Mild · Medium · Hot         │
│ Time         <20m · 30–45m · 1h+         │
│ Avoiding 🔒  peanuts, shellfish           │
│ Also noted   dislikes olives             │
│ Beef, pork, or a mix?  [Beef][Mix][Pork] │
│                  [ Cancel ]  [ Generate ]│
└──────────────────────────────────────────┘
 Generate → recipe card (existing generation + allergen check)
```

Owner rulings in this design:

- **Always ask.** Even an explicit request gets the offer. There is no fast path straight to the card.
- **Single doorway.** Every generation, from the offer or from a results list's Generate, goes through the adjust card.
- **RecipeChef gets the same offer and card.**
- **Button taps don't count toward the Coach Pro daily message limit** (owner, 2026-10-06, review L2). Today Coach Pro finder taps pass `coachDailyLimit` to `createFinderUserMessage` (`server/routes/chat.ts` ~411); RecipeChef taps already never count. With the flag on, **all** Coach Pro finder taps (new and existing actions) stop passing it. Only typed messages count. Generation still counts against the recipe-generation limit at the card's Generate.
- **Refine is the one exception to single doorway** (owner, 2026-10-06). "Make it spicier" or "swap the chicken" while a recipe card is the latest message regenerates that card directly through the existing `classifyTurn → refine_current` path, with no offer and no card. It edits a recipe already on screen, and a card would add a tap to every tweak.

## 4. Architecture

### 4.1 Finder state machine (shared, `server/services/recipe-finder/`)

The finder already models a flow as blocks (`recipe_results`, `recipe_questions`) and button actions (`search_online`, `generate`, `none_of_these`, `answers`), with stages `results | clarifying`. This design adds:

| Addition                                              | Shape                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage `offer`                                         | Block `recipe_offer`: `{ type, flow }`. The **flow** carries the context so later stages keep it (M2): `dish`, `details` = `{ servings?, spice?, time?, ingredients[], fromConversation }`. Required `FinderFlow` fields for an offer flow: `request` = dish + rendered details, `query` = `{ q: dish }`, `round` = 0, `shownIds` = [].                                                                             |
| Stage `adjust`                                        | Block `recipe_adjust`: `{ type, flow, prefill: { servings, spice, time }, avoiding[] (display), noted: { dietType?, dislikes[] } (display), followUps: ClarifyingQuestion[] (0–2) }`. The flow (with `dish` + `details`) is copied forward from the offer, or built from the results flow when entered from a list.                                                                                                 |
| Action `offer_yes`                                    | offer → build the adjust block                                                                                                                                                                                                                                                                                                                                                                                      |
| Action `offer_search`                                 | offer → existing `search_community` step                                                                                                                                                                                                                                                                                                                                                                            |
| Action `offer_no`                                     | offer → **persists a closing assistant message with no finder block** ("No problem."). It is now the latest assistant message, so `getLatestFinderBlock` returns null and the flow is over; repeat = yes cannot match it. No marker needed.                                                                                                                                                                         |
| Action `adjust_generate`                              | Payload `{ servings: int 1–20, spice: "mild"\|"medium"\|"hot", time: "under_20"\|"30_45"\|"60_plus", answers: FinderAnswer[] }`, schema-validated → gate + claim → generate                                                                                                                                                                                                                                         |
| Action `adjust_cancel`                                | adjust → persists a closing assistant message with no block (same as `offer_no`); nothing claimed                                                                                                                                                                                                                                                                                                                   |
| Changed: **every** existing direct-generate path (H1) | Each becomes `build_adjust` (no claim): (1) the `generate` action, which is now valid **only** when the latest block is `recipe_results` and is otherwise `invalid_for_stage`; (2) the second "None of these" (`noneOfThese()` round 1); (3) a round-1 community search with zero results (`finderOutcome` fall-through); (4) typed "generate" (`matchTypedFinderCommand` → `GENERATE_PHRASES`) on a results block. |

**Schema changes (`shared/schemas/recipe-finder.ts`):**

- `FinderFlow.stage` adds `offer | adjust`;
- `FinderFlow` gains optional `dish` and `details`;
- `finderBlockSchema` adds `recipe_offer` and `recipe_adjust` (and `isFinderBlockType`);
- `finderActionSchema.type` adds `offer_yes | offer_search | offer_no | adjust_generate | adjust_cancel`, with a refine that requires the `adjust_generate` payload;
- the time ids are the profile's `quick | moderate | leisurely`, with `COOKING_TIMES` moved from `client/constants/dietary-options.ts` to `shared/` so the client, server and Zod all read one list (M3).

`transition.ts` stays pure (plan step / outcome). The new steps get new `FinderStep` kinds: `offer`, `build_adjust`, `generate_with_settings`. The only I/O is in `run-turn.ts`'s `executeFinderStep`: the follow-up call and the generation claim.

The rule that only the latest finder message is live (`getLatestFinderBlock` / `isActionCurrent`) applies unchanged, so stale offers and cards ignore taps.

### 4.2 Entry: Coach Pro (`coach-pro-chat.ts`, `coach-tools.ts`)

- Add tool **`offer_recipe`** to the Pro tool definitions:
  ```
  offer_recipe({
    dish: string (1–80 chars, required),
    from_conversation: boolean,   // the dish is one the coach suggested / discussed
    servings?: int 1–20,          // only if the user stated it
    spice?: "mild"|"medium"|"hot",
    time?: "under_20"|"30_45"|"60_plus",
    ingredients?: string[] (≤ 15) // ingredients the user said they have
  })
  ```
  Tool description, which the prompt-engineer reviews:
  - Call this when the user wants a recipe or cooking instructions for a dish, including "turn that into a recipe" about a dish you suggested.
  - Call it without commentary.
  - If you can't name a concrete dish, ask which dish in plain text and do not call the tool.
  - Do not call it for questions about an existing recipe (calories, logging, adding to a plan, opinions).
- **Terminal tool (H4).** Today `generateCoachProResponse` yields only `tool_calls` (names) and `content`, and `handleCoachChat` saves only `if (fullResponse && !isAborted())`, so a silent tool call would save nothing. The contract:
  1. `generateCoachProResponse` gains a chunk `{ type: "terminal_tool", name: "offer_recipe", args }`. On seeing `offer_recipe` among a round's tool calls, it yields that chunk and returns. Other tool calls in the same response are **dropped**, not run: the turn ends, so their results would inform nothing.
  2. `handleCoachChat` Zod-validates the arguments. An invalid or empty `dish` is treated as no tool call; any streamed text stands, or a fixed "Which dish did you have in mind?" is saved.
  3. On a valid call, it **saves** the assistant message (text so far plus the `recipe_offer` block, with the `turnKey`) **before** yielding the offer event. This is the same save-before-yield rule `coach-turn.ts` documents.
  4. The route's disconnect settle path (`server/routes/chat.ts` ~850) treats a saved blocks-only reply as a reply and keeps the user row.
- **Repeat = yes.** If the latest live block is a **still-open** `recipe_offer` and the model calls `offer_recipe` again with the same dish, the server goes straight to building the adjust block. After `offer_no` the offer is closed, so a re-call produces a **fresh offer**, never the card. Same dish means a normalised match: lowercase, `&` → "and", articles and punctuation dropped.
- **Pre-tool text.** Each round's text is already yielded at the end of the round, before its tools run (`nutrition-coach.ts` ~779), so any pre-tool text is already on screen. It is kept as the message's lead line. The offer's wording and button labels are fixed server copy; the model never writes them.
- **Removed from the flag-on path:**
  - the regex recipe route (`classifiedIntent === "recipe_request"` → finder);
  - the `search_recipes` tool;
  - `recipe_card` in the Pro block instructions.

  `classifyIntent` still runs for the **safety** intent and prompt intent. On a safety turn, `offer_recipe` is not in the tool list. This needs a **new per-turn tool filter**: today the tool list depends only on the flag (L3).

- **Entry changes in `decideCoachFinderEntry` (flag on):**
  - **H2:** latest block is `recipe_offer` or `recipe_adjust` → `none`. The typed text falls through to the tool loop, which makes "typed yes → re-call → repeat = yes" reachable. A live `recipe_results` / `recipe_questions` block keeps today's typed handling.
  - **H3:** latest message is a recipe card → `classifyTurn`. Only `refine_current` stays in the finder (the refine exception). `new_request` and `other` both go to the tool loop, which offers if it judges a recipe ask. The model is the single decider of new recipe asks.
  - The `intent === "recipe_request"` → `start` branch is not used with the flag on.

### 4.3 Entry: RecipeChef (`server/routes/chat.ts` recipe path)

RecipeChef has no tool loop and every message there is a recipe request. A new dish request starts the flow at **offer** instead of community search:

- The dish comes from the existing `extractQuery` step.
- Details (servings, spice, time) are extracted in the same call; `extractQuery`'s prompt and schema are extended.
- Offer, card and generate are identical to Coach Pro via the shared state machine.
- Existing refine-after-card behaviour (`classifyTurn` → `refine_current`) is unchanged (refine exception). `classifyTurn → new_request` starts at **offer** instead of community search.
- **Typed text while an offer or card is live (H2).** RecipeChef has no model loop, so it uses an exact-phrase rule like `GENERATE_PHRASES`:
  - offer + a normalised yes-phrase ("yes", "yes please", "sure", "go ahead", "do it") → `offer_yes`;
  - offer + a no-phrase → `offer_no`;
  - adjust + a generate-phrase → `adjust_generate` with the card's prefill and no answers;
  - any other text → a **fresh offer** built from that text (with history), via `extractQuery`.
- **Later messages with no live block and no card (H3).** With the flag on, `decideRecipeChefEntry`'s `legacy` branch becomes **offer** too. Today legacy generates directly (`server/routes/chat.ts` ~606) on the old `createChatMessageWithLimitCheck` count. If `extractQuery` finds no dish ("thanks"), the reply is a short plain message with no offer and nothing generated.

### 4.4 Adjust card data (built on `offer_yes` / list `generate`)

The precedence is **chat details > profile > default**:

| Field             | Chat               | Profile                                          | Default         |
| ----------------- | ------------------ | ------------------------------------------------ | --------------- |
| servings          | `details.servings` | `householdSize`                                  | 2               |
| spice             | `details.spice`    | —                                                | mild            |
| time              | `details.time`     | `cookingTimeAvailable` (mapped to the 3 buckets) | 30_45           |
| avoiding (locked) | —                  | `allergies[].name`                               | hidden if none  |
| noted (read-only) | —                  | `dietType`, `foodDislikes`                       | hidden if none  |
| followUps (0–2)   | AI-picked          | —                                                | none on failure |

**Follow-ups** come from a "this dish" variant of `askClarifying`. It takes the dish, the details and the recent transcript, and returns 0–2 multiple-choice questions.

- It must not ask about allergies, servings, spice or time.
- A failure or timeout gives **no follow-ups**, not the fixed fallback questions.
- It uses its own `aiChat` feature row, so it is routable and evaluable.

### 4.5 Generation (`adjust_generate`)

1. **Validate answers (M1).** Each `answers[]` entry must match a question **and** one of its options on the stored latest `recipe_adjust` block. A mismatch → `invalid_for_stage` (ignored, nothing claimed). The card has no free-text field.
2. **Gate and claim.** `gateRecipeGeneration` runs on this action's user message row (created and de-duplicated by `createFinderUserMessage`, `server/routes/chat.ts` ~401). The existing claims table, guarded refund on disconnect, premium check and daily limit are all reused. This is the **only** claim point.
3. **Build the messages.** `buildFinderGenerationMessages` gains a third mode, `{ mode: "adjusted", dish, settings, answers, history? }`:
   - The structured settings become fixed template lines (servings N, spice level, time bucket, chosen answers). They are never free text.
   - When the flow's `details.fromConversation` is set, it includes the conversation context the way `refine` does today (`buildRecipeContext(history)`), so "that" carries the coach's suggestion; `details.ingredients` are listed explicitly.
4. **Allergies (M5).** `generateRecipeChatResponse` builds its own system prompt with `allergenDetail: "basic"` (`recipe-chat.ts` ~196, ~292). It gains an `allergenDetail` option. The adjusted-generation path passes `"extended"` (severity plus derived ingredients); RecipeChef's other generation paths (refine, remix) stay `"basic"` in this work. The post-generation `checkRecipeAllergens` warning is unchanged.

## 5. Errors and edge cases

| Case                                                                      | Behaviour                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Limit reached / no premium                                                | Card Generate → existing `blockedGenerateBlock` notice                                                                                                                                                                                                 |
| Disconnect during generation                                              | Existing guarded refund keyed on the action's message row                                                                                                                                                                                              |
| "That" with no referent                                                   | The tool requires `dish`; the model asks instead. An empty or junk dish is rejected server-side, so no card is ever built from empty context.                                                                                                          |
| Typed "yes" while offer live                                              | Coach: falls through to the tool loop → if the model re-calls `offer_recipe` for the same dish → adjust card (repeat = yes). RecipeChef: yes-phrase → `offer_yes`.                                                                                     |
| Typed "no thanks"                                                         | Coach: normal chat; the offer goes stale. RecipeChef: no-phrase → `offer_no`.                                                                                                                                                                          |
| Tapped No, then types "actually, make it spicy"                           | Coach: tool loop → a fresh offer if the model judges a recipe ask. RecipeChef: legacy-with-flag → a fresh offer. **Never a direct generation** (H3).                                                                                                   |
| Old client taps Generate on a card / non-results block                    | `invalid_for_stage` → ignored (H1)                                                                                                                                                                                                                     |
| Card answer not among the offered options                                 | Ignored; nothing claimed (M1)                                                                                                                                                                                                                          |
| Tapped No, then talks about the same dish and the model re-calls the tool | A **fresh offer** (the closed offer can't trigger repeat = yes)                                                                                                                                                                                        |
| Stale offer/card tapped                                                   | Ignored (only the latest block is live)                                                                                                                                                                                                                |
| Follow-up call fails                                                      | Card shows without follow-ups                                                                                                                                                                                                                          |
| Safety-flagged message                                                    | Unchanged safety path; no `offer_recipe` tool                                                                                                                                                                                                          |
| Free Coach                                                                | Unchanged; no tool, no finder                                                                                                                                                                                                                          |
| Flag off                                                                  | Today's behaviour exactly: regex route; model `recipe_card`; `search_recipes` filtered out while `RECIPE_FINDER_ENABLED` is on                                                                                                                         |
| Old client, flag on                                                       | The flag flips only after the client OTA, but that covers only builds on the OTA's runtime version. An older binary on another runtime gets the server's fallback text for unknown blocks, never a broken render (L4). Render tests confirm this (§7). |

## 6. Security and safety notes

- Card settings are enums or bounded integers, Zod-validated before they reach the prompt. Follow-up answers must match an offered option on the stored card. This is a **new** check (§4.5 step 1): today's `finderAnswerSchema` accepts free text and `appendAnswers` copies it into the request.
- `offer_recipe` arguments are model output. Zod-validate them; `dish` and `ingredients` pass through `sanitizeContextField` with length caps before they reach any prompt or persisted block.
- Allergies are enforced twice: in the prompt (extended detail) and by the deterministic `checkRecipeAllergens` scan. The card cannot remove an allergy.
- Claims stay IDOR-safe: they are keyed by `userId` plus the message row the user owns, as today.

## 7. Testing (TDD)

**Step 0: measurement gate (before PR 2).** A script under `evals/` or `scripts/` (planning picks which) runs each case 3 times against `openai/gpt-6-luna` via OpenRouter, with the Pro tool list including `offer_recipe`. Each case has a realistic preceding conversation. The corpus has three sets:

- **Real asks (9):** the todo's 6 ❌ rows + 3 ✅ rows, including the owner's exact message after a coach meal suggestion.
- **Existing-recipe negatives (4):** "that recipe was too salty", "log that recipe", "how many calories in that recipe", "add that recipe to my meal plan". These follow a recipe card, so in production they pass through `classifyTurn` **before** the tool loop. The harness replicates that routing order: a case counts as a false alarm only if the message reaches the tool loop **and** the tool fires.
- **Ordinary-coaching negatives (≥ 6):** meal-idea coaching that must stay prose, for example:
  - "what should I have for dinner?";
  - "what can I make with chicken, rice and spinach?" (the owner's own first turn);
  - "is pasta OK for my goals?";
  - "give me a few high-protein snack ideas";
  - "what's a good breakfast before a run?";
  - "I'm hungry, any ideas?".

  These are the false alarms that would stop the coach suggesting meals in prose.

**Report:** tool-called count out of 3 runs per case, per set, with denominators.

**Pass bar (all must hold):**

- ≥ 8/9 real asks offer on the majority of their runs;
- 0 existing-recipe negatives offer on a majority of runs;
- ≤ 1 ordinary-coaching negative offers on a majority of runs.

**Fail:** stop and return to the owner. Options are to tune the tool description and re-run once, or fall back to a separate per-turn AI check (approach 2 in the brainstorm).

The cases then go into the eval runner as a permanent set, so a model switch gets re-checked.

**Unit and integration tests**

- `transition.ts`: one test per former direct-generate path (H1: the `generate` action on a non-results block, a second None of these, zero results in round 1, typed generate); every new transition; repeat = yes; stale actions; `offer_no` and `adjust_cancel` persist a closing message; **No, then a same-dish re-call → a fresh offer, not the card**; list `generate` → adjust.
- Claims: claimed only on `adjust_generate`; refund on disconnect; not claimed on offer, card, cancel or no.
- `offer_recipe` handler: argument validation, empty dish rejected, absent on safety turns and in free Coach, other same-response tool calls dropped.
- **Silent tool call (H4):** the model calls `offer_recipe` with no text → the offer is saved with the `turnKey`; a disconnect after the save keeps the user row.
- **Entry (H2/H3):** Coach, live offer + typed text → tool loop; Coach, card + `new_request` → tool loop; RecipeChef, yes/no-phrases and other text during an offer/card; RecipeChef, flag on, "No" then "actually, make it spicy" → a fresh offer, not a generation.
- `adjust_generate` with an answer not in the offered options → rejected, nothing claimed (M1).
- Coach Pro finder taps (flag on) don't consume a daily message; typed messages still do (L2).
- Card prefill precedence (chat > profile > default); allergies always shown; extended allergen context on this path.
- RecipeChef: a dish request → offer; refine-after-card unchanged.
- Regression set from the todo: the owner's exact message → offer; the 4 negatives ("that recipe was too salty", "log that recipe", "how many calories in that recipe", "add that recipe to my meal plan") → no offer; safety wins; free Coach unchanged.
- Client: old-block render tests (existing chats still render) and unknown-block fallback; card logic in a pure `client/components/*-utils.ts` (prefill display, stepper bounds, payload build) with Vitest coverage; render tests for the offer and adjust blocks in both chats.
- Maestro (iOS): extend `e2e/manual/recipe-finder.yaml` with offer → Yes → card → Generate, and offer → Search.

### Results (2026-10-07): PASS

**Setup.** Probe `scripts/probe-offer-recipe.ts` at commit 14e44fe5.

- Model: `openai/gpt-6-luna` via OpenRouter (answered by Azure), production settings (temperature 0.5, `max_completion_tokens` 1500).
- Prompt: the production Pro system prompt with `getBlocksSystemPrompt(true, { offer: true })`.
- Tools: production `TOOL_DEFINITIONS` minus `search_recipes`, plus `OFFER_RECIPE_TOOL`.
- 3 runs per case. A case counts as called when the model called `offer_recipe` in at least 2 of the 3 runs.

**Results.**

| Set             | Called / cases       | Pass bar | Errored runs |
| --------------- | -------------------- | -------- | ------------ |
| ask             | 9/9 (every case YYY) | ≥ 8      | 0            |
| recipe_negative | 0/4                  | 0        | 0            |
| coach_negative  | 0/6                  | ≤ 1      | 0            |

**Notes.**

- `rneg-too-salty` was classified `refine_current`, so it never reached the tool loop (`---`). The other three recipe negatives reached the tool loop and were not called (`nnn`).
- The probe context is minimal: no notebook, memory or screen context. The result is therefore a lower bound on production prompt noise.

## 8. Feature flag

`RECIPE_OFFER_ENABLED`, server-side and off by default. It is read only where Coach Pro and RecipeChef pick their entry path. Flag off means today's behaviour. It requires `RECIPE_FINDER_ENABLED`.

## 9. Rollout

| #    | Ships                                                                                                                                                                                                                               | Gate                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| PR 1 | Measurement script + eval cases; results recorded in this spec                                                                                                                                                                      | Pass bar in §7 (all three sets), else stop                                    |
| PR 2 | Server: state machine, `offer_recipe`, RecipeChef offer entry, card data, adjusted generation; flag **off**                                                                                                                         | Reviewers: server-reviewer, ai-reviewer, security-auditor (allergens, claims) |
| PR 3 | Client: offer + adjust card in both chats                                                                                                                                                                                           | Preview OTA → owner device test                                               |
| —    | Flip `RECIPE_OFFER_ENABLED` on Railway prod                                                                                                                                                                                         | **Owner's explicit yes only**                                                 |
| —    | Production OTA                                                                                                                                                                                                                      | Separate ask                                                                  |
| PR 4 | Cleanup: delete the regex recipe route, `search_recipes`, model `recipe_card` from Pro, RecipeChef's legacy direct-generation branch, and the flag-off branches of **both** `RECIPE_OFFER_ENABLED` and `RECIPE_FINDER_ENABLED` (M4) | After the flag has been on and stable                                         |

**Rollback before PR 4:** unset the flag; no deploy needed.

## 10. Open items for planning (verify, don't assume)

Resolved by spec-review round 1 (2026-10-06):

- item 1 (claim row: yes, via `createFinderUserMessage`);
- item 2 (§4.2 terminal tool);
- item 4 (§4.1 shared time ids);
- item 7 (drop the other tool calls);
- item 8 (refine is an exception, an owner ruling);
- L2 (taps don't count, an owner ruling).

Still open:

1. Whether the Pro system prompt's `recipe_card` instruction is referenced by evals or tests that must move with it.
2. The client: where Coach Pro and RecipeChef render finder blocks, so both get the new blocks from one component.
3. Which `aiChat` feature rows the follow-up call and the adjusted generation use, given that coach-pro-chat is on `gpt-6-luna` via OpenRouter.

## 11. Shipped, and where the build differs from this spec (2026-10-07)

Shipped flag **off**: server #1330 (`9cf8dbef`) and client #1332 (`1a3ca0b9`). PR 1 and PR 2 shipped as one server PR, because the §7 gate had already passed. The open items in §10 were settled during the build.

**Owner ruling 2026-10-09: all three ACCEPTED** (typed replies stay in the flow; taps don't count; the RecipeChef carve-out stands).

- **R16, typed replies in Coach.** An exact typed "yes", "no", "search" or "generate" on a live offer or card stays in the finder, in both chats. This replaces §4.2 H2 and the §5 rows "typed yes → tool loop → repeat=yes" and "typed no thanks → normal chat". It matches only the exact phrase, so "no thanks, but what about X" still goes to the model. If this is wrong, a typed "no" on a Coach offer gets "No problem." instead of a chat reply.
- **R17, taps don't count.** Finder taps (rows with `metadata.finderInput`) are left out of the Coach daily message count. This follows the owner ruling in §3 over the plan's route bullet.
- **RecipeChef carve-out.** When the latest message is a recipe card and the turn is classified `other`, RecipeChef uses its legacy path rather than the finder.
