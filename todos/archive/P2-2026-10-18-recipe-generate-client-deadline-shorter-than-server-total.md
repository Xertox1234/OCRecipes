---
title: "Background recipe generation: the 60 s client deadline fires before a slow server finishes (observed 65 s), turning a success into 'check Saved items'"
status: done
priority: medium
created: 2026-10-18
updated: 2026-10-18
assignee:
labels: [deferred, ai, mobile]
github_issue:
---

# Client deadline (60 s) can beat a slow but successful generation

## Summary

`useGenerateRecipeInBackground` aborts the request after `RECIPE_GENERATION_DEADLINE_MS = 60_000` (spec constraint). The server's heavy-model timeout is also 60 s (`OPENAI_TIMEOUT_HEAVY_MS`), but the route does more after the model answers (hero image, allergen pass, save, Saved-items row), so a slow run can finish **after** the client has given up. Observed 2026-10-18 on the dev server (gpt-4o, run 4 of the sim check): the server log recorded the request with `statusCode: null, responseTime: 59973` (client closed the socket at the deadline) and the recipe row landed 5 s later (23:58:42). The client correctly took the soft path (Saved items refetch + "Couldn't confirm the recipe — check Saved items"), so nothing was lost, but the user was told to go looking for a recipe that would have arrived as a normal toast a few seconds later.

## Background

Deferred because the behaviour is the one the spec asked for (the soft path exists precisely for this), the number is a spec constraint (§3), and PR 3 changes the model to Gemini 4 Argon (p50 11 s, max 13 s measured), which makes the race rarer. Four of five sim runs finished in 3.5–8 s.

## Acceptance Criteria

- [x] Owner decides the client deadline: keep 60 s, or raise to ~90 s so the client outlives the server's own 60 s model timeout plus post-processing (the server will have answered or 5xx'd by then). _Owner 2026-10-18: raise to 90 s._
- [x] If raised: change `RECIPE_GENERATION_DEADLINE_MS` in `client/hooks/useGenerateRecipeInBackground.ts` (and the meal-plan hook if it shares it), update the deadline test, and update spec §3. _Done; the meal-plan hook (`useRecipeGenerate.ts`) inherits the constant through `withDeadline`'s default. The spec sentence lives in §5 (and §8), not §3._
- [x] Measure once after PR 3 is live: p95 of `responseTime` for `POST /api/recipes/generate` in the server log over a day of dev use, and confirm it sits well under the chosen deadline. _Skipped (owner 2026-10-18): the dev server logs to the terminal only (pino-pretty on stdout), so there is no stored log to measure. The new test pins the one slow case observed (65 s)._

## Implementation Notes

- The server-side total is model time + image generation + DB; `server/routes/recipes.ts` ~line 121 onwards. `OPENAI_TIMEOUT_HEAVY_MS` is in `server/lib/ai-models.ts` / the AI client.
- Keep `AbortController` + `setTimeout` (Hermes has no `AbortSignal.timeout`).

## Scope Contract

- **Mechanisms to use:** the existing `withDeadline` helper and its test.
- **Files in scope:** `client/hooks/useGenerateRecipeInBackground.ts`, `client/hooks/__tests__/useGenerateRecipeInBackground.test.ts`, the spec's §3 line, and the meal-plan hook if it reuses the constant.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Best decided after PR 3 (Argon) lands, since the model change moves the distribution.

## Risks

- A longer deadline holds the pending flag (and the disabled Generate button) longer when the server is truly gone; 90 s is still bounded.

## Updates

### 2026-10-18

- Initial creation (observed during the PR 1 simulator check, server log 23:58:37 entry).

### 2026-10-18 — orchestrator

- Owner raised the deadline to 90 s. `RECIPE_GENERATION_DEADLINE_MS` is now `90_000`; both the photo hook and the meal-plan hook move together (shared `withDeadline` default).
- TDD: new test "waits out a slow success: a reply at 65 s still lands as a ready recipe" in `useGenerateRecipeInBackground.test.ts` was red at 60 s (listener never called; the abort won) and is green at 90 s. 22 tests pass across the two hook files.
- Two premises in the Summary were wrong, corrected in the hook's doc comment and the spec: the hero image is fire-and-forget AFTER the reply (`fireAndForget` in `server/routes/recipes.ts`), so the pre-reply work is model + normalization + two DB writes; and the server has NO 60 s ceiling: `OPENAI_TIMEOUT_HEAVY_MS` is per attempt, the OpenAI SDK retries a timed-out attempt (default `maxRetries` 2), and `aiChat` then tries the OpenAI fallback with its own budget. No client deadline can rule out the soft path for a hung model; 90 s covers the slow-success case.
- Spec updated at §5 (the 60 s sentence, with the reason) and §8 ("The 90 s client deadline"). The AC's "§3" pointed at the wrong section.
