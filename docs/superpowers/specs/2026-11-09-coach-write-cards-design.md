# Coach write cards: check it, then save (M8)

Date: 2026-11-09 · Status: draft for owner approval

## Why

When the owner asked Coach to log a meal, all they got back was text:
"All I got back was a text answer. Chats have come a long way. I would have
liked to see some kind of interface materialize."

Today Coach's three write tools (`log_food_item`, `add_to_meal_plan` and
`add_to_grocery_list` in `server/services/coach-tools.ts`) save nothing. They
return `{ proposal: true, … }` along with a message telling the model to send
the user to Quick Log or the Plan tab. The action cards that do appear
(`actionCardSchema` in `shared/schemas/coach-blocks.ts`) only navigate:
`handleBlockAction` in `client/components/coach/CoachChat.tsx` opens Quick
Log, the Recipe Browser or Grocery Lists. The user leaves the chat to finish
the job.

M8 replaces that with a small editable form that appears inside the chat.

## What the owner decided

- **Option B, "Check it, then save".** Coach fills in a card in the chat. The
  user adjusts it and taps once to save. Nothing is written before that tap.
  The user stays in the chat and is never sent to Quick Log.
- **It covers three jobs:** logging food, adding to a grocery list, and adding
  to the meal plan ("yes, the coach should be able to assist with both").
- **Swap on a plan day** opens two or three alternative recipes in place.
  Tapping one replaces that row.
- **A chat reply updates the current card in place.** If the user types "make
  it three eggs" instead of touching the card, Coach's reply changes the
  existing card. It does not post a new one.
- **Old cards lock.** Once a newer card appears, or a card has been saved, the
  older one can't be tapped.
- **Undo after saving lasts a few seconds**, like the notebook popup
  (`SavedToNotebookPopup.tsx`, auto-confirm after 6 s).

## The three cards

The mockups were shown in chat on 2026-11-09. Light-mode tokens come from
`client/constants/theme.ts`.

### Food card

The user types "I had two eggs and toast for breakfast".

- One row per item: name, per-unit calories ("72 cal each"), and a − / +
  stepper for the count.
- Meal chips: Breakfast · Lunch · Dinner · Snack.
- Primary button: "Log 225 cal". The total updates as the steppers change.
- Saving writes one food-log entry per item, through the same storage path
  Quick Log uses (`createScannedItemWithLog` in `server/storage/nutrition.ts`).

### Grocery card

The user types "What do I need for the lentil stew this week?"

- Checklist rows with quantity and unit. Every row starts ticked except items
  Coach thinks the user already has. Pantry items (from `get_pantry_items`)
  are left off entirely.
- "Add to" chips: the user's existing lists plus "New list".
- Primary button: "Add 4 items". The count follows the ticks.
- Saving uses `addGroceryListItems`, or `createGroceryListWithLimitCheck` for
  a new list.

### Meal plan card

The user types "Plan my dinners for the next three days, high protein".

- One row per day and meal: day, recipe title, calories and protein, plus
  Swap and Remove.
- Swap expands a picker under the row with two or three alternatives, each
  showing title, calories and protein. Coach sends the alternatives with the
  card, so the picker opens instantly with no extra AI call.
- An optional tick, off by default: "Also add the shopping to my grocery
  list".
- Primary button: "Add 3 dinners to plan". The count follows Remove.
- Saving uses `addMealPlanItem`, one row per kept day.

## How every card behaves

**States:**

- **Live:** editable, with the button enabled.
- **Saving:** the button shows progress and the controls lock.
- **Saved:** the card shrinks to a one-line receipt ("✓ Logged to
  Breakfast · 225 cal", "✓ Added 4 items to Weekly shop", "✓ 3 dinners
  added"). Undo shows for a few seconds, then the receipt stays without it.
- **Failed:** an inline error with Retry. The card stays editable and nothing
  is lost.
- **Replaced:** greyed out with the label "Replaced". Not tappable.
- **Expired:** greyed out. This is an unsaved card in a conversation that has
  moved on.

**Rules:**

- **One live card per conversation.** A new card, or a reply that replaces a
  card, locks every earlier unsaved card. The server enforces this, not just
  the app: a save from a card that isn't the conversation's live card is
  refused, so a stale card can't write twice.
- **Updating by chat.** The current card's state, including any edits the
  user made by hand, goes to the server with the user's next message. Coach
  starts from those numbers. Its reply carries a card that names the card it
  replaces, and the app swaps it in place. Coach's text stays short
  ("Updated.").
- **Undo removes exactly what that save wrote**: the log entries, list items
  or plan rows, plus a list created by the save. It uses the existing deletes
  (`softDeleteScannedItem`, `deleteGroceryListItem` / `deleteGroceryList`,
  `removeMealPlanItem`). After Undo the card goes back to Live, so the user
  can fix something and save again.
- **Coach's tools stop saying "this has not been logged".** The tool results
  tell the model a card is on screen for the user to confirm. The prompt must
  never claim anything was saved.

**Transport:** no WebSockets. Every change starts with something the user
does: a message, which uses the existing SSE stream (`server/lib/sse.ts`,
`client/lib/sse-xhr.ts`), or a tap, which is an ordinary authenticated
request. The server never needs to push on its own.

## Calls I made (owner can overrule)

- **Default meal on the food card:** taken from the user's words ("for
  breakfast"). Otherwise it comes from the user's local time of day.
- **Default list on the grocery card:** the most recently used list. "New
  list" sits beside it, and a new list gets a name taken from the request
  ("Lentil stew").
- **Undo window:** 6 s, matching the notebook popup.
- **Old cards** show the "Replaced" or "Expired" label rather than
  disappearing, so the conversation still reads correctly.
- **Existing navigate-style cards** (set_goal, add_allergy, navigate) are not
  changed by M8.
- **Food numbers:** the user edits counts, not calories. The per-unit
  calories and macros come from the server: from `lookup_nutrition` when it
  finds the item, otherwise from Coach's estimate. On save, the server
  re-reads the per-unit numbers it stored for that card. It never trusts
  numbers sent back by the app. The entry is saved with a source that marks
  it as Coach-logged.
- **When a card expires:** only a newer card, or a save, locks a card. If
  Coach replies without a card (for example, the user asks a side question),
  the live card stays live.
- **Older apps:** the app sends a "can show write cards" flag with each
  message. Without it, the tools keep today's wording, so a phone still on
  the old client never hears that a card is on screen when none is.
- **A plan day that already has that meal:** the row shows "Already planned:
  <title>". Saving adds alongside it and doesn't replace anything. The user
  can Remove the row if they don't want both.
- **"Also add the shopping":** the items go to the grocery card's default
  list (the most recently used one), pantry items are left out, and
  quantities follow the existing meal-plan grocery rule (whole batches by
  servings). It is part of the same save, so one Undo removes both the plan
  rows and the list items.

## Owner answers from the builder check (2026-11-09)

- **Plan recipes:** Coach may plan from community recipes. Saving copies each
  community recipe the user doesn't already have into their library, the
  same way the Plan tab does today (`createMealPlanRecipe`, which also starts
  an AI cover image). Undo deletes copies that save created, and only those.
  A Swap alternative can be a community recipe or one the user has already
  saved, so Coach needs a read tool for the user's own recipes.
- **Log date:** the food card logs to today or yesterday, never further back.
  Coach reads the day from the user's words. The card shows it as a
  Today / Yesterday chip the user can change, using
  `createScannedItemWithLog`'s `occurredAt`. For any earlier day, Coach
  points the user to Quick Log.

## Goals

- **Saving takes one tap.** Logging, list-building and planning finish inside
  the chat.
- **The user sees what will be written before it's written,** and can change
  it with taps or with words.
- **The cards look like part of the app:** theme tokens only, the existing
  card and chip styles, and dark mode.

## Non-goals

- Editing or deleting past log entries, list items or plan rows from the chat
  (beyond the Undo window).
- Server-initiated updates and live sync across devices.
- Changing Quick Log, the Plan tab or Grocery Lists screens.
- A new visual identity (owner ruling 2026-10-29: restyle within `theme.ts`
  only).

## Anti-goals (a failure even if it works)

- **Anything written without the user's tap.** That includes an "Updated"
  card that saves itself.
- **A card that saves twice:** a double tap, a stale card, or a retry after a
  save that actually succeeded.
- **Coach saying "Logged" or "Added" in text** when nothing was saved.
- **Sending the user to another screen** to finish the job.
- **Plan rows pointing at recipes that don't exist.**

## Constraints

- Strict TDD. Pure card logic (totals, counts, row edits) lives in
  `client/components/coach/*-utils.ts` so Vitest covers it.
- **Security:** every save and undo endpoint checks that the conversation and
  the card belong to the user (IDOR), is rate-limited (CodeQL is required),
  and validates its body with Zod.
- **Health data:** food-log writes are user health data. Kimi workers never
  touch this code.
- Accessibility: every control is labelled for VoiceOver and TalkBack, uses
  the existing touch-target sizes, and has a reduced-motion variant.
- **Client builds:** the client half needs an OTA to reach phones. Don't
  publish one unasked.
- No `ios/` or `android/` edits (CNG).

## Left to the builder

- Endpoint shapes and names, the card-ID scheme, and where card state is
  stored (chat message `metadata` is the obvious home).
- How to make saves idempotent (for example, a save key per card).
- Exact block and schema names, and whether the existing `log_food`,
  `add_meal_plan` and `add_grocery_list` action schemas grow or new block
  types are added.
- Animation details, within the project's motion rules.
