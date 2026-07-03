---
title: ESLint v9 RuleTester auto-integrates with Vitest — no describe/it wrappers needed
track: knowledge
category: conventions
module: shared
tags: [eslint, vitest, rule-tester, testing, eslint-v9]
applies_to: [eslint-plugin-ocrecipes/__tests__/*.test.ts]
created: '2026-06-03'
---

# ESLint v9 RuleTester auto-integrates with Vitest — no describe/it wrappers needed

## Rule

Call `tester.run()` directly at module scope in `.test.ts` files. ESLint v9 auto-detects Vitest and wraps each valid/invalid case in its own `it()` — explicit `describe`/`it` wrappers are neither required nor beneficial.

## Why

ESLint v9's `RuleTester` uses a test-framework detection strategy: on module load it checks for Vitest's global `it`/`describe` and, if found, delegates each test case to the runner automatically. Each valid case becomes one passing `it()` and each invalid case becomes one `it()` that throws `AssertionError` on mismatch. The result is per-case failure reporting (e.g. "Expected 1 error but got 0") rather than a module-level crash.

Prior to ESLint v9, `tester.run()` threw synchronously on first failure, and callers had to wrap it in `it()` to get individual test reporting. That pattern is obsolete in v9.

## Examples

```ts
// ✅ correct — module-scope calls, ESLint v9 handles the it() wrapping
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("no-error-message-in-ui", plugin.rules["no-error-message-in-ui"], {
  valid: [...],
  invalid: [...],
});
```

```ts
// ❌ unnecessary — wrapping tester.run() in describe/it adds noise without benefit in v9
describe("no-error-message-in-ui", () => {
  it("flags ...", () => {
    tester.run(...);
  });
});
```

## Exceptions

If you need to run `tester.run()` inside a `beforeAll`/`afterAll` lifecycle or share setup state across suites, you may wrap it — but this is unusual for rule tests.

## Related Files

- `eslint-plugin-ocrecipes/__tests__/rules.test.ts`

## See Also

- [custom-eslint-rules-eslint-plugin-ocrecipes-2026-05-13.md](../best-practices/custom-eslint-rules-eslint-plugin-ocrecipes-2026-05-13.md) — the server-side rule pattern this test file tests against
