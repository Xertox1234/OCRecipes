---
title: "Decide whether production may boot with email verification disabled (RESEND_API_KEY unset)"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, reliability, auth]
github_issue:
human_led: true
---

# Decide whether production may boot with email verification disabled

## Summary

When `RESEND_API_KEY` is unset, `validateEnv()` only warns. Email verification,
and the email-code paths gated on `emailVerificationEnabled` (password reset,
email change, two-step by email), are then silently disabled, and new users
auto-login unverified. The open question is whether production should refuse
to boot unless the key is set or an explicit opt-out is given.

## Background

This is the second half of reliability-audit finding R13 (2026-10-30, Low). The
first half shipped in the `claude/reliability-server-network` PR:
`RECIPE_FINDER_ENABLED`, `RECIPE_OFFER_ENABLED`, `RETENTION_CLEANUP_ENABLED` and
`RECIPE_FINDER_SPOONACULAR_DAILY_CAP` are now validated in `server/lib/env.ts`.

This half was deferred because it needs a product/deploy decision. Making the
key mandatory in `NODE_ENV=production` would fail every production boot that
runs without Resend today. The fail-open posture is also documented as
deliberate (see the `RESEND_API_KEY` comment in `server/lib/env.ts` and the
startup warning). It needs an owner ruling, not an executor guess.

## Acceptance Criteria

- [ ] Owner decides: (a) keep the warn-only fail-open posture (then close this todo), or (b) require `RESEND_API_KEY` in production unless `EMAIL_VERIFICATION_DISABLED=true` is set explicitly
- [ ] If (b): `validateEnv()` throws in production when neither is set, with a message naming both variables
- [ ] If (b): `EMAIL_VERIFICATION_DISABLED` is added to `envSchema` as a `"true" | "false"` flag
- [ ] If (b): tests in `server/lib/__tests__/env.test.ts` cover all three cases (key set / opt-out set / neither)
- [ ] If (b): the production Railway environment has one of the two set **before** the change deploys

## Implementation Notes

- The guard goes next to the existing `RECEIPT_VALIDATION_STUB` and R2 production guards in `validateEnv()` (`server/lib/env.ts`).
- Mirror the R2 guard style: throw in production, warn elsewhere.

## Scope Contract

- **Mechanisms to use:** the existing `validateEnv()` production-guard pattern
- **Files in scope:** `server/lib/env.ts`, `server/lib/__tests__/env.test.ts`, `CLAUDE.md` (Environment Variables line only)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Owner decision (product/deploy posture)

## Risks

- Option (b) bricks production boots if the env var is missing at deploy time.

## Updates

### 2026-10-30

- Initial creation (deferred half of reliability finding R13)
