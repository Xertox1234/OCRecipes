---
title: "Move the camera / image-reading AI features from gpt-4o to Gemini (eval-gated, one row at a time)"
status: backlog
priority: medium
created: 2026-10-18
updated: 2026-11-05
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

### 2026-11-05: RESUMED; `photo-label` and `front-label-scan` measured (no row switched)

- **Owner: "resume now"** (typed in the orchestrating session on 2026-11-05) lifts the 2026-10-19 park. Per-row approval still holds: this run built eval cases and measured, and **changed no row in `server/lib/ai-models.ts`**.
- **New eval suites.** `npm run eval:label` (6 cases, `evals/datasets/label-extraction-cases.json`, runner `evals/runner-label-extraction.ts`) and `npm run eval:front-label` (8 cases, `evals/datasets/front-label-cases.json`, runner `evals/runner-front-label.ts`). Images are Wikimedia Commons public-domain/CC files (FDA sample panels, Supplement Facts, phone photos of real packs); no user uploads. Each case's `description` lists what is printed, checked against the pixels (and the full-size photo where a detail was in doubt), plus `mustContain`/`mustNotContain` patterns for the key numbers. Images are converted to JPEG with sharp before sending, as the app uploads. Judge: `anthropic/claude-sonnet-4.6`. 3 samples per case, fallback off, 0 call violations.
- **Dataset fixes before the final runs** (earlier runs kept locally as `*.INVALID-*.json`, not comparable): the judge read confidence 1.0 as "lowest possible" (rubric now states the 0-1 scale); my `allin` assertions rejected a correct Hebrew `60 גרם` and the spelling `all in`; the Pringles description missed a 'Suitable for vegetarians' badge on the turned can that Argon read correctly.

**`photo-label`** (6 cases x 3; current cap `max_completion_tokens: 800`, detail high):

| Measure                  | gpt-4o (`label-extraction-…T17-58-31`) | Gemini 3.8 Flash, low (`…T17-59-22`) | Argon (`…T18-00-49`) |
| ------------------------ | -------------------------------------- | ------------------------------------ | -------------------- |
| Weighted overall         | 8.91                                   | 8.39                                 | 8.40                 |
| Extraction accuracy      | 9.59                                   | 9.50                                 | 9.67                 |
| Null discipline          | 9.12                                   | 7.89                                 | 7.92                 |
| Confidence calibration   | 7.12                                   | 7.17                                 | 6.83                 |
| Parse / call failures    | 1/18 (Azure error)                     | 0/18                                 | 6/18 invalid data    |
| Latency p50 / p90 / max  | 5.0 / 5.7 / 43.2 s                     | 3.0 / 3.4 / 4.0 s                    | 6.8 / 7.9 / 8.3 s    |
| Cost per call (measured) | ~$0.0051                               | ~$0.0020                             | ~$0.0054             |

- **Paired gate** (`eval:paired`, gpt-4o baseline): Gemini FAIL on null discipline (-0.97 [-3.25, 0.31]) and calibration (CI too wide on 6 cases); extraction accuracy equal (0.00). No new hard-assertion failure for Gemini. Argon FAIL, with new hard-assertion failures only because of the parse errors.
- **Why Gemini loses on null discipline.** It writes `0` for rows the label does not list (saturated fat, trans fat, cholesterol, fiber, calcium, iron on the bilingual carton photo: 2.3/10 vs gpt-4o 9.0) and on the old-format panel copies a percent daily value into calcium/iron. gpt-4o does the second one too (old-format case 4.5/10 for gpt-4o vs 5.0 for Gemini). Both models report 0.85-0.9 confidence on the crumpled, cut-off wrapper (calibration 2.0 and 3.0), which is the miscalibration the allergen-adjacent paths should not trust.
- **Why Argon fails.** It returns numeric fields as strings ("8g") in 6 of 18 calls, so the existing strict `labelExtractionSchema` rejects them (fail-closed, correctly). Argon would need a prompt or schema-coercion change; not worth it, since it is also slowest and the same price as gpt-4o.
- **Takeaway.** Same reading accuracy, 40% lower latency, 60% lower cost, but a real regression in null discipline (invented zeros). A move needs a prompt tweak first ("never write 0 for a row that is not printed") and a re-run, and the nutrition values are what a user logs. Nothing was switched.

**`front-label-scan`** (8 cases x 3; current cap `max_completion_tokens: 300`, detail low):

| Measure                  | gpt-4o (`front-label-…T18-18-25`) | Gemini low, cap 300 (`…T18-19-30`) | Gemini low, cap 1300 (`…T18-20-43`) | Argon (`…T18-22-25`) |
| ------------------------ | --------------------------------- | ---------------------------------- | ----------------------------------- | -------------------- |
| Weighted overall         | 7.83                              | 8.92                               | 8.86                                | 8.95                 |
| Field accuracy           | 8.77                              | 9.71                               | 9.71                                | 9.92                 |
| Claims fidelity          | 7.55                              | 8.71                               | 8.67                                | 8.96                 |
| Confidence calibration   | 6.50                              | 7.75                               | 7.54                                | 7.00                 |
| Parse / call failures    | 2/24 (Azure errors)               | 0/24 this run (see below)          | 0/24                                | 0/24                 |
| Hard-assertion pass rate | 83%                               | 100%                               | 100%                                | 100%                 |
| Latency p50 / p90 / max  | 3.1 / 3.4 / 3.8 s                 | 2.6 / 4.3 / 4.6 s                  | 2.7 / 4.4 / 9.5 s                   | 5.7 / 10.8 / 18.2 s  |
| Cost per call (measured) | ~$0.00164                         | ~$0.00085                          | ~$0.00081                           | ~$0.00228            |

- **Paired gate vs gpt-4o:** claims fidelity +0.96 [0.50, 1.67] and field accuracy +0.83 [0.13, 1.79] pass for Gemini (cap 300); calibration +1.12 with CI [-0.96, 3.67] reads FAIL only on the 8-case interval width. Same shape for cap 1300 and Argon (+1.21 claims, +1.04 fields). No new hard-assertion failure for any candidate.
- **gpt-4o's weak spots.** It invented a net weight for the Marmite jar in 2 of 3 samples in the final run (`225g`; the small print is illegible even at 3369 px, so this is product knowledge, against "do not infer") and reads the unbranded jar with confidence 0.85-0.95 (calibration 1.0).
- **Token-cap hazard (the one real risk).** With the shipped `max_completion_tokens: 300`, Gemini low on the Pringles photo hit `finish_reason: length` at 293 of 300 tokens (249 of them reasoning) and failed to parse. It happened in 2 of 72 default-cap Gemini eval samples and 1 of 25 direct probes on that photo; reasoning reached 225 of 300 in a clean run. At a 1300 cap, 64 of 64 samples across the 3-sample and 5-sample runs parsed (max 437 completion tokens, 364 reasoning). Any switch must raise this row's cap (the backup leg already adds `VERTEX_BACKUP_REASONING_HEADROOM` = 1000, the OpenRouter-primary leg does not).
- **Argon** is the best scorer on claims and field accuracy but is 2x the cost and ~2x the latency (p90 10.8 s, max 18.2 s) for +0.2 over Gemini, and the gap is inside the noise.
- **Consumers.** `analyzeFrontLabel` output is stored as product verification data (brand, name, net weight, claims) through `server/routes/verification.ts`; `analyzeLabelPhoto` feeds the nutrition-label scan in `server/routes/photos.ts`. Neither measurement touched an allergen filter, and no filter was changed. Claims fidelity (only printed claims) is the dimension that matters most for the stored data, and Gemini scored higher than gpt-4o on it.
- **Spend.** About $2.94 of today's $5 OpenRouter budget for the whole session (all runs, judge calls and 40 direct probes, including the 8 invalidated runs).
- **Owner decisions needed (one each, per row).** (1) `front-label-scan`: switch to `google/gemini-3.8-flash` + `reasoning_effort: low` with the cap raised to 1300, or keep gpt-4o. The measurements favour switching. (2) `photo-label`: keep gpt-4o for now, or let me try a prompt fix for the invented zeros and re-measure first. No row was switched; the other 7 rows still have no eval cases.

### 2026-11-05: owner decisions; eval photos now sized like the app's uploads

- **Owner: switch `front-label-scan`** to Gemini 3.8 Flash (low reasoning) with the cap raised to 1300. **Owner: try a prompt fix for `photo-label`** (no invented zeros), then re-measure.
- **Caveat on the tables above (review of #1755).** Those runs sent each Wikimedia photo at full size (up to 3369 px) at JPEG quality 90. The app shrinks a scan before upload: up to 1536 px at quality 0.85 for nutrition labels (`uploadLabelForAnalysis`), and up to 1024 px at 0.8 for package fronts (`uploadFrontLabelPhoto`), both in `client/lib/photo-upload.ts`. Every model got the same images, so the comparisons hold, but the absolute scores and per-call costs overstate what the app sees, mostly for `photo-label` (`detail: high`). `evals/lib/fetch-image.ts` now applies each path's bound and quality. The app's extra quality step-down for files over its `targetSizeKB` is not reproduced. The follow-up runs use the app-sized photos.
