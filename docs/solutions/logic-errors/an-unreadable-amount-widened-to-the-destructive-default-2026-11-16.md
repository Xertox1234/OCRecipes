---
title: "An amount that cannot be read was treated as 'all' — an unparsed input must be dropped and reported, never widened to the destructive default"
track: bug
category: logic-errors
tags: [ai-prompting, architecture, parsing, write-cards, pantry]
module: server
applies_to: ["server/services/write-cards/**/*.ts", "server/services/coach-tools.ts"]
symptoms: ["a use of 'half' or '-1' of a pantry item empties the item", "a null from a quantity parser shares a branch with 'the user asked for all of it'", "one boolean is computed from an OR of an explicit flag and several 'could not tell' conditions"]
created: 2026-11-16
severity: medium
---

# An amount that cannot be read was treated as "all"

## Problem

`planPantryCard` computed "use all" as
`all === true || held === null || amount === null || amount >= held`. A model
quantity such as "half" or "-1" parses to null, so the row was shown as
"use all" and removed on save.

## Symptoms

- "I used half the milk" produces a card row "Use Milk all (2 L)".

## Root Cause

"Could not read the input" and "the user asked for everything" shared one
branch. The grocery card fixed earlier the same day follows the opposite rule:
a pantry match that cannot be judged keeps the item. The pantry card did not.

## Solution

Drop the change, count it, and tell the model: the tool result says how many
changes were left off and asks for amounts as numbers. `all` is true only when
it was asked for, when the row has no amount to subtract from, or when the
readable amount is at least what the row holds.

## Prevention

- Give "unknown" its own branch. Decide which way it fails by asking which
  mistake costs the user more; removing or overwriting data is the costly one.
- When a tool drops part of a request, the result must say so, or the reply
  will describe work that did not happen.

## Related Files

- `server/services/write-cards/pantry.ts` — `planPantryCard`
- `server/services/write-cards/grocery.ts` — `pantryVerdict` (the same rule for the grocery card)

## See Also

- [tool result before the card is filtered](tool-result-says-card-shown-before-the-card-is-filtered-2026-11-16.md) — why the result must report what was dropped
