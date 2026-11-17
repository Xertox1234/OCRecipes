---
title: "A new server-built block or card kind is gated on a per-kind capability the app sends — older builds drop unknown blocks silently"
track: knowledge
category: conventions
tags: [api, client-state, architecture, write-cards, rollout]
module: shared
applies_to: ["shared/schemas/coach-write-cards.ts", "shared/schemas/coach-blocks.ts", "server/routes/chat.ts", "client/lib/coach-stream-body.ts"]
symptoms: ["a new value is added to a kind enum that an installed app validates with zod", "the server decides what to send from one boolean the app has sent since an earlier release", "the reply says 'tap the card' on a build that shows no card"]
created: 2026-11-16
---

# A new server-built block or card kind is gated on a per-kind capability the app sends

## Rule

Before the server can send a block or card kind that did not exist when some
installed build shipped, the app must declare that kind in the request, and the
server must offer the tool or feature that produces it only when it is
declared. Do not reuse an existing "I support cards" flag.

## Why

The app filters message blocks through `coachBlockSchema`. A kind it does not
know fails the schema and the block is dropped with no error. A build that
predates the pantry card and still sends `writeCards: true` would have been
given `update_pantry`, told a card was shown, and rendered nothing.

## Examples

- The app sends `cardKinds: ["pantry"]` next to `writeCards: true`
  (`client/lib/coach-stream-body.ts`); `server/routes/chat.ts` validates it as
  an enum array; `chat-turn.ts` turns it into `pantryCard` together with the
  plan check.
- Sites the type checker does not flag when a kind is added, each needing a
  test: the payload `z.union` in the block schema (a missing member makes the
  block fail to parse), and any `if / else` chain whose last branch is a
  default (the card wrapper's render choice and locked summary fell through to
  the plan card). The database column's `$type<…>` union and its CHECK
  constraint also list the kinds.

## Exceptions

A saved conversation opened later on an older build still loses the block; the
message text stays. That is accepted.

## Related Files

- `shared/schemas/coach-write-cards.ts` — `WRITE_CARD_KINDS`, the payload union
- `client/components/coach/blocks/write-cards/WriteCard.tsx`
- `migrations/0048_coach_write_cards_pantry_kind.sql`

## See Also

- [a check made at build is repeated at apply](a-check-made-when-a-pending-action-is-built-is-repeated-when-it-is-applied-2026-11-16.md) — the plan gate on the same tool
