---
title: "Move the camera / image-reading AI features from gpt-4o to Gemini (eval-gated, one row at a time)"
status: backlog
priority: medium
created: 2026-10-18
updated: 2026-11-06
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

### 2026-11-05: `front-label-scan` switched to Gemini 3.8 Flash (low reasoning), cap 1300

- **Re-checked with app-sized photos** (1024 px, quality 80), the shipped prompt and the new 1300 cap, 8 cases × 3 samples. Judge: claude-sonnet-4.6.

  | Measure           | gpt-4o (`front-label-2026-11-05T19-27-11`) | Gemini Flash, low (`…T19-26-19`) |
  | ----------------- | ------------------------------------------ | -------------------------------- |
  | Weighted overall  | 8.2                                        | 8.8                              |
  | Field accuracy    | 9.3                                        | 9.6                              |
  | Claims fidelity   | 7.9                                        | 8.7                              |
  | Calibration       | 6.7                                        | 7.5                              |
  | Hard assertions   | 95.8%                                      | 100%                             |
  | Latency avg / max | 3.0 / 4.1 s                                | 3.1 / 8.4 s                      |

- **Paired gate:** claims fidelity +0.83 [0.29, 1.58] and field accuracy +0.33 [-0.17, 0.83] pass. Calibration +0.79 [-0.92, 2.71] reads FAIL on the 8-case interval width only, the same shape as the full-size run. No new hard-assertion failure.
- **Weak spot both share:** the ambiguous multi-carton Oatly frame gets 0.95 confidence from Gemini (calibration 2/10).
- **Change:** the row runs `google/gemini-3.8-flash` with `adapt: { set: { reasoning_effort: "low" } }`, and `analyzeFrontLabel`'s `max_completion_tokens` went from 300 to 1300. `npm run ai:smoke -- front-label-scan` passed: Google answered `google/gemini-3.8-flash`, 1/1 rows.

### 2026-11-05: `photo-label` prompt fixed and switched to Gemini 3.8 Flash (low reasoning), cap 1300

- **Prompt fix (`LABEL_PROMPT`).** The old rules said "Include units (g, mg, mcg, %)" next to a numbers-only JSON template, which explains Argon's `"8g"` strings, and they never covered a row the label does not print. The new rules say a row that is not printed is null and never 0, that a nutrient is a plain number in the unit the app shows (g for macros, mg for cholesterol, sodium and minerals, mcg for vitamin D, as in `client/screens/label-analysis-utils.ts`), and that a vitamin or mineral printed only as a % Daily Value is null.
- **Re-measured with app-sized photos** (1536 px, quality 85) and the new prompt, 6 cases × 3 samples:

  | Measure                | gpt-4o (`label-extraction-2026-11-05T19-55-21`) | Gemini Flash, low (`…T19-56-08`) |
  | ---------------------- | ----------------------------------------------- | -------------------------------- |
  | Weighted overall       | 8.93                                            | 9.01                             |
  | Extraction accuracy    | 9.6                                             | 9.7                              |
  | Null discipline        | 9.1                                             | 9.1 (was 7.9 on the old prompt)  |
  | Confidence calibration | 7.1                                             | 7.4                              |
  | Call errors            | 1/18 (36.6 s provider error)                    | 0/18                             |
  | Latency p50 / max      | 4.7 / 36.6 s                                    | 3.3 / 7.2 s                      |
  | Cost per call          | ~$0.005 (full-size run)                         | ~$0.002                          |

- **Paired gate:** extraction +0.06 passes. Null discipline -0.06 [-2.06, 1.83] and calibration +0.11 [-0.50, 0.67] read FAIL on interval width only; both means are level. No new hard-assertion failure. The prompt fix did not lower gpt-4o (8.91 → 8.93).
- **Remaining weak spots.** Gemini still writes 0 for six unprinted rows on the bilingual carton in 2 of 3 samples. gpt-4o turns % Daily Value-only minerals into amounts on the old-format label in 2 of 3 (calcium 0, iron 10 mg). Both cases score 3–5 for null discipline.
- **Cap.** Gemini's label replies peaked at 405 of 800 tokens (212 reasoning), all `finish_reason: stop`. The cap is now `LABEL_MAX_TOKENS = 1300`, shared by `analyzeLabelPhoto` and the `analyzePhoto` label intent (which already ran on Gemini through `photo-analyze`).
- **Owner: "switch to Gemini".** `npm run ai:smoke -- photo-label` passed: Google answered `google/gemini-3.8-flash`, 1/1 rows.
- **Left:** 6 rows still have no eval cases: `photo-classify`, `photo-recipe`, `receipt-scan`, `menu-scan`, `cooking-ingredient-photo` and `recipe-chat-image`.

### 2026-11-06: `photo-recipe`, `receipt-scan`, `cooking-ingredient-photo`, `photo-classify` measured (no row switched)

- **Run constraints.** The orchestrator said to switch no row; this run built eval suites and measured. `server/lib/ai-models.ts` is unchanged. Judge `anthropic/claude-sonnet-4.6`, fallback off, 3 samples per case, candidate `google/gemini-3.8-flash` with `reasoning_effort: low`, 0 call violations. Result files are gitignored (`evals/results/`). Earlier runs with dataset or assertion defects are kept locally as `*.INVALID-*.json`.
- **New suites** (Wikimedia Commons public-domain/CC files, plus Unsplash photos already used by the photo-analysis suite; no user uploads; each `description` transcribes what is in the picture, checked against the pixels and, for receipts and cards, at 2x zoom): `npm run eval:recipe-photo` (7 cases), `eval:receipt` (6), `eval:ingredient-photo` (5), `eval:photo-classify` (14).
- **App-sized images.** Each runner sizes the photo like the screen's upload (inline `maxEdge`/`quality` at the call site, as the label runners do, with the client function named in a comment): `photo-recipe` 1536 px / quality 85 (`uploadRecipePhotoForAnalysis`), `receipt-scan` 1536 / 85 (`useReceiptScan`), `cooking-ingredient-photo` 1536 / 85 (`useAddCookPhoto`), `photo-classify` 1024 / 70 (`uploadPhotoForAnalysis` calls `compressImage(uri)` with the defaults in `client/lib/image-compression.ts`). `fetch-image.ts` now also applies the EXIF orientation (the app's image manipulator does; phone photos otherwise arrive sideways) and retries a Wikimedia 429 for longer.
- **Like-for-like.** Each runner calls the service, so it sends what the service sends: `analyzeRecipePhoto` detail high, cap 2000; `analyzeReceiptPhotos` detail high, cap 4096; `analyzeIngredientPhoto` detail high for a first photo, cap 1000; `classifyPhoto` detail low, cap 150.
- **Privacy.** `analyzeRecipePhoto`, `analyzeReceiptPhotos`, `analyzeIngredientPhoto` and the classification call take only the image(s) (plus a mime type and photo count). No profile or health fields go in those prompts.
- **Two rows not measured.** `menu-scan`: `analyzeMenuPhoto(image, userId)` reads the user's goals, diet, allergies and dislikes from storage and puts them in the prompt, so it needs a database and sends health data; not eval-safe here. `recipe-chat-image`: `POST /api/chat/conversations/:id/upload-image` has no caller in `client/` or `shared/` (grep for `upload-image`), so there is no app upload bound and the row serves no screen. The owner may want to drop the endpoint rather than move the row.
- **Service change (out of contract, for the `photo-classify` eval).** `classifyAndAnalyze`'s step 1 is now an exported `classifyPhoto` (behaviour unchanged, test added). Without it the eval also ran the follow-on analysis rows, and a failure there threw away a good classification (first attempt, kept locally as `*.INVALID-step2-failures-and-429.json`).

**`photo-recipe`** (7 cards and pages x 3; gpt-4o `recipe-photo-2026-11-06T00-35-30`, Gemini `…T00-40-21`):

| Measure                  | gpt-4o             | Gemini 3.8 Flash, low |
| ------------------------ | ------------------ | --------------------- |
| Weighted overall         | 3.99               | 4.31                  |
| Ingredient fidelity      | 4.9                | 5.2                   |
| Method fidelity          | 4.5                | 3.5                   |
| Confidence calibration   | 1.1                | 4.0                   |
| Parse / call failures    | 0/21               | 0/21                  |
| Hard-assertion pass rate | 85.7%              | 85.7%                 |
| Latency p50 / p90 / max  | 6.7 / 9.2 / 10.5 s | 6.9 / 9.0 / 13.3 s    |
| Cost per call (measured) | ~$0.0079           | ~$0.0038              |

- **Paired gate:** calibration +2.95 [1.10, 4.90] pass; ingredient fidelity +0.33 [-1.10, 2.43] and method fidelity -1.00 [-3.10, 0.95] read FAIL on interval width (7 cases). No new hard-assertion failure.
- **What both models get wrong.** Both invent servings and a prep time on every card that prints none (the prompt's JSON example shows `servings: 4`, `prepTimeMinutes: 15`), and both guess the flour quantity on the card where it is missing. gpt-4o reports confidence 1.0 on every card, handwritten or faded. Gemini reads quantities better (gingerbread ingredients 8.7 vs 2.7: gpt-4o turned 2 1/2 c flour into 2 2/3) but writes more into the method: on the card with no oven temperature it added 350F, a 30 to 35 minute bake and a toothpick test (method fidelity 1.0).
- **Token cap.** Gemini replies peaked at 997 of 2000 tokens (reasoning 389 at most); every call ended `stop`. gpt-4o peaked at 711.
- **Takeaway.** Same accuracy within noise, half the cost, much better calibrated, but neither model is trustworthy on printed-versus-invented fields. A prompt fix ("servings and times are null unless the page prints them; a missing quantity is null") should come before any row move, as it did for `photo-label`. **Owner decision:** let me try that prompt fix and re-measure both models, or leave `photo-recipe` on gpt-4o for now.

**`receipt-scan`** (6 receipts x 3; gpt-4o `receipt-scan-2026-11-06T01-06-07`, Gemini `…T01-09-29`):

| Measure                  | gpt-4o            | Gemini 3.8 Flash, low                     |
| ------------------------ | ----------------- | ----------------------------------------- |
| Weighted overall         | 6.43              | 8.85 (12 of 18 samples scored)            |
| Item decoding            | 4.8               | 9.2                                       |
| Food classification      | 8.5               | 10.0                                      |
| Confidence calibration   | 5.5               | 5.9                                       |
| Parse / call failures    | 0/18              | **6/18 (2 receipts, all 3 samples each)** |
| Hard-assertion pass rate | 50.0%             | 66.7% (failures count as misses)          |
| Latency p50 / p90 / max  | 8.3 / 9.2 / 9.8 s | 5.8 / 7.1 / 7.2 s                         |
| Cost per call (measured) | ~$0.0102          | ~$0.0041                                  |

- **Gemini fails the whole receipt when it has a non-food line.** It writes `estimatedShelfLifeDays: null` for lines it marks `isFood: false` (napkins, straws, plates, balloons, tissues, detergent), and `receiptItemSchema` requires an integer, so `analyzeReceiptPhotos` throws "Receipt analysis returned unexpected data" before it drops the non-food lines. I reproduced it on the Alexander's receipt (27 lines, 6 nulls on exactly the 6 non-food lines, twice) and it also fails the Walmart receipt with voided entries. Most real grocery receipts have a non-food line. **The Vertex backup route runs Gemini on this row today, so it has the same failure whenever it fires.** The fix is a one-line schema change (`estimatedShelfLifeDays` nullish, like `unit`); I did not make it here.
- **Paired gate** (the 4 receipts Gemini returned): item decoding +2.92 [1.33, 4.50] and food classification +0.17 [0.00, 0.50] pass; calibration -0.33 [-0.75, 0.00] reads FAIL (4 cases). No new hard-assertion failure among them.
- **gpt-4o's weak spots.** On the 28-line Alexander's receipt it returns 8 to 10 items and hallucinates names (cherry fruit snacks became "Snack Fries Chaya"); it drops 2 of 7 lines on the voided-entries receipt and invents "Greek Yogurt" and "German Lentils" on the Vienna receipt. Both models report 0.85 to 0.95 confidence on crumpled or faded receipts (calibration 3 to 6).
- **Food-only output.** The service drops every line the model flags non-food, so the suite checks that non-food products are absent from the result (the first runs asserted `isFood=false` on the returned items, which can never appear; they are invalidated).
- **Token cap.** Gemini's largest successful reply was 949 of 4096 tokens; the failing 27-line receipt used about 2430, with no reasoning tokens.
- **Takeaway.** On the receipts Gemini returns it is far better and 60% cheaper, but with the current schema it throws on any receipt with a non-food line. **Owner decision:** approve the `estimatedShelfLifeDays` nullish fix (then I re-measure) before moving the row; it also repairs the backup route.

**`cooking-ingredient-photo`** (5 photos x 3; gpt-4o `ingredient-photo-2026-11-06T01-23-07`, Gemini `…T00-49-17`):

| Measure                  | gpt-4o                | Gemini 3.8 Flash, low |
| ------------------------ | --------------------- | --------------------- |
| Weighted overall         | 6.81                  | 8.12                  |
| Item identification      | 8.0                   | 9.0                   |
| Quantity plausibility    | 5.9                   | 6.9                   |
| Confidence calibration   | 5.4                   | 7.5                   |
| Parse / call failures    | 2/15 (Azure 502, 504) | 0/15                  |
| Hard-assertion pass rate | 66.7%                 | 100%                  |
| Latency p50 / p90 / max  | 6.2 / 6.7 / 7.3 s     | 4.7 / 7.1 / 8.3 s     |
| Cost per call (measured) | ~$0.0065              | ~$0.0026              |

- An earlier gpt-4o run (`…T00-46-26`, overlapped with other runs) had 3/15 "Request timed out" errors and scored 6.92; the sequential re-run still had 2/15 Azure errors, so these are provider failures, not load from my runs.
- **Paired gate** (vs the sequential baseline): calibration +2.13 [1.40, 2.87], quantity +1.10 [0.17, 2.07] and identification +0.80 [-0.33, 2.07] all pass. No new hard-assertion failure. gpt-4o missed the carrot end in the vegetable-board photo 3 of 3 times and scored 5.0 on the herb-and-pepper plate.
- **Token cap.** Gemini replies peaked at 546 of 1000 tokens (reasoning 263 at most), all `stop`.
- **Takeaway.** Better on all three dimensions, 60% cheaper, slightly lower p50. **Owner decision:** switch `cooking-ingredient-photo` to `google/gemini-3.8-flash` + `reasoning_effort: low`, keeping the 1000 cap (about 45% headroom) or raising it to be safe. The measurements favour switching.

**`photo-classify`** (14 pictures x 3, classification call alone; gpt-4o-mini `photo-classify-2026-11-06T01-13-11`, Gemini `…T01-16-49`):

| Measure                  | gpt-4o-mini       | Gemini 3.8 Flash, low              |
| ------------------------ | ----------------- | ---------------------------------- |
| Weighted overall         | 9.92              | 9.85 (36 of 42 samples scored)     |
| Classification accuracy  | 10.0              | 10.0                               |
| Confidence calibration   | 9.7               | 9.4                                |
| Parse / call failures    | 0/42              | **6/42** (`finish_reason: length`) |
| Hard-assertion pass rate | 100%              | 85.7% (failures count as misses)   |
| Latency p50 / p90 / max  | 2.4 / 2.8 / 3.1 s | 2.5 / 3.4 / 4.6 s                  |
| Cost per call (measured) | ~$0.0005          | ~$0.0008                           |

- **Token-cap hazard.** With the shipped `max_completion_tokens: 150`, Gemini low spends the cap on reasoning: on the bilingual carton photo 9 of 10 direct probes ended `length` at 143 to 146 of 150 tokens (140 to 145 of them reasoning) and failed to parse (6 of 42 in the eval). At a 600 cap, 10 of 10 parsed (largest reply 430 tokens, 387 reasoning). A move needs a cap of 1000 or more.
- **Paired gate:** accuracy 0.00 [0.00, 0.00] and calibration -0.19 [-0.48, 0.00] pass; the 4 "new hard-assertion failures" are the length-truncated samples. gpt-4o-mini classified all 14 pictures correctly in all 3 samples, including the partial menu, the faded 1994 receipt, the hotel bar bill and the blurred EAN-13 (read exactly).
- **Takeaway.** No accuracy gain to buy: gpt-4o-mini is already perfect on this set, cheaper and as fast. **Owner decision:** keep `photo-classify` on gpt-4o-mini until the gpt-4o family retires, or switch with a cap of at least 1000 (cost rises about 60%, still under a tenth of a cent).
- **Not measured:** multi-photo receipts (the screen sends 1 to 3), `menu-scan`, `recipe-chat-image` (above), a default-reasoning Gemini run, `gemini-4-argon`.
- **Spend.** About $3.1 of today's OpenRouter budget (all runs, judge calls, probes and the invalidated runs).

### 2026-11-06: owner decisions and switches

- **Owner rulings (2026-11-06):** switch `cooking-ingredient-photo` and `photo-classify` to Gemini 3.8 Flash (low reasoning), raise the `photo-classify` reply cap 150 to 1000; approve the `receipt-scan` null-shelf-life fix and re-measure; fix the `photo-recipe` prompt and re-measure without switching.
- **Switched:** `cooking-ingredient-photo` (keeps its 1000 cap, peak 546 tokens measured) and `photo-classify` (`classifyPhoto` cap 1000) now run `google/gemini-3.8-flash` with `adapt: { set: { reasoning_effort: "low" } }` and the Vertex backup, like `photo-label` and `front-label-scan`. `npm run ai:smoke -- cooking-ingredient-photo` and `-- photo-classify` each passed 1/1: Google answered `google/gemini-3.8-flash`. Measurements are in the 2026-11-06 entry above.
- **`receipt-scan` fix:** `estimatedShelfLifeDays` is now `absentAsUndefined(...)` like `unit`, so a null on a non-food line no longer fails the receipt (test first). The service drops non-food lines as before; a food line with no estimate gets 7 days (the review screen's own default), so `ReceiptAnalysisResult` still carries a number and `/api/receipt/confirm` is unchanged.

**`receipt-scan` re-measured** (6 receipts x 3, judge claude-sonnet-4.6, fallback off; gpt-4o `receipt-scan-2026-11-06T01-39-28`, Gemini Flash low `…T01-43-48`):

| Measure                  | gpt-4o              | Gemini 3.8 Flash, low              |
| ------------------------ | ------------------- | ---------------------------------- |
| Weighted overall         | 6.14                | 8.46 (17 of 18 samples scored)     |
| Item decoding            | 4.56                | 8.76                               |
| Food classification      | 8.11                | 9.53                               |
| Confidence calibration   | 5.39                | 5.71                               |
| Parse / call failures    | 0/18                | **1/18** (Walmart weighed-bananas) |
| Hard-assertion pass rate | 50.0%               | 94.4%                              |
| Latency p50 / p90 / max  | 8.7 / 10.1 / 10.5 s | 6.6 / 14.1 / 23.9 s                |
| Cost per call (measured) | ~$0.0102            | ~$0.0052                           |

- **Null fix worked:** the 6 failures of the first run are gone (Alexander's and the voided-entries Walmart receipt now parse).
- **Paired gate** (`eval:paired`, 6 cases): item decoding +4.22 [2.83, 5.67], food classification +1.44 [0.22, 3.44] and calibration +0.42 [-0.22, 0.97] all pass; no new hard-assertion failure.
- **Not switched.** The ruling needed 0 parse failures. One sample failed: Gemini wrote `category: "deli"`, which is not in the enum, and the strict schema rejected the whole receipt (the same shape of bug as the null shelf life; the Vertex backup route has it too). A fix would map unknown categories to `other`; I did not make it, as it was not authorized. **Owner decision:** approve that fix (then one more re-run), or leave the row on gpt-4o.
- Gemini's largest reply was 2443 of 4096 tokens (no reasoning tokens on the receipt rows earlier; not re-checked per sample).

**`photo-recipe`** (prompt fix: servings, prep and cook time, oven temperature and ingredient quantities are null unless printed; example values removed from the JSON template; a unit test asserts the rule):

- **Not conclusive: the OpenRouter workspace ran out of credits mid-run.** The gpt-4o run (`recipe-photo-2026-11-06T01-50-14`) scored 18 of 21 samples (1 timeout, 2-3 HTTP 402 credit errors); the first Gemini run had 14 of 21 samples fail with 402, and a retry failed 20 of 21. All three are kept locally as `*.INVALID-*.json`. Nothing was switched.
- Partial gpt-4o numbers with the new prompt (18 samples; old prompt in brackets): overall 6.40 [3.99], ingredient fidelity 7.33 [4.9], method fidelity 7.83 [4.5], calibration 1.67 [1.1]. Hard-assertion rate 85.7% (the 3 failures are the errors above). Gemini's 7 scored samples from the first run: overall 8.29, ingredient 9.14, method 9.0, calibration 5.14 (not comparable: 7 samples, some cases only 1).
- **Next:** after the budget resets, re-run both models on `npm run eval:recipe-photo` (3 samples, with `--candidate "photo-recipe=google/gemini-3.8-flash;reasoning_effort=low"` for Gemini), then decide the row. Calibration of gpt-4o is still near 1.7: it reports 1.0 on every card.
- **Spend:** about $1.0 of today's OpenRouter budget this session (daily usage went 3.12 to 4.14 plus the retry).
- **Still open:** `menu-scan` and `recipe-chat-image` remain unmeasured.

### 2026-11-06: receipt category normalised; receipt-scan and photo-recipe re-measures still to run

- **Fix (orchestrator, same branch).** The one Gemini receipt failure above was `category: "deli"`, outside the enum, which failed the whole receipt — the same shape as the shelf-life null, and live today on the Vertex backup route. `receiptItemSchema.category` now trims and lowercases the value and files anything still unknown (or missing) under `"other"` instead of rejecting the item. Tests: unknown → other, `" Produce "` → produce, null/undefined/number → other.
- **Still to do (owner ruling 2026-11-06: switch receipt-scan only if Gemini wins with 0 failures).** Re-measure receipt-scan on Gemini after the fix, and re-run photo-recipe on both models with the new prompt; both blocked on the OpenRouter budget (HTTP 402 mid-run on 2026-11-06).
