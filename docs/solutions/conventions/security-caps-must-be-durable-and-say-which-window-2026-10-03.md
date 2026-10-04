---
title: A brute-force cap must live in the database (in-memory limiters reset on every deploy), and a count + window-start column is a FIXED window, not a rolling one
track: knowledge
category: conventions
tags: [security, database, architecture, rate-limiting, brute-force, password-reset, deploys]
module: server
applies_to: ["server/storage/password-reset.ts", "server/routes/_rate-limiters.ts", "shared/constants/password-reset.ts"]
created: 2026-10-03
---

# A brute-force cap must live in the database (in-memory limiters reset on every deploy), and a count + window-start column is a FIXED window, not a rolling one

## Rule

1. **Any cap that a security bound depends on lives in the database**, enforced by one atomic predicate on the DB clock. express-rate-limit's MemoryStore is per process and resets on every restart. That makes it fine for throttling, but useless as the factor in a brute-force calculation.
2. **Name the window the SQL actually implements.** A `count` column plus a `window_start` column, reset with `CASE WHEN window_start <= now() - interval '24 hours' THEN 1 …`, is a **fixed** window that opens at the first event. It is not "N per rolling 24 h". A truly rolling cap needs one timestamp per event (an array or a log table) so you can count `WHERE at > now() - interval '24 hours'`. Comments, constants, specs and the bound you quote must use the window you built.

## Why

**Deploy cadence turns a memory cap into no cap.** In the week of 2026-09-26, `main` took 11–30 squash merges a day, and every merge auto-deploys to Railway and restarts the process. An in-memory "6 codes per day" cap would have reset 11–30 times a day, multiplying the password-reset brute-force bound by about that factor. The design moved both factors of the bound into SQL instead: 5 guesses per code (`reset_code_attempts < 5`, incremented in the same UPDATE) and 6 codes per window (`reset_issue_count`). The in-memory limiters stayed as an outer layer (per-IP, per-email) and are not counted in the bound.

**The fixed window doubles the worst case at its edge.** The PR #1233 server review measured this against the real `issuePasswordResetCode` by moving `reset_issue_window_start` back inside a test transaction:

```
issue1(t=0)=true
issue2..6(t=23h58m)=true (x5)
CONTROL issue7(t=23h58m, must be false)=false
accepted at t=24h00m01s (of 7 tried)=6
issued within ~2-minute span=11 exceedsCap6=YES
```

That is 11 codes, so 55 guesses, inside a span of about two minutes, against a spec that said "6 per rolling 24 h, 30 guesses/day". The long-run average still holds (at most 6 per 24 h, so the yearly bound is unchanged), which is why the owner chose to keep the fixed window and correct the wording (todo `P3-2026-10-03-password-reset-review-followups`). Either outcome is fine. Quoting a rolling bound over a fixed window is not.

## Examples

- `server/storage/password-reset.ts` — `issuePasswordResetCode` (cap and code write in one UPDATE, `RETURNING id`, where 0 rows means capped) and `reservePasswordResetAttempt` (`reset_code_attempts < 5` in the WHERE, `+ 1` in the SET; six parallel reservations still cap at 5).
- Boundary probe recipe: inside `setupTestTransaction`, move the window column back with `UPDATE … SET window_start = now() - '23 hours 58 minutes'::interval`, then issue across the edge. `now()` is transaction-start time, so move the stored timestamp rather than waiting.

## Exceptions

- Pure UX throttles (e.g. the 60 s resend cooldown on the client, the per-IP 10/15 min limiter) can stay in memory: losing them on deploy weakens nothing the threat model counts on.
- If the service goes multi-instance, the in-memory layer becomes per-instance too. That is still no worse for the bound, which is already in the DB.

## Related Files

- `server/storage/password-reset.ts`
- `shared/constants/password-reset.ts` — `RESET_CODE_MAX_ATTEMPTS`, `RESET_CODE_DAILY_ISSUE_CAP`
- `server/routes/_rate-limiters.ts` — the in-memory outer layer (`forgotPassword*`, `resetPassword*` limiters)
- `server/storage/__tests__/users-password-reset.test.ts`

## See Also

- [password-reset-must-cancel-stateless-identity-credentials](password-reset-must-cancel-stateless-identity-credentials-2026-10-03.md) — the rest of the reset's safety properties
- [credential-keyed-failed-attempt-throttle](../design-patterns/credential-keyed-failed-attempt-throttle-2026-06-10.md) — the in-memory per-account login throttle
- [rolling-instant-window-spans-n-plus-1-calendar-days](../logic-errors/rolling-instant-window-spans-n-plus-1-calendar-days-2026-07-12.md) — a different window-boundary pitfall
