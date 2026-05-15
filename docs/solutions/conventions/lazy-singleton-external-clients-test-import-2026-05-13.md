---
title: "Lazy-singleton external service clients so tests can import the module"
track: knowledge
category: conventions
tags:
  [
    testing,
    openai,
    external-clients,
    module-loading,
    vitest,
    lazy-initialization,
  ]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
---

# Lazy-singleton external service clients so tests can import the module

## Rule

Never instantiate external service clients (OpenAI, Stripe, AWS SDK, Anthropic, etc.) at module scope in any server-side file that exports functions a test might import. Use a lazy getter function instead.

## Smell patterns

- `const openai = new OpenAI({ apiKey: process.env.X })` at the top of `server/services/<anything>.ts`.
- Tests crashing on `import` before they ever execute, with an env-var-missing or constructor error.
- Pure helper functions in the same file are technically testable but unreachable because the module import itself fails.

## Why

Module-scope client instantiation runs the moment the file is imported. In Vitest, environment variables like `AI_INTEGRATIONS_OPENAI_API_KEY` are typically unset, so the constructor throws. Any test that imports the module — even to test a completely pure helper exported from the same file — crashes before the first test body runs.

A lazy singleton defers construction until a function that actually needs the client is invoked. Importing the module is now safe; tests of pure helpers can run without mocking the external SDK.

## Examples

### Bad: top-level instantiation

```typescript
// server/services/meal-suggestions.ts (before)
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, // undefined in test env -> throws
});

export function buildPromptForMeals(/* ... */) {
  /* pure */
}
export async function getMealSuggestions(/* ... */) {
  /* uses openai */
}
```

Importing this file in a test crashes immediately even if the test only touches `buildPromptForMeals`.

### Good: lazy singleton

```typescript
// server/services/meal-suggestions.ts (after)
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

export function buildPromptForMeals(/* ... */) {
  /* pure */
}
export async function getMealSuggestions(/* ... */) {
  const openai = getOpenAI();
  // ...
}
```

The client is only instantiated when a function that actually calls the API runs.

## Exceptions

Server bootstrap files that are imported only at process start and never by tests (e.g., a thin `server/index.ts` entrypoint) can construct clients eagerly. The rule binds files in `server/services/**`, `server/routes/**`, `server/storage/**` — anywhere tests might transitively reach.

## Related Files

- `server/services/meal-suggestions.ts` — original of this pattern
- `server/services/photo-analysis.ts`, `server/services/recipe-generation.ts` — historically still used module-level initialization and would break if their pure helpers were tested directly

## See Also

- [`__DEV__` conditional require for mock vs real module switching](../design-patterns/dev-conditional-require-mock-vs-real-module-2026-05-13.md) — sibling rule for the client side; both address "loading the wrong implementation at import time"
- [Module-level mutable state is a React smell](../code-quality/module-level-mutable-state-react-smell-2026-05-13.md) — related anti-pattern on the client
