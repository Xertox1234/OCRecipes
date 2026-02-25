---
title: "Replace z.any() with proper schema in recipe generation"
status: pending
priority: p1
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, security, validation, recipes]
---

# Replace z.any() with proper schema in recipe generation

## Summary

`z.array(z.any())` in `server/services/recipe-generation.ts` completely disables Zod validation for recipe instruction array elements, allowing malformed AI responses to pass through.

## Background

Found by: kieran-typescript-reviewer (C3)

The recipe content schema uses `z.union([z.string(), z.array(z.any())])` for the instructions field. The `z.any()` means any value in the array passes validation — nested arrays, numbers, booleans all get silently `JSON.stringify`'d into the instructions string.

**File:** `server/services/recipe-generation.ts`, line 12

## Acceptance Criteria

- [ ] `z.any()` replaced with a proper schema for instruction items
- [ ] Schema handles both string arrays and object arrays (with text/instruction/description fields)
- [ ] Malformed AI responses are caught by validation instead of silently passing

## Implementation Notes

```typescript
const instructionItemSchema = z.union([
  z.string(),
  z.object({
    text: z.string().optional(),
    instruction: z.string().optional(),
    description: z.string().optional(),
  }).passthrough(),
]);
```

Also add try/catch around JSON.parse on line 144 — if OpenAI returns malformed JSON, it throws before safeParse is reached (found by H4).

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
