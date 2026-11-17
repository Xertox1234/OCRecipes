---
title: "A tool result that says 'a card is on screen' before the card is filtered lets the reply promise what the card lacks — work the card out during the tool call"
track: bug
category: logic-errors
tags: [ai-prompting, architecture, coach, write-cards, tool-results]
module: server
applies_to: ["server/services/coach-tools.ts", "server/services/coach-pro-chat.ts", "server/services/write-cards/**/*.ts"]
symptoms: ["the coach's reply lists items the card under it does not show", "the coach says 'tap the card' and no card appears", "a write tool returns a fixed 'card shown' message and the real card is built after the model has finished its reply", "a builder that can throw or drop rows runs at end of turn, with its error only logged"]
created: 2026-11-16
severity: medium
---

# A tool result that says "a card is on screen" before the card is filtered lets the reply promise what the card lacks

## Problem

The coach's write tools recorded a proposal and answered the model with a fixed
"a card is on screen" message. The card itself was built at the end of the
turn. For the grocery card that build dropped items already in the pantry, and
threw when nothing was left. The model had already written its reply.

## Symptoms

- The reply lists "eggs, milk, bread" and the card shows only "bread".
- The reply says "tap the card when it looks right" and no card is attached,
  because the build threw and the error was only logged.

## Root Cause

Filtering ran after the model's last chance to hear about it. The tool result
is the only channel that tells the model what happened; a result written before
the work is done is a guess.

## Solution

Work the card out inside the tool call and return what changed.

- `onWriteCardProposal` may return a `WriteCardOutcome`. The chat loop plans the
  grocery and pantry cards in that callback (`planGroceryCard`,
  `planPantryCard`), keeps the payload, and reuses it at end of turn so the
  card is exactly what the model was told about.
- The tool wording names what was left off, what starts unticked, or that no
  card was made **for this request** (an earlier card from the same turn may
  still be shown, so never say "no card is on screen").
- The card row is still created at end of turn: creating it locks the previous
  live card, which an abandoned turn must not do.
- The card-result helpers in the tool file do no database reads: the
  callback's caller does the read, the tool only words the outcome.

## Prevention

- A tool result may only state what has already happened. If a later step can
  drop, change or fail the thing the result describes, move that step into the
  tool call or do not describe it.
- Text echoed back to the model must be the model's own validated text, or pass
  the prompt sanitizer (pantry row names are the user's words).
- Widening a callback from sync to async needs an `await` at every existing
  call site; the food and plan tools were missed and only the push lint gate
  (`no-floating-promises`) caught it.

## Related Files

- `server/services/coach-tools.ts` — `groceryCardResult`, `pantryCardResult`
- `server/services/coach-pro-chat.ts` — `onWriteCardProposal`
- `server/services/write-cards/grocery.ts`, `server/services/write-cards/pantry.ts`

## See Also

- [a gate checked at build must be re-checked at apply](../conventions/a-check-made-when-a-pending-action-is-built-is-repeated-when-it-is-applied-2026-11-16.md) — the card outlives the turn that built it
