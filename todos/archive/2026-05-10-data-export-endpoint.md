---
title: "Data export endpoint (CCPA/PIPEDA right to portability)"
status: backlog
priority: high
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [compliance, privacy, deferred]
github_issue:
---

# Data Export Endpoint

## Summary

Implement `GET /api/users/me/export` that returns a JSON bundle of all data the app holds for the authenticated user, satisfying the CCPA/PIPEDA right to data portability.

## Background

CCPA (California) and PIPEDA (Canada) both give users the right to receive a copy of their personal data in a portable format. The app collects significant personal and health data: profile, nutrition logs, weight tracking, recipes, meal plans, chat history, grocery lists, cookbooks, activity logs, and more. Without an export endpoint, the app cannot satisfy a data access request without manual database intervention.

## Acceptance Criteria

- [ ] `GET /api/users/me/export` route exists, behind `requireAuth`, with a low rate limit (e.g. 2/hour per user)
- [ ] Response is a JSON object with top-level keys per domain: `profile`, `scannedItems`, `nutritionLogs`, `weightLogs`, `mealPlans`, `recipes`, `chatHistory`, `groceryLists`, `cookbooks`, `activityLogs`, `fastingLogs`
- [ ] Response excludes sensitive system fields: `password`, `tokenVersion`, internal cache keys
- [ ] Response includes a `exportedAt` ISO timestamp and `appVersion` field
- [ ] Content-Disposition header set to `attachment; filename="ocrecipes-export-YYYY-MM-DD.json"`
- [ ] Route test: unauthenticated → 401; authenticated → 200 with correct shape; rate limit exceeded → 429
- [ ] Client-side: "Export My Data" button in Profile settings that triggers the download/share sheet

## Implementation Notes

- Gather data via parallel `Promise.all` across all storage domains — do not do sequential awaits
- Use `safeUserColumns` equivalent for each domain (strip internal fields)
- For chat history: include message content but strip `dedupeKey`, internal metadata
- Response size could be large for active users — set `Content-Type: application/json` and stream if needed, or accept that a synchronous response is fine for MVP
- Rate limit: use a dedicated `exportRateLimit` (2 req/hour/user) in `server/routes/_rate-limiters.ts`
- Client: use `Share` API from React Native to allow user to save/send the JSON file
- Eligible for Copilot delegation (no auth logic, no health-data mutations — read-only aggregation)

## Dependencies

- All storage modules must be readable (they already are)
- `server/routes/_rate-limiters.ts` — add `exportRateLimit`

## Risks

- Response payload size: a user with years of data could generate a very large JSON. Consider adding a `?since=YYYY-MM-DD` query param in a future iteration.
- PII in chat history: AI responses may contain user-disclosed health info — this is expected and correct to include, but worth noting in the privacy policy

## Updates

### 2026-05-10

- Created from compliance review (North America launch planning)
