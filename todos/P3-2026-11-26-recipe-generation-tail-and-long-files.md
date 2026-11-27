---
title: "One recipe-generation tail for RecipeChef and the Coach finder; split notification-scheduler; the finder schema cycle"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, architecture, maintainability]
github_issue:
---

# Recipe-generation tail, notification-scheduler, finder schema cycle

## Summary

RecipeChef and the Coach finder each implement the recipe-generation tail and "save the reply once". `notification-scheduler.ts` carries two near-identical reminder senders plus the weekly-report runner. A shared schema cycle runs through the finder schemas. Deferred from the coach chat audit 2026-11-24, bundle K (owner 2026-11-26: small fixes now, refactors later).

## Background

Audit rows, in `docs/audits/2026-11-24-coach-chat.md`:

- **L134:** `chat-turn.ts` `streamRecipeTurn` and `recipe-finder/coach-turn.ts` `runCoachFinderTurn` both run the generation, its allergen warning and image, and save the reply once.
- **L130:** `server/services/notification-scheduler.ts` is 655 lines. `sendDailyCheckinReminders` and `sendMealLogReminders` are near-identical per-user senders, and the file also hosts the whole weekly-report runner.
- **S2:** a circular dependency, `shared/schemas/recipe-finder.ts` → `inspired-recipes.ts` → `shared/schema.ts`.

## Acceptance Criteria

- [ ] One generation-tail function, used by both turns. Their existing tests pass unedited, except for imports.
- [ ] One generic per-user reminder sender. The weekly-report runner moves to its own module. `notification-scheduler.ts` is under 600 lines.
- [ ] `npx madge --circular` no longer reports the finder schema cycle.

## Implementation Notes

- Files: `server/services/chat-turn.ts`, `server/services/recipe-finder/coach-turn.ts`, `server/services/notification-scheduler.ts`, `shared/schemas/recipe-finder.ts`, `shared/schemas/inspired-recipes.ts`.
- The generation tail spends money in production; keep the claim order exactly as it is. Paid evals are not needed, because the prompts do not change.
