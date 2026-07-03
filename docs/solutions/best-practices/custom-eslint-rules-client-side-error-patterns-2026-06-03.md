---
title: Adding client-side rules to eslint-plugin-ocrecipes for error-handling patterns
track: knowledge
category: best-practices
module: client
tags: [eslint, client, error-handling, silent-failures, custom-rules, automated-enforcement]
applies_to: [eslint-plugin-ocrecipes/index.js, eslint.config.js, 'client/**/*.{ts,tsx}']
created: '2026-06-03'
last_updated: '2026-06-03'
---

# Adding client-side rules to `eslint-plugin-ocrecipes` for error-handling patterns

## When this applies

When a client-side pattern needs mechanical enforcement that `no-restricted-syntax` AST selectors can't express — specifically patterns that require inspecting binding names, call-chain structure, or scope resolution across statements. The same plugin used for server-side rules (`no-bare-error-response`, `no-parseint-req`) hosts client-side rules under a separate `eslint.config.js` scope block.

## Why

Silent failure patterns (`error.message` rendered in JSX, dead `if (!res.ok)` guards) recurred after the 2026-05-28 audit because there was no write-time enforcement. Code review catches these inconsistently. A custom ESLint rule fires on every save, pre-commit, and CI run — so the pattern can't silently re-enter the codebase.

## Examples

### Two rules added in the 2026-06-03 PR

**`no-error-message-in-ui`** — three sub-patterns, all requiring binding-name inspection:

```js
// Detects: {error.message} / {generateMutation.error.message} in JSX
JSXExpressionContainer(node) {
  if (isErrorMessage(node.expression)) report(node);
},
// Detects: setError(err.message) / setError(err.message || "fallback")
// Detects: toast.error(err.message) / AccessibilityInfo.announceForAccessibility(error.message)
CallExpression(node) { ... }
```

**`no-dead-apiRequest-guard`** — requires scope-aware binding resolution:

```js
IfStatement(node) {
  const identName = getOkCheckIdentifier(node.test); // extracts "res" from !res.ok
  if (!identName) return;
  const scope = context.sourceCode.getScope(node);   // ESLint v9 API
  if (resolveToAwaitApiRequest(identName, scope)) {  // follows let/const/alias
    context.report({ node, messageId: "noDeadGuard" });
  }
},
```

### Activating the client block in `eslint.config.js`

```js
// After the existing type-aware TypeScript blocks:
{
  files: ["client/**/*.{ts,tsx}"],
  plugins: { ocrecipes: ocrecipesPlugin },
  rules: {
    "ocrecipes/no-error-message-in-ui": "error",
    "ocrecipes/no-dead-apiRequest-guard": "error",
  },
},
```

The `ocrecipes` plugin key must be declared again (flat config is per-object) but references the same imported `ocrecipesPlugin`. The server block (`server/routes/**/*.ts`) is untouched.

### ESLint v9 scope API for cross-statement analysis

Use `context.sourceCode.getScope(node)` (not deprecated `context.getScope()`) and `scope.variables` / `variable.references` / `variable.defs` for binding resolution:

```js
function resolveToAwaitApiRequest(name, scope) {
  let current = scope;
  while (current) {
    const variable = current.variables.find(v => v.name === name);
    if (variable) {
      for (const def of variable.defs) {
        if (def.type === "Variable" && def.node.init && isAwaitApiRequest(def.node.init))
          return true;
        if (def.node.init?.type === "Identifier")
          return resolveToAwaitApiRequest(def.node.init.name, scope); // one-hop alias
      }
      for (const ref of variable.references) {
        if (ref.isWrite() && ref.writeExpr && isAwaitApiRequest(ref.writeExpr))
          return true;
      }
      return false;
    }
    current = current.upper;
  }
  return false;
}
```

### Testing with ESLint v9 RuleTester

```ts
// eslint-plugin-ocrecipes/__tests__/rules.test.ts
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

const plugin = require("../index.js") as {
  rules: Record<string, import("eslint").Rule.RuleModule>; // NOT Record<string, object>
};

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-error-message-in-ui", plugin.rules["no-error-message-in-ui"], {
  valid: [...],
  invalid: [...],
});
// tester.run() at module scope — ESLint v9 auto-wraps each case in it()
```

### Coverage gaps in `no-dead-apiRequest-guard`

Two verified coverage gaps were discovered during implementation and testing:

1. **Destructured `ok` from the response**  
   When the developer writes:
   ```js
   const { ok } = await apiRequest(...);
   if (!ok) { ... }
   ```
   the guard `!ok` is a `UnaryExpression` over a bare `Identifier`, not a `MemberExpression` (like `!res.ok`).  
   The helper `getOkCheckIdentifier` looks for `!{something}.ok` and returns `null` for this pattern, so the `IfStatement` visitor exits without ever performing scope resolution.  
   *Note:* Destructuring another field and then checking `.ok` on that object **is** caught (e.g. `const { data } = await apiRequest(...); if (!data.ok)`) because the scope resolver follows the `VariableDeclarator` init to find the `apiRequest` call.

2. **Renamed import aliases**  
   If a file imports `apiRequest` under a different name:
   ```js
   import { apiRequest as makeRequest } from '@oc/api';
   const res = await makeRequest(...);
   if (!res.ok) { ... }
   ```
   the rule does not flag this because `isAwaitApiRequest` only matches the callee name `'apiRequest'` literally. The scope resolver never sees the original binding name.

Both gaps are left as known limitations pending a future enhancement (see the `Related Files` note on `docs/rules/client-state.md` for the design rule these checks enforce).

## Exceptions

- Patterns reliably caught by a single `no-restricted-syntax` AST selector → use that instead (less code)
- Cross-file invariants (e.g. "every screen must import useTheme") → use a custom lint script under `scripts/check-*.js`

## Related Files

- `eslint-plugin-ocrecipes/index.js`
- `eslint.config.js`
- `eslint-plugin-ocrecipes/__tests__/rules.test.ts`
- `docs/rules/client-state.md` — the rules these ESLint checks enforce

## See Also

- [custom-eslint-rules-eslint-plugin-ocrecipes-2026-05-13.md](./custom-eslint-rules-eslint-plugin-ocrecipes-2026-05-13.md) — the server-side counterpart (same plugin, server/routes scope)
- [eslint-v9-ruletester-auto-integrates-with-vitest-2026-06-03.md](../conventions/eslint-v9-ruletester-auto-integrates-with-vitest-2026-06-03.md) — RuleTester integration detail
- [eslint-rule-module-type-too-weak-record-object-2026-06-03.md](../code-quality/eslint-rule-module-type-too-weak-record-object-2026-06-03.md) — type gotcha in test files
