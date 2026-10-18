---
title: "recipe-chat row (coach / RecipeChef recipe cards): run its eval suite against Gemini candidates and pick the gpt-4o replacement"
status: backlog
priority: medium
created: 2026-10-17
updated: 2026-10-17
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
- [ ] Check the output-token cap at `server/services/recipe-chat.ts` ~line 394 (2000) and ~543 (500) against thinking-model behaviour; a Flash candidate without low effort will truncate (see the 2026-10-17 recipe-generate finding).
- [ ] Safety-category cases pass at least as well as the control after excluding the plant-milk / nut-butter regex false positives (todo `P2-2026-10-17-recipe-eval-dairy-regex-plant-milk-false-positives.md` — fix that first if it has not landed).
- [ ] A streamed-latency note: time-to-first-token and total time for one real finder "adjusted" generation on the simulator, so the owner can judge the feel.
- [ ] Owner picks the model; row added to `AI_FEATURES` with a test update in `server/lib/__tests__/ai-models.test.ts` ("switched rows are exactly the approved ones"), `fallback: "gpt-6-luna"`, adapt block as needed.
- [ ] `recipe-chat-image` (vision, same file) is NOT in scope here — it belongs to the vision migration (Gemini for vision, owner 2026-10-17).

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
