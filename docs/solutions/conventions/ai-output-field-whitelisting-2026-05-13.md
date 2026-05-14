---
title: "AI output field whitelisting (Zod enum, never z.string)"
track: knowledge
category: conventions
tags: [security, ai-safety, zod, structured-output, allowlist]
module: server
applies_to: ["shared/schemas/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# AI output field whitelisting (Zod enum, never z.string)

## Rule

When AI models generate structured data containing navigation targets, screen names, or other parameterized commands, constrain the values to a Zod enum whitelist — never use `z.string()`.

## Examples

```typescript
// ❌ BAD — AI can specify any screen, including admin/settings
const navigateActionSchema = z.object({
  type: z.literal("navigate"),
  screen: z.string(), // unbounded — AI could emit "AdminPanel"
});

// ✅ GOOD — constrained to safe screens
const NAVIGABLE_SCREENS = [
  "NutritionDetail",
  "FeaturedRecipeDetail",
  "QuickLog",
  "RecipeBrowserModal",
] as const;

const navigateActionSchema = z.object({
  type: z.literal("navigate"),
  screen: z.enum(NAVIGABLE_SCREENS),
});
```

## When to use

Any Zod schema for AI-generated structured output that references app screens, API endpoints, storage keys, or other internal identifiers.

## Why

Without a whitelist, the AI model can suggest navigation to any screen. If navigation actions are wired up without validation, this could expose admin, settings, or onboarding screens to unintended access.

## Related Files

- `shared/schemas/coach-blocks.ts` — `navigateActionSchema` with `NAVIGABLE_SCREENS` enum
- `server/services/coach-blocks.ts` — `validateBlocks()` drops blocks that fail schema validation
- Origin: Coach Pro code review (2026-04-10) — caught as Important finding (I2)

## See Also

- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Sanitize AI-generated content before storage](sanitize-ai-generated-content-before-storage-2026-05-13.md)
