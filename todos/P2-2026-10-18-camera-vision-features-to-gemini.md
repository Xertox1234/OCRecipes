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

### 2026-10-19: `photo-analyze` measured (gpt-4o vs Gemini 3.8 Flash, low reasoning)

**Dataset fix first.** The judge never sees the photo. It scores against each case's text `description`. Seven of the 12 descriptions did not match their photo:

| Case             | Problem                                                        |
| ---------------- | -------------------------------------------------------------- |
| steak-09         | The board holds raw meats and sausages, not a grilled steak.   |
| salad-02         | The salad has meat slices in it.                               |
| peanut-butter-07 | The jar is "Protein Choco Crisp", with bread and a drink.      |
| ambiguous-11     | A well-lit plate of grilled shellfish tails, not a dark scene. |
| colorful-12      | Description too thin to check against.                         |
| restaurant-08    | Description too thin to check against.                         |
| sushi-05         | Description too thin to check against.                         |

The dataset has no genuine low-light case now; add one when the label/receipt cases are built.

That mismatch penalised whichever model read the photo correctly: Gemini scored 3/10 for naming the jar's exact label. The first pair of runs is kept locally as `*.INVALID-pre-description-fix.json` and is not comparable.

**Runs:** 12 cases × 3 samples, judged by `anthropic/claude-sonnet-4.6`, with the fallback off and 0 call violations. Result files are gitignored and kept in the main checkout's `evals/results/`.

| Measure                               | gpt-4o (`photo-analysis-2026-10-19T03-09-51`) | Gemini 3.8 Flash, low (`…T03-12-49`) |
| ------------------------------------- | --------------------------------------------- | ------------------------------------ |
| Weighted overall                      | 6.90                                          | 7.76                                 |
| Identification                        | 7.1                                           | 8.1                                  |
| Portion plausibility                  | 6.7                                           | 7.1                                  |
| Confidence calibration                | 6.6                                           | 7.8                                  |
| Hard-assertion / JSON failures        | 0/36                                          | 1/36 (steak-09#3)                    |
| Latency p50 / p90 / max               | 5.2 s / 7.3 s / 7.8 s                         | 8.0 s / 21.0 s / 31.1 s              |
| Cost per call (steak photo, measured) | ~$0.008                                       | ~$0.004                              |
| Host                                  | Azure                                         | Google (vertex)                      |

- **Paired result** (`eval:paired`): quality passes on every dimension. Identification is +0.90 [0.44, 1.36], calibration +1.19 [0.28, 2.25], portions +0.38 [-0.30, 1.10]. The gate reads FAIL only because of the new steak-09 failure.
- **What caused the failure.** I reproduced it on the same request 6 times. 1 of 6 stopped with `finish_reason: length` at 996 tokens, which is cut-off JSON. Healthy Gemini replies used 790–930 tokens against the `LOG_MAX_TOKENS = 1000` cap (`photo-analysis.ts:76`). gpt-4o used 610–690 tokens on the same photo, and reasoning tokens were 0 for both. Gemini writes longer item names, so a move would need a higher cap for this row.
- **Latency is the real trade-off.** In the invalid first run, Gemini also had 3/36 samples at 40 s, 66 s and 68 s. The two above 60 s match the 60 s `OPENAI_TIMEOUT_HEAVY_MS` timeout plus the SDK's automatic retry, so in the app a user would have waited over a minute. gpt-4o's slowest sample across both runs was 8.6 s.
- **Privacy.** `analyzePhoto(imageBase64, intent)` sends only the photo and the scan instructions. No profile or health fields go in the prompt.
- **Argon.** Skipped for this row. "Where accuracy matters most" means the allergen-critical rows (photo-label, front-label).
- **Spend.** $1.41 of today's $5 OpenRouter budget, covering both run pairs, judging and the 9 repro calls.
- **Owner decision needed.** Switch `photo-analyze` to Gemini Flash (low) with a higher token cap for better accuracy at half the cost per call but a slower and spikier wait, or keep gpt-4o for now. No row was switched.

### 2026-10-19: `photo-analyze` switched; the other rows PARKED

- **Owner: "switch to gemini".** `photo-analyze` now runs `google/gemini-3.8-flash` with `adapt: { set: { reasoning_effort: "low" } }`, and the direct-OpenAI fallback stays `gpt-4o`. `LOG_MAX_TOKENS` went from 1000 to 1500, which covers the cut-off reply measured above. `refineAnalysis` shares that cap. `npm run ai:smoke -- photo-analyze` passed: answered by Google `google/gemini-3.8-flash`, 1/1 rows.
- **Owner: "park for now"** for the other 8 rows. Each still needs its own eval cases first, using free-to-use photos and descriptions checked against each photo. Start with photo-label and front-label, since allergen detection depends on them. Resume only when the owner asks.
