---
title: 'Record<string, object> is too weak a type for ESLint RuleTester.run()'
track: bug
category: code-quality
module: shared
severity: medium
tags: [typescript, eslint, rule-tester, type-safety, record]
symptoms: [tsc --noEmit passes locally (Vitest transpiles without checking) but CI type check fails, 'TS2345: Argument of type ''object'' is not assignable to parameter of type ''RuleDefinition''', 'Property ''create'' is missing in type ''{}'' but required in type ''RuleDefinition''']
applies_to: [eslint-plugin-ocrecipes/__tests__/*.test.ts]
created: '2026-06-03'
---

# `Record<string, object>` is too weak a type for ESLint `RuleTester.run()`

## Problem

Typing the imported CommonJS plugin as `{ rules: Record<string, object> }` compiles under Vitest (which transpiles but does not typecheck) but fails `tsc --noEmit` in CI:

```
TS2345: Argument of type 'object' is not assignable to parameter of type
'RuleDefinition<RuleDefinitionTypeOptions>'.
  Property 'create' is missing in type '{}' but required in type
  'RuleDefinition<RuleDefinitionTypeOptions>'.
```

`RuleTester.run()` expects its second argument to be `Rule.RuleModule`, which requires a `create` method. The structurally weaker `object` type satisfies nothing.

## Symptoms

- `npx vitest run` passes (transpile-only, no typecheck)
- `npm run check:types` / CI `tsc --noEmit` fails with TS2345
- The error only appears on lines where `plugin.rules["rule-name"]` is passed to `tester.run()`

## Root Cause

`object` in TypeScript is a non-primitive type — it structurally matches `{}` and does not guarantee any properties. `Rule.RuleModule` requires `{ create: Function; meta?: ... }`. The mismatch is only visible when TypeScript performs structural checking, which Vitest's transpiler skips.

## Solution

Import `Rule` from `"eslint"` and use `Rule.RuleModule` as the map value type:

```ts
// Before:
const plugin = require("../index.js") as {
  rules: Record<string, object>;
};

// After:
const plugin = require("../index.js") as {
  rules: Record<string, import("eslint").Rule.RuleModule>;
};
```

`Rule.RuleModule` is the correct structural type for any object exported from an ESLint plugin's `rules` map. No additional imports are needed — inline `import()` in the cast is sufficient.

## Prevention

When typing a CommonJS `require()` cast for an ESLint plugin, always use `Record<string, import("eslint").Rule.RuleModule>` rather than `Record<string, object>` or `Record<string, unknown>`.

## Related Files

- `eslint-plugin-ocrecipes/__tests__/rules.test.ts`

## See Also

- [eslint-v9-ruletester-auto-integrates-with-vitest-2026-06-03.md](../conventions/eslint-v9-ruletester-auto-integrates-with-vitest-2026-06-03.md) — companion convention for RuleTester usage
