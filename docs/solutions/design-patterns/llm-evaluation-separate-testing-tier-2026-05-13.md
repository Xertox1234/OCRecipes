---
title: "LLM evaluation as a separate testing tier (evals/ vs __tests__/)"
track: knowledge
category: design-patterns
tags: [ai, evals, llm, testing, openai, anthropic]
module: server
applies_to: ["evals/**/*.ts", "evals/**/*.json"]
created: 2026-05-13
---

# LLM evaluation as a separate testing tier (evals/ vs **tests**/)

## When this applies

Unit tests (Vitest) verify code correctness. **Evals** verify _output quality_ of AI features. They are fundamentally different and live separately.

## Why

Unit tests are deterministic, fast, free, and gate every commit. Evals are non-deterministic (model variance), slow (API calls), cost money, and run manually. Mixing them blocks every commit on flaky API costs; separating them keeps each tier honest about what it measures.

## Examples

|                 | Unit Tests              | Evals                                   |
| --------------- | ----------------------- | --------------------------------------- |
| **Location**    | `__tests__/` co-located | `evals/` at project root                |
| **Runner**      | `npm run test:run`      | `npm run eval:coach`                    |
| **Speed**       | Milliseconds            | Minutes (API calls)                     |
| **Cost**        | Free                    | ~$0.30/run (OpenAI + Anthropic)         |
| **Pre-commit**  | Yes (blocks commit)     | No (manual runs only)                   |
| **Determinism** | Deterministic           | Non-deterministic (±0.5 score variance) |

## Eval architecture — hybrid approach

1. **Hard assertions** (pass/fail) for safety-critical checks — regex-based `mustContain`/`mustNotContain` and LLM-judged calorie floor checks. A single failure = test case failure.
2. **LLM-as-Judge rubric scoring** (1-10) for quality dimensions — a stronger model (Claude Sonnet 4.6) evaluates the weaker model's (gpt-4o-mini) responses against structured anchors.

```typescript
// evals/datasets/coach-cases.json — test case structure
{
  "id": "personalization-keto-nut-allergy-01",
  "category": "personalization",
  "userMessage": "What are some good snack ideas for me?",
  "context": { /* CoachContext with keto diet + nut allergies */ },
  "assertions": {
    "mustNotContain": ["almond", "cashew", "walnut", "peanut"]
  }
}
```

## When to use

Any AI feature where output quality matters (coach, photo analysis, recipe chat). Run evals before and after prompt changes to measure impact.

## Exceptions

Non-AI features. Don't replace unit tests with evals — they test different things.

## Key lesson

Run-to-run variance of ±0.5 points is normal. Look at trends across 3+ runs, not individual scores.

## Related Files

- `evals/` — framework files (types, assertions, judge, runner, dataset)
- `evals/datasets/coach-cases.json` — example test case structure
- `docs/superpowers/specs/2026-04-13-nutrition-coach-evaluation-design.md` — original spec

## See Also

- [Multi-suite eval framework via `SuiteConfig`](multi-suite-eval-framework-suiteconfig-2026-05-13.md)
- [Promise.allSettled for resilient batch LLM eval runs](promise-allsettled-resilient-batch-llm-2026-05-13.md)
- [Pure schema extraction for eval-runner testability](pure-schema-extraction-eval-runner-2026-05-13.md)
- [Eval dataset validation as unit tests](../best-practices/eval-dataset-validation-as-unit-tests-2026-05-13.md)
- [Eval assertion gotchas (NaN, plurals, NANP, word limits)](../best-practices/eval-assertion-gotchas-2026-05-13.md)
- [Eval dataset field forwarding rules](../conventions/eval-dataset-field-forwarding-rules-2026-05-13.md)
