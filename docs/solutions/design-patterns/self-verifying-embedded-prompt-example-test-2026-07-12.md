---
title: Self-verifying embedded-example test — parse the prompt constant through the real parser and schema
track: knowledge
category: design-patterns
tags: [prompt-engineering, testing, llm-output-format, schema-validation, coach-blocks]
module: server
applies_to: ["server/services/coach-blocks.ts", "server/services/**/*.ts"]
created: 2026-07-12
---

# Self-verifying embedded-example test — parse the prompt constant through the real parser and schema

## When this applies

A system-prompt constant embeds a complete format example (a fenced JSON block, a structured response template) that production code later parses and schema-validates — and the validator drops malformed output **silently** (log-and-skip), so format drift is an invisible feature failure rather than an error.

## Examples

`BLOCKS_SYSTEM_PROMPT` embeds an example `coach_blocks` fence; `parseBlocksFromContent` + `validateBlocks` (Zod `coachBlockSchema`) parse model output and debug-drop anything malformed. The pattern: run the REAL pipeline over the prompt constant itself —

```typescript
it("BLOCKS_SYSTEM_PROMPT contains a complete example whose blocks survive schema validation", () => {
  const { blocks } = parseBlocksFromContent(BLOCKS_SYSTEM_PROMPT);
  expect(blocks.length).toBeGreaterThanOrEqual(1);
  expect(blocks.some((b) => b.type === "quick_replies")).toBe(true);
});
```

Now any schema change (renamed field, new required key) or careless prompt edit turns the invisible drift into a red test. Models copy formatting from examples far more reliably than from schema descriptions, so the example IS the de-facto contract — pin it to the real schema.

A second assertion can pin instruction coherence the same way (e.g. the test that the prompt no longer contains contradictory "always include X" / "don't force X" rules).

## Exceptions

Prompt examples that nothing parses (pure prose few-shots) have no schema to drift from — don't manufacture one.

## Related Files

- `server/services/coach-blocks.ts` — `BLOCKS_SYSTEM_PROMPT` with embedded example; `parseBlocksFromContent`, `validateBlocks`
- `server/services/__tests__/coach-blocks.test.ts` — the self-verifying test

## See Also

- [../conventions/tier-variant-prompt-lines-static-and-hashed-2026-07-12.md](../conventions/tier-variant-prompt-lines-static-and-hashed-2026-07-12.md) — companion prompt-integrity rule from the same session
