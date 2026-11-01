---
title: "Decide and unify the day boundary for daily quotas (UTC vs user-local)"
status: done
priority: low
created: 2026-10-30
updated: 2026-10-31
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

- [x] Product rule chosen and written into `docs/rules/` (server domain).
- [x] Every daily-quota counter uses that rule, and the early check and the
      in-transaction re-check for the same feature use the same bounds.
- [x] Tests show one bucket per feature (scan, meal suggestions, chat, recipe generation).

## Implementation Notes

- `getDayBounds(date, tz = "UTC")` in `server/storage/helpers.ts` is the single primitive.
- For option (b), read the stored tz the scheduler uses (`storage.getUserTimezones`)
  instead of `parseTimezone(req.headers["x-timezone"])`.

## Updates

### 2026-10-30

- Initial creation (reliability audit R35 deferral).

### 2026-10-31

- Owner ruling: **option (b)** — every daily quota resets at midnight in the user's STORED profile timezone (`users.timezone`, as the scheduler reads it via `storage.getUserTimezones`), never the `x-timezone` header, so switching timezones cannot earn extra resets. Implementer: check how the stored tz gets updated; if the client can change it freely, cap how often it can change (per the Background), and record the rule in `docs/rules/` (server).

### 2026-11-01

- Implemented option (b). One primitive, `quotaDayBounds(executor, userId)` (`server/storage/quota-day.ts`), reads the STORED `users.timezone` (NULL/invalid -> UTC) and is used by every quota counter: scans, meal suggestions, chat/coach messages, recipe generations (early check AND in-transaction re-check), finder claims, and the #1663 `claimDailyAiCall` paid-AI caps. The `tz` parameter was removed from the quota storage functions, so no route can pass the header.
- Nothing wrote `users.timezone`; `PUT /api/auth/profile` now accepts an IANA `timezone`, stored write-once (`setUserTimezoneIfUnset`, `WHERE timezone IS NULL`). Write-once is the change cap without a schema change.
- Follow-ups (not todos): the client does not yet send `timezone`, so quotas stay UTC until it does; a real change-rate cap needs a `users.timezone_updated_at` column (db-serial); write-once also freezes reminder timing, which shares the column.
