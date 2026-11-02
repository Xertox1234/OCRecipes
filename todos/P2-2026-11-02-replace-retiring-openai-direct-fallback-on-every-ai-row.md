---
title: "Replace the retiring direct-OpenAI fallback on every AI_FEATURES row before 2027-01-14"
status: backlog
priority: medium
created: 2026-11-02
updated: 2026-11-02
assignee:
labels: [deferred, ai]
github_issue:
---

# Replace the retiring direct-OpenAI fallback on every AI row

## Summary

Every non-Vertex row in `server/lib/ai-models.ts` falls back to a direct-OpenAI model (`gpt-4o` or `gpt-4o-mini`) when OpenRouter is down, its circuit breaker is open, or its balance is exhausted (402). OpenAI direct shuts both down on **2027-01-14**; from then on the fallback errors instead of answering. Owner goal (2026-10-19): replace OpenAI entirely, including as the backup.

## Background

Deferred from PR #1700 (recipe-chat → Gemini 3.8 Flash, 2026-11-02). The owner asked for a different fallback on that row; none of the obvious picks works today:

- **gpt-5-nano**: OpenAI's deprecations page lists its shutdown as 2026-12-11, _before_ gpt-4o. Also, like every GPT-5/6 reasoning model, it rejects `temperature` ≠ 1, and the fallback request is sent unadapted (`server/lib/ai-client.ts` ~line 255: `{ ...params, model: fallbackModel(...) }`). `adapt` only reaches the OpenRouter attempt.
- **gpt-6-luna**: same temperature problem.
- **A Gemini model (e.g. Argon)**: `fallback` is an OpenAI-direct model id; the slot cannot name a Google model.

The only OpenAI-free routing that exists is the `primary: "vertex"` path (Vertex direct → OpenRouter, no OpenAI; spec `docs/superpowers/specs/2026-10-19-vision-rows-vertex-direct*`), used by vision rows. It has not been used for a streaming row.

## Acceptance Criteria

- [ ] Owner picks the fallback design (options: extend Vertex-direct routing to text and streaming rows; an OpenRouter in-request `models: [primary, backup]` list; an OpenAI-direct model that survives past 2027-04-14 plus a fallback-side `adapt` so it can drop `temperature`).
- [ ] No row's fallback names a model whose shutdown date is on or before the switch-over date, checked against OpenAI's deprecations page that day.
- [ ] `server/lib/__tests__/ai-models.test.ts` pins the new rule.
- [ ] Done before 2027-01-14.

## Implementation Notes

- Rows: `server/lib/ai-models.ts` (`FAST`, `HEAVY`, `LUNA`, and the explicit `recipe-generate`, `photo-analyze`, `recipe-chat` rows).
- Router: `server/lib/ai-client.ts` (`fallbackModel`, the OpenRouter → fallback branch, the Vertex branch).
- Background: memory note on gpt-4o retirement (dates on both paths; Azure via OpenRouter retires gpt-4o/mini 2027-04-14, which is a separate, later deadline for the primary routes still on `openai/gpt-4o*`).

## Dependencies

- Owner decision on the design (first criterion).

## Risks

- A design that adds a second Google route for streaming rows touches `aiChat`'s streaming path, which every coach and recipe-chat reply uses.

## Updates

### 2026-11-02

- Initial creation (owner, while reviewing PR #1700: "merge now, fix backup later").
