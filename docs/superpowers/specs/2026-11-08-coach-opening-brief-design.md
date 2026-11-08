# Coach opening brief — design

Date: 2026-11-08 · Status: draft for owner review · Source: Coach chat polish report, idea P1 (with P3)

## Intent

The Coach chat "does not feel unique or special" (owner, 2026-11-08). Today Coach Pro shows a
collapsible dashboard above every conversation, and a new free chat shows a list of stock prompts, and the red dot on the
Coach tab says "something happened" and then says nothing. The coach should speak first: a new
chat opens with a short message from the coach that greets the user, recaps their day, and
gives one useful pointer. When the dot was lit by a reminder, that first message leads with the
reason and offers to help with it.

The collapsible dashboard is removed. The owner's words: "get rid of that collapsable dashboard,
thats the whole reason we are doing this".

## Owner decisions (2026-11-08)

1. **New chats open with a greeting and recap** from the coach. Mockup A was approved: one coach
   bubble with a greeting line, a calories and protein sentence, a small three-stat row, one
   pointer sentence, and three reply chips under the bubble.
2. **When a reminder lit the dot, the reason comes first, with buttons** for what it needs, and a
   shorter recap follows. Mockup B was approved.
3. **The wording is assembled from data**, not written by the AI. It uses fixed templates, makes
   no model call, adds no wait, and the numbers are exact.
4. **CoachDashboard is removed** from Coach Pro.
5. **Everyone gets the brief**, free and Coach Pro users alike.
6. **The Coach tab opens a fresh chat with the brief when it matters**: the first visit of the
   day, or when a reminder is pending. Otherwise it opens as now.

## Goals

- **No blank first screen:** every new coach conversation shows the brief as its first message.
- **The dot means something:** pending reminder context, which is stored today and thrown away,
  is shown to the user with an action.
- **One pointer per brief**, so the message stays short.
- **The coach knows what it said:** the brief text reaches the model as part of the conversation,
  so the model can refer back to it.

## Non-goals

- **No AI-written brief.** No LLM call happens in this path.
- **No push notifications, reminder scheduling or new reminder types.** P12, P6 and P7 are
  separate ideas.
- **No Sunday look-back (P5)** and no visible-memory work (R1–R3).
- **No restyle beyond theme tokens.** The owner ruling says to keep the current design and
  restyle within `theme.ts` only. The brief uses the existing assistant-bubble styling.
- **The unread-reply dot is unchanged.** It already opens the reply the user missed.

## Anti-goals (a failure even if it works)

- **A brief that feels like a template banner:** the same three lines on every chat, every time
  of day. Avoid this with the time-of-day greeting, the single varying pointer and contextual
  chips, plus the short form for repeat chats (below).
- **Wrong numbers.** The recap must match what the Home screen shows for the same day and
  timezone.
- **A visible wait:** the brief must not hold up the chat. If its data is slow or fails, the
  chat works as it does now, with no error toast for the brief.
- **Shaming language:** no "you failed", no red for being over the calorie goal. Keep the
  neutral "Over" wording from #1802.
- **Nagging:** a reminder shows once, and answering it or sending a message clears it.

## Behaviour

### What the Coach tab opens (owner, 2026-11-08: "Fresh chat when it matters")

Today Coach Pro auto-selects the most recent thread (`CoachProScreen.tsx`, the
`threadBarConversations[0]` adjust-during-render), and free users land on the chat list
(`coachInitialRoute`). So the brief would only show after tapping New. The new rule:

- **The tab opens a new, unsaved draft chat with the brief** when either:
  - this is the user's first Coach visit of their local day (stored on the device), or
  - a reminder that passes the "Which reminders are shown" filter is pending.
- **Otherwise the tab behaves as it does now:** the last thread for Pro, the list for free.
- **Free users land in that draft too** (a new coach conversation screen). Back from it returns to
  the list.
- **No empty rows:** the draft creates no conversation until the first send, as `isNewDraft`
  already does for Pro.
- **Existing threads get no brief:** a reopened thread with messages shows no brief and no
  dashboard. The day's numbers live in the brief and on Home. The owner accepted this as part of
  removing the dashboard.
- **Deep links win:** a link or notification tap that names a conversation (for example
  `openCoachConversation`, `selectedConversationId`) always opens that conversation, never the
  draft.

### Where it shows

- **Coach Pro** (`CoachProScreen` → `CoachChat`): a new or empty conversation. The brief replaces
  the space the dashboard used.
- **Free** (`ChatScreen`): a new or empty coach conversation only. The brief replaces the
  `SuggestedPrompts` empty state; the upgrade and camera entry points that view held still need a
  home (builder: keep them reachable, for example as chips or one row under the brief). This does
  not apply to recipe or other non-coach conversation types that `ChatScreen` also hosts.
- **Any conversation with messages:** no brief is added on reopen. It is part of the history only
  if it was saved there (see "The coach knows what it said").

### Message content (fixed templates)

1. **Greeting:** time of day plus the user's first name when known ("Good afternoon, Will."),
   reusing the existing `getGreeting()` logic.
2. **Recap sentence:** "You're at {consumed} of {goal} calories." Then add protein when a protein
   goal exists and the user is behind ("Protein is behind at {p} of {goal} g."). With no goals
   set, say "You've logged {consumed} calories so far." With nothing logged, say "Nothing logged
   yet today." Use whole numbers and locale separators, matching `remainingCaloriesStat`.
3. **Stats row** (up to three tiles): calories left (or "Over"), protein still to go, and
   tonight's planned meal name, which is shortened. Drop a tile when its data is missing.
4. **One pointer sentence**, chosen in this priority order:
   1. a pantry item expiring within 1 day, paired with tonight's plan when there is one
   2. tonight's planned meal
   3. the top notebook tip, using `selectTopInsights(notebook, 1)` so the #1802 dedupe survives
   4. a goal gap ("40 g protein left")
   5. nothing
5. **Chips:** the existing server `suggestions` list plus `withFeatureChip`, at most three, shown
   under the bubble. Tapping a chip sends it, as dashboard chips do today.

### Reminder-led form

When the user has unacknowledged pending reminders, the bubble opens with the newest one as a
highlighted section with action buttons. The day recap follows as a second, shorter bubble: the
recap sentence only, with no stats row and no pointer.

| Reminder type   | Lead line                                                                  | Buttons                                        |
| --------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `commitment`    | "Earlier you said you'd {content}. How did it go?"                         | **Went well** / **Partly** / **Didn't happen** |
| `meal-log`      | "Nothing logged yet today."                                                | **Log {meal for time of day}** opens Quick Log |
| `daily-checkin` | "Time for your check-in." The recap bubble below carries the live numbers. | **How was my day?** (sends it)                 |

`user-set` exists in the type and schema but nothing produces it today (it is not in
`server/services/notifications/registry.ts`), so it gets no template. The brief skips such rows.

**Which reminders are shown** _(builder-check calls, 2026-11-08)_:

- Only reminders whose `scheduledFor` falls on the user's current local date. Older ones are stale.
- A `meal-log` reminder is dropped when today's intake is above zero. It was true when it fired but
  not any more.
- The `daily-checkin` stored `calories` snapshot (taken at 09:00) is never shown. The recap uses
  live intake.
- The commitment template says "Earlier" rather than a day, because the reminder context carries no
  date and an extra notebook read for one word isn't worth it.

- **Multiple pending reminders:** lead with one, chosen by type in this order: commitment,
  meal-log, daily-checkin. The rest are not shown in this version.
- **Commitment answers send a chat message; they don't PATCH the entry.** When the push was
  delivered, `notification-scheduler.ts` has already marked the entry `completed`. Reactivating or
  archiving it from a button would fight the scheduler, so the buttons send "It went well", "It
  went partly" or "It didn't happen" as the user's message, which also acknowledges the reminder.
  The coach follows up in conversation. Changing the entry status from the answer is a later
  idea (P4) that needs a scheduler change.
- **Ask Coach overlay** (`CoachOverlayContent`): no brief. It stops acknowledging reminders,
  because it never shows them, and a send there would otherwise clear a reason the user never saw.
- **Free first-turn cache:** `coach-pro-chat.ts` caches free first answers while
  `history.length <= 1`. The saved brief must not count toward that check or the cache key. It is
  deterministic day data, and losing the cache would raise AI cost on every free first turn.
- **Acknowledging:** tapping any reminder button, or sending any message, acknowledges reminders
  through the existing `POST /api/reminders/acknowledge` call. Opening the chat alone does not
  acknowledge them, which matches today's rule.

### Repeat chats the same day

Once the user has seen the full brief today, later new chats that day get the short form: the
greeting plus the recap sentence only, unless a reminder is pending. "Seen today" is stored on
the device, keyed by the user's local date. Losing it only means one extra full brief.

### The coach knows what it said

The brief's plain text (no buttons) must be in the conversation history the model sees, saved
as an assistant message before the user's first message. It is saved only when the user sends
something, so abandoned new chats leave no rows. Mechanism: the builder's call. The likely route
is an optional `openingBrief` field on the first send, which the server writes as an assistant
message before the user's message, after length-capping it and checking that it came from the
template set. The model should not see an AI-authored brief it never wrote.

## Data

New endpoint `GET /api/coach/brief` (requires auth, rate-limited like `/api/coach/context`, and
available on every plan). It returns structured data, not text:

- `greetingName`
- `todayIntake`: totals for the user's timezone, using `parseTimezone(x-timezone)`
- `goals`
- `tonightPlan`: today's dinner from the meal plan, if any
- `expiringPantry`: items expiring within 1 day, capped at 3
- `topTip`
- `suggestions`
- `pendingReminders`: unacknowledged reminder contexts, read-only. This needs a new
  peek-style storage read that does not set `acknowledgedAt`, parsed with `coachContextItemSchema`
  the same way `acknowledgeReminders` does.

What free users actually get: notebook extraction runs only for Coach Pro, and pantry needs the
premium `pantryTracking` feature. So free users have no commitment reminders, no notebook tip and
no pantry line. Their pointer is tonight's plan or a goal gap. The endpoint gates notebook and
pantry fields by feature. `buildCoachContext` fetches no meal-plan or pantry data, so
`tonightPlan` and `expiringPantry` are new queries over the existing storage helpers
(`getMealPlanItems`, `getExpiringPantryItems`). `selectTopInsights` moves to `shared/` so the
server can pick `topTip` with the #1802 dedupe.

The client builds the sentences from this data with pure functions in
`client/components/coach/opening-brief-utils.ts`, so Vitest covers every template case.

Reuse `buildCoachContext`'s data fetches where possible rather than duplicating queries.
`/api/coach/context` stays Coach-Pro-gated, because it carries notebook and pattern data. For
free users the brief either omits notebook-derived fields or sends only the single top tip
(builder: the free brief has no notebook tip unless the free plan already reads the notebook).

## Removed

- `client/components/coach/CoachDashboard.tsx` and its tests, plus the fold persistence it alone
  uses (`getCachedCoachDashboardFolded`, `loadCoachDashboardFolded`, `setCoachDashboardFolded`
  and their storage key).
- `remainingCaloriesStat` and `selectTopInsights` move to, or are imported by, the brief utils
  rather than being deleted.
- `CoachProScreen`'s `forceCollapsed={keyboardVisible}` wiring, if nothing else uses it.
- **Notebook entry point:** the dashboard's Notebook button moves to a notebook icon in the Coach
  header (both screens if free users have a Notebook, otherwise Coach Pro only).

Every removal is listed in the PR body. Unused code that wasn't the dashboard's is left alone,
per the owner rule that unused is not removable.

## States

| State                         | What shows                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Loading                       | No skeleton; the chat composer is usable at once, and the brief appears when ready with a short fade (reduced motion: no fade) |
| Brief fetch failed or offline | No brief; the old empty view (free) or an empty chat (Pro); no toast                                                           |
| No goals set                  | Recap without "of {goal}"; no stats row                                                                                        |
| Nothing logged                | "Nothing logged yet today." plus a Log chip                                                                                    |
| Over goal                     | "Over" tile; neutral wording                                                                                                   |
| Reminder pending              | Reminder-led form                                                                                                              |
| Dark mode                     | Existing bubble tokens; check contrast of the highlighted reminder section                                                     |
| VoiceOver                     | The bubble reads as one coach message; buttons are labelled ("Went well, commitment: prep overnight oats")                     |

## Testing

Strict TDD:

- **Pure template functions:** each recap case, each pointer priority, each reminder type, and
  the short form.
- **Endpoint:** a route test for free and Pro users and for timezone handling, and a test that
  the peek read leaves `acknowledgedAt` null.
- **Screens:** the brief shows on an empty conversation and not on one with messages; a reminder
  button acknowledges and calls PATCH; the first send carries `openingBrief`.
- **Simulator check:** both screens, light and dark, with a seeded pending reminder.

## Left to the builder

- **Exact copy.** Keep it inside the templates above, short and in a plain voice.
- **Saving the brief:** how `openingBrief` is validated and stored, within the constraints above.
- **Free-plan surfaces:** where the free view's upgrade and camera entry points go.
- **Multiple reminders:** whether more than one pending reminder gets a "+1 more" line.
- **The header notebook icon:** its glyph and accessibility label.
