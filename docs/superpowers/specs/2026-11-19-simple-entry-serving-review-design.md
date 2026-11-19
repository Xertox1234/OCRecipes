# Simple Entry: serving review, drinks and sides, shared pictures

Date: 2026-11-19 · Status: awaiting owner approval

## Why

Simple Entry (meal planner → add → Simple Entry) turns a typed dish name into a
plan entry with a nutrition estimate. Today the estimate is saved unseen. The
app's idea of one serving is often not the person's ("what FDA considers one
serving is not what I consider one serving"), so the numbers are wrong and the
person never gets a chance to fix them. The owner wants a friendly step that
shows the assumed serving and lets people correct it, to raise both accuracy
and interaction. Each simple entry should also get a picture, made once and
reused by everyone who enters the same dish.

## Goals

1. After the estimate, show each food the app found with its amount, and let the
   person change each amount before saving. Totals update as they change.
2. Offer optional drinks and sides to add to the entry.
3. Give a simple entry a picture the first time a dish name is used, and reuse
   that picture for every later entry of the same name, by anyone.

## Non-goals

- Reopening a saved simple entry to adjust it later. The breakdown is not
  stored; only the adjusted per-serving totals are, as today. (Agent's call —
  reject it if "adjust" was meant to cover saved entries.)
- Changing Quick Log on the Home screen.
- Matching near-identical names ("bacon & eggs" vs "bacon and eggs") to one
  picture.

## Anti-goals

- A longer flow that people abandon: one extra step, no more, and the Add button
  is usable the moment the estimate arrives.
- Presenting a guess as a fact: a food with no estimate, or an unknown portion,
  says so.
- A shared picture that disappears when one person deletes their entry or
  account.
- One person's own photo leaking to others through the shared picture.

## Approaches

**Serving edit** — owner picked _per-food amounts_ over a single portion slider:
more accurate, and it shows the app's assumption honestly.

**Shared picture**

1. _Dedicated shared table, dish name → picture_ (chosen, agent's call). Only
   pictures the app generated go in it, so personal photos can never be shared.
   Needs a migration and one change to the "is this picture still used?" check.
2. _Reuse the picture from any other user's entry with the same name._ No
   migration, but an entry's picture can be a photo its owner supplied, and
   nothing marks which pictures are generated — rejected for the leak risk.
3. _Deterministic file name from the dish name, no table._ Rejected: the
   existing cleanup would delete the file when its last entry is deleted, and
   every create would need a storage round-trip to check.

**Drinks and sides** (agent's call): a short fixed list of suggestions per meal
type plus a free-text "something else", each estimated by the existing
food-text call when tapped. Rejected: AI-chosen suggestions per dish (a paid
call on every estimate for a small gain).

## Design

### Part 1 — review step (client only)

The sheet becomes two steps in the same bottom sheet.

Step 1, as today minus the servings row: dish name (typed or dictated) and an
**Estimate** button.

Step 2, review:

```
 Quick add to Breakfast                     Done
 Bacon and eggs                             Edit
 Here's what we counted as one serving
 ┌──────────────────────────────────────────────┐
 │ Bacon        3 slices (24 g)     [-] 3 [+]   │
 │ Egg          2 large (100 g)     [-] 2 [+]   │
 │ Coffee       1 cup (240 g)       [-] 1 [+]   │
 └──────────────────────────────────────────────┘
 Add a drink or side
 ( Coffee ) ( Orange juice ) ( Toast ) ( + Something else )
 ──────────────────────────────────────────────
 412 kcal · 28 g protein · 2 g carbs · 31 g fat
 Servings on the plan               [-] 1 [+]
 [                 Add to Breakfast            ]
```

- **Rows.** One per food from the estimate: name, amount with unit and weight,
  and a stepper. Stepping changes the amount; calories, macros and the weight
  scale in proportion to the original estimate. Stepping below the smallest
  amount removes the row. Step size follows the unit: whole steps for counted
  things (slice, piece, large), half steps for measured ones (cup, tablespoon).
- **Honest rows.** A food with no nutrition estimate shows "No estimate" and
  adds nothing to the total. A food whose portion is unknown (the server's
  "100 g (portion unknown)") is labelled as a 100 g guess.
- **Drinks and sides.** Fixed suggestions by meal type (for example breakfast:
  coffee, tea, orange juice, toast, fruit; lunch and dinner: water, salad,
  bread, rice, fries; snack: coffee, tea, fruit). Tapping one runs the same
  estimate call for that food and appends its rows. "Something else" opens a
  one-line field. Extras are folded into this entry's totals; they are not
  separate plan entries, and the entry keeps the dish name the person typed.
  (Agent's call.)
- **Totals** update live.
- **Servings on the plan** is the existing stepper, moved here and relabelled:
  the rows define one serving, this says how many go on the plan.
- **Edit** next to the dish name returns to step 1 and discards the rows.
- **Add** saves exactly as today: a `quick_entry` recipe with the adjusted
  per-serving totals, then the plan item. No server change for this part.
- Errors, the upgrade prompt, voice input and the success toast stay as they
  are. The sheet grows to fit the list (today it is fixed at 45%).

Details for the builder:

- Put the scaling, step-size and totals maths in a `*-utils.ts` file with a
  Vitest file written first.
- Guard a zero or negative original quantity (the server schema allows any
  number): treat the row as amount 1.
- The retry memory (`createdRecipeRef`) is keyed on the title alone today; key
  it on title plus totals so a retry after an edit does not reuse a recipe
  saved with old numbers.
- Follow the `crafting-ui` and `interaction-feel` skills; restyle within
  `theme.ts` only. Stepper buttons are 44-point targets that read the current
  amount as their value, and each change is announced.

### Part 2 — shared picture (server only)

- New table `dish_images`: `name_hash` (primary key), `image_url`,
  `created_at`. `name_hash` is a SHA-256 of the dish name lower-cased, trimmed,
  with punctuation removed and spaces collapsed. Storing a hash keeps typed
  text out of a table that outlives the account that typed it. Migration 0049.
- Applies to `quick_entry` recipes only, on both paths that create one
  (`POST /api/meal-plan/recipes` and the inline-recipe path of
  `POST /api/meal-plan/items`).
- **Picture exists:** the new recipe is created with that `image_url`. No image
  call, nothing counted against the daily cap.
- **No picture yet:** the existing background step runs with its existing
  gates (paid tier, AI-sharing consent, daily cap). When it produces a picture
  it also records it in `dish_images` (insert, do nothing on conflict, so two
  first entries at the same moment cannot clash; the loser just keeps its own
  picture).
- **Deletion safety.** `filterUnreferencedImageUrls` in
  `server/storage/account-images.ts` also treats a `dish_images` row as a
  reference, so deleting an entry, replacing its picture or deleting an account
  never removes a shared picture. The change lives in storage, per the standing
  ruling.
- A picture a person supplies themselves never enters `dish_images`.
- Simple Entry is a paid feature and paid accounts already have automatic
  pictures, so no tier gains or loses anything.

## Shipping

Two PRs, since the halves share no files:

1. Server (Part 2): live on deploy. Needs the production migration confirmed
   (`to_regclass` output) before merge.
2. Client (Part 1): reaches phones only through an OTA, published when the
   owner asks.

## Left to the builder

Exact suggestion lists, copy, step sizes per unit, animation and the sheet's
height behaviour.
