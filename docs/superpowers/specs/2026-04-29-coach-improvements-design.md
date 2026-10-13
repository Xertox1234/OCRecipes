# Coach Improvements Design

**Date:** 2026-04-29  
**Scope:** UX polish + feature completeness pass on the Coach chat feature  
**Status:** Approved — ready for implementation

---

## Overview

Six targeted improvements across two dimensions:

| ID  | Item                     | Dimension | Layer                                 |
| --- | ------------------------ | --------- | ------------------------------------- |
| B1  | Retry / Regenerate       | UX        | `CoachChat.tsx` + new server route    |
| B2  | Block action feedback    | UX        | `ActionCard.tsx`                      |
| B3  | Conversation management  | UX        | New screen + schema columns + route   |
| C1  | Notebook UI              | Feature   | New screen + 4 server routes          |
| C2  | Local push notifications | Feature   | `expo-notifications` + notebook hooks |
| C4  | Text warm-up             | Feature   | `useCoachWarmUp.ts` + `CoachChat.tsx` |

**No schema migrations required for B1, B2, C4.** B3 adds two columns to `chat_conversations`. C1 adds CRUD routes on the existing `coach_notebook` table. C2 stores notification IDs in the existing `metadata` JSONB column on notebook entries.

**Out of scope:** server-driven push (APNs/FCM), voice TTS output, AI prompt quality improvements. See `todos/` for deferred items.

---

## B1 — Retry / Regenerate

### Behaviour

A `↺ Regenerate` button appears beneath the last assistant message bubble after streaming completes. Tapping it:

1. Removes the last assistant message from the visible list (optimistic UI)
2. Calls `DELETE /api/chat/messages/:id` to delete the assistant message from the DB (owner-scoped — validates `userId` matches `chatMessages.userId`)
3. Re-sends the last user message to the same conversation, triggering a fresh streaming response

### Constraints

- The button is only shown when the last assistant message is also the most recent message in the conversation (i.e. no subsequent user turns). If the user has sent further messages since, the button is hidden.
- One retry at a time — button is hidden while streaming.

### UI

- Small `↺ Regenerate` text button sits below the last assistant bubble, not inside it
- Styled as a subtle secondary action — same visual weight as the `QuickReplies` row
- No retry button on user bubbles

### New server route

```
DELETE /api/chat/messages/:id
```

- Requires auth
- Validates message belongs to requesting user
- Validates message is the most recent in its conversation (server-side guard)
- Returns 204 on success

---

## B2 — Block action feedback

### Problem

Fire-and-forget action block types (`add_grocery_list`, `set_goal`) currently execute silently — no visual confirmation the action worked.

Actions that auto-send a follow-up message (`log_food`, `add_meal_plan`) and actions that navigate (`navigate`) have implicit feedback already and are not changed.

### Solution

`ActionCard` gains an `onPressAsync?: () => Promise<void>` prop. When provided:

1. User taps → card enters **loading state**: spinner replaces the CTA icon
2. Promise resolves → card enters **success state** for 1.5s: ✓ checkmark in `#008A38`, label reads "Done"
3. After 1.5s → card resets to normal state
4. Promise rejects → card enters **error state** for 1.5s: ✗ in `theme.error`, label reads "Failed", then resets

The state machine lives entirely in `ActionCard` — callers just pass an async function.

### Affected action types

| Action             | Change                                                    |
| ------------------ | --------------------------------------------------------- |
| `add_grocery_list` | Pass async grocery-add call as `onPressAsync`             |
| `set_goal`         | Pass async goal-update call as `onPressAsync`             |
| `log_food`         | No change — auto-sends message (existing behaviour)       |
| `add_meal_plan`    | No change — passes planDays to modal (existing behaviour) |
| `navigate`         | No change — brief press animation is sufficient           |

---

## B3 — Conversation Management

### Thread bar changes (CoachProScreen)

- Pinned threads appear first in the horizontal thread bar with a 📌 indicator
- Un-pinned threads show a ☆ star icon (tap to toggle pin)
- Maximum 3 pinned conversations total — if at limit, tapping ☆ on a new conversation shows an alert: "Unpin an existing conversation first." The ☆ in the thread bar and All Conversations screen both enforce this limit.
- A "See all ›" tile at the end opens the All Conversations screen

### All Conversations screen

New `fullScreenModal` screen: `AllConversationsScreen`.

**Layout:**

- Search bar at top (filters by title client-side for loaded results; triggers server search for deeper history)
- Three sections: **Pinned**, **Recent** (last 30 days), **Older** (paginated, 20 per page)
- Each row: title, relative date, message count, ☆ pin toggle
- Swipe-left actions: Delete (with confirmation), Rename (triggers inline text field)
- Tap row → opens conversation in `CoachChat`

### Schema additions

Two new columns on `chat_conversations`:

```sql
isPinned   BOOLEAN NOT NULL DEFAULT false
pinnedAt   TIMESTAMP  -- set when isPinned flips to true, used for sort order among pinned threads
```

### New server route

```
PATCH /api/chat/conversations/:id/pin
Body: { isPinned: boolean }
```

- Requires auth, owner-scoped
- Sets `isPinned` and `pinnedAt` (now) or clears `pinnedAt` (on unpin)
- Returns updated conversation row

### Existing route change

`GET /api/chat/conversations` gains:

- `?search=<query>` param (title ILIKE search)
- `?page=<n>` + `?limit=<n>` pagination (default limit 20)
- Pinned conversations always included in first page regardless of recency

---

## C1 — Notebook UI

### Entry points

1. **CoachProScreen header** — "Notebook" icon button (top-right), opens `NotebookScreen` as `fullScreenModal`
2. **Coach dashboard insights row** — "View all →" link at the end of the insights list

### NotebookScreen — List view

- Filter chips: All · Commitments · Insights · Goals · Preferences · Strategies · Archived
- Entries sorted: active first (by `updatedAt` desc), completed/archived dimmed at bottom
- Each row: color-coded type dot, type label, content preview (2 lines), optional due date badge
- Swipe-left: **Archive** (sets `status = "archived"`) and **Delete** (with confirmation alert)
- Tap row → NotebookEntryScreen

**Type colour mapping:**
| Type | Colour |
|------|--------|
| commitment | `#f59e0b` (amber) |
| insight | `#7c6dff` (purple) |
| goal | `#008A38` (green) |
| preference | `#06b6d4` (cyan) |
| coaching_strategy | `#06b6d4` (cyan) |
| motivation | `#ec4899` (pink) |
| emotional_context | `#ec4899` (pink) |
| conversation_summary | `#888` (grey) |

### NotebookEntryScreen — Detail / Edit

- Type selector: horizontal pill row of all 8 types (tap to change)
- Content: inline `TextInput` (multi-line, up to 500 chars per existing schema constraint)
- Follow-up date: tappable date picker (only shown for `commitment` type)
- Source attribution: "Extracted from [conversation title] · [date]" or "Added by you · [date]"
- **Mark Complete** button (only for `commitment` and `goal` entries with `status = "active"`)
- **Archive** button
- Save button in header (disabled until changes made)

### Create entry — bottom sheet

Tapping "+ New" opens a bottom sheet:

- Type selector pill row
- Multi-line content `TextInput`
- Optional follow-up date picker (shown when type is `commitment`)
- Save / Cancel

User-authored entries are saved with `metadata: { source: "user" }` so the notebook extraction pipeline skips re-extracting them.

### New server routes

```
GET    /api/coach/notebook          — list, ?type=, ?status=, ?page=, ?limit=20
POST   /api/coach/notebook          — create (user-authored)
PATCH  /api/coach/notebook/:id      — edit content, type, followUpDate, status
DELETE /api/coach/notebook/:id      — hard delete (owner-scoped)
```

All routes require auth and validate `userId` ownership before read/write.

---

## C2 — Local Push Notifications

### Trigger

When a notebook entry of type `"commitment"` is saved with a non-null `followUpDate` — whether via AI extraction or user creation/edit — schedule a local notification for **9:00 AM local time** on that date.

### Permission

Request notification permission on the user's first Coach Pro session (not on app launch). Handled via `expo-notifications`'s `requestPermissionsAsync`. If denied:

- Entry saves normally without a notification
- Commitment cards in NotebookScreen show a subtle hint: "Enable notifications to get a reminder" (links to device Settings)

### Notification content

```
Title: "Coach reminder"
Body:  <commitment content, truncated to 100 chars>
Data:  { notebookEntryId, conversationId? }
```

### Deep linking on tap

- If entry has a source `conversationId`: navigate to `ocrecipes://chat/[conversationId]` (already registered in `client/navigation/linking.ts`)
- Otherwise: navigate to the Coach tab via root navigation (no deep link needed — handled in the notification response listener)

The notification response listener passes `notebookEntryId` as a navigation param so `CoachProScreen` can auto-open the notebook modal scrolled to the relevant entry.

### Notification ID persistence

The `expo-notifications` identifier returned by `scheduleNotificationAsync` is stored in the entry's `metadata.notificationId`. This enables cancellation by ID without querying all scheduled notifications.

### Lifecycle management

| Event                             | Action                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Entry created with `followUpDate` | Schedule notification, store ID in `metadata.notificationId`                                                                              |
| `followUpDate` edited             | Cancel old notification, schedule new one, update `metadata.notificationId`                                                               |
| Entry marked complete or archived | Cancel notification, clear `metadata.notificationId`                                                                                      |
| App comes to foreground           | Query all active commitment entries, cancel notifications for any with `status != "active"` (cleanup for entries changed outside the app) |

### Implementation notes

- `expo-notifications` is already a dependency (check `package.json` before installing)
- Notification scheduling is client-side only — no server changes required
- A `useNotebookNotifications` hook wraps the scheduling/cancellation logic, called from `NotebookEntryScreen` on save and from the app's `AppState` change listener for foreground cleanup

---

## C4 — Text Warm-Up

### Current behaviour

`useCoachWarmUp` fires a warm-up pre-fetch when `expo-speech-recognition` starts (voice input only).

### Change

Wire the warm-up trigger to text input changes in `CoachChat.tsx`:

- Fire warm-up after the user has typed **3+ characters** and paused for **500ms** (debounce)
- Cancel the debounce timer on message send
- The existing dedup logic in `coach-warm-up.ts` makes this a no-op if a warm-up is already in-flight for the same conversation

### Implementation

One additional call in `CoachChat.tsx`'s `onChangeText` handler — pass the debounced warm-up trigger from the existing `useCoachWarmUp` hook. No server changes required.

---

## Files Affected

### Client (new files)

- `client/screens/AllConversationsScreen.tsx`
- `client/screens/NotebookScreen.tsx`
- `client/screens/NotebookEntryScreen.tsx`
- `client/hooks/useNotebookNotifications.ts`

### Client (modified files)

- `client/components/coach/CoachChat.tsx` — B1 retry button, C4 text warm-up
- `client/components/coach/blocks/ActionCard.tsx` — B2 feedback states
- `client/screens/CoachProScreen.tsx` — B3 thread bar pins, "See all" tile, C1 notebook entry point
- `client/navigation/` — register new screens in root modal stack
- `client/types/navigation.ts` — add `AllConversations`, `NotebookScreen`, `NotebookEntryScreen` to root params

### Server (new files)

- `server/routes/notebook.ts` — CRUD routes for `/api/coach/notebook`

### Server (modified files)

- `server/routes/chat.ts` — add `DELETE /api/chat/messages/:id`
- `server/storage/chat.ts` — add `deleteMessage`, `pinConversation`, paginated + searchable `getConversations`

### Schema (modified)

- `shared/schema.ts` — add `isPinned`, `pinnedAt` to `chatConversations` table definition
- Run `npm run db:push` after schema change

---

## Deferred / Out of Scope

See `todos/` for full details:

- `todos/coach-server-driven-push.md` — APNs/FCM server-driven push for reminders
- `todos/coach-voice-tts.md` — voice TTS output
- `todos/coach-ai-quality.md` — AI prompt and context quality improvements
