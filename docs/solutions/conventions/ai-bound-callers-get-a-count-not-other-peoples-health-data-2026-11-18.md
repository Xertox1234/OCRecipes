---
title: "Code that feeds an AI prompt gets a count, never rows of other people's health data — and an AI-reader list follows the data into every table it is copied to"
track: knowledge
category: conventions
tags: [security, privacy, ai-prompting, architecture, family-profiles, health-data]
module: server
applies_to: ["server/services/family-context.ts", "server/services/**/*.ts", "server/storage/meal-plan-analytics.ts", "server/services/coach-tools.ts"]
created: 2026-11-18
---

# AI-bound callers get a count, not other people's health data

## Rule

1. A helper used by code that builds an AI prompt returns only what the prompt may contain. When the prompt may hold a headcount but not the people, the helper returns the count (`getFamilyContext` → `{ active, profileCount }`), never the profile rows plus a comment saying "only use `.length`".
2. A list of "readers that send X to an AI provider" follows X into every table it is copied to. A guarantee on the direct readers of `meal_plan_items` says nothing about a grocery list generated from those items and read by a coach tool.

## Why

- Family profiles hold other people's names, allergies and notes — some of them children. Owner ruling 2026-11-18: none of it reaches a provider. A prompt builder that holds the rows is one edit ("respect the family's allergies") away from sending them, with no ruling and no `sanitizeUserInput`. A caller that receives a number cannot leak rows; the type enforces what the comment only asked.
- The security audit found the second-hand path (profile meal → generated grocery list → `get_grocery_lists` → provider) only because it traced the data past the first table. The spec's verified reader list had covered the three direct readers.

## Examples

- `server/services/family-context.ts`: `countFamilyProfiles(userId)`, no `getFamilyProfiles`; its test asserts `getFamilyProfiles` is never called.
- `server/services/pantry-meal-plan.ts`: `householdSize = 1 + family.profileCount` — the old test fed names into a mock to check they stayed out of the prompt; that test is gone because the service can no longer receive names.
- Second-hand path: accepted by owner ruling 2026-11-18 (grocery items are not profile details) and recorded in `docs/superpowers/specs/2026-11-16-plan-week-grid-family-profiles-design.md`. A new AI-bound reader of family data still needs a ruling.

## Related Files

- `server/services/family-context.ts`
- `server/services/pantry-meal-plan.ts`
- `server/storage/meal-plan-items.ts` — `getMealPlanItemSummaries` (never returns profile meals)
- `server/storage/meal-plan-analytics.ts`, `server/services/coach-tools.ts` — the grocery path

## See Also

- `docs/solutions/conventions/other-peoples-health-data-stays-out-of-the-persisted-query-cache-2026-11-16.md`
