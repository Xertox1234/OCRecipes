---
title: "Extend eval framework to cover photo-analysis service"
status: done
priority: medium
created: 2026-05-04
updated: 2026-05-04
assignee:
labels: [deferred, evals]
---

# Extend eval framework to cover photo-analysis service

## Summary

Add LLM-as-Judge evaluation for `server/services/photo-analysis.ts`. This was deferred from the broader eval framework extension (recipe-chat, meal-suggestions, recipe-generation) because it requires real image fixtures rather than plain JSON inputs.

## Background

The eval framework extension session covered recipe-chat, meal-suggestions, and recipe-generation (all text-in/text-out). Photo analysis was explicitly deferred because each test case needs a real food image as input — base64-encoded or URL-referenced — which adds fixture management complexity not present in the other eval suites. When this is tackled, the fixture strategy should be decided first (e.g., checked-in test images in `evals/fixtures/images/`, or a fixture manifest pointing to stable URLs).

## Acceptance Criteria

- [ ] Fixture strategy chosen and documented (checked-in images vs. stable URLs)
- [ ] `evals/datasets/photo-analysis-cases.json` dataset with ≥10 test cases covering: correct food identification, portion estimation, low-confidence follow-up triggering, multi-food scenes, allergen-present foods
- [ ] Hard assertions: `overallConfidence` in expected range, `foods` array non-empty
- [ ] LLM judge rubric: identification accuracy, portion plausibility, confidence calibration
- [ ] Runner integrated into the shared eval entry point alongside other services
- [ ] `npm run eval:photo` script in `package.json`

## Implementation Notes

- `photo-analysis.ts` exports `analyzePhoto(imageBase64, intent, userProfile)` — test cases need to encode images and mock the OpenAI Vision call, OR use real API calls (expensive)
- Consider mocking `openai.chat.completions.create` in tests to return fixture JSON, then evaluating the parsing/validation layer only — saves API cost
- Alternatively, use a small curated set of real API calls with stable public food images
- Integration point: extend `evals/runner.ts` main() to optionally run photo analysis cases when `--suite photo` is passed

## Dependencies

- Eval framework extension for recipe-chat, meal-suggestions, recipe-generation (should be completed first to establish the multi-suite runner pattern)

## Risks

- OpenAI Vision API costs if using real calls per test case
- Image fixture freshness (URLs can 404; checked-in images bloat the repo)

## Updates

### 2026-05-04

- Initial creation — deferred from eval framework extension brainstorm session
