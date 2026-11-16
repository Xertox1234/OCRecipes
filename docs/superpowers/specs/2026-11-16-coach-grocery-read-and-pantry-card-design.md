# Coach: read grocery lists, change the pantry

Date: 2026-11-16. Status: proposed, awaiting owner approval.

Two features, shipped as two PRs in this order:

1. **Grocery read tool** — Coach can see the user's grocery lists. Server
   change plus one new line in the AI-sharing disclosure, which the app shows
   from a shared file, so that line reaches phones only with the next app
   update.
2. **Pantry card** — Coach can propose pantry changes on a tap-to-save card.
   Server, a migration and a client card (needs an app update).

The owner asked for both and handed the design to the agent ("approved" on
2026-11-16), so every choice below is the agent's call unless marked
**Owner decision**.

## Why

A review of Coach's tools (2026-11-16) found it can read the pantry but not
change it, and can add to a grocery list but not see one. So "what's still on
my list?" has no answer, Coach cannot avoid proposing what is already listed,
and "I used the last of the eggs" changes nothing. The grocery card's own
defects were fixed first in #1892.

## Goals

- Coach answers questions about what is on the user's grocery lists.
- Coach can propose adding to, using from and removing from the pantry, and
  the user confirms each change with one tap, with Undo.

## Non-goals

- Coach removing, checking off or editing grocery list items. The read tool is
  the first step toward that; the write side is a later project.
- Coach changing a pantry item's name, category or expiry date.
- Changing the meal-plan card's pantry rule (`pantry-deduction.ts`).

## Anti-goals

- Coach never writes to the pantry or a list directly. Every change is a card
  the user saves.
- An app build that cannot draw the pantry card must never be told one is on
  screen.
- List and pantry text written by the user must not reach the model unsanitized.

## Constraints found in the code

- Write cards: the tool call records a proposal, the card row is created at the
  end of the turn, the app saves it through `POST` on the card, and Undo
  reverts by ids kept in `savedRefs` (`server/services/write-cards/`).
- The app declares card support with one flag, `writeCards: true`
  (`server/routes/chat.ts`). A block whose kind the app does not know fails
  `coachBlockSchema` and is dropped silently (`coach-chat-utils.ts`).
- `coach_write_cards.kind` has a database check: `food`, `grocery`, `plan`
  (migration 0042).
- Pantry storage has insert-under-cap (500 items, per-user lock), update and
  delete. Update and delete run on `db`, not on a caller's transaction.
- Pantry routes require the `pantryTracking` plan feature.
- `get_pantry_items` hands the model each row's `id`, name, quantity and unit,
  sanitized.
- The AI-sharing disclosure (`shared/lib/ai-sharing.ts`) lists what is sent to
  AI companies. It does not mention the pantry or grocery lists, although
  `get_pantry_items` already sends pantry rows.

## Approaches

### Grocery read tool

- **A. One tool, recent lists with their open items (chosen).**
  `get_grocery_lists` returns the user's most recent lists with the items still
  to buy. One call answers most questions and matches how the grocery card
  already offers the four most recent lists.
- B. Two tools: list the lists, then fetch one by id. More precise for users
  with many lists, but costs two model round-trips for the common question.
- C. Put the lists in Coach's standing context on every turn. No tool call,
  but it sends list contents on turns that never need them, which is worse for
  cost and for privacy.

### Pantry card

- **A. One new card kind with a row per change (chosen).** Each row is an add,
  a use or a remove. One card covers "I bought eggs and finished the milk".
  It follows the food, grocery and plan cards, so save, Undo, edits and the
  locked state come from the existing shell.
- B. Three separate tools and cards (add, use, remove). Simpler rows, but a
  turn shows at most one card, so a mixed request would lose changes.
- C. Let Coach write directly and report it. Rejected: it breaks the
  tap-to-save rule every other Coach write follows.

## Design 1: grocery read tool

**Tool.** `get_grocery_lists`, no required arguments, optional `listName`
(text; lists whose title contains it, case-insensitive). Available wherever
`get_pantry_items` is.

**Result.** Up to 4 most recent lists (or up to 4 matches for `listName`).
For each: `id`, `title`, the date range, how many items are bought, and the
items still to buy (name, quantity, unit, category), capped at 60 per list
with a `more` count when cut. Bought items are counted, not listed. Titles,
names, units and categories pass through `sanitizeUserInput`.

**Storage.** A new user-scoped read in `server/storage/grocery-lists.ts`
that returns the lists with their items in one query pair. Every query filters
on `userId`.

**Coach's view of it.** Tool description says when to call it: questions
about what is on a list, and before `add_to_grocery_list` when the user asks
to add to a list they already have. A step label ("Checking your grocery
lists…") and a "Checked:" trail entry, as the pantry tool has.

**Privacy.** Add one line to `AI_SHARED_DATA`: "Your pantry items and grocery
lists, when Coach looks at them", and bump `AI_SHARING_VERSION`. This also
covers the pantry rows the existing tool already sends. Two limits to know:

- `AiSharingScreen.tsx` renders `AI_SHARED_DATA` from the app bundle, so an
  installed build shows the old list until an app update, while the server
  starts sending list contents as soon as PR 1 deploys. Accepted because the
  app has no users (owner ruling 2026-10-06); the PR must say so.
- The public privacy page is not in this repo's served files (searched
  `server/` and `docs/` for the recipient names; nothing found). The builder
  locates it before PR 1 merges, or reports that it lives elsewhere.

**Owner decision:** confirm the wording of the line.

**Not included.** No pagination past 4 lists and 60 items; Coach says there
are more and the user opens the list.

## Design 2: pantry card

### What the user sees

```
┌ Pantry ─────────────────────────────┐
│ ☑ Add     Eggs            12        │
│ ☑ Add     Greek yogurt    500 g     │
│ ☑ Use     Milk            1 L of 2 L│
│ ☑ Remove  Spinach         1 bag     │
│                                     │
│            [ Update pantry ]        │
└─────────────────────────────────────┘
After save:  ✓ Pantry updated · 2 added, 1 used, 1 removed   Undo
```

Each row has a tick, the action as a word (never colour alone), the name and
the amount. The user can untick rows. There is no amount editing on the card
in this version; a wrong amount is fixed by telling Coach, which replaces the
card. The receipt and Undo behave as on the other cards.

### Tool

`update_pantry`, offered only when the app declared the pantry card and the
user has `pantryTracking`. Arguments: `changes` (1 to 20), each one of:

- `add`: `name`, optional `quantity`, `unit`, `expiresInDays` (1 to 365).
- `use`: `itemId` from `get_pantry_items`, and `quantity` or `all: true`.
- `remove`: `itemId`.

Text fields use the same `cardText` screen as the other cards. The tool
description tells Coach to call `get_pantry_items` first for a use or remove.

### Building the card (during the tool call)

As the grocery card now does, the card is worked out inside the tool call so
the result can tell Coach what happened:

- A `use` or `remove` whose `itemId` is not the user's is dropped and named in
  the result. Ids are always read with the user's id in the query.
- A `use` of more than the row holds, or of a row with no quantity, becomes
  "use all" (the row is removed on save).
- An `add` that matches an existing row (same name key and unit, both with
  quantities) is shown as a top-up of that row; otherwise it is a new row.
- If no change survives, no card is shown and the result says so.

The payload stores, per row: the action, the display name and amount, and for
`use`/`remove`/top-up the pantry row id and the quantity seen at build time.

### Saving

One transaction: the card's existing save transaction (`saveWriteCard` locks
the card row, then runs the kind's save). The pantry save takes the pantry's
per-user advisory lock as its first step, for every action, not only adds, so
the cap count and the "changed since" check are both read under the lock. The
lock helper in `server/storage/pantry.ts` is private today and gets exported.
Card-row lock then pantry lock is the only order used; no pantry path takes a
card lock, so the two cannot deadlock. Queries on the transaction run one
after another (database rule: no `Promise.all` on one transaction client).

- New rows go through `insertPantryItemsUnderCap`; rows that do not fit under
  the 500 cap are skipped and the receipt says how many.
- A `use`, `remove` or top-up whose row is gone, or whose quantity no longer
  equals the one seen at build time, is skipped ("1 changed since" on the
  receipt). The card never overwrites a change the user made elsewhere.
- Update and delete get transaction-taking variants in
  `server/storage/pantry.ts`, both filtered on `userId`.

`savedRefs` records the ids of rows added, and a full copy of every row
updated or deleted.

### Undo

Deletes the added rows, restores updated rows to their copied quantity, and
re-inserts deleted rows from the copy (they get new ids). A restore that would
pass the cap is impossible, since Undo only puts back what the save removed.
A row the user changed after the save is left as the user has it.

### Old app builds

The app sends `cardKinds: ["pantry"]` next to `writeCards: true`. The server
offers `update_pantry` only when that list includes `pantry`. A build without
it never gets the tool, so Coach answers as it does today. The existing three
kinds stay tied to `writeCards: true` alone.

A saved conversation can still be opened later on an older build. There the
pantry block fails the block schema and is dropped, as any unknown block is;
the message text stays. That is accepted.

Adding a kind touches every place that switches on the card kind (about 11
sites: the payload and edits schema maps, build, save, revert, receipt, the
tool-for-kind map, the live-card description, and the client's `canSave` and
locked summary). The builder finds them with the LSP references of
`WriteCardKind` and lets the type checker's exhaustiveness errors confirm
none is missed.

### Database

Schema and migrations are on the repo's hard-exclusion list: they need a
human-approved plan. **Owner decision:** approving this spec approves the
following, and nothing else in the schema.

- Migration 0048 drops and re-adds `coach_write_cards_kind_check` as
  `kind IN ('food', 'grocery', 'plan', 'pantry')`, in one transaction, written
  to be safe to run twice. The matching `check(...)` in `shared/schema.ts`
  and `WRITE_CARD_KINDS` change in the same PR.
- No new tables or columns: the row copies live in the existing `saved_refs`
  JSON (`CoachWriteCardSavedRefs` gains two optional fields).
- Order: apply to prod before the PR merges. The wider constraint is harmless
  to the old server, which never writes `pantry`.
- Verify on prod and paste the output in the PR. `to_regclass` cannot see a
  constraint, so the check is
  `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coach_write_cards_kind_check'`,
  and the output must name `pantry`.

### Client

A `PantryWriteCard` component beside the other three, registered in
`WriteCard.tsx`, with the payload and edits schemas added to
`shared/schemas/coach-write-cards.ts`. Screen-reader labels read the whole row
("Add, eggs, 12, ticked"). Built within the current theme. Ships in an app
update; the server half is harmless before then because of the `cardKinds`
gate.

## Testing

- Grocery read: storage test with two users (no cross-read), tool test for
  sanitizing, the caps and `listName`.
- Pantry card: build tests for each drop and conversion rule; save tests for
  the cap, a row changed since build, and a foreign `itemId`; Undo tests for
  each action; a chat test that the tool is absent without `cardKinds`.
- Client: card logic in a `*-utils.ts` file under Vitest; a simulator check of
  the card with VoiceOver.
- Not planned: a paid model eval of how Coach uses the tools (evals need the
  owner's OK for the spend).

## Review notes (2026-11-16)

Self-reviewed with the repo's spec-review procedure, calibrated against the
write-cards and show-the-work specs. Edits made from it: the disclosure's
app-update lag, the missing privacy page location, the lock order on save,
the hard-exclusion callout and exact prod check for the migration, the
old-build history case, and the list of kind switch sites. No domain reviewer
was dispatched on the spec; the implementation PRs get the normal review.

## Left to the builder

File names, exact tool wording, the receipt's wording for mixed outcomes, and
the card's layout details within the theme.

## Open questions for the owner

1. The disclosure line and version bump in Design 1 (wording, privacy page).
2. `update_pantry` is limited to users with `pantryTracking`, like the pantry
   screen. `get_pantry_items` has no such check today. Leave that as it is?
