---
title: "AI/vision services swallow OpenAI/Zod failures and return empty-but-valid results (misleading 200)"
status: backlog
priority: high
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [api, architecture, error-handling, camera]
github_issue:
---

# AI/vision services swallow OpenAI/Zod failures and return empty-but-valid results (misleading 200)

## Summary

Six AI/vision service functions catch OpenAI outages/timeouts and Zod-validation failures and return a structurally-valid **empty** result instead of throwing. The route then ships a misleading HTTP 200, so the client sees "success" and the user sees an empty/zero scan — indistinguishable from a genuine "no food / unreadable label", and in one case a confident **"this isn't food"**.

## Background

Silent-failures audit cluster 1 (`docs/audits/2026-05-28-silent-failures.md`, findings **C1, C2, H1, H2, H3, H4**). The Express _route_ layer was audited route-by-route and is clean — every catch propagates a real 4xx/5xx. The risk lives one layer down in the services. The codebase already demonstrates the correct pattern: `server/services/receipt-analysis.ts:140` and `server/services/menu-analysis.ts:154` **throw** on the same OpenAI-failure condition, so their routes return a real 5xx the user sees. These six functions are an inconsistent application of the team's own pattern, not deliberate graceful degradation. This is the highest-severity cluster and touches the app's camera-first identity (plus health data via label/medication-adjacent flows).

## Acceptance Criteria

- [ ] **C1** `analyzePhoto` (`photo-analysis.ts:531`, +509 Zod) — on OpenAI/Zod failure, throw (or otherwise signal failure) so `/api/photos/analyze` returns a 5xx; the client distinguishes "analysis failed, retry" from "no food found". (Note: the catch's `followUpQuestions:["…try again"]` is currently dead — the client only shows it when `result.needsFollowUp` is truthy, which the error object omits.)
- [ ] **C2** `classifyAndAnalyze` (`photo-analysis.ts:749`, +734 Zod) — stop returning `contentType:"non_food"` on a classification API error; surface a real failure so smart-scan (intent=auto) doesn't tell the user a real food image "isn't food".
- [ ] **H1** `analyzeLabelPhoto` (`photo-analysis.ts:431`, +423 Zod) — stop returning `EMPTY_LABEL_RESULT` on failure; don't create a label session from an all-null extraction.
- [ ] **H2** `analyzeRecipePhoto` (`photo-analysis.ts:352`; note line 344 throws but is self-caught at 352) — propagate failure instead of returning an empty recipe.
- [ ] **H3** `parseNaturalLanguageFood` (`food-nlp.ts:77`, +89 JSON, +94 shape) — distinguish "AI call failed" from "no parseable food"; `/api/food/parse` and `/api/food/transcribe` should signal the failure.
- [ ] **H4** `analyzeFrontLabel` (`front-label-analysis.ts:124`) — propagate failure; don't create a `frontLabelStore` session + spend a slot on an empty extraction.
- [ ] Routes that consume these (`server/routes/photos.ts`, `food.ts`, `verification.ts`) return a 4xx/5xx via `handleRouteError` on failure; client error/retry UX confirmed for each.
- [ ] A genuine empty/unreadable result (real 200) remains distinguishable from a failure (5xx) end-to-end.

## Implementation Notes

- Mirror `receipt-analysis.ts:140` / `menu-analysis.ts:154`: `throw new Error("…")` in the catch instead of returning an empty literal. Let the existing route `handleRouteError` map it to a 5xx.
- Watch the Zod-failure branches separately from the network-catch branches — several functions return empty on _both_ (e.g. label at 423 and 433). Decide whether a Zod-invalid AI response is "retryable failure" (throw) vs "genuinely unreadable" (explicit empty with a flag the client renders). The audit's view: treat it as failure unless there's a deliberate "unreadable" UX.
- `analyzePhoto`'s error object carries a `followUpQuestions` message that never renders — either wire the client to surface it (set `needsFollowUp` on the error path) or drop it and throw. Throwing is simpler and matches the rest.
- These are **camera/health-adjacent and AI** paths — do NOT delegate; review carefully. Add/adjust service unit tests to assert the throw on simulated OpenAI failure.

## Dependencies

- None hard. Independent of the client-side clusters, though fixing these makes the client-side error UX (cluster 2 todo) actually fire for scan flows.

## Risks

- Changing a 200→5xx contract: confirm the client treats the 5xx as a retryable error, not a crash. Each of these flows already has _some_ loading/spinner UI; verify the failure path lands on an error state, not an infinite spinner.
- Don't over-throw: a genuinely empty-but-successful result (e.g. a photo with truly no food) must still 200.

## Updates

### 2026-05-28

- Created from silent-failures audit (themed-by-cluster triage). All 6 findings verified against source; discriminator (`receipt-analysis`/`menu-analysis` throw) confirmed by reading both.
