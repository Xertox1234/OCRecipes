---
title: 'A module-level hard guard reachable from the server boot path must check exact env values, not bare truthiness'
track: knowledge
category: conventions
tags: [env-vars, guard-rails, fail-fast, server-boot, prod-safety]
module: server
created: '2026-07-06'
---

# A module-level hard guard reachable from the server boot path must check exact env values, not bare truthiness

## Rule

Before writing `if (process.env.NODE_ENV === "production" && process.env.SOME_FLAG) throw ...` at the top of a module, check whether that module sits on the MANDATORY server-boot import graph (i.e. `server/routes.ts` or anything it eagerly imports pulls this file in regardless of runtime config) — not just whether it's imported by an opt-in CLI script. If it's on the boot path, check the flag against its EXACT valid value(s) (`=== "1"`, a `Set` of recognized modes, etc.), never bare truthiness (`if (process.env.SOME_FLAG)`). A stray/leftover/garbage value for an unrelated env var must not be able to crash the entire production server at startup.

## Why

The "refuse-prod" pattern (seen in `seed-recipes.ts`'s `--allow-prod-seed` guard) is safe to write as a bare-truthiness check because that script is opt-in: a human runs it directly and sees the thrown error immediately, with zero blast radius beyond that one script invocation. Copying the same bare-truthiness pattern into a module that's unconditionally imported by every route file changes the blast radius completely — ANY value at all for that flag (a copy-pasted `.env.development` value, a leftover Railway env var, a CI secret bleed) now takes down the *entire* production API, not just the one feature the guard was meant to protect.

Two independent reviewers (`code-reviewer` and `server-reviewer`) converged on this exact same finding on the same diff — a strong signal it's a natural trap when following a "mirror the seed script's refuse-prod pattern" instruction literally without checking who imports the module.

## Examples

```typescript
// BAD — bare truthiness; any set value crashes prod boot for a module that's
// always imported by server/routes.ts
if (process.env.NODE_ENV === "production" && process.env.API_CACHE) {
  throw new Error("...");
}
```

```typescript
// GOOD — exact recognized values only; a garbage/unrelated value degrades to
// "cache stays off", not "server crashes"
const ACTIVE_VALUES = new Set(["1", "refresh"]);
if (
  process.env.NODE_ENV === "production" &&
  ACTIVE_VALUES.has(process.env.API_CACHE ?? "")
) {
  throw new Error("...");
}
```

## Exceptions

- A guard in a module ONLY reachable from an opt-in CLI entrypoint (never imported by `server/routes.ts` or its transitive graph) can safely use bare truthiness — that's the seed-script precedent, and it's correct there specifically because the blast radius is contained to one manual invocation.
- If the flag genuinely has no valid values other than "set" vs "unset" (a pure boolean switch with no distinct modes), bare truthiness is fine — the exact-value check only matters when there ARE multiple recognized values and a mismatched/garbage value is plausible.

## Related Files

- `server/services/dev-api-cache.ts` — `ACTIVE_CACHE_VALUES` exact-match guard, transitively imported by `server/routes.ts` via `nutrition-lookup.ts`/`recipe-catalog.ts`
- `server/scripts/seed-recipes.ts` — the bare-truthiness precedent this pattern is safe for (opt-in CLI, not boot-path)

## See Also

- [Guard one-shot prod-ops scripts on an explicit flag, not NODE_ENV](prod-ops-script-guard-on-flag-not-node-env-2026-06-20.md)
- [Fence a prod-dangerous operation at its call site with a fail-closed target check](fail-closed-guard-at-dangerous-op-call-site-2026-06-25.md)
