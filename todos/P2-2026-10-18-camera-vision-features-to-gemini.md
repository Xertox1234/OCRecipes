---
title: "Move the camera / image-reading AI features from gpt-4o to Gemini (eval-gated, one row at a time)"
status: backlog
priority: medium
created: 2026-10-18
updated: 2026-10-18
assignee:
labels: [deferred, ai, camera]
github_issue:
---

# Move the camera / image-reading AI features to Gemini

## Summary

Gemini is the recommended model for the features that **read** images: written or printed recipes, ingredient photos, food photos, nutrition and front labels, receipts and menus (owner 2026-10-18). Nine `vision: true` rows in `server/lib/ai-models.ts` still run on `openai/gpt-4o` or `gpt-4o-mini`, and both retire (OpenAI direct 2027-01-14, Azure-via-OpenRouter 2027-04-14). Move each row to Gemini on google-vertex, but only after a paired eval shows no quality loss.

## Background

The 2026-10-06 routing spec (`docs/superpowers/specs/2026-10-06-openrouter-model-routing-design.md`) already planned "photo scan → `google/gemini-3.8-flash`" (Roboflow Vision Evals: 85.4% overall, 97.9% identification, vs Luna 77.2% / 87.5%). That move was never made. Google Vertex is already a pinned OpenRouter host, so no privacy-policy change is needed. The spec's Google provider row covers photo scanning with "the photo and the scan instructions only". Confirm per service that no profile or health fields go in the prompt.

Lessons from the recipe-generate move (#1496): `gemini-3.8-flash` with default reasoning truncated JSON 10/36 times, and `reasoning_effort: low` fixed it. Gemini does not list `max_completion_tokens` (spec line 102), so check the `adapt` block for each row.

Image **generation** is out of scope. It is Runware only (`todos/P2-2026-10-17-remove-dead-dall-e-image-fallback.md`). Barcode decoding is out of scope too: it runs on the device and makes no AI call.

## Rows in scope (`server/lib/ai-models.ts`)

| Row                        | Today | Service                                                       |
| -------------------------- | ----- | ------------------------------------------------------------- |
| `photo-analyze`            | HEAVY | photo-analysis `analyzePhoto`                                 |
| `photo-classify`           | FAST  | photo-analysis `classifyAndAnalyze`                           |
| `photo-label`              | HEAVY | photo-analysis `analyzeLabelPhoto`                            |
| `photo-recipe`             | HEAVY | photo-analysis `analyzeRecipePhoto` (written/printed recipes) |
| `front-label-scan`         | HEAVY | front-label-analysis `analyzeFrontLabel`                      |
| `receipt-scan`             | HEAVY | receipt-analysis `analyzeReceiptPhotos`                       |
| `menu-scan`                | HEAVY | menu-analysis `analyzeMenuPhoto`                              |
| `cooking-ingredient-photo` | HEAVY | cooking-session `analyzeIngredientPhoto`                      |
| `recipe-chat-image`        | HEAVY | recipe-chat `analyzeImageForRecipe`                           |

The text-only follow-ups (`photo-refine`, `photo-recipe-text`) can move together with their photo row if the eval covers them. Otherwise they stay put.

## Acceptance Criteria

- [ ] Eval coverage first. `evals/datasets/photo-analysis-cases.json` has 12 cases (11 `log`, 1 `identify`) and covers `photo-analyze` only. Add cases (or a small runner) for labels, written recipes, receipts, menus and ingredient photos before moving those rows. Use public-domain or self-shot images only, never user uploads.
- [ ] For each row: a paired eval (`npm run eval:paired`) of gpt-4o vs the Gemini candidate (`gemini-3.8-flash` with `reasoning_effort: low`, plus `gemini-4-argon` where accuracy matters most). Record score, JSON-parse failures, p50 latency and cost in this todo's Updates.
- [ ] Owner approval per row (spec §3.1/§5), then a one-line row edit. Keep a working OpenAI `fallback` until the gpt-4o retirement plan replaces it.
- [ ] `scripts/ai-smoke.ts` passes for every moved row (vision + json shape).
- [ ] The allergen/safety paths that consume scan output (front-label, photo-label) keep their existing fail-closed behaviour. No filter is loosened to fit the new model's output.

## Implementation Notes

- Rows can move one at a time. Start with `photo-analyze`, since its eval suite already exists.
- Watch the OpenRouter workspace daily budget ($5, resets 00:00 UTC). It tripped mid-run on the recipe-chat eval. Run evals with small `EVAL_SAMPLES_PER_CASE` or across days.
- Keep the image-size and detail settings each service sends today, so cost comparisons stay like-for-like.

## Scope Contract

- **Mechanisms to use:** `AI_FEATURES` rows and their `adapt` blocks, the existing eval runners and `eval:paired`, and `scripts/ai-smoke.ts`.
- **Files in scope:** `server/lib/ai-models.ts`, the vision services listed above (only if an `adapt` change cannot express a needed parameter), `evals/datasets/*`, the eval runners, and co-located tests.
- No new provider clients. Everything goes through the existing OpenRouter routing.

## Dependencies

- Part of the gpt-4o retirement migration (memory `project_gpt4o_retirement_2027.md`).

## Updates

### 2026-10-18

- Created after the owner corrected the image todo: Gemini is for reading images (camera features), not generating them.
