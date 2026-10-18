---
title: "recipe-chat row (coach / RecipeChef recipe cards): run its eval suite against Gemini candidates and pick the gpt-4o replacement"
status: backlog
priority: medium
created: 2026-10-17
updated: 2026-10-18
assignee:
labels: [deferred, ai, evals]
github_issue:
---

# recipe-chat row: eval Gemini candidates, then switch

## Summary

The coach's and RecipeChef's recipe cards are written by the `recipe-chat` feature (`generateRecipeChatResponse`, streaming, gpt-4o), not by `recipe-generate`. gpt-4o retires (OpenAI direct 2027-01-14, Azure via OpenRouter 2027-04-14). Owner ruling 2026-10-17: handle this row **separately, after its own eval run** — it is NOT part of the recipe-generate → Gemini 4 Argon project. The coach conversation itself stays on GPT-6 Luna (ruling 2026-10-06).

## Background

On 2026-10-17 `recipe-generate` was measured (12 cases ×3, judge sonnet-4.6): Gemini 4 Argon +1.97 creativity vs a same-session gpt-4o control, 0/36 assertion failures, p50 11 s; Gemini 3.8 Flash with `reasoning_effort: low` +1.58, p50 5 s. `recipe-chat` differs in three ways that need their own measurement: it streams (a slow model shows progressively, so latency is felt differently), `checkRecipeAllergens` runs on the streamed text, and the finder builds its messages via `buildFinderGenerationMessages` (fresh / refine / adjusted modes) rather than the recipe-generate system prompt.

## Acceptance Criteria

- [ ] `npm run eval:recipe-chat` run as a same-session gpt-4o control, then with `--candidate "recipe-chat=google/gemini-4-argon"` and `--candidate "recipe-chat=google/gemini-3.8-flash;reasoning_effort=low"`, `EVAL_SAMPLES_PER_CASE=3`, paired via `npm run eval:paired`.
- [x] Check the output-token cap at `server/services/recipe-chat.ts` ~line 394 (2000) and ~543 (500) against thinking-model behaviour; a Flash candidate without low effort will truncate (see the 2026-10-17 recipe-generate finding).
- [x] Safety-category cases pass at least as well as the control after excluding the plant-milk / nut-butter regex false positives (todo `P2-2026-10-17-recipe-eval-dairy-regex-plant-milk-false-positives.md` — fix that first if it has not landed).
- [ ] A streamed-latency note: time-to-first-token and total time for one real finder "adjusted" generation on the simulator, so the owner can judge the feel.
- [ ] Owner picks the model; row added to `AI_FEATURES` with a test update in `server/lib/__tests__/ai-models.test.ts` ("switched rows are exactly the approved ones"), `fallback: "gpt-6-luna"`, adapt block as needed.
- [x] `recipe-chat-image` (vision, same file) is NOT in scope here — it belongs to the vision migration (Gemini for vision, owner 2026-10-17).

## Implementation Notes

- Candidate flag refuses models without a pinned host; Google is pinned (`PINNED_HOSTS.google = "google-vertex"`), Anthropic is not.
- The eval judge is `anthropic/claude-sonnet-4.6` via OpenRouter — no self-preference confound for Gemini candidates.
- Result files are local-only (`evals/results/`); record the paired table in this todo's Updates.

## Scope Contract

- **Mechanisms to use:** the existing eval runner, `--candidate`, `eval:paired`, the `AI_FEATURES` table and its test.
- **Files in scope:** `server/lib/ai-models.ts`, `server/lib/__tests__/ai-models.test.ts`, this todo. No prompt or service edits unless the eval shows a parse/truncation defect, in which case `server/services/recipe-chat.ts` token caps only.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Preferably after `P2-2026-10-17-recipe-eval-dairy-regex-plant-milk-false-positives.md` so the paired gate's "new assertion failures" check is meaningful.
- Independent of the recipe-generate → Argon project.

## Risks

- Streaming + JSON-ish card parsing: confirm the client's card parser tolerates a different model's formatting before switching.

## Updates

### 2026-10-17

- Initial creation (owner: "separately after eval run").

### 2026-10-18 — eval run (Argon done; Flash-low blocked on budget)

**Suite prep first (PR `evals/recipe-chat-suite-prep`):** two runner defects made the suite unfit to decide on: it waited on the Runware hero image per sample (latency measured image generation; 45 images per run) and, when a card parsed, it threw away the model's prose — which is where the allergen callout lives, so the judge's SAFETY dimension never saw one. The dataset's vegan/low-carb/dairy-free patterns were also the naive `milk|butter|cream` forms #1498 fixed only in the recipe-generation set. A first gpt-4o control taken before the prose fix (`recipe-chat-2026-10-18T13-28-57.json`) is not comparable and is not used below.

**Runs** (15 cases × 3 samples, `EVAL_PARALLELISM=4`, judge `anthropic/claude-sonnet-4.6` via OpenRouter, fallback off, 0/45 call violations in each):

|                                                 | gpt-4o control (`13-32-05`)                                                           | Gemini 4 Argon (`13-36-14`)          | Gemini 3.8 Flash low |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ | -------------------- |
| answered by                                     | openai/gpt-4o @ Azure 45/45                                                           | google/gemini-4-argon @ Google 45/45 | —                    |
| recipe card parsed                              | 45/45                                                                                 | 45/45                                | —                    |
| hard-assertion failures                         | 1/45 (peanut-01#1: said "doesn't include peanuts", pattern wants allerg/avoid/cannot) | 0/45                                 | —                    |
| weighted overall                                | 8.21                                                                                  | 8.76                                 | —                    |
| relevance / recipe_quality / dietary_compliance | 8.64 / 8.53 / 9.31                                                                    | 9.16 / 8.96 / 9.71                   | —                    |
| safety / tone                                   | 6.96 / 8.84                                                                           | 7.80 / 9.11                          | —                    |
| latency p50 / p90 / max                         | 3.3 s / 3.9 s / 4.4 s                                                                 | 11.7 s / 13.4 s / 31.5 s             | —                    |
| words p50 / max (warn at 300)                   | 195 / 292                                                                             | 316 / 434                            | —                    |

**Paired (Argon vs control) — PASS.** relevance +0.51 [0.29, 0.78], recipe_quality +0.42 [0.20, 0.64], dietary_compliance +0.40 [0.13, 0.71], safety +0.84 [0.36, 1.42] (bar ≥ −0.25), tone +0.27 [0.13, 0.42]; no new hard-assertion failures, no missing cases.

**Safety cases read by hand (01 peanut, 02 gluten, 12 nut-allergy baking, 15 egg):** Argon names the user's allergy in the prose in 12/12 samples ("since your dietary profile lists a peanut allergy…", "completely nut-free", "completely egg-free") and every ingredient list is clean. gpt-4o names it in 2/12 (only the peanut case, 2 of 3 samples); its nut-allergy cakes and egg-free breakfasts are compliant but never say so. The one Argon sample scored safety 6 (12#1) offers "milk (any kind, dairy or oat)" in a nut-free cupcake — compliant, the judge wanted a cross-contamination note.

**Token cap:** `max_completion_tokens: 2000` in `generateRecipeChatResponse` was not hit — 45/45 Argon samples parsed and the longest is 434 words. No change proposed. The 500 cap at ~line 543 belongs to `recipe-chat-image` (vision), out of scope here.

**Gemini 3.8 Flash (`reasoning_effort=low`) — NOT RUN TO COMPLETION.** The run reached 26/45 samples and then every call returned `403 Workspace daily budget of $5.00 exceeded … resets 2026-10-19T00:00:00.000Z` (`limit_source: openrouter_workspace_budget`). The runner refused to write a report (fail-closed, correct). The key itself has ~$42 of its $50 weekly limit left, so this is the OpenRouter **workspace daily budget** setting. Resume once the budget resets or is raised:

```
NODE_ENV=development EVAL_SAMPLES_PER_CASE=3 EVAL_PARALLELISM=4 npm run eval:recipe-chat -- --candidate "recipe-chat=google/gemini-3.8-flash;reasoning_effort=low"
npm run eval:paired -- --baseline-file evals/results/recipe-chat-2026-10-18T13-32-05.json --candidate-file evals/results/<new file>
```

**Streamed-latency note — PENDING on the same budget.** A scratch script that drives `generateRecipeChatResponse` with a finder `adjusted`-mode message (`buildFinderGenerationMessages`, `allergenDetail: "extended"`) under each model and prints time-to-first-token and time-to-card is written; it needs ~9 OpenRouter calls. The eval already gives time-to-card: gpt-4o p50 3.3 s, Argon p50 11.7 s. For the simulator feel the owner asked for, the row has to run the candidate, so that comes after the pick.

**Owner's call (no switch made):** Argon is better on every dimension and clearly better at saying _why_ a recipe is safe, at ~3.5× the stream time (the client streams, so the user sees prose within a second or two and the card at ~12 s instead of ~3 s). Flash-low is the latency-friendly candidate and is still unmeasured on this row.
