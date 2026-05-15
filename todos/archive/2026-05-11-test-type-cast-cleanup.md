---
title: "Triage and clean up `as unknown as X` casts in test files"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, code-quality, deferred, audit-2026-05-11]
github_issue:
---

# Triage and clean up `as unknown as X` casts in test files

## Summary

37+ `as unknown as X` casts exist across 28 test files. ESLint blocks `as never` (per testing-specialist agent), but `as unknown as X` is the same type-bypass. Some are legitimate (partial `express.Request` for unit tests of pure helpers, testing with null inputs), but the pattern erodes the typed-factory discipline.

## Background

Surfaced by audit 2026-05-11 (finding L3 in `docs/audits/2026-05-11-testing.md`). Hotspots: `server/routes/__tests__/auth.test.ts` (9 casts — partial `express.Request` mocks), `server/services/__tests__/coach-pro-chat.test.ts` (2 — `CoachBlock` partial mocks), `server/scripts/__tests__/cleanup-retention.test.ts` (3 — `RetentionDb` interface mocks), `client/hooks/__tests__/useCoachWarmUp.test.ts` (3 — `Response` mocks).

## Acceptance Criteria

- [ ] Triage all 37 instances — for each: keep (with brief comment explaining why type-bypass is necessary) or replace
- [ ] Replacements use factories from `server/__tests__/factories/` where the type has one
- [ ] For `express.Request`/`Response` partial mocks, consider extracting a `test/utils/express-mocks.ts` helper exporting `mockRequest({ ip, socket, ... })` and `mockResponse()` that return well-typed objects
- [ ] For `Response` (fetch) mocks, use a typed helper like `mockFetchResponse({ ok, status, json })`
- [ ] Consider an ESLint custom rule banning `as unknown as` in `__tests__/` directories (allow-listed for cases with a `// eslint-disable-next-line` and a justification comment)

## Implementation Notes

- Don't blanket-ban — some casts are truly necessary (e.g., constructing minimal partial objects for testing pure helpers that only read specific fields). The goal is intentionality, not elimination.
- A custom ESLint rule is overkill for 37 cases; manual triage + reviewer awareness may be enough
- Most-bang-for-buck: extract `mockExpressReq`/`mockExpressRes` helpers — that single change eliminates ~15 casts

## Dependencies

None.

## Risks

- Low; this is hygiene work.
