---
title: "Confirm and dedupe the vision-prompt → JSON.parse → Zod scaffolding across 5 analysis services"
status: done
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, architecture]
github_issue:
---

# Shared AI JSON parse helper for vision services

## Summary

Five vision services each hand-roll the same steps: build the vision prompt, call `JSON.parse`, then validate with Zod `safeParse`. None of them share a helper. This is finding L8 from the 2026-11-06 architecture audit.

The five are `server/services/photo-analysis.ts`, `receipt-analysis.ts`, `menu-analysis.ts`, `front-label-analysis.ts` and `notebook-extraction.ts`.

## Background

- Measured: each file has 1-3 `JSON.parse` calls and 1-2 `safeParse` calls, with no shared parse helper. The code wasn't diffed line by line, so how much is truly duplicated isn't confirmed yet.
- Consequence: a fix to parse-failure handling (fence stripping, empty response) would have to be copied into five places.

## Acceptance Criteria

- [x] Diff the five parse paths; if they really are the same, extract a provider-neutral `parseAiJson(schema, text)` helper in `server/lib/` (no business logic)
- [x] If they differ in ways that matter, close this todo with a note saying so
- [x] Each service's existing tests pass, and AI eval baselines are not re-run without the owner's OK on cost

## Implementation Notes

- Food-photo analysis is health-adjacent. Don't use a kimi worker on this.

## Outcome (2026-11-07) — closed without extraction

Diffed all five parse paths. They are not the same flow in the ways that matter:

- `photo-analysis.ts` already has the dedupe: a local `parseVisionResponse(content, schema, msgs)` used by 5 call sites (lines ~391, 496, 560, 654, 871). Its `refineAnalysis` path (~741) deliberately differs: a parse or schema failure returns `previousResult` instead of throwing.
- `front-label-analysis.ts`, `menu-analysis.ts`, `receipt-analysis.ts` share the "no content / invalid JSON / schema miss, then throw" shape, but each throws its own user-facing message. Receipt even uses two different messages (invalid vs unexpected data). A shared helper would need a per-caller message map, which is what `parseVisionResponse` already is.
- `notebook-extraction.ts` returns `[]` on empty content and on schema miss, and lets `JSON.parse` throw into an outer catch: different failure semantics.
- No path strips code fences or special-cases empty text; all rely on `response_format: json_object`. The "fix once" consequence in Background is hypothetical today.

Moving `parseVisionResponse` to `server/lib/` would touch 3 services plus their tests to save about 8 lines each, while the two fallback-style callers could not use it. Not worth the churn; revisit if fence stripping is ever needed.
