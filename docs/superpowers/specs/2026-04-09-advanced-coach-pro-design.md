# Advanced Coach Pro — Design Spec

**Date:** 2026-04-09
**Status:** Draft
**Scope:** Redesign the NutriCoach into a premium "Coach Pro" experience with persistent memory, rich interactive messages, voice input, and latency optimizations.

---

## 1. Overview

The current NutriCoach is a reactive text chatbot — it answers questions using the user's daily nutrition context but has no memory across sessions, no rich interactions, and no sense of continuity. This redesign transforms it into a premium coaching experience that remembers the user, sends structured interactive content, accepts voice input, and feels fast.

Coach Pro becomes a new subscription tier above the current premium, serving as a key product differentiator.

### Goals

- Coach feels like it knows the user — persistent memory across all conversations
- Rich, interactive responses — not just text, but cards, charts, recipes, and actionable suggestions
- Fast end-to-end experience — speech to response feels near-instant
- Premium tier justification — clear value upgrade over basic coach chat

### Non-Goals

- Proactive push notifications or background-triggered insights (deferred to fasting/reminders project)
- Text-to-speech / voice responses from the coach
- Coach surfaces embedded throughout the app (stays on dedicated screen)

---

## 2. Screen Layout: Collapsible Dashboard + Chat

The Coach tab is redesigned as a single screen with two zones.

### Dashboard Header (Collapsible)

A summary panel at the top of the screen that collapses to a compact strip while chatting.

**Expanded state shows:**

- Personalized greeting with the user's name
- Key stat cards (3 across): protein goal streak, average calories this week, weight trend
- Active commitments list with checkmarks for completed items
- Latest coach insight with a "Discuss with coach" link that starts a conversation about it
- "See all" toggle to expand/collapse

**Collapsed state shows:**

- Single-line greeting + streak summary
- Mini stat row (compact versions of the 3 stat cards)
- Tap to expand

**Data source:** All dashboard data comes from the preloaded context endpoint (Section 7) and the coach notebook (Section 5).

### Contextual Suggestion Chips

Below the dashboard, a horizontally scrolling row of suggested conversation starters. These are **dynamic**, generated from:

- Recent notebook entries (e.g., if the user committed to meal prep, "How did meal prep go?")
- Current nutrition data (e.g., "I'm low on protein today — ideas?")
- Time-based relevance (morning: breakfast focus, evening: day review)

Replaces the current static predefined question buttons in `AskCoachSection`.

**Generation:** Suggestion chips are generated server-side as part of the `GET /api/coach/context` response. The server examines notebook entries (commitments with passed follow-up dates, recent insights) and current nutrition data to produce 3-5 contextual suggestions. The client renders them as-is.

### Chat Area

Full-featured chat below the dashboard. Supports all 7 rich message block types (Section 3). Same streaming SSE architecture as current implementation but with structured block rendering.

### Input Bar

- Text input field (same as current)
- Mic button for voice input (Section 5) — positioned to the right of the text field
- Send button appears when text is entered (mic button hides)

### What It Replaces

- `CoachChatScreen` modal — replaced by the redesigned Coach tab screen
- `AskCoachSection` component — replaced by contextual suggestion chips
- `CoachOverlayContent` — replaced by the new chat + dashboard component
- The Coach tab in bottom navigation stays; its content changes entirely

---

## 3. Rich Message Block System

Coach responses can contain structured content blocks alongside regular text. Blocks are transmitted via the existing SSE stream and rendered inline in the chat.

### Wire Format

Each SSE chunk can include a `blocks` array:

```json
{
  "content": "Here are some high-protein lunch options:",
  "blocks": [
    {
      "type": "suggestion_list",
      "items": [
        {
          "title": "Greek Chicken Bowl",
          "subtitle": "480 cal - 42g P - 18g F - 32g C",
          "action": { "type": "view_recipe", "recipeId": 123 }
        }
      ]
    }
  ],
  "done": false
}
```

Blocks appear after the text content in the chat bubble, or as standalone cards below the bubble depending on type.

### Block Types

#### 3.1 Action Card

Single tappable action embedded in a response.

```json
{
  "type": "action_card",
  "title": "Grilled chicken salad",
  "subtitle": "~450 cal - 38g protein - 12g fat",
  "action": {
    "type": "log_food",
    "description": "Grilled chicken salad",
    "calories": 450,
    "protein": 38,
    "fat": 12,
    "carbs": 25
  },
  "actionLabel": "Log it"
}
```

**Supported action types:**

- `log_food` — creates a daily log entry with the provided nutrition data
- `navigate` — navigates to a screen (recipe detail, nutrition detail, etc.)
- `set_goal` — opens goal setup with pre-filled values

**Rendering:** Card with title, subtitle, and a tappable button. Button executes the action.

#### 3.2 Suggestion List

Formatted list of options with optional tap actions.

```json
{
  "type": "suggestion_list",
  "items": [
    {
      "title": "Greek Chicken Bowl",
      "subtitle": "480 cal - 42g P",
      "action": {
        "type": "navigate",
        "screen": "RecipeDetail",
        "params": { "recipeId": 123 }
      }
    },
    {
      "title": "Tuna & Avocado Wrap",
      "subtitle": "420 cal - 36g P",
      "action": null
    }
  ]
}
```

**Rendering:** Stacked list cards, each tappable if an action is provided. Shows a "View" arrow for navigable items.

#### 3.3 Inline Chart

Mini data visualization rendered inside the chat.

```json
{
  "type": "inline_chart",
  "chartType": "bar",
  "title": "Protein This Week",
  "data": [
    { "label": "Mon", "value": 142, "target": 140, "hit": true },
    { "label": "Tue", "value": 155, "target": 140, "hit": true }
  ],
  "summary": "5/7 days on target"
}
```

**Supported chart types:**

- `bar` — vertical bar chart (macro tracking, daily intake)
- `progress` — circular or linear progress indicator (single goal)
- `stat_row` — row of 2-4 stat cards with labels and values

**Rendering:** Self-contained chart component. View-only, no tap actions. Uses the app's theme colors.

#### 3.4 Commitment Card

Structured goal or intention that saves to the notebook on accept.

```json
{
  "type": "commitment_card",
  "title": "Meal prep on Sunday",
  "followUpText": "I'll check in on Monday to see how it went",
  "followUpDate": "2026-04-13"
}
```

**Rendering:** Card with checkbox icon, title, follow-up text, and Accept/Dismiss buttons.

**On accept:** Immediately writes a notebook entry of type `commitment` with `status: active` and the specified `followUpDate`. Dashboard updates to show the new commitment.

**On dismiss:** No notebook entry. Card grays out.

#### 3.5 Quick Reply Chips

Contextual tap-to-reply options that appear after a coach response.

```json
{
  "type": "quick_replies",
  "options": [
    { "label": "Yes, show me options", "message": "Yes, show me options" },
    {
      "label": "Under 5 minutes only",
      "message": "Show me options that take under 5 minutes to prepare"
    },
    {
      "label": "No, something else",
      "message": "No, I'd like to ask about something else"
    }
  ]
}
```

**Rendering:** Horizontal row of pill-shaped chips below the assistant message. Tapping one sends the `message` as a user message and removes the chips.

**Key detail:** The `message` field can differ from the `label` — the label is short for UI, the message provides full context for the AI.

#### 3.6 Recipe Card

Full recipe preview with save/plan actions.

```json
{
  "type": "recipe_card",
  "recipe": {
    "title": "Mediterranean Quinoa Bowl",
    "calories": 420,
    "protein": 28,
    "prepTime": "15 min",
    "imageUrl": "https://...",
    "recipeId": 456,
    "source": "community"
  }
}
```

**Rendering:** Card with recipe image (if available), title, nutrition summary, prep time. Action buttons: "View Recipe" (navigates to RecipeDetail), "Save" (adds to favourites), "Add to Plan" (opens meal plan picker).

**Source handling:** `recipeId` may reference a community recipe or a Spoonacular recipe. The `source` field determines which detail screen to navigate to.

#### 3.7 Meal Plan Card

A suggested daily or multi-day meal plan.

```json
{
  "type": "meal_plan_card",
  "title": "High-Protein Day Plan",
  "days": [
    {
      "label": "Today",
      "meals": [
        {
          "type": "breakfast",
          "title": "Greek Yogurt & Berries",
          "calories": 320,
          "protein": 28
        },
        {
          "type": "lunch",
          "title": "Chicken Caesar Wrap",
          "calories": 480,
          "protein": 42
        },
        {
          "type": "dinner",
          "title": "Salmon & Roasted Vegetables",
          "calories": 520,
          "protein": 38
        }
      ],
      "totals": { "calories": 1320, "protein": 108 }
    }
  ]
}
```

**Rendering:** Expandable card showing meals grouped by day. Each meal shows title, calories, protein. Bottom shows daily totals. "Add to Meal Plan" button writes all items to the `mealPlanItems` table for the specified dates.

### AI Output Format

The coach's system prompt instructs the model to output structured blocks using a defined JSON schema. OpenAI's function calling / tool use is used to ensure valid structured output. The model can choose to include zero or more blocks per response. Text content and blocks can be interleaved.

The server parses model output, validates block schemas with Zod, and streams valid blocks to the client. Invalid blocks are silently dropped (text content still streams).

---

## 4. Coach Tools (API Access)

The coach has access to backend APIs via OpenAI function/tool calling. Instead of generating nutrition data or recipes from training knowledge, the coach queries real data from the app's services and database. This makes rich message blocks (recipe cards, meal plan cards, action cards) contain accurate, actionable data.

### How Tool Calling Works

1. The coach's OpenAI request includes a `tools` array defining available functions
2. Mid-response, the model can decide to call a tool (e.g., `search_recipes`)
3. The server intercepts the tool call, executes it against the real backend service, and feeds the result back to the model
4. The model continues its response using the real data
5. Tool calls happen server-side — the client only sees the final streamed response with accurate data

### Tool Definitions

#### 4.1 `lookup_nutrition`

Look up nutrition data for a specific food item using the multi-source pipeline (CNF → USDA → API Ninjas).

| Parameter | Type   | Required | Description                                                 |
| --------- | ------ | -------- | ----------------------------------------------------------- |
| `query`   | string | yes      | Food name to look up (e.g., "chicken breast", "brown rice") |

**Returns:** `{ name, calories, protein, carbs, fat, fiber, sugar, sodium, servingSize, source }`

**Use cases:** User asks "how many calories in X?", coach builds action cards with accurate nutrition, coach validates a food logging request.

**Backend:** `lookupNutrition(query)` from `server/services/nutrition-lookup.ts`

#### 4.2 `search_recipes`

Search the recipe catalog for recipes matching a query, with optional filters.

| Parameter      | Type   | Required | Description                                                     |
| -------------- | ------ | -------- | --------------------------------------------------------------- |
| `query`        | string | yes      | Search terms (e.g., "high protein lunch")                       |
| `cuisine`      | string | no       | Cuisine filter (e.g., "Mediterranean", "Asian")                 |
| `diet`         | string | no       | Diet filter (e.g., "vegetarian", "keto")                        |
| `maxReadyTime` | number | no       | Max prep+cook time in minutes                                   |
| `intolerances` | string | no       | Comma-separated intolerances (auto-populated from user profile) |

**Returns:** Array of `{ id, title, image, readyInMinutes, calories, protein }` (up to 5 results)

**Use cases:** Coach suggests meals → returns real recipe cards with valid `recipeId`s. Coach responds to "what should I eat?" with actual recipes.

**Backend:** `searchCatalogRecipes(params)` from `server/services/recipe-catalog.ts`. User's allergies/intolerances are auto-injected from their profile.

#### 4.3 `get_daily_log_details`

Get the detailed breakdown of what the user has eaten on a specific day.

| Parameter | Type   | Required | Description                         |
| --------- | ------ | -------- | ----------------------------------- |
| `date`    | string | no       | ISO date string (defaults to today) |

**Returns:** Array of log entries with `{ name, calories, protein, carbs, fat, mealType, servings, loggedAt }` plus daily totals.

**Use cases:** Coach drills into specific meals ("your lunch was carb-heavy"), identifies gaps ("you haven't logged dinner yet"), provides detailed feedback.

**Backend:** `getDailyLogs(userId, date)` + `getDailySummary(userId, date)` from `server/storage/nutrition.ts`. User ID injected server-side.

#### 4.4 `log_food_item`

Log a food item to the user's daily intake. Used when the user confirms a food logging action card.

| Parameter     | Type   | Required | Description                                                                |
| ------------- | ------ | -------- | -------------------------------------------------------------------------- |
| `description` | string | yes      | Food description (e.g., "grilled chicken salad")                           |
| `calories`    | number | yes      | Calorie count                                                              |
| `protein`     | number | yes      | Protein in grams                                                           |
| `carbs`       | number | yes      | Carbs in grams                                                             |
| `fat`         | number | yes      | Fat in grams                                                               |
| `mealType`    | string | no       | "breakfast", "lunch", "dinner", or "snack" (inferred from time if omitted) |
| `servings`    | number | no       | Number of servings (default 1)                                             |

**Returns:** `{ success: true, logId }` or `{ success: false, error }`

**Use cases:** Coach offers "Log this?" action card → user accepts → coach calls this tool to actually create the log entry.

**Backend:** `createScannedItemWithLog()` from `server/storage/nutrition.ts`. Nutrition data first resolved via `parseNaturalLanguageFood()` or `lookupNutrition()` for accuracy.

**Safety:** The coach should always confirm with the user before logging (via action card with Accept/Dismiss). Never auto-log without user consent.

#### 4.5 `get_pantry_items`

Check what's currently in the user's pantry.

| Parameter         | Type    | Required | Description                                      |
| ----------------- | ------- | -------- | ------------------------------------------------ |
| `includeExpiring` | boolean | no       | If true, also flags items expiring within 7 days |

**Returns:** Array of `{ name, quantity, unit, category, expiresAt? }` plus optionally `expiringItems[]`

**Use cases:** "What can I make with what I have?", coach checks pantry before suggesting recipes, coach warns about expiring items.

**Backend:** `getPantryItems(userId)` + `getExpiringPantryItems(userId, 7)` from `server/storage/meal-plans.ts`

#### 4.6 `get_meal_plan`

Get the user's scheduled meal plan for a date range.

| Parameter   | Type   | Required | Description                      |
| ----------- | ------ | -------- | -------------------------------- |
| `startDate` | string | yes      | ISO date (e.g., today)           |
| `endDate`   | string | yes      | ISO date (e.g., 7 days from now) |

**Returns:** Array of `{ date, mealType, recipe: { title, calories, protein, prepTime } }`

**Use cases:** Coach reviews the week's plan, identifies nutrition gaps across days, suggests adjustments.

**Backend:** `getMealPlanItems(userId, startDate, endDate)` from `server/storage/meal-plans.ts`, joined with recipe details.

#### 4.7 `add_to_meal_plan`

Add a recipe to the user's meal plan for a specific date and meal.

| Parameter  | Type   | Required | Description                                 |
| ---------- | ------ | -------- | ------------------------------------------- |
| `recipeId` | number | yes      | Recipe ID (from search_recipes or existing) |
| `date`     | string | yes      | ISO date                                    |
| `mealType` | string | yes      | "breakfast", "lunch", "dinner", or "snack"  |
| `servings` | number | no       | Number of servings (default 1)              |

**Returns:** `{ success: true, itemId }` or `{ success: false, error }`

**Use cases:** Meal plan card "Add to Plan" action, coach builds a full day plan and adds it on confirmation.

**Safety:** Requires user confirmation via meal plan card Accept action. Never auto-add.

**Backend:** `addMealPlanItem()` from `server/storage/meal-plans.ts`

#### 4.8 `add_to_grocery_list`

Add items to the user's grocery list.

| Parameter  | Type   | Required | Description                                      |
| ---------- | ------ | -------- | ------------------------------------------------ |
| `listId`   | number | no       | Existing list ID (creates a new list if omitted) |
| `listName` | string | no       | Name for new list (required if `listId` omitted) |
| `items`    | array  | yes      | Array of `{ name, quantity?, unit? }`            |

**Returns:** `{ success: true, listId, itemCount }` or `{ success: false, error }`

**Use cases:** "Add the ingredients for that recipe to my grocery list", coach suggests a shopping list after meal planning.

**Safety:** Requires user confirmation. Coach should present items before adding.

**Backend:** `addGroceryListItems()` or `createGroceryListWithLimitCheck()` from `server/storage/meal-plans.ts`

#### 4.9 `get_substitutions`

Get ingredient substitutions that respect the user's dietary restrictions.

| Parameter     | Type  | Required | Description                                                   |
| ------------- | ----- | -------- | ------------------------------------------------------------- |
| `ingredients` | array | yes      | Array of `{ name, quantity?, unit? }` to find substitutes for |

**Returns:** Array of `{ original, substitute, reason, ratio, confidence }`

**Use cases:** "Can I swap the butter in this recipe?", coach proactively suggests swaps for allergens.

**Backend:** `getSubstitutions()` from `server/services/ingredient-substitution.ts`. User profile (allergies, diet type) auto-injected.

### Tool Execution Flow

```
Coach receives user message
  → OpenAI processes with tools array in request
  → Model decides to call tool(s) (0 or more)
  → Server receives tool_call in streamed response
  → Server pauses streaming to client
  → Server executes tool against real backend service
  → Server injects tool result back into OpenAI conversation
  → Model continues response with real data
  → Server resumes streaming to client
  → Client sees final response with accurate data in blocks
```

**Multiple tool calls:** The model may call multiple tools in sequence (e.g., `get_pantry_items` → `search_recipes` with pantry-based query → respond with recipe cards). Each call adds latency, so the tool set is kept focused to minimize unnecessary calls.

**Error handling:** If a tool call fails (DB error, external API timeout), the server returns an error result to the model. The model is instructed to gracefully tell the user the lookup failed and provide its best advice from training knowledge as a fallback.

**Token budget:** Tool results are injected into the conversation context. Large results (pantry with 50+ items, detailed meal plans) are truncated or summarized server-side before injection to stay within token limits.

### Security Considerations

- All tool calls are executed server-side — the client never sees tool definitions or raw results
- User ID is injected by the server (never passed from the model) — no IDOR risk
- Write operations (`log_food_item`, `add_to_meal_plan`, `add_to_grocery_list`) require explicit user confirmation via UI interaction (action card accept, meal plan card accept) — the model cannot silently write data
- Tool call rate limiting: max 5 tool calls per coach response to prevent runaway loops
- Tool results are sanitized before re-injection to prevent prompt injection from stored data

---

## 5. Coach Notebook (Memory System)

The notebook is a persistent structured data store that builds the coach's understanding of the user over time.

### Entry Types

| Type                   | Description                                           | Example                                                                        |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `insight`              | Pattern or observation from user data or conversation | "Dinners average 60% of daily calories"                                        |
| `commitment`           | Something the user agreed to try                      | "Meal prep on Sunday"                                                          |
| `preference`           | Stated preference about food, cooking, or lifestyle   | "Prefers quick meals under 15 min"                                             |
| `goal`                 | Explicit goal the user is working toward              | "Increase vegetable intake at lunch"                                           |
| `motivation`           | Why the user cares — the deeper reason                | "Wants more energy for playing with kids"                                      |
| `emotional_context`    | Emotional state or stressor related to nutrition      | "Frustrated about weight plateau"                                              |
| `conversation_summary` | Brief summary of what was discussed and decided       | "Discussed protein sources, agreed to try Greek yogurt at breakfast"           |
| `coaching_strategy`    | How the coach should interact with this user          | "Responds well to positive reinforcement, prefers actionable tips over theory" |

### Database Schema

New table: `coach_notebook`

| Column                 | Type      | Notes                                                      |
| ---------------------- | --------- | ---------------------------------------------------------- |
| `id`                   | serial    | Primary key                                                |
| `userId`               | varchar   | FK to users                                                |
| `type`                 | text      | One of the 8 entry types above                             |
| `content`              | text      | The extracted content                                      |
| `status`               | text      | `active`, `completed`, `expired`, `archived`               |
| `followUpDate`         | timestamp | Nullable — for commitments with check-in dates             |
| `sourceConversationId` | integer   | FK to chatConversations — which conversation produced this |
| `createdAt`            | timestamp |                                                            |
| `updatedAt`            | timestamp |                                                            |

**Indexes:**

- `userId + type + status` — primary query pattern for feeding context into prompts
- `userId + followUpDate` — for finding upcoming commitment check-ins
- `sourceConversationId` — for tracing entries back to conversations

### Extraction Process (Hybrid)

**Immediate extraction:**

- When the user accepts a commitment card → write `commitment` entry with `status: active` and `followUpDate`
- When the user accepts a meal plan card → could generate an `insight` about meal planning preferences

**Background extraction (post-conversation):**

- Triggered when the user navigates away from the coach screen, or after 2 minutes of chat inactivity
- Sends the full conversation to OpenAI with an extraction prompt
- Extraction prompt asks for structured output: new insights, preferences, goals, motivations, emotional context, and a conversation summary
- Server validates extracted entries with Zod, deduplicates against existing notebook entries (fuzzy match on content + type), and upserts
- Coaching strategy entries are only updated every ~5 conversations to avoid thrashing — tracked via a counter on the user or a timestamp check

**Feeding into conversations:**

- On each new message, the server fetches active notebook entries for the user
- Entries are condensed into a notebook summary injected into the system prompt: "Here's what you know about this user..."
- Token budget: cap notebook context at ~800 tokens
- Priority ranking: commitments with upcoming follow-up dates first, then recent insights, then preferences/goals/motivations, then coaching strategy, then summaries
- Old entries (>30 days with no update) are candidates for archival — a periodic cleanup marks them `archived`

### Commitment Follow-Up

When the coach's notebook contains a commitment with a `followUpDate` that has passed:

- The commitment is surfaced as a suggestion chip: "How did [commitment] go?"
- If the user discusses it, the coach can update the commitment status to `completed` or extend it
- The coach's system prompt includes a note: "The user committed to [X] on [date]. Check in about it."

---

## 6. Voice Input Integration

Reuses existing speech-to-text infrastructure with a new premium-styled component.

### Existing Infrastructure (No Changes Needed)

- `useSpeechToText` hook — on-device streaming recognition via `expo-speech-recognition`
- `volumeToScale()` utility — maps volume to animation scale
- Error handling and permission patterns

### New Component: CoachMicButton

A mic button styled for the coach screen's premium aesthetic. Wraps `useSpeechToText`.

**Positioning:** In the input bar, right side. When text is present in the input field, the mic button is replaced by a send button (same pattern as many chat apps).

**States:**

- **Idle:** Mic icon, tappable
- **Listening:** Pulsing animation driven by `volumeToScale()`, red/active accent color. Interim transcript appears in the input field in real-time.
- **Processing:** Brief transition state after `isFinal` fires — transcript is committed and sent

**Flow:**

1. Tap mic → `startListening()` → mic animates, interim text shows in input
2. User stops speaking → silence detection → `isFinal` fires
3. Final transcript replaces interim → auto-sends as message
4. Latency pipeline activates (Section 6)

**Feature gating:** Gated behind `coachPro` entitlement, not the existing `voiceLogging` flag. Coach Pro voice input and QuickLog voice input are separate features.

**Accessibility:**

- `accessibilityLabel`: "Voice input" / "Listening..." based on state
- `AccessibilityInfo.announceForAccessibility()` on iOS when listening starts/stops
- Respects reduced motion for animations

---

## 7. Latency Optimization

Three layers that compound to minimize perceived and actual latency.

### Layer 1: Preloaded Context

**New endpoint:** `GET /api/coach/context`

Returns the user's complete coaching context in a single batched response:

- Daily nutrition goals
- Today's intake summary
- Weight trend (last 7 days)
- Dietary profile (diet type, allergies, dislikes)
- Active notebook entries (condensed)
- Active commitments with follow-up status
- Dashboard stats (streak, averages)

**Client behavior:**

- Fetched when the coach screen mounts via `useQuery` with a 5-minute stale time
- Stored in a ref for passing to message requests (avoids re-fetching per message)
- Refreshed on screen focus if stale
- The server caches the assembled context per user with a short TTL (~60s) to handle rapid re-fetches

**Server behavior:**

- Assembles context from: `userProfiles`, `dailyLogs`, `weightLogs`, `coach_notebook`, goal calculator
- Single DB round-trip using parallel queries
- Returns a structured JSON payload that can be directly injected into the system prompt

### Layer 2: Interim Transcript Warm-Up

**New endpoint:** `POST /api/coach/warm-up`

Accepts an interim transcript and pre-fetches conversation history + prepares the OpenAI messages array without calling OpenAI yet.

**Client behavior:**

- While `useSpeechToText` is active and `isFinal` is false:
  - When interim transcript is >20 chars and stable for 500ms, send warm-up request
  - Only one warm-up request in flight at a time
- When `isFinal` fires: send the real message request with a `warmUpId` reference
- If no warm-up was sent (short utterance), falls back to normal request flow

**Server behavior:**

- Warm-up request: fetches conversation history, builds system prompt with preloaded context, prepares the messages array, stores in a short-lived in-memory cache (keyed by `warmUpId`, 30s TTL)
- Real message request: if `warmUpId` matches a cached warm-up, swaps in the final transcript and immediately calls OpenAI. If no match (expired or none sent), assembles from scratch.
- Warm-up cache is per-user, max 1 entry (new warm-up evicts old)

**Failure handling:**

- If final transcript differs substantially from interim (>50% edit distance), discard warm-up and assemble fresh
- Warm-up failures are silent — no user-visible error, just falls back to normal latency

### Layer 3: Optimistic UI

**Client-side only, no server changes.**

- User's message appears in the chat immediately as an optimistic bubble (before SSE stream starts)
- Typing indicator starts the moment the message is sent, not when the first SSE chunk arrives
- Each SSE chunk appends directly to the assistant message with no buffering delay
- Quick reply chips animate in as the stream completes (on `done: true`)
- Smooth auto-scroll follows streaming text without jumps
- If the server rejects the message (rate limit, error), the optimistic bubble shows an error state with retry

---

## 8. Premium Tier & Feature Gating

### Tier Structure

| Feature                      | Free | Premium     | Coach Pro                    |
| ---------------------------- | ---- | ----------- | ---------------------------- |
| Basic coach chat (text only) | —    | Daily limit | Higher daily limit           |
| Rich message blocks          | —    | —           | All 7 types                  |
| Coach notebook / memory      | —    | —           | Full coaching profile        |
| Collapsible dashboard        | —    | —           | Stats, commitments, insights |
| Voice input to coach         | —    | —           | STT via mic button           |
| Quick reply chips            | —    | —           | Contextual chips             |
| Commitment tracking          | —    | —           | Accept/track/follow-up       |
| Preloaded context + warm-up  | —    | —           | Latency optimizations        |
| Contextual suggestion chips  | —    | —           | Dynamic, notebook-driven     |

### Feature Flag

New entitlement: `coachPro`

- Checked via `usePremiumFeature("coachPro")` on the client
- Checked via `requireFeature("coachPro")` middleware on new endpoints
- Existing `aiCoach` entitlement continues to gate basic coach access for Premium users

### Screen Adaptation by Tier

**Free users:** See the existing premium gate (upgrade prompt).

**Premium users:** See the current basic chat experience — text bubbles, predefined question buttons, no dashboard, no rich blocks. A tasteful upgrade banner at the top shows what Coach Pro offers (dashboard preview, "your coach remembers" messaging) with an upgrade CTA.

**Coach Pro users:** Full experience — collapsible dashboard, rich message blocks, voice input, contextual suggestions, commitment tracking.

### Server-Side Gating

- `GET /api/coach/context` — requires `coachPro`
- `POST /api/coach/warm-up` — requires `coachPro`
- Rich blocks in SSE stream — server only includes `blocks` in output if user has `coachPro`; otherwise strips them and sends text-only
- Tool calling — server only includes `tools` array in OpenAI request if user has `coachPro`; basic coach gets no API access
- Background notebook extraction — only runs for `coachPro` users
- `coach_notebook` CRUD endpoints — require `coachPro`

### Upgrade Flow

When a Premium user opens the Coach tab:

1. Basic chat loads (current experience)
2. A non-intrusive banner appears above the chat showing a preview of the dashboard and key benefits
3. Tapping the banner navigates to the subscription management screen with Coach Pro highlighted

---

## 9. Data Flow Summary

### Sending a Message (Coach Pro)

```
User speaks/types
  → [Optimistic] Message appears in chat immediately
  → [Warm-up] If voice: interim transcript sent to /api/coach/warm-up
  → [Final] Message sent to POST /api/chat/conversations/:id/messages
  → Server checks coachPro entitlement
  → Server retrieves preloaded context (from cache or assembles)
  → Server fetches conversation history (from warm-up cache or DB)
  → Server fetches active notebook entries, injects into system prompt
  → Server calls OpenAI with tools array + structured output schema for blocks
  → [Tool calls] Model may call tools (lookup_nutrition, search_recipes, etc.)
    → Server executes tool against real backend service
    → Server injects tool result back into conversation
    → Model continues with real data
  → SSE stream: { content, blocks, done }
  → Client renders text + block components inline
  → On done: quick reply chips animate in
  → [Background] Commitment cards accepted → immediate notebook write
```

### Post-Conversation Notebook Extraction

```
User leaves coach screen OR 2 min inactivity
  → Client sends signal to server (or server detects via session timeout)
  → Server fetches full conversation since last extraction
  → Server sends conversation to OpenAI with extraction prompt
  → OpenAI returns structured entries (insights, preferences, goals, etc.)
  → Server validates with Zod, deduplicates against existing entries
  → Server upserts notebook entries
  → Next conversation: notebook entries included in system prompt
  → Next screen mount: dashboard reflects new entries
```

---

## 10. New & Modified Files

### New Files

**Server:**

- `server/routes/coach-context.ts` — `GET /api/coach/context`, `POST /api/coach/warm-up`
- `server/storage/coach-notebook.ts` — CRUD for `coach_notebook` table
- `server/services/notebook-extraction.ts` — Post-conversation extraction logic
- `server/services/coach-blocks.ts` — Block schema definitions, validation, OpenAI structured output config
- `server/services/coach-tools.ts` — Tool definitions, execution dispatcher, result formatting for OpenAI function calling

**Client:**

- `client/screens/CoachProScreen.tsx` — Redesigned coach tab screen (dashboard + chat)
- `client/components/coach/CoachDashboard.tsx` — Collapsible dashboard header
- `client/components/coach/CoachChat.tsx` — Rich chat area with block rendering
- `client/components/coach/CoachMicButton.tsx` — Premium voice input button
- `client/components/coach/blocks/ActionCard.tsx` — Action card renderer
- `client/components/coach/blocks/SuggestionList.tsx` — Suggestion list renderer
- `client/components/coach/blocks/InlineChart.tsx` — Chart renderer
- `client/components/coach/blocks/CommitmentCard.tsx` — Commitment card renderer
- `client/components/coach/blocks/QuickReplies.tsx` — Quick reply chips renderer
- `client/components/coach/blocks/RecipeCard.tsx` — Recipe card renderer
- `client/components/coach/blocks/MealPlanCard.tsx` — Meal plan card renderer
- `client/hooks/useCoachContext.ts` — Hook for preloaded context endpoint
- `client/hooks/useCoachWarmUp.ts` — Hook for interim transcript warm-up

**Shared:**

- `shared/schema.ts` — `coach_notebook` table definition (addition to existing file)
- `shared/types/coach-blocks.ts` — TypeScript types and Zod schemas for all block types

**Database:**

- Migration adding `coach_notebook` table with indexes

### Modified Files

**Server:**

- `server/routes/chat.ts` — Add `coachPro` gating to message endpoint, include blocks in SSE output, trigger notebook extraction on inactivity
- `server/services/nutrition-coach.ts` — Update system prompt to include notebook context and structured output instructions
- `server/routes.ts` — Register new coach-context routes
- `server/storage/index.ts` — Compose coach-notebook storage module

**Client:**

- `client/navigation/ChatStackNavigator.tsx` — Swap coach screen based on tier
- `client/hooks/useChat.ts` — Handle blocks in SSE stream parsing, optimistic message support
- `client/components/ChatBubble.tsx` — Render blocks within or below message bubbles

---

## 11. Testing Strategy

### Unit Tests

- Block schema validation (Zod schemas for all 7 types)
- Notebook extraction parsing (mock OpenAI responses → expected entries)
- Notebook deduplication logic
- Context assembly and token budgeting
- Warm-up cache behavior (hit, miss, eviction, expiry)
- Dashboard data computation (streaks, averages, trend)
- Block action handlers (log_food, navigate, set_goal)
- Tool definitions match expected OpenAI function calling schema
- Tool execution dispatcher routes to correct backend service
- Tool result formatting and truncation for token budget
- Tool call rate limiting (max 5 per response)
- Tool error handling (graceful fallback on service failure)

### Integration Tests

- Full message flow with blocks: send message → receive SSE with blocks → validate block content
- Tool call flow: user asks about nutrition → model calls `lookup_nutrition` → response contains accurate data
- Multi-tool flow: user asks for pantry-based recipes → `get_pantry_items` → `search_recipes` → recipe cards with real IDs
- Write tool safety: `log_food_item` and `add_to_meal_plan` require user confirmation before execution
- Notebook lifecycle: create conversation → extract entries → verify in subsequent conversation context
- Commitment flow: accept card → verify notebook entry → verify follow-up suggestion
- Tier gating: verify Premium users get text-only, Coach Pro gets full blocks + tools
- Warm-up flow: send warm-up → send final message with warmUpId → verify faster path taken
- Context endpoint: verify batched response matches individual queries

### Manual Testing

- Voice input flow on physical device (STT requires real microphone)
- Dashboard collapse/expand animation smoothness
- Block rendering across all 7 types with real OpenAI responses
- Tool-powered responses: verify recipe cards link to real recipes, nutrition data matches database
- Upgrade banner appearance and navigation for Premium users
- Streaming latency comparison: with vs. without warm-up
