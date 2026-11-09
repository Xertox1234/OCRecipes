---
title: "Trim redundant server reads on the meal-plan and coach paths (perf audit M3, L5–L8)"
status: backlog
priority: low
created: 2026-11-08
updated: 2026-11-08
assignee:
labels: [deferred, performance, server]
github_issue:
---

# Trim redundant server reads on the meal-plan and coach paths

## Summary

Five small server-side read inefficiencies found by the 2026-11-08 performance audit
(meal planning + coach chat). None is user-visible at today's single-user scale; each
is a cheap fix to make before real data volumes exist.

## Background

Deferred at audit triage (owner, 2026-11-08). M3 was reported Medium but re-rated Low
after a closer look: two of its three callers read one day (≤ ~4 recipes) and the coach
tool already trims the rows before the model sees them, so the waste is DB→server
bytes only. The local `meal_plan_recipes` table was empty, so no real size was measured.

## Acceptance Criteria

- [ ] **M3** — a narrow meal-plan read (e.g. `getMealPlanItemSummaries`) returns recipe `{id, title, caloriesPerServing, proteinPerServing, carbsPerServing, fatPerServing}` and scanned item `{id, productName, calories, protein, carbs, fat}`; used by `server/services/coach-brief.ts` (~L87), the `get_meal_plan` tool in `server/services/coach-tools.ts` (~L681, retype `compactMealPlanItems`) and `server/routes/meal-suggestions.ts` (~L107). Carry the `userId` / `deletedAt` / `discardedAt` filters over verbatim. Leave `server/routes/meal-plan.ts:268` (client screen) on the full read unless the client type is checked. Red test first: summary rows have no `instructions` key.
- [ ] **L5** — `MealPlanHomeScreen` loads `useDailySummary` and `useDailyBudget`; both endpoints (`server/routes/nutrition.ts` ~L738, `server/routes/goals.ts` L143-200) run `getDailySummary`. Derive the budget from one response, or serve both from one endpoint.
- [ ] **L6** — `pickReminder` in `server/services/coach-brief.ts` (~L40-48) awaits `getNotebookEntryById` per commitment reminder; batch with `inArray` or reuse `getCommitmentsWithDueFollowUp`, which the same function already loads.
- [ ] **L7** — `refreshRepeats` in `server/storage/coach-notebook.ts` (~L111-130) loads every active + rejected row for the types with no limit; bound it (recency-ordered limit, or active + a capped number of rejected).
- [ ] **L8** — redundant lookups: grocery item toggle checks ownership in the route (`server/routes/grocery.ts` ~L267) and again in storage (`server/storage/grocery-lists.ts` ~L145-175); add-to-pantry (~L352) loads the whole list to find one item; `GET /grocery-lists/:id` (~L226) awaits `getUserProfile` serially; meal confirm (`server/routes/meal-plan.ts` ~L530) pre-checks with `getConfirmedMealPlanItemIds` although the unique index already guards it.

## Implementation Notes

Source: audit manifest `docs/audits/2026-11-08-performance.md` (local, gitignored) rows M3, L5–L8, all from the server-reviewer discovery pass. Ownership scoping must stay in the SQL of every storage function touched (`docs/rules/security.md`). Each item is independent; split into separate PRs if one grows.
