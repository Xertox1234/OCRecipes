---
title: Timezone-aware day boundaries using Intl.DateTimeFormat
track: knowledge
category: conventions
module: server
tags: [timezone, dates, intl, pattern, day-boundary]
applies_to: [server/storage/helpers.ts, server/routes/_helpers.ts, client/hooks/useDailyBudget.ts, client/hooks/useHistoryData.ts, client/screens/DailyNutritionDetailScreen.tsx, client/screens/meal-plan/MealPlanHomeScreen.tsx]
created: '2026-05-31'
last_updated: '2026-05-31'
---

# Timezone-aware day boundaries using `Intl.DateTimeFormat`

## Rule

Use `Intl.DateTimeFormat` (including `timeZoneName: 'longOffset'`) to compute day start/end timestamps in the client's timezone — never use `new Date().toLocaleString()` or libraries like `moment-timezone` for this purpose.

When you need to translate a civil date (e.g. "2026-05-31") to the UTC epoch that corresponds to midnight of that date in the user's timezone, apply `getDayBounds`. To validate or normalize a timezone identifier from user input or request headers, use `parseTimezone`.

## Why

OCRecipes stores all timestamps in UTC. Budgets, daily allowances, and other "per-day" calculations must be aligned to the user's local midnight, not UTC midnight. Using `Intl.DateTimeFormat` directly avoids:

- Bugs when the server's own timezone is not UTC (common in CI or local dev).
- Unnecessary external dependencies (no `moment-timezone`, `luxon`, or `date-fns-tz`).
- Off-by-one errors from the "server vs client" offset mismatch.

## Smell patterns

- `new Date(value).toLocaleString()` appearing in server-side date calculations.
- Adding or subtracting a fixed number of milliseconds per day (e.g. `+ 86400000`) to shift timezones.
- Direct use of `moment.tz()` or `tz` from `@date-fns/tz` without a strong reason.
- `getTimezoneOffset()` used to adjust epoch timestamps (does not account for DST transitions).

## Examples

### `getDayBounds(date, tz = 'UTC')`

```typescript
import { getDayBounds } from './helpers'; // from server/storage/helpers.ts

// Given a date and a timezone, return { startUtcMs, endUtcMs }.
function getDayBounds(date: Date, tz: string = 'UTC'): { startUtcMs: number; endUtcMs: number } {
  // 1. Get the civil date in the target timezone.
  const civilFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = civilFormatter.formatToParts(date);
  const year = Number(parts.find(p => p.type === 'year')!.value);
  const month = Number(parts.find(p => p.type === 'month')!.value);
  const day = Number(parts.find(p => p.type === 'day')!.value);

  // 2. Get the UTC offset at the given date.
  const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const offsetStr = offsetFormatter.formatToParts(date).find(p => p.type === 'timeZoneName')!.value;
  // offsetStr is like "GMT+5:30" or "GMT-04:00" or "GMT" (UTC)
  const offsetMinutes = parseOffsetToMinutes(offsetStr);

  // 3. Compute UTC midnight for that civil date.
  const startUtcMs = Date.UTC(year, month - 1, day) - offsetMinutes * 60000;
  const endUtcMs = startUtcMs + 86400000;

  return { startUtcMs, endUtcMs };
}

function parseOffsetToMinutes(offset: string): number {
  if (offset === 'GMT') return 0;
  const match = offset.match(/^GMT([+-])(\d{1,2}):?(\d{2})?$/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}
```

### `parseTimezone(value)`

```typescript
import { parseTimezone } from './_helpers'; // from server/routes/_helpers.ts

function parseTimezone(value: string | undefined): string {
  if (!value) return 'UTC';
  try {
    // Verify the timezone name is valid by attempting to use it.
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}
```

### Usage in route handlers

```typescript
// server/routes/_helpers.ts
function getClientTimezone(req: Request): string {
  const header = req.headers['x-timezone'];
  return parseTimezone(header);
}
```

### Usage in client hook

```typescript
// client/hooks/useDailyBudget.ts
import { getDayBounds } from '../../server/storage/helpers'; // or extracted shared util

function useDailyBudget() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; // client sends this in X-Timezone
  // ... use getDayBounds(new Date(), tz) to compute budget window
}
```

## Client threading caveat: shared static query keys

A client query that needs to send `X-Timezone` must use a custom `queryFn` calling `apiRequest` with `{ headers: { 'X-Timezone': getDeviceTimezone() } }` — the global `getQueryFn` does **not** support custom headers, so any screen relying on it silently sends UTC. The helper `getDeviceTimezone` (try `Intl.DateTimeFormat().resolvedOptions().timeZone` / catch → `'UTC'`) should be extracted into `client/lib/timezone.ts` once two or more callers need it.

**CRITICAL nuance**: When a screen **shares** a static query key with another observer (e.g. `DailyNutritionDetailScreen` and `useHistoryData` both use the bare `['/api/daily-summary']` key), they share **one** TanStack v5 cache entry whose `queryFn` is last-writer-wins among mounted observers. Therefore:

- (a) **All** observers of that shared key must provide a `queryFn` that sends `X-Timezone`, or the header presence becomes mount-order–dependent.
- (b) You must **not** add a per-observer key segment like `{ tz }` to only one of them (the way per-hook keys such as `useDailyBudget`'s `['/api/daily-budget', { tz }]` do) — that would **fragment** the shared cache entry and is only safe when the key is **not** shared.

Also note that `apiRequest` throws on non-2xx via `throwIfResNotOk`, so a custom `queryFn` must **not** add a redundant `if (!res.ok)` guard.

## Exceptions

- If the application already includes `luxon` or `date-fns` with `date-fns-tz` as a core dependency, it is acceptable to reuse those utilities instead of implementing `getDayBounds`, as long as the same constraint (no `toLocaleString` on the server) is enforced.
- `parseTimezone` returns `'UTC'` on failure because that is a safe default for all users; if a user's timezone is invalid they will see UTC-aligned days, which is at least consistent.

## Related Files

- `server/storage/helpers.ts` — Contains `getDayBounds` and related helpers.
- `server/routes/_helpers.ts` — Contains `parseTimezone` and `getClientTimezone`.
- `client/hooks/useDailyBudget.ts` — Client hook that reads the user's timezone from `Intl` and uses `getDayBounds`.
- `client/lib/timezone.ts` — getDeviceTimezone() helper shared by hooks and screens.
- `client/hooks/useHistoryData.ts` — sends X-Timezone via custom queryFn on the shared ["/api/daily-summary"] key.
- `client/screens/DailyNutritionDetailScreen.tsx` — daily-summary screen caller threading X-Timezone via custom queryFn on the shared key.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — daily-summary screen caller threading X-Timezone on its per-date key.

## See Also

- [MDN: Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)
- [ECMA‑262 §11.6.1 – Intl.DateTimeFormat and timeZoneName](https://tc39.es/ecma402/#sec-datetimeformat-formatToParts)
