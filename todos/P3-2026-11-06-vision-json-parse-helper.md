---
title: "Confirm and dedupe the vision-prompt → JSON.parse → Zod scaffolding across 5 analysis services"
status: backlog
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

- [ ] Diff the five parse paths; if they really are the same, extract a provider-neutral `parseAiJson(schema, text)` helper in `server/lib/` (no business logic)
- [ ] If they differ in ways that matter, close this todo with a note saying so
- [ ] Each service's existing tests pass, and AI eval baselines are not re-run without the owner's OK on cost

## Implementation Notes

- Food-photo analysis is health-adjacent. Don't use a kimi worker on this.
