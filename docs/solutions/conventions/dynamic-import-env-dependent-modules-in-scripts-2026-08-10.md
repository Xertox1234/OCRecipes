---
title: Dynamic import for env-dependent modules in scripts
track: knowledge
category: conventions
module: server
tags: [scripts, env, dynamic-import, module-loading, dotenv, import-hoisting]
applies_to: [scripts/**/*.ts, server/**/*.ts]
created: '2026-08-10'
---

# Dynamic import for env-dependent modules in scripts

## Rule

When a script loads its environment in the script body (`loadEnv()`, `dotenv`), any module that reads `process.env` at module scope must be imported **dynamically, inside the function that uses it** — never statically at the top of the script.

## Why

Static imports are hoisted and evaluated before any module body code. A top-of-file `import { runware } from "../server/lib/runware"` therefore evaluates the runware module — and its top-level `process.env.RUNWARE_API_KEY` read — before the script body's `loadEnv()` ever runs. The env is empty at the only moment the module looks at it.

## Examples

```typescript
// Bad: static import evaluates at module load — env not ready
import { runware } from "../server/lib/runware"; // reads process.env.RUNWARE_API_KEY at module load

async function generateAssetImage(prompt: string): Promise<Buffer> {
  const result = await runware.generateImage(prompt);
  return result.imageBuffer;
}

// Good: dynamic import deferred until after env is loaded
async function generateAssetImage(prompt: string): Promise<Buffer> {
  const { runware } = await import("../server/lib/runware"); // loads after env ready
  const result = await runware.generateImage(prompt);
  return result.imageBuffer;
}

// In scripts/generate-app-assets.ts
import { loadEnv } from "vite";
loadEnv("production", process.cwd());

const imageUrl = await generateAssetImage(prompt);
```

## Exceptions

If you own the module, the better fix is to make it lazy at the source — construct the client inside a getter instead of at module scope — which removes the load-order sensitivity for every consumer. The dynamic-import form is for consuming modules you can't (or shouldn't) change in the same PR.

## Related Files

- `scripts/generate-app-assets.ts` — dynamic import after `loadEnv()`

## See Also

- [Lazy-initialize DB pools and API clients in modules that tests import](lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md) — the source-side fix for the same load-order problem
- [Centralized environment validation with Zod schema](../design-patterns/centralized-env-validation-zod-2026-05-13.md) — the server's env-boot first-import invariant is the same hoisting rule in the other direction
