---
title: "Confirm and dedupe the vision-prompt → JSON.parse → Zod scaffolding across 5 analysis services"
status: done
priority: low
created: 2026-11-06
updated: 2026-11-07
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
- [x] (superseded by owner ruling 2026-11-07: extract) If they differ in ways that matter, close this todo with a note saying so
- [x] Each service's existing tests pass, and AI eval baselines are not re-run without the owner's OK on cost

## Implementation Notes

- Food-photo analysis is health-adjacent. Don't use a kimi worker on this.

## Resolution (2026-11-07)

Owner ruling: extract. `parseAiJson(content, schema, msgs, log)` now lives in `server/lib/ai-json.ts` (moved from `parseVisionResponse` in photo-analysis.ts). `msgs` has an optional `schemaMismatch` so receipt keeps its two distinct messages. Migrated: photo-analysis (6 call sites), menu-analysis, front-label-analysis, receipt-analysis; all error and log strings unchanged.

Left as is on purpose: `notebook-extraction.ts` and the photo-analysis refinement path (`analysisResultSchema.safeParse(JSON.parse(content))`) return a fallback instead of throwing, so the throw-on-failure helper does not fit them. No AI evals were run.
