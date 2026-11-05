---
title: "Server: hand-built 500s and silent best-effort catches never reach Sentry"
status: done
priority: medium
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, code-quality, server, observability]
github_issue:
---

# Server: hand-built 500s and silent best-effort catches never reach Sentry

## Summary

Several route catches log and hand-build a 500 instead of going through `handleRouteError` — the handled-5xx Sentry chokepoint (`server/routes/_helpers.ts`) — and several best-effort cleanups swallow errors with no log at all. Group A of the 2026-11-05 code-quality audit (CQ1–6, CQ11).

## Acceptance Criteria

- [x] CQ1 `server/routes/meal-plan.ts` confirm catch: non-unique-violation errors go through `handleRouteError` (409 branch unchanged)
- [x] CQ2 `server/routes/food.ts` transcribe catch → `handleRouteError` (ZodError → 400 for free)
- [x] CQ3 `server/routes/nutrition.ts` toggle-favourite catch calls `reportError` (keeps `TOGGLE_FAILED` code)
- [x] CQ4 `server/routes/cooking.ts` `IngredientAnalysisError` is logged + reported and returns a fixed user-facing message, not `error.message`
- [x] CQ5 `server/services/voice-transcription.ts` rethrow keeps `{ cause }`
- [x] CQ6 `server/routes/inspired-recipes.ts` three best-effort cleanups log a warning on failure (still non-fatal)
- [x] CQ11 `server/services/coach-blocks.ts` malformed block JSON logs at `warn` with `err`
- [x] Each change has a test that asserts on the call records (`reportError`/logger mocks), not the response text

## Scope Contract

- **Mechanisms to use:** existing `handleRouteError`, `reportError`, `logger`, `toError` — nothing new
- **Files in scope:** the 7 files above and their `__tests__`
