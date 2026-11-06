---
title: "Front-label confirm hand-builds a 500 after a warn — never reaches Sentry"
status: backlog
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, api]
github_issue:
---

# Front-label confirm hand-builds a 500 after a warn — never reaches Sentry

## Summary

`server/routes/verification.ts` (front-label confirm, the `frontLabelDataSchema.safeParse` failure branch, ~lines 381-390) logs with `logger.warn` and returns a hand-built `sendError(res, 500, …)`. Neither path reaches Sentry, so a systematic schema drift in front-label data would fail every confirm silently.

## Background

Noticed during the 2026-11-05 data-integrity audit (cluster 3, L10) — out of that audit's scope. The rule is codified in `docs/solutions/logic-errors/route-catch-that-hand-builds-a-500-never-reaches-sentry-2026-11-05.md` and `docs/solutions/conventions/server-log-level-is-the-sentry-routing-decision-2026-10-30.md` (error pages, warn does not).

## Acceptance Criteria

- [ ] The validation-failure branch reports through the handled-5xx chokepoint (`handleRouteError`) or logs at `error`, so Sentry sees it
- [ ] A route test asserts the failure path reports (mirroring the existing handled-5xx tests)

## Implementation Notes

- File: `server/routes/verification.ts`, test `server/routes/__tests__/verification.test.ts`
- Keep the response body/status the client already handles.

## Scope Contract

- **Mechanisms to use:** `handleRouteError` / `logger.error` — nothing new
- **Files in scope:** `server/routes/verification.ts`, `server/routes/__tests__/verification.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None notable

## Updates

### 2026-11-06

- Initial creation (data-integrity audit 2026-11-05, noticed out of scope)
