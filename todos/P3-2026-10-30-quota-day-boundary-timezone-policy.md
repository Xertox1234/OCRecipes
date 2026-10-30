---
title: "Decide and unify the day boundary for daily quotas (UTC vs user-local)"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, reliability, server]
github_issue:
---

# Decide and unify the day boundary for daily quotas (UTC vs user-local)

## Summary

Daily quotas reset on different day boundaries depending on the path. Pick one product
rule, then make every quota counter (early check and in-transaction re-check) use it.

## Background

Deferred from the 2026-10-30 reliability audit (finding R35, data-correctness PR). It needs
a product decision, so it was not fixed in that PR:

- **UTC bucket:** `getDailyScanCount` (`server/storage/nutrition.ts:~492`, called from
  `server/routes/photos.ts:182,581` and `server/routes/subscription.ts:167`),
  `getDailyMealSuggestionCount` and the transactional cache check (`server/storage/cache.ts:202,241`),
  the chat/coach limits (`server/storage/chat.ts:336`, `server/storage/chat-quota.ts:141`),
  and the finder leg of `countRecipeGenerationsToday` / `countClaimsToday`
  (`server/storage/chat-quota.ts:39,190`, documented as deliberately UTC).
- **User-tz bucket (x-timezone header):** `getDailyRecipeGenerationCount`
  (`server/routes/recipes.ts:99,137`, `cooking.ts:~517`, `recipe-generate.ts:~43`,
  `inspired-recipes.ts:~191`; storage `community-generation-log.ts`).

A UTC-8 user's "daily" scan limit resets at 4pm local, and the two recipe-generation
buckets can disagree for the same feature limit.

**Why this needs a decision:** `x-timezone` is client-controlled. Local-day quotas let a
user who flips the header (UTC+14 → UTC-12) get up to one extra reset per day. Options:
(a) keep UTC everywhere, make the recipe-generation path UTC too, and surface the reset
time to the client; (b) use the user's _stored_ profile tz (not the header) for every
quota, with a cap on how often it can change.

## Acceptance Criteria

- [ ] Product rule chosen and written into `docs/rules/` (server domain).
- [ ] Every daily-quota counter uses that rule, and the early check and the
      in-transaction re-check for the same feature use the same bounds.
- [ ] Tests show one bucket per feature (scan, meal suggestions, chat, recipe generation).

## Implementation Notes

- `getDayBounds(date, tz = "UTC")` in `server/storage/helpers.ts` is the single primitive.
- For option (b), read the stored tz the scheduler uses (`storage.getUserTimezones`)
  instead of `parseTimezone(req.headers["x-timezone"])`.

## Updates

### 2026-10-30

- Initial creation (reliability audit R35 deferral).
