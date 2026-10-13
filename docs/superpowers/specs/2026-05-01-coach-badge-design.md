# Coach Tab Badge — Design Spec

**Date:** 2026-05-01  
**Status:** Approved for implementation

## Overview

A small red dot on the Coach tab in the bottom tab navigator signals that the app has a proactive reminder waiting for the user. Tapping the tab navigates into the Coach chat, where the AI has already composed a contextual opening message based on what triggered the reminder. The dot clears as soon as the user opens the Coach tab.

---

## Decisions

| Question               | Decision                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| What triggers the dot? | System-generated reminders only (not unread chat replies)                                          |
| Which reminder types?  | Meal logging nudges, commitment follow-ups, daily check-in (Phase 1); user-set reminders (Phase 2) |
| Badge appearance       | Simple red dot — no number                                                                         |
| In-tab experience      | Coach proactively sends a message weaving together all pending reminder contexts                   |
| When does dot clear?   | When user opens the Coach tab (on focus)                                                           |
| Mute control           | Per-category toggles in Profile/Settings                                                           |
| Architecture           | Server-side `pendingReminders` table; client polls on app foreground                               |

---

## Data Model

### New table: `pendingReminders`

```ts
pendingReminders: {
  id:             serial PRIMARY KEY
  userId:         integer NOT NULL  // → users.id
  type:           text NOT NULL     // "meal-log" | "commitment" | "daily-checkin" | "user-set"
  context:        jsonb             // payload passed to coach AI
  scheduledFor:   timestamp NOT NULL
  acknowledgedAt: timestamp         // null = still pending
  createdAt:      timestamp NOT NULL DEFAULT now()
}
```

**`context` shape by type:**

```json
// meal-log
{ "mealType": "lunch", "lastLoggedAt": "2026-05-01T09:00Z" }

// commitment
{ "notebookEntryId": 42, "content": "drink 8 glasses of water daily" }

// daily-checkin
{ "calories": 1240, "goal": 2000, "streak": 3 }

// user-set (Phase 2)
{ "message": "Take medication" }
```

### `userProfiles` addition

A new `reminderMutes` JSONB column on the existing `userProfiles` table. No new table required.

```ts
reminderMutes: jsonb DEFAULT '{}'
// shape: { "meal-log": false, "commitment": false, "daily-checkin": false }
```

---

## Server — Scheduling

The existing `notification-scheduler.ts` daily cron (09:00) is extended. For each user it runs three checks (respecting `reminderMutes`) and inserts into `pendingReminders` when conditions are met:

| Type            | Condition                                                                              |
| --------------- | -------------------------------------------------------------------------------------- |
| `meal-log`      | A meal window (breakfast/lunch/dinner) has passed with no log entry for the user today |
| `commitment`    | `coachNotebook` rows where `status = 'active'` and `followUpDate ≤ today`              |
| `daily-checkin` | Always fires once per day unless muted; includes calorie progress + streak in context  |
| `user-set`      | Phase 2 — requires `userReminders` table + creation UI                                 |

Duplicate guard: insert is skipped if an unacknowledged row of the same `type` already exists for the user on the same calendar day.

---

## API

### `GET /api/reminders/pending`

Returns whether the authenticated user has any unacknowledged pending reminders.

```json
{ "hasPending": true }
```

### `POST /api/reminders/acknowledge`

Marks all unacknowledged `pendingReminders` rows for the user as acknowledged (`acknowledgedAt = now()`). Returns the aggregated context for the Coach AI to use.

```json
{
  "acknowledged": 2,
  "coachContext": [
    { "type": "meal-log", "mealType": "lunch" },
    { "type": "commitment", "content": "drink 8 glasses of water daily" }
  ]
}
```

Both endpoints require Bearer token auth. Both live in a new `server/routes/reminders.ts` route file registered via `server/routes.ts`.

---

## Client

### `usePendingReminders` hook — `client/hooks/usePendingReminders.ts`

- Calls `GET /api/reminders/pending` via TanStack Query
- Refetches whenever the app returns to foreground (`AppState` change listener)
- Returns `{ hasPending: boolean }`

### `useAcknowledgeReminders` hook — `client/hooks/useAcknowledgeReminders.ts`

- Wraps `POST /api/reminders/acknowledge` as a TanStack mutation
- Returns `{ acknowledge: () => Promise<void>, coachContext: CoachContextItem[] }`
- On success, invalidates the `usePendingReminders` query so the dot clears immediately

### `MainTabNavigator.tsx` — badge dot

The existing `AnimatedTabIcon` component gains an optional `showDot` prop. When `true`, a 9×9 red circle is rendered as an absolute-positioned overlay on the top-right of the icon. Only the Coach tab receives this prop, driven by `usePendingReminders().hasPending`.

```tsx
<AnimatedTabIcon name="message-circle" focused={focused} showDot={hasPending} />
```

Dot styling:

- Size: 9×9 px
- Color: `#EF4444` (red-500)
- Border: 2px solid background color (prevents bleed into icon)
- Position: `top: -2, right: -2` relative to icon container

### `CoachContextItem` type — `shared/types.ts`

```ts
type CoachContextItem =
  | { type: "meal-log"; mealType: string }
  | { type: "commitment"; content: string; notebookEntryId: number }
  | { type: "daily-checkin"; calories: number; goal: number; streak: number }
  | { type: "user-set"; message: string };
```

### Proactive coach message

**Premium users (`CoachProScreen.tsx`):** On mount or navigation focus, calls `acknowledge()`. If `coachContext` is non-empty, injects a hidden `role: "system"` message into the conversation before the AI reply, instructing the coach to open with a natural message weaving together all pending contexts. If `coachContext` is empty, no injection occurs and chat behaves normally.

**Free users (`ChatListScreen.tsx`):** On mount or navigation focus, also calls `acknowledge()` to clear the dot. No proactive message is injected — free users see the normal conversation list. The dot clearing is the primary behaviour for this tier.

---

## Mute Settings UI

A new **"Coach Reminders"** row in the existing Profile/Settings screen opens a simple toggle list — one `Switch` per reminder type. Saved via `PATCH /api/profile` to the `reminderMutes` column.

Reminder types shown:

- Meal logging nudges
- Commitment follow-ups
- Daily check-in

(User-set reminders toggle added in Phase 2 alongside the creation UI.)

---

## Phase 2 — User-set Reminders

Deferred. Requires:

1. New `userReminders` DB table (`id`, `userId`, `message`, `fireAt`, `recurrence`)
2. Reminder creation UI (new modal or settings sub-screen)
3. Cron check against `userReminders` where `fireAt ≤ now`

Phase 1 ships without this. The `type` discriminator already accommodates `"user-set"` so no schema migration is needed when Phase 2 ships.

---

## Out of Scope

- Push notifications (not required for dot accuracy; can be added later as a separate enhancement)
- Unread message count from AI chat replies (a different feature)
- Cross-device badge sync beyond what the server table already provides
