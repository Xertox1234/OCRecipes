---
title: Centralized environment validation with Zod schema
track: knowledge
category: design-patterns
module: server
tags: [api, env, zod, startup, validation]
applies_to: [server/lib/env.ts, server/index.ts, server/lib/env-boot.ts]
created: '2026-05-13'
last_updated: '2026-06-10'
---

# Centralized environment validation with Zod schema

## When this applies

Every Express server startup. Call `validateEnv()` before any other module initialization. Instead of scattered `if (!process.env.X) throw` checks across modules, define a single Zod schema for all environment variables and validate it once at server startup. This surfaces all missing variables at once (not one at a time) and provides typed access to validated values.

## Why

For projects with many env vars, scattered inline checks fail one at a time — fix `JWT_SECRET`, restart, then learn `DATABASE_URL` is also missing. A single schema collects all failures and reports them together. Typed access (`getEnv()`) eliminates `process.env.X!` non-null assertions throughout the codebase.

## Examples

```typescript
// server/lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  // Required — server will not start without these
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),

  // Optional with defaults
  PORT: z.string().default("3000"),
  NODE_ENV: z.string().default("development"),

  // Optional — features degrade gracefully
  AI_INTEGRATIONS_OPENAI_API_KEY: z.string().optional(),
  SPOONACULAR_API_KEY: z.string().optional(),
  // ... other optional vars
});

type Env = z.infer<typeof envSchema>;
let validated: Env | null = null;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  validated = result.data;

  // Warn about missing optional vars
  if (!validated.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.warn(
      "[env] AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features disabled",
    );
  }
  return validated;
}

export function getEnv(): Env {
  if (!validated)
    throw new Error("validateEnv() must be called before getEnv()");
  return validated;
}
```

```typescript
// server/lib/env-boot.ts — side-effect bootstrap module
// IMPORTANT: This must be the FIRST import in server/index.ts to ensure
// env validation runs before any module that reads process.env at module scope.
import "dotenv/config";
import { validateEnv } from "./env";

validateEnv();
```

```typescript
// server/index.ts — first import is the bootstrap module
// NOTE: Do NOT reorder this import. import sorting autofix tools must preserve
// this as the first import declaration. A unit test asserts this invariant.
import "./lib/env-boot";

// ... other imports that depend on validated env
import { getEnv } from "./lib/env";
```

```typescript
// server/lib/__tests__/env-boot.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("env-boot", () => {
  it("is the first import in server/index.ts", () => {
    const indexPath = path.resolve(__dirname, "../../index.ts");
    const content = fs.readFileSync(indexPath, "utf-8");
    const lines = content.split("\n");
    const importLines = lines.filter((l) => l.trim().startsWith("import ") || l.trim().startsWith("// "));
    // ignore comments and blank lines, find first actual import
    const firstImport = importLines.find((l) => l.trim().startsWith("import "));
    expect(firstImport).toBeDefined();
    expect(firstImport!.trim()).toMatch(/['"].\/lib\/env-boot['"]/);
  });
});
```

## Key elements

1. **Required vs optional** — required vars use `.min(1)` (not just `.string()`) to reject empty strings
2. **Defaults** — `PORT` and `NODE_ENV` get sensible defaults via `.default()`
3. **All-at-once errors** — `safeParse` collects all failures, not just the first
4. **Warning for degraded features** — optional vars log warnings so operators know what is disabled
5. **Typed access** — `getEnv()` returns a fully typed object, no more `process.env.X!` assertions
6. **Side-effect bootstrap module** — env validation runs in a dedicated bootstrap module (`env-boot.ts`) rather than inline in `index.ts`, because static imports are hoisted and evaluated before any module body code

## Import hoisting and the side-effect bootstrap

A naive `validateEnv()` call in `index.ts`'s module body fails: in both ESM (esbuild bundle) and CJS (tsx dev) modes, static imports are hoisted and evaluated **before** any module body code. So `./db` — imported directly by `index.ts` and also reached transitively via `./routes` → storage — is evaluated before any `validateEnv()` body call, meaning `server/db.ts`'s module-scope `throw` on missing `DATABASE_URL` fires first.

The working pattern uses a **side-effect bootstrap module**: `server/lib/env-boot.ts` imports `dotenv/config` (to populate env from `.env`), imports and calls `validateEnv()`, and is imported as the **first** import declaration of `server/index.ts`. Because import declarations evaluate in order relative to each other (ES spec: first import → first evaluation), the bootstrap wins in both runtime modes.

This invariant is comment-fragile: import-sorting autofix tools (e.g., `eslint-plugin-import`) may reorder imports, so a **unit test** (`server/lib/__tests__/env-boot.test.ts`) asserts that `index.ts`'s first import is `./lib/env-boot`.

**Testing gotcha**: `env-boot`'s `import "dotenv/config"` side effect repopulates vars deleted from `process.env` (from the repo `.env`). A test of `env-boot` itself must mock dotenv:
```typescript
vi.mock("dotenv/config", () => ({}));
```
Note that `vi.mock` persists across `vi.resetModules()` because they use separate module registries.

## Defense-in-depth

`server/db.ts` deliberately keeps its own `DATABASE_URL` throw as defense-in-depth for direct-entry scripts (`server/scripts/*`, seeds) that never load `index.ts`. The bootstrap pattern is the primary guard; the db module guard is the backup for non-server contexts.

## Relation to existing pattern

This supersedes the simpler [fail-fast environment validation](../conventions/fail-fast-environment-validation-2026-05-13.md) pattern for projects with many env vars. Small projects with 1-2 required vars can still use inline checks.

## Related Files

- `server/lib/env.ts` — full schema and validation
- `server/lib/env-boot.ts` — side-effect bootstrap module (first import in index.ts)
- `server/lib/__tests__/env-boot.test.ts` — unit test asserting first-import invariant
- `server/index.ts` — `import "./lib/env-boot"` as the first import declaration (no body-level `validateEnv()` call remains)

## See Also

- [Fail-fast environment validation at module load](../conventions/fail-fast-environment-validation-2026-05-13.md)
- [Startup warning for optional env vars](../conventions/startup-warning-optional-env-vars-2026-05-13.md)
- [Service availability guard checkAiConfigured](service-availability-guard-check-ai-configured-2026-05-13.md)
