---
title: "The coach stream never sends X-Timezone, so the notebook follow-up date anchor merged in PR #901 is a no-op in production — and wiring it alone makes two writers of followUpDate diverge"
status: backlog
priority: high
created: 2026-09-03
updated: 2026-09-03
assignee:
labels: [deferred, server, client, coach]
github_issue:
---

# The coach stream never sends X-Timezone

## Background

Surfaced by the `server-reviewer` pass on PR #901 during the 2026-09-03 merge sweep, and
independently re-verified before filing. PR #901 merged (it is a real improvement to the
extraction prompt) but its **write-side** fix does nothing in production today.

The owner ruled on 2026-09-03 that both halves below ship as **one change**, not two.

### Verified facts (each checked by reading the file on 2026-09-03, not inherited)

1. `client/hooks/useCoachStream.ts:195-196` builds a raw `XMLHttpRequest` and sets exactly
   two headers — `Content-Type` and `Authorization`. **No `X-Timezone`.** It does not route
   through `client/lib/query-client.ts`'s `apiRequest`, so no interceptor adds one.
2. `server/routes/chat.ts:534` reads `tz: parseTimezone(req.headers["x-timezone"])`.
3. `server/routes/_helpers.ts:170-171` — `parseTimezone` returns `"UTC"` for a missing or
   empty value.
4. Therefore `tz` on this endpoint is **always `"UTC"`**, and `civilDateToInstant(dateStr,
"UTC")` produces the same instant as the pre-#901 `new Date(dateStr)`. The
   push-reminder-fires-early defect that PR #901 set out to close is unchanged in the field.
5. `server/routes/notebook.ts:109` and `:148` — the manual create/edit entry route — still
   write `followUpDate: followUpDate ? new Date(followUpDate) : null`.

### Why this is HIGH and not medium

Fixing (1) alone is actively worse than leaving it. Today both writers of
`coachNotebook.followUpDate` land on UTC midnight — wrong for UTC-negative users, but
**consistently** wrong. The moment `X-Timezone` reaches the chat route, the extraction path
starts anchoring at local midnight while `notebook.ts` keeps anchoring at UTC midnight, and
two commitments a user states for the same calendar day — one via chat, one via the manual
add screen — sit at different instants. For a UTC-negative user the manual one comes due
_earlier_ for the same nominal day.

That is exactly
`docs/solutions/logic-errors/two-writers-of-one-date-column-must-share-a-normalisation-basis-2026-08-31.md`:
the two writers agree on the helper _name_ and disagree on its input basis.

## There is an established pattern to copy — this is not novel plumbing

Six client call sites already send the header with `getDeviceTimezone()`, including one on
the coach surface itself:

- `client/hooks/useCoachContext.ts:37`
- `client/hooks/useDailyBudget.ts:28`
- `client/hooks/useMicronutrients.ts:46`
- `client/hooks/useProfileWidgets.ts:15`
- `client/hooks/useMealPlan.ts:97`
- `client/screens/DailyNutritionDetailScreen.tsx:140`, `client/screens/meal-plan/MealPlanHomeScreen.tsx:594`

`useCoachStream.ts` is the outlier. `useMealPlan.ts:88` even carries a comment explaining
the header is required and not decorative. Copy that pattern rather than inventing one.

## Acceptance Criteria

- [ ] `client/hooks/useCoachStream.ts` sends `X-Timezone: getDeviceTimezone()` on its XHR,
      matching the six existing call sites.
- [ ] `server/routes/notebook.ts:109` and `:148` are converted onto the same civil-date
      basis (`civilDateToInstant` with the route's parsed timezone) **in this same change**.
      Shipping the client header without this is the specific outcome this todo exists to
      prevent — say so in the PR body.
- [ ] The notebook route parses `X-Timezone` (it does not today) and its client callers send
      it. **Verify by execution that the header actually arrives** — do not infer it from
      the server parsing it. That inference is the exact error that made PR #901's fix a
      no-op, and repeating it here would make this fix a no-op too.
- [ ] Tests at BOTH offset signs (one UTC-negative, one UTC-positive zone), with the zone
      passed as explicit data rather than ambient `process.env.TZ`, and not built in a
      `describe.each` table (tables evaluate before hooks).
- [ ] Two-sided mutation test: reverting each half independently must make assertions FAIL.
      In particular there must be a test that fails if the client header is dropped — the
      current suite passes with it absent, which is why this shipped.
- [ ] A cross-surface test: a commitment created via chat extraction and one created via the
      manual notebook route, for the SAME stated calendar day, land on the same instant.
- [ ] Zero follow-ups.

## Implementation Notes

- `shared/schema.ts:87`'s `users.timezone` column exists but has **zero server-side readers**
  (grepped 2026-09-03). Either use it as the fallback when the header is absent — which
  would fix this class for every endpoint at once — or leave it alone deliberately; do not
  half-adopt it.
- ESLint blocks `toLocalDateString` from `server/**`; `server/lib/civil-date.ts` is the
  server-side helper.
- Do NOT delegate any part of this to a cheap-worker script: it touches coach/health-adjacent
  user data, which is an absolute exclusion in both tiers.

## Scope Contract

- **Files in scope:** `client/hooks/useCoachStream.ts`, `server/routes/notebook.ts`,
  `server/services/coach-pro-chat.ts` (only if the basis decision requires it), their tests,
  and this todo.
- No change to `parseTimezone`'s "UTC" fallback semantics, and no change to the other six
  existing `X-Timezone` call sites.

## Related

- PR #901 (merged 2026-09-03) — introduced the write-side anchor this todo makes real.
- `docs/solutions/logic-errors/a-date-cannot-express-a-calendar-day-2026-08-31.md` — its
  Prevention section already carries the bullet "check that a header the server now depends
  on is actually sent". This todo is that bullet going unheeded once.
- `todos/P2-2026-09-03-batch-scan-grocery-list-uses-utc-calendar-day.md` — same defect class,
  different surface, independently fixable.
