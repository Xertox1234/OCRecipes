---
title: "`Promise.allSettled` for resilient batch LLM eval runs"
track: knowledge
category: design-patterns
tags: [ai, evals, llm, concurrency, error-handling, batch]
module: server
applies_to: ["evals/lib/runner-core.ts", "evals/**/*.ts"]
created: 2026-05-13
---

# `Promise.allSettled` for resilient batch LLM eval runs

## When this applies

Use `Promise.allSettled` (not `Promise.all`) when running multiple concurrent eval cases. A single API timeout or rate-limit error with `Promise.all` aborts the entire run and discards all completed scores. With `Promise.allSettled`, rejected cases produce a score-0 error-result placeholder and the run continues.

## Why

`Promise.all` rejects on the first failure, throwing away every other in-flight result. For long, expensive eval runs (~$0.30/run, minutes per suite), a transient 429 or socket error wastes the entire run. `allSettled` gives per-case status so transient failures degrade gracefully.

## Examples

```typescript
const rawResults = await Promise.allSettled(tasks.map((task) => limit(() => evaluateCase(...))));

for (let i = 0; i < rawResults.length; i++) {
  const raw = rawResults[i];
  if (raw.status === "fulfilled") {
    settled.push(raw.value);
  } else {
    const errorMsg = raw.reason instanceof Error ? raw.reason.message : String(raw.reason);
    console.error(`  ✗ CASE ERRORED: ${tc.id} — ${errorMsg}`);
    settled.push({ /* score-0 placeholder with assertions.passed: false */ });
  }
}
```

## When to use

Any batch operation against an external API (Anthropic, OpenAI) where individual failures should degrade gracefully rather than aborting the batch.

## Related Files

- `evals/lib/runner-core.ts` — `Promise.allSettled` pattern in batch eval runs

## See Also

- [LLM evaluation as a separate testing tier](llm-evaluation-separate-testing-tier-2026-05-13.md)
- [Multi-suite eval framework via `SuiteConfig`](multi-suite-eval-framework-suiteconfig-2026-05-13.md)
