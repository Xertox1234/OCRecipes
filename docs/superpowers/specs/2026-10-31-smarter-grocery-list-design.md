# Smarter Grocery List — Design

**Date:** 2026-10-31
**Status:** Draft for owner approval — owner Q&A complete, builder check done; refreshed 2026-11-22 against `main` (see "Refresh 2026-11-22" at the end, which also lists the questions for the owner)
**Mockups:** two throwaway browser mockups (not committed): the list overview and the voice listen → check flow. The owner approved both ("everything" / "that looks great"), and their content is described in full below.
**Reviews:** builder check (questions folded in); an advisor review (bump ordering, both-empty bump, parser isolation, export coverage, all fixed); `/spec-review`, verdict approve-with-edits, all edits applied (race-safe bump under an advisory lock, offline scope removed, one amount formatter, security section, permission wording, work order, tests, verification). Calibrated against `2026-10-31-cookbook-ai-cover-studio-design.md`, `2026-10-25-form-fields-feel-and-behaviour-design.md` and `2026-06-12-offline-persistence-design.md`.

## Intent

The grocery list stores what you type exactly as typed. `Milk 2L` becomes an item literally called "Milk 2L" with no amount. The owner wants the list to understand ordinary shopping-list writing and speech, without AI: pull the amount out, tidy the name, file it in the right aisle, and make amounts easy to change afterwards. "Smarter, not AI smarter."

Success: typing or saying things the way people normally do (`Milk 2L`, `2 cans chopped tomatoes`, "a dozen eggs") produces a tidy item with the right amount under the right aisle heading. Adjusting amounts, removing items and emptying the list are each one gesture.

## Goals (owner-decided)

1. **Smart typed entry.** These all work, with the amount allowed before or after the name: `Milk 2L` · `2L milk` · `milk x2` · `2 x milk` · `3 apples` · `a dozen eggs` · `500g mince` · `half a kilo of cheese` · `2 cans chopped tomatoes` · `eggs 12`.
2. **Tidy display.** `milk 2l` shows as **Milk · 2 L**, with the amount set apart from the name.
3. **Units.** Metric first (L, ml, g, kg), plus lb, oz, cups, cans, packs, bunches, dozen. **Keep the unit the user gave; never convert.**
4. **Unreadable input is added anyway.** For example `Bob's Red Sauce` is added as typed, with no error and no question asked.
5. **Amount drop-down that remembers.** An item added without an amount shows an **Amount ▾** picker. Whatever the user picks is **saved to their account** as that item's default. Next time they add `Bob's Red Sauce` with no amount, the saved amount fills in automatically.
6. **− / + controls on every item that has an amount.** On a measured amount, **+ adds another pack**: `500 g` → `2 × 500 g`, not `1 kg`.
7. **Adding something already on the list bumps it** rather than making a duplicate line. **If the amounts can't be combined** (e.g. `1 L` on the list, `2 cartons` added), **add a second line.**
8. **Auto-sorting into aisles.** Typed and spoken items are filed under the right category heading (Dairy, Produce, …), not "Other".
9. **Voice entry.** A 🎤 button next to the add box opens a sheet that shows the words live as you speak. You can say several items in one go ("milk, a dozen eggs and two loaves of bread"). It then shows a **check screen**: one row per item, each with − / + controls and ✕ to drop it, plus **Say more** and **Add N items**. Nothing goes on the list until you tap Add. The check screen uses the same rules as typing: it shows bumps ("already on your list: makes it 2 L") and remembered amounts ("your usual: 1 jar").
10. **Clear list.** The ⋯ menu offers **Clear ticked items** and **Clear all items**. Clear all asks "Are you sure?" first.
11. **Swipe to remove.** Swiping an item the opposite way to the existing "Pantry" swipe removes it **at once**, with an **Undo** toast. No confirmation.

## Non-goals

- AI or server-side language models for parsing. Plain rules only.
- The pantry's add box. **Grocery list only** for now.
- Unit conversion (1 L + 500 ml → 1.5 L) or comparing units across systems.
- Changing how grocery lists are _generated_ from meal plans. Generated items keep working, and they gain the − / + controls, swipe-to-remove and clear like any other item.

## Anti-goals (failure even if it "works")

- **Losing what the user typed.** If a guess is unsure, keep the text in the name rather than dropping a word. A wrong amount the user can see and fix is acceptable. Silently deleting words is not.
- **Asking questions at add time.** Typing an item and pressing Return must never open a prompt. The Amount ▾ picker is optional and appears on the row.
- **Changing the user's capitalisation beyond the first letter.** `milk` → `Milk`, but `Bob's Red Sauce` and `PG Tips` stay exactly as typed.

## How amounts work (the model)

Every item has a **count** and, optionally, a **size**:

| Typed                      | Shown                      | stored as                     |
| -------------------------- | -------------------------- | ----------------------------- |
| `Milk 2L`                  | Milk · 2 L                 | count 1, quantity 2, unit L   |
| `500g mince` then **+**    | Beef mince · 2 × 500 g     | count 2, quantity 500, unit g |
| `2 cans chopped tomatoes`  | Chopped tomatoes · 2 cans  | count 1, quantity 2, unit can |
| `eggs 12` / `a dozen eggs` | Eggs · 12                  | count 1, quantity 12, no unit |
| `milk x2`                  | Milk · 2                   | count 1, quantity 2, no unit  |
| `Bob's Red Sauce`          | Bob's Red Sauce · Amount ▾ | count 1, no quantity, no unit |

**Decided (Claude's call, after the builder check):** add one new integer column, `count`, to `grocery_list_items`, **defaulting to 1, with no backfill**. `count` is used only for **measured units**. Everything else keeps its number in the existing `quantity` column, so rows already generated from meal plans (e.g. quantity 2, unit "can", or quantity 1.5 cups) read exactly as they do today.

- **Measured units = L, ml, g, kg, lb, oz only.** `quantity` + `unit` is the **size of one pack**, and **+ / −** change `count`. Display is `size` when count is 1 and `count × size` when it's more.
- **Everything else** (can, pack, jar, bottle, bunch, loaf, bag, box, cup, tbsp, tsp, clove, pieces, any unit the parser doesn't know, or no unit): **+ / −** change `quantity` by 1, and display is `quantity unit`. `2 cans` → `3 cans`. A fractional generated amount steps by 1 too (1.5 cups → 2.5 cups). Cups and spoons are deliberately _not_ measured, because "2 × 2 cups" reads oddly on a shopping list.
- **−** stops at 1 (or at the current value, if it's already below 1). Removing an item is a swipe, not a tap to zero.
- **Bumping on re-add** (goal 7). **Match against the list first.** A remembered amount is used **only when no row matches** and a new row is inserted. (If it filled in first, `milk` with a saved `1 L` against `Milk · 2 L` on the list would make a second line, where the owner expects one more milk.) The rules for a matching name:
  - Same name, same measured size → `count` goes up by the new count. `Milk 2L` added again → `2 × 2 L`.
  - Same name, same non-measured unit (including no unit) → the quantities add. `2 cans` + `1 can` → `3 cans`.
  - New item has no amount, existing has one → +1 step, as if **+** were tapped. `milk` onto `Milk · 2 L` → `2 × 2 L`.
  - Existing has no amount, new item has one → the existing row **takes the new amount**. `Milk 2L` onto `Milk · Amount ▾` → `Milk · 2 L`.
  - Neither has an amount → a missing amount counts as 1, so the row becomes 2 and gains the − / + controls. `Bob's Red Sauce` added twice → `Bob's Red Sauce · 2`.
  - Anything else (`1 L` vs `2 cartons`) → **second line**.
  - Generated (meal-plan) rows are bumped like manual ones: it's the same shopping. **Ticked rows are bumped too, and the bump unticks them** (owner ruling A below).
- Name matching for bumps ignores case, extra spaces and simple plurals (`apple`/`apples`, `tomato`/`tomatoes`). The server already has a name key and a unit key for this (`matchKey` and `unitKey` in `server/services/pantry-deduction.ts`, used by the pantry rule and the Coach grocery card). **Move those to `shared/` and reuse them; do not write a second matching rule.** If they prove too loose or too strict for a bump, change them in one place, with tests for the pantry rule too.
- **Only typed and spoken adds bump** (Claude's call, owner question 2 in the refresh section). Generated lists, batch scan and the Coach grocery and plan cards keep inserting their own lines as they do today: each Coach card remembers the rows it created so its Undo can delete exactly those, and a bump into an existing row would break that.
- **The bump rules are one pure function in `shared/`** (Claude's call). The **server** uses it for the actual write. The **client** uses it **only to preview** what will happen: the voice check screen's "already on your list: makes it 2 L" note and the typed hint. Adds are not optimistic and are not queued offline today (`useAddManualGroceryItem` invalidates on success), and this design does not change that.
- **The write is race-safe** (spec-review, `docs/rules/database.md` per-row derived value rule). The match is a per-row decision taken by comparing the new item against sibling rows, so it runs in **one transaction** whose **first statement is `pg_advisory_xact_lock`** keyed on the list id. **Use the per-list lock that already exists**: `insertGroceryListItemsUnderCap` in `server/storage/grocery-lists.ts` takes `grocery-list-items:<listId>` before it counts rows for the 500-item cap (#1930). The bump write takes that same key, so a bump and a capped insert on one list can never interleave; a second key would let them. It then SELECTs candidates under the lock and either INSERTs, or UPDATEs with a **relative** `count = count + n` / `quantity = quantity + n`. A voice batch runs as one transaction under one lock, and a batch that names the same item twice ("milk … and milk") merges inside the batch before matching. Without this, a double-tapped Return or two phones adding milk at once makes two lines or loses a bump.
- **The 500-item cap** (`MAX_GROCERY_LIST_ITEMS`, #1930). A bump adds no row, so it works on a full list. A new line on a full list is refused with the existing `LIMIT_REACHED` answer and the existing "list is full" message. A voice batch on a nearly full list applies every bump, inserts the new lines that fit, in order, and reports how many were left out: the same "adds as many as fit" behaviour every other insert path has. The app then says how many were skipped.

## Parsing rules

Plain rules in one pure function, shared by typing and voice. The existing `client/lib/ingredient-parser.ts` handles only a leading number plus a short unit list, and `shared/lib/quantity.ts` already normalises fractions. **Write a new grocery parser** (Claude's call) that reuses `quantity.ts` and shares a unit table. **Do not change `parseIngredientText` in place**: it feeds the recipe form (`client/hooks/useRecipeForm.ts`), and accepting trailing amounts, `x2` and word numbers there would change recipe entry as a side effect.

- **Numbers:** digits, decimals, fractions (`1/2`, `½`, `1 1/2`), and words: `a`/`an` = 1, `one`…`twenty`, `a couple of` = 2, `half a`/`half` = 0.5, `a dozen`/`dozen` = 12, `two dozen` = 24.
- **Where the amount sits:** before the name (`2L milk`), after it (`Milk 2L`, `eggs 12`), or as a multiplier (`x2`, `2 x`, `×2`, `2x`). `Milk 2L x2` = count 2, size 2 L.
- **Glued and spaced units:** `2L`, `2 L`, `2 litres`, `2 liters`, `500g`, `500 grams`, `1.5kg`, `half a kilo`. Spelling variants and plurals map to one short label for display: `L`, `ml`, `g`, `kg`, `lb`, `oz`, `cup`, `can`, `pack`, `jar`, `bottle`, `bunch`, `loaf`, `bag`, `box`.
- **Filler words dropped from the name:** a joining `of` (`half a kilo of cheese` → Cheese), and leading `some`. Nothing else is dropped.
- **Tidy name:** trim, collapse spaces, capitalise the first letter only.
- **Unreadable:** no amount found → the name is everything typed (tidied), with no amount.
- **Several items (voice, and typed text with commas):** split on commas and on `and` between items. Known pairs that are one item stay whole: `mac and cheese`, `salt and pepper` (the seasoning pair), `fish and chips`, `peanut butter and jelly`. _Builder's call:_ keep the pair list small. The check screen lets the user drop a wrong split, so perfection isn't needed. **Typed** text with commas becomes several items at once. **Typed** text without commas never splits on `and`.

A live hint under the add box shows what the text will become ("Becomes Milk · 2 L, under Dairy"). That needs the category guess on the client too (next section).

## Aisle sorting

`categorizeIngredient()` and its `CATEGORY_KEYWORDS` already exist in `server/services/grocery-generation.ts`. Manual adds currently skip them (the add route defaults `category` to `"other"`).

**Builder's call, recommended:** move the keyword map and `categorizeIngredient` to `shared/` so the client hint and the server use one list. Since October three Coach card services import it from `grocery-generation.ts` (`server/services/write-cards/grocery.ts`, `pantry.ts`, `plan.ts`); point them at the new home in the same change. The add route then categorises any item sent without a category. Check the keywords cover common shopping words that recipes rarely use (paper towels, dish soap, coffee, cereal); anything that doesn't match stays "Other".

## Remembered amounts

- **New per-user table**, for example `user_grocery_defaults`: user id, normalised item name, count, quantity, unit, updated at. Unique on (user, name).
- **Written only** when the user picks from the **Amount ▾** drop-down. A later pick for the same name overwrites it. − / + taps and typed amounts do **not** write it. _Claude's call, owner can veto:_ the owner was asked whether typed amounts should also be learned (add "Milk 2L" often, then `milk` alone fills in 2 L). The answer described only the drop-down, so this design learns from the drop-down only.
- **Read** when an item is added with no amount (typed or spoken). If a saved amount exists, the item gets it straight away, and the voice check screen labels it "your usual: …".
- The drop-down offers counts 1–6, common packs (1 jar, 1 bottle, 1 can, 1 pack, 1 bag, 1 box), common sizes (250 g, 500 g, 1 kg, 500 ml, 1 L, 2 L), and **Type an amount…**, which runs the same parser. _Builder's call:_ the exact list may be tuned. Tapping the amount on any item (not only ones without an amount) opens the same picker.
- The amount is tied to the user's account, so it follows them to a new phone. Deleting the account removes these rows through the same `onDelete: "cascade"` foreign key to `users.id` that the other per-user tables use (`deleteUser` in `server/storage/users.ts`). The data export lists tables explicitly (`server/storage/export.ts`, which already covers grocery lists and items), so **the new table must be added there**.
- Allergen flags need no change: the list GET route runs `flagAllergenicGroceryItems` over every item when it reads the list, manual ones included.

## Voice

- Reuse `client/hooks/useSpeechToText.ts` (already used by Coach chat and `SimpleEntrySheet`). Don't add a new speech library. Only one field may own the microphone at a time; follow the ownership rule the voice fields use (`client/hooks/useVoiceField.ts`, #1735 and #1739).
- **The add box already has a 🎤 button** (added since October). Today it dictates straight into the add box, replacing its text, and Return adds one item. In this design that same button opens the listening sheet instead (Claude's call, owner question 1 in the refresh section). There is one mic button, not two.
- **Listening sheet:** a large pulsing mic and the live transcript. Tap the mic to stop, or Cancel.
- **Check sheet:** the parsed rows as in the mockup. Each row has ✕, the name, an optional note line (bump / "your usual"), and − / + controls (or **Amount ▾** if there's no amount). Then **Add N items** and **🎤 Say more**, which appends to the same list.
- If permission is denied or nothing is heard, show the hook's existing error message in the sheet. The typed path is unaffected.
- **Add N items** sends everything in one request, so a failure can't leave half the items added. (A full list is not a failure: see the 500-item cap rule above.) _Builder's call_ on the shape (a batch endpoint, or the single-add endpoint taking an array).

## Server changes (summary)

- Add-item route: accepts count/quantity/unit, categorises when no category is given, applies the bump rules **on the server** (so two phones adding milk agree), and returns whether it bumped or inserted.
- Item update route (`PUT …/items/:itemId`): today it accepts only `isChecked` / `addedToPantry` (and refuses a body with neither). It needs reworking to also take `count` / `quantity` / `unit` from − / + and the picker. This is a real rewrite of the schema and refine rule, not a one-line addition.
- **New** `DELETE …/grocery-lists/:id/items/:itemId` for swipe-remove. `deleteGroceryListItem()` already exists in `server/storage/grocery-lists.ts` with an ownership check. The Coach grocery and plan cards call it for their Undo; no route does yet.
- **Every reader of an amount must count `count`.** Once a row can be `2 × 500 g`, anything that reads `quantity` alone under-reads it. Besides the screen, that is: the Coach grocery read tool (`server/services/coach-tools/grocery.ts`), the pantry rule the Coach cards use to skip what is already at home (`server/services/pantry-deduction.ts`), and Add to Pantry. Each takes the total (count × size) from one shared helper. Slice 3 is not done until all three do.
- **New** clear endpoint: clear ticked / clear all for one list, with ownership enforced.
- Remembered-amount read and write, scoped to the signed-in user.
- The bump decision and batch add live in a service function (route → service → storage), not inline in the route (`docs/rules/architecture.md`). The storage function owns the transaction and lock.
- **− / + and the picker send the absolute new value** (count / quantity / unit), not a delta. A retried request then can't double-apply, and two phones editing the same row resolve last-write-wins, which is acceptable for a shopping list. Only the add-again bump is relative, under the lock above.
- One migration: the `count` column (`integer NOT NULL DEFAULT 1`) plus the defaults table, as a hand-written idempotent migration with the next free number (`0050` on 2026-11-22; check again when slice 3 starts) and the same header shape as `0049_dish_images.sql` (ordering note, apply command, `to_regclass` verify query). `db:push` is the dev path only. Prod migration process applies: get the `to_regclass` output before merging.

## Security and ownership (spec-review)

- Every new or changed route checks the list belongs to `req.userId` before reading or writing. **`deleteGroceryListItem(id, listId, userId?)` makes `userId` optional, and the ownership JOIN runs only when it's passed**, so the DELETE route must pass `req.userId`. The clear route does the same.
- The defaults table is read and written only by `req.userId`. There is no endpoint that takes a user id.
- Zod limits on every body, matching the existing add schema: name ≤ 200 characters, unit ≤ 50, numbers finite and positive with a sane upper bound (e.g. ≤ 9,999). The voice batch caps the number of items (e.g. ≤ 50) so one request stays small (compare #1649's request-size cap).
- Each new route takes `crudRateLimit` inline, like every existing route in `server/routes/grocery.ts` (CodeQL's missing-rate-limiting check is required). No stricter limiter is needed: there's no AI or expensive work (`docs/rules/api.md`). No premium gate (owner ruling B).

## Client changes (summary)

All in `client/screens/meal-plan/GroceryListScreen.tsx` and its hooks in `client/hooks/useGroceryList.ts`, plus new components for the stepper, amount picker and voice sheets:

- Add box: live hint, 🎤 button, sends parsed fields.
- Row: amount text and − / + controls, or **Amount ▾**. − / + and the picker update the cache optimistically, following the existing optimistic `useToggleGroceryItem` (`onMutate` plus rollback), and every mutation shows visible failure copy (`docs/rules/client-state.md`).
- **One amount formatter** (in `shared/`) is used everywhere an amount is shown: the row, the voice check screen, the **Share** text, and the Add-to-Pantry total. Today the row (`GroceryListScreen.tsx:136`), the row's spoken label (`:146`) and the Share text (`:360`) each format `quantity unit` inline. Left alone, all three would say "500 g" for 2 × 500 g.
- `SwipeableRow` gains a remove action on the opposite side to "Pantry" (its `rightAction`, which the component already supports; that side is always "remove", including for users who don't have the Pantry swipe), with Undo. **Undo must restore the item exactly** (name, amount, category, ticked state, added-to-pantry flag).
- **Undo has no timer** (owner ruling 2026-11-22, WCAG 2.2.1, #1963): it stays until the user's next action on the list or until they leave the screen. The shared toast still hides an action after 5 seconds (`ACTION_DISMISS_MS` in `client/components/Toast.tsx`), so the grocery Undo cannot be a plain toast action as it stands. _Builder's call_ between an Undo bar on the screen and a toast option that stays. Either way the item is deleted on the server at once and Undo puts it back through a restore call. "Delay the delete until the toast closes" is no longer an option, because nothing closes on a clock.
- ⋯ menu (**new**: the header has only a Share button today, so put Share inside it or keep it beside the menu; builder's call): Clear ticked items (immediate, with the same untimed Undo, restoring every cleared row) and Clear all items… (confirmation, no undo).
- Theme tokens only (light and dark). Every control gets an accessibility label ("Increase milk", "Remove Bob's Red Sauce").
- **Accessibility, from the 2026-11-21 audit's rules.** − / + and ✕ are at least 44 pt. A − / + tap, a bump, a removal and a clear are each announced with the result ("Milk, 2 times 2 litres"), not only drawn. Remove is reachable without swiping (an accessibility action on the row). The row keeps working at the largest text sizes: the amount and its controls wrap under the name rather than clip.

## Constraints

- Strict TDD (CLAUDE.md). The parser is pure and gets table-driven tests covering every example in this document, including the anti-goal cases.
- Existing generated lists must keep working unchanged. Of the grocery mutations only the tick is offline-durable today (`TOGGLE_GROCERY_ITEM_KEY` in `client/lib/mutation-defaults.ts`). Adds are not, and this design adds no new durable mutation; offline grocery editing would be its own project. The tick's durable replay must keep working after the item update route is reworked.
- Add to Pantry from a row with count > 1 sends the total (count × size).
- **iOS permission wording.** The speech-recognition prompt text in `app.json` (lines 19 and 187) now reads "…to turn what you dictate into text for food logging, recipes and coach messages." The grocery add box already uses the microphone under that text. Add the grocery list to it, e.g. "…for food logging, recipes, grocery lists and coach messages." This is a native change: it ships in the next EAS build, not an OTA. Until then the current wording shows, which is accurate but incomplete.

## Work order (spec-review: mergeable slices)

Each slice is its own PR, usable on its own, in this order:

1. **Smart typing.** The parser and amount formatter (shared, pure, TDD), aisle categories moved to `shared/`, and the add route categorising manual items. The typed add sends parsed fields, with the live hint. **No migration.** Bumps don't exist yet, so re-adding makes a second line.
2. **Remove and clear.** The DELETE item and clear routes, swipe-to-remove with Undo, the ⋯ menu. **No migration.**
3. **Amounts.** Migration (`count` and the defaults table, export entry), − / + controls, the Amount ▾ picker and remembered amounts, and bump-on-re-add under the lock. The prod `to_regclass` check gates this merge.
4. **Voice.** The listening and check sheets, batch add, and the permission wording (it needs the native build).

## Tests (written first, by layer)

- **Shared, pure:** a parser table covering every example in this document, the anti-goal cases (no words dropped, capitals kept) and the "and"-pair splits. A bump-rule table covering every rule in "How amounts work", including both-empty and the ticked → unticked case. A formatter table (`2 L`, `2 × 500 g`, `3 cans`, `12`).
- **Storage (real Postgres, like the existing storage tests):** two concurrent adds of the same item end as **one row with count 2**. A batch naming milk twice makes one row. Clear ticked leaves unticked rows. Delete with the wrong user id deletes nothing.
- **Routes:** 404/403 for a list owned by someone else on DELETE, clear, PUT and add. Zod 400s at the caps. The defaults read never returns another user's rows.
- **Export:** the defaults table appears in the data export.
- **Client hooks:** optimistic − / + rolls back on failure and shows failure copy.

## Verification

- CI's checks, plus `preflight:fast` on push, as usual.
- After each client slice, **verify-ui** on the simulator: the typed hint, a row with − / +, the swipe and Undo, and the ⋯ menu. Voice can only be partly checked on the simulator (no real microphone input); the owner checks it on the phone after the build.
- Slice 3: the prod migration check before merging.

## Owner rulings after the builder check (2026-10-31)

- **A. Ticked items are bumped like any other.** The owner: the user isn't necessarily in the shop yet, so re-adding milk "just auto increments the existing item". _Claude's call on top:_ bumping a ticked row also **unticks** it, so the bigger amount shows as still needed rather than struck through.
- **B. Everything here is free.** Owner rule: "If no AI is being used it is free." No premium gate on any part, voice and remembered amounts included.

## Left to the builder

Storage shape (if not the recommended `count` column), endpoint shapes, component boundaries, the drop-down list, the "and"-pair list, and how Undo is drawn, all within the behaviour above.

## Refresh 2026-11-22

The spec sat on an unpushed branch for three weeks. It was checked against `main` at `8623366b7`, and each point below is folded into the section it belongs to.

What changed in the code since 2026-10-31:

- **A 500-item cap and a per-list lock exist** (#1930). The bump reuses that lock, and the cap rules for a bump and for a voice batch are now stated.
- **The Coach can read grocery lists and add to them through cards** (#1892–#1897, #1917). So there are more insert paths than the add route, more readers of an amount, and an existing name and unit matching rule to reuse.
- **The add box already has a mic button** that dictates into the field (#1735, #1739).
- **Undo may not run on a timer** (owner ruling 2026-11-22, #1963), which removes one of the two Undo designs this spec offered.
- **The tick is now offline-durable.** The spec said no grocery mutation was.
- **Smaller corrections:** the migration number (0033 → the next free one, 0050 today), the permission text and its line numbers, the screen line numbers, `deleteGroceryListItem` now having callers, the rate-limit line, and a doubled table header.

Unchanged and still true: the parser files, `parseIngredientText` feeding only the recipe form, the item update route accepting only the tick and the pantry flag, manual adds defaulting to "Other", and the data export listing tables by name.

Questions for the owner before approval:

1. **The mic button.** Today it dictates into the add box. This design makes the same button open the listening sheet with the check screen. Confirm, or keep quick dictation and give the sheet its own button.
2. **Coach and generated adds.** This design bumps only what the user types or says. Items added by a Coach card, a generated list or a batch scan still arrive as their own lines, so "Milk" from the Coach can sit beside the user's "Milk · 2 L". Confirm, or ask for those paths to bump too (a larger change: the Coach card's Undo would need a new design).
3. **Still open from October:** remembered amounts are learned from the Amount ▾ drop-down only, not from typed amounts ("Remembered amounts" above). Veto if typed amounts should be learned too.
