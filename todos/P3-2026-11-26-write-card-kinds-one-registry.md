---
title: "Write cards: one per-kind registry instead of switches repeated across the client, server and shared code"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, architecture, maintainability]
github_issue:
---

# Write cards: one per-kind registry

## Summary

Each write-card kind (food, grocery, pantry, goals, allergy, plan) is dispatched by hand-written switches in several places. Adding a kind means editing all of them, and only one copy is checked for exhaustiveness. Deferred from the coach chat audit 2026-11-24, bundle K: the owner chose small fixes first and larger refactors later (2026-11-26).

## Background

Audit rows, in `docs/audits/2026-11-24-coach-chat.md`:

- **L114:** per-kind dispatch is repeated across the client and shared code, and only one copy is exhaustive.
- **L136:** `server/services/write-cards/index.ts` switches on the kind six times (`buildWriteCardPayload`, `performWriteCardSave`, `revertWriteCardSave` and three more).
- **L132:** which cards a turn may show is carried as four booleans (`writeCards`, `pantryCard`, `goalsCard`, `allergyCard`). They are derived in three places, and the hoisted tool lists multiply.
- **L128:** a 70-line per-kind `onWriteCardProposal` closure sits inline in the generic stream stage (`server/services/coach-pro-chat/stream-reply.ts`).
- **L131:** `context.blocksPrompt` is assigned at three sites and doubles as the "is Pro" flag.

## Acceptance Criteria

- [ ] One server registry maps each kind to its build, save, revert and plan handlers, typed so that a missing kind fails to compile.
- [ ] Card capability is one value (for example a set of enabled kinds), derived once per turn.
- [ ] The per-kind proposal logic leaves `stream-reply.ts`.
- [ ] Whether a turn is Pro is no longer read from `blocksPrompt`.
- [ ] The client's per-kind rendering in `WriteCard.tsx` is exhaustive by type.
- [ ] Behaviour unchanged: the existing write-card and coach-tools tests pass unedited, except for imports.

## Implementation Notes

- Server: `server/services/write-cards/index.ts`, `server/services/coach-pro-chat/stream-reply.ts`, `server/services/coach-context-builder.ts`, `server/routes/chat-admit.ts`.
- Client: `client/components/coach/blocks/write-cards/WriteCard.tsx`.
- Shared: `shared/schemas/coach-write-cards.ts`.
- One PR per seam (server registry, then capability, then client) keeps each review small.
