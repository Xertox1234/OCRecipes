---
title: "Add Zod validation to Google RTDN webhook body in store-webhooks.ts"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, security]
github_issue:
---

# Add Zod validation to Google RTDN webhook body in store-webhooks.ts

## Summary

The Google RTDN webhook body in `store-webhooks.ts` passes `req.body` to the service without Zod validation. The Apple path has `appleNotificationBodySchema`; this asymmetry is a footgun. Not currently exploitable (OIDC auth guards it), but should be fixed before prod.

## Background

Deferred from 2026-06-03 full audit (L9). Files: `server/routes/store-webhooks.ts:68`, `server/services/store-notifications.ts:128-165`.

## Acceptance Criteria

- [ ] A Zod schema for Google RTDN webhook body shape is defined
- [ ] `req.body` is validated against the schema before passing to the service
- [ ] Invalid shapes return 400

## Implementation Notes

Model after `appleNotificationBodySchema`. Reference the [Google RTDN docs](https://developer.android.com/google/play/billing/rtdn-reference) for the expected payload shape. The schema should be lenient on fields the service doesn't use (`.passthrough()` or `.strip()`).

## Dependencies

- None

## Risks

- Low — additive validation; OIDC auth already gates access

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L9)
