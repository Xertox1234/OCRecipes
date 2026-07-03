---
title: meta.silentError on a shared query key is mount-order-dependent
track: bug
category: logic-errors
module: client
severity: medium
tags: [client-state, react-query, query-meta, error-handling, toast]
symptoms: [A query failure shows no toast and no inline error on one screen after another screen opted out via meta.silentError, Toast suppression varies with screen mount order, A screen double-reports errors (global toast plus inline UI) on a shared query key]
applies_to: [client/lib/query-client.ts]
created: '2026-05-28'
---

# `meta.silentError` on a shared query key is mount-order-dependent

**Category:** logic-errors
**Domain:** client-state
**Date:** 2026-05-28

## Problem

The global `QueryCache.onError` net (`client/lib/query-client.ts`) shows a backstop
toast on query failure and lets a screen opt out via `meta: { silentError: true }`
when it renders its own error UI. During the 2026-05-28 silent-failures cluster,
four screens independently added `silentError` to queries — but several of those
queries use a **statically-keyed** shared cache entry read by *other* screens that
have no error UI of their own and rely on the global toast.

Concretely:

- `QUERY_KEYS.dietaryProfile` (`["/api/user/dietary-profile"]`) — read by
  `CoachRemindersScreen`, `RecipeChatScreen`, `useDietaryProfileForm`.
- `["/api/daily-summary"]` — read by `DailyNutritionDetailScreen` and
  `useHistoryData` (History dashboard).
- `["/api/daily-budget"]` (no date) — read by `HomeScreen`, `DailySummaryHeader`,
  `DailyNutritionDetailScreen`.

## Root cause

In TanStack Query v5, `meta` is stored on the **Query** (the cache entry keyed by
`queryKey`), not per-observer. Each observer's `setOptions` overwrites the query's
`meta`, so the value the cache-level `onError` reads is whichever observer most
recently mounted/updated. When two observers of one key disagree (one sets
`silentError`, one doesn't), toast suppression becomes **mount-order- and
co-mount-dependent**:

- If the opted-out observer wins, the other screen's failure is **fully silent**
  (no toast, no inline UI) — re-introducing the exact bug being fixed.
- If the non-opted observer wins, the opted-out screen **double-reports** (toast +
  inline).

## Fix

`silentError` is only safe on a key when **every** consumer opts out *and* renders
its own error UI. For a key with heterogeneous consumers:

- **Don't opt out** — accept the toast + inline double-report (deterministic, safe).
  Used for `dietaryProfile` (CoachReminders) and `daily-summary` (DailyNutrition).
- **Make all consumers agree** when they *all* render their own error UI. Used for
  `daily-budget`: Home, DailySummaryHeader, and DailyNutritionDetail all pass
  `{ meta: { silentError: true } }`. (`MealPlanHomeScreen` uses a *dated* key —
  separate cache entry — so it's unaffected.)

## How to detect

Before adding `meta: { silentError: true }`, `findReferences` (LSP) the **query
key**, not just the wrapping hook — a hook param threads the flag but the cache
entry is still shared. Static keys are the dangerous case; per-`id` keys
(`[".../${conversationId}/messages"]`) rarely co-mount the same entry, so the risk
is low (left as-is for `useChatMessages`).
