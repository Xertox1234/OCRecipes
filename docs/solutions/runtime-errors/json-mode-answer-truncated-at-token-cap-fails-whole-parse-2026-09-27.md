---
title: "A JSON-mode LLM answer that reaches max_completion_tokens is cut off mid-object and fails the whole parse — measure finish_reason on the longest real input before adding fields"
track: bug
category: runtime-errors
module: server
tags: [ai-prompting, architecture, openai, json-mode, token-budget]
applies_to: [server/services/photo-analysis.ts, server/services/food-nlp.ts, server/services/cooking-session.ts, server/services/**/*.ts]
symptoms: ["A multi-item photo or phrase fails with \"returned invalid data\" while single items work", "finish_reason is \"length\" and usage.completion_tokens equals the cap exactly", "Failures come and go between runs of the same input (the model's length varies)", "Adding a field to the response schema turns an occasional failure into a frequent one"]
created: '2026-09-27'
severity: high
---

# A JSON-mode LLM answer that reaches max_completion_tokens is cut off mid-object and fails the whole parse

## Problem

`response_format: { type: "json_object" }` does not make the model fit its answer into
`max_completion_tokens`. When the answer runs long, it is cut at the cap and the JSON is
unterminated. `JSON.parse` throws, the caller's parser (`parseVisionResponse`,
`validateAiResponse`) reports invalid data, and the **whole** analysis fails. It does not
degrade to fewer items.

Photo analysis logged at a 500-token cap. Live on the 12 eval photos
(`evals/datasets/photo-analysis-cases.json`, 2026-09-27), `main`'s own prompt:

| Run | Result |
|---|---|
| 1 | burger photo 500/500, `finish_reason: "length"` → invalid JSON |
| 2 | burger 461, salad 484, steak 443, all near the cap |
| 3 | steak photo 500/500, `finish_reason: "length"` → invalid JSON |

Adding `grams` and `lookupName` to each food raised the largest answer to 667 tokens.

Quick Log hit the same wall in #1118: 13 items needed 597 tokens against a 500 cap.

## Symptoms

- Multi-item inputs fail while single items work, and the same input fails only some of the
  time.
- `finish_reason === "length"` with `completion_tokens` exactly at the cap.

## Root Cause

A cap sized for typical answers has no headroom for the long tail. Every field added to
each item multiplies across items. JSON mode can only emit a valid document if the budget
lasts to the closing brace.

## Solution

- Raise the cap for food-list prompts. Photo logging and its follow-up refine share
  `LOG_MAX_TOKENS = 1000` (#1129). The cap bounds cost; it does not lengthen typical
  answers.
- Measure before shipping a schema change: run the real prompt on the **longest realistic
  inputs** (multi-food photos, a 10+ item phrase), and read `finish_reason` and
  `usage.completion_tokens`, not just whether the parse succeeded this once. The live probe
  for #1129 replicated `analyzePhoto`'s request so `usage` was visible.

## Prevention

- A change that adds a field to an LLM JSON schema is a token-budget change. Measure the
  largest answer against the cap, and flag any run within ~15% of it.
- A test that mocks the model can't catch this. The failure exists only at the real length.

## Related Files

- `server/services/photo-analysis.ts`: `LOG_MAX_TOKENS`, `getPromptForIntent`, `refineAnalysis`
- `server/services/food-nlp.ts`: Quick Log's cap and its measured per-item cost

## See Also

- [quantity-in-nutrition-lookup-query-does-not-scale-result](../logic-errors/quantity-in-nutrition-lookup-query-does-not-scale-result-2026-09-27.md) — the fields whose addition pushed both prompts over the cap
