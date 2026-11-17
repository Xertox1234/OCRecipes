---
title: "A plan or permission check made when a pending action is built is repeated when it is applied — the pending thing outlives the check"
track: knowledge
category: conventions
tags: [security, api, architecture, write-cards, premium]
module: server
applies_to: ["server/services/write-cards/**/*.ts", "server/routes/coach-write-cards.ts", "server/services/chat-turn.ts"]
symptoms: ["a feature gate is checked where a proposal, draft or card is created and nowhere on the route that commits it", "the direct routes for the same data refuse a user the deferred path still serves"]
created: 2026-11-16
---

# A check made when a pending action is built is repeated when it is applied

## Rule

When an action is proposed now and committed later (a coach write card, a
draft, a queued job), every plan, permission and ownership check made at
proposal time is made again at commit time.

## Why

The pending thing outlives the request that checked. The pantry card was built
only for users whose plan has `pantryTracking`, but its save checked nothing: a
card still on screen after a subscription lapsed could change the pantry while
every pantry route refused the same user. A security review found it; no test
did, because each half was correct alone.

## Examples

- `performPantrySave` reads `getEffectiveTierForUser` and refuses without
  `pantryTracking`. Undo is deliberately not gated, so a save made in time can
  always be taken back.
- Row ownership is checked at build (`getPantryItems(userId)`) and again at
  save (`getPantryItemForUpdate(tx, id, userId)`), and the save also skips a row
  whose quantity changed since the card was built.
- The tool handler refuses `update_pantry` unless the turn enabled it, even
  though the tool was left out of the tool list: a model can call a name it was
  never offered.

## Exceptions

Undo of a committed action is not re-gated on the plan. It is still scoped to
the owner.

## Related Files

- `server/services/write-cards/pantry.ts`
- `server/services/coach-tools.ts` — the `update_pantry` case

## See Also

- [a new card kind needs its own capability flag](a-new-server-built-block-kind-is-gated-on-a-per-kind-client-capability-2026-11-16.md) — the other gate on the same tool
