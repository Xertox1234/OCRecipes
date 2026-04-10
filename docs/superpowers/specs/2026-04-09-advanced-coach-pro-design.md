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

**Data source:** All dashboard data comes from the preloaded context endpoint (Section 6) and the coach notebook (Section 4).

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

## 4. Coach Notebook (Memory System)

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

## 5. Voice Input Integration

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

## 6. Latency Optimization

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

## 7. Premium Tier & Feature Gating

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
- Background notebook extraction — only runs for `coachPro` users
- `coach_notebook` CRUD endpoints — require `coachPro`

### Upgrade Flow

When a Premium user opens the Coach tab:

1. Basic chat loads (current experience)
2. A non-intrusive banner appears above the chat showing a preview of the dashboard and key benefits
3. Tapping the banner navigates to the subscription management screen with Coach Pro highlighted

---

## 8. Data Flow Summary

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
  → Server calls OpenAI with structured output schema for blocks
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

## 9. New & Modified Files

### New Files

**Server:**

- `server/routes/coach-context.ts` — `GET /api/coach/context`, `POST /api/coach/warm-up`
- `server/storage/coach-notebook.ts` — CRUD for `coach_notebook` table
- `server/services/notebook-extraction.ts` — Post-conversation extraction logic
- `server/services/coach-blocks.ts` — Block schema definitions, validation, OpenAI structured output config

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

## 10. Testing Strategy

### Unit Tests

- Block schema validation (Zod schemas for all 7 types)
- Notebook extraction parsing (mock OpenAI responses → expected entries)
- Notebook deduplication logic
- Context assembly and token budgeting
- Warm-up cache behavior (hit, miss, eviction, expiry)
- Dashboard data computation (streaks, averages, trend)
- Block action handlers (log_food, navigate, set_goal)

### Integration Tests

- Full message flow with blocks: send message → receive SSE with blocks → validate block content
- Notebook lifecycle: create conversation → extract entries → verify in subsequent conversation context
- Commitment flow: accept card → verify notebook entry → verify follow-up suggestion
- Tier gating: verify Premium users get text-only, Coach Pro gets full blocks
- Warm-up flow: send warm-up → send final message with warmUpId → verify faster path taken
- Context endpoint: verify batched response matches individual queries

### Manual Testing

- Voice input flow on physical device (STT requires real microphone)
- Dashboard collapse/expand animation smoothness
- Block rendering across all 7 types with real OpenAI responses
- Upgrade banner appearance and navigation for Premium users
- Streaming latency comparison: with vs. without warm-up
