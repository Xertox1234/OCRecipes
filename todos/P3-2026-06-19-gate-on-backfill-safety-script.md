---
title: "One-shot guarded backfill script for the email-verification gate-on flip"
status: backlog
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, ops, database, auth]
github_issue:
---

# Gate-on backfill safety script

## Summary

Turning email verification ON in prod is correct ONLY if
`UPDATE users SET email_verified = true` runs **before** `RESEND_API_KEY` is set.
Out of order → every pre-existing user is locked out of login. Today that ordering
is enforced only by the `docs/DEV_SETUP.md` runbook (human discipline), not by
code.

## Background

From the PR #403 review — the #1 residual _operational_ risk of the feature. The
feature itself is fail-open and correct; the risk is purely the rollout sequence.
A single guarded script makes the safe path the easy path and removes a manual
`psql` foot-gun. Not urgent: the gate stays OFF until launch, so this is needed
only when the flip is actually scheduled.

## Acceptance Criteria

- [ ] A script (e.g. `server/scripts/backfill-email-verified.ts`) runs the
      point-in-time `UPDATE users SET email_verified = true WHERE email_verified = false`,
      prints the affected row count, and is idempotent.
- [ ] It refuses to run unless it can confirm the env is the intended target
      (mirror the `--allow-prod-seed` guard pattern in `seed-recipes.ts`).
- [ ] `docs/DEV_SETUP.md` "Turning the gate ON" step 3 references the script
      instead of a raw `psql` one-liner.
- [ ] (Optional) the script warns if `RESEND_API_KEY` is already set in the target
      env (i.e. the flip already happened — backfill is now late).

## Implementation Notes

- Reuse the Railway prod-DB access pattern from the runbook:
  `railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -c "…"'`
  (internal host won't resolve from a laptop — see
  [[project_railway_autodeploy_migrate_ordering]]).
- This is gate-on tooling, not scaling/deployment infra — keep it runnable on
  demand, not wired into boot (`server:prod` runs no migrations on boot).

## Dependencies

- Builds on the email-verification feature (PR #403). Execute when the Resend
  gate-on is actually scheduled.

## Risks

- The script writes to the prod `users` table — review the statement and run the
  point-in-time backfill immediately before flipping `RESEND_API_KEY`, per the
  runbook.
