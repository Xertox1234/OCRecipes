---
title: "Centralized environment validation with Zod schema"
track: knowledge
category: design-patterns
tags: [api, env, zod, startup, validation]
module: server
applies_to: ["server/lib/env.ts", "server/index.ts"]
created: 2026-05-13
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
// server/index.ts — call as the very first thing
import { validateEnv } from "./lib/env";
validateEnv();
```

## Key elements

1. **Required vs optional** — required vars use `.min(1)` (not just `.string()`) to reject empty strings
2. **Defaults** — `PORT` and `NODE_ENV` get sensible defaults via `.default()`
3. **All-at-once errors** — `safeParse` collects all failures, not just the first
4. **Warning for degraded features** — optional vars log warnings so operators know what is disabled
5. **Typed access** — `getEnv()` returns a fully typed object, no more `process.env.X!` assertions

## Relation to existing pattern

This supersedes the simpler [fail-fast environment validation](../conventions/fail-fast-environment-validation-2026-05-13.md) pattern for projects with many env vars. Small projects with 1-2 required vars can still use inline checks.

## Related Files

- `server/lib/env.ts` — full schema and validation
- `server/index.ts` — `validateEnv()` called at top of main IIFE

## See Also

- [Fail-fast environment validation at module load](../conventions/fail-fast-environment-validation-2026-05-13.md)
- [Startup warning for optional env vars](../conventions/startup-warning-optional-env-vars-2026-05-13.md)
- [Service availability guard checkAiConfigured](service-availability-guard-check-ai-configured-2026-05-13.md)
