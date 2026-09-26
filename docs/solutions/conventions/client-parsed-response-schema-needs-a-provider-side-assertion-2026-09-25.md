---
title: A client-parsed response schema must live in shared/ with a provider-side test assertion
track: knowledge
category: conventions
tags: [zod, validation, testing, contract-coverage, shared, api]
module: client
created: '2026-09-25'
---

# A client-parsed response schema must live in shared/ with a provider-side test assertion

## Rule

Any Zod schema a client hook or component uses to `safeParse`/`parse` a server response must be:

1. Defined in `shared/types/<name>.ts` (or extended in an existing shared/ types file), never inline in the client file that consumes it, and
2. Referenced by name in a real assertion — `expectResponseToMatch(res.body, <name>Schema)` from `test/utils/expect-response-schema.ts` — inside an EXISTING or new `server/**/__tests__/*.test.ts` (or `test/**`) test that exercises the route the schema validates.

`scripts/__tests__/contract-coverage-guard.test.ts` enforces this mechanically: it walks `client/` for every `<name>Schema.safeParse(`/`.parse(` call site and fails the whole suite if no `server/`/`test/` test file's CODE (comments/strings stripped, per `scripts/lib/contract-coverage.ts`) contains that same bare identifier. Its `CONTRACT_ALLOWLIST` is an intentionally **empty ratchet** — adding a name to it to silence a new schema is the wrong fix and regresses the ratchet; `NON_RESPONSE_SCHEMAS` is reserved for schemas that validate form/local-state input, never a genuine server response.

## When this applies

- Writing a new client-side Zod schema for ANY `fetch`/`apiRequest` response body, in a hook, screen, or utility under `client/`.
- Especially easy to miss when a todo's Implementation Notes / Scope Contract say "add the schema at the current call site, keep the diff small" — that phrasing predates awareness of this guard and will steer straight into a same-file, client-only schema that fails `npm run test:run` the moment it exists. Check for this guard BEFORE writing the schema, not after the full suite fails.

## Why

The guard exists to keep a client's parsing assumptions from silently drifting from what the server actually sends — the same motivation as `docs/rules/typescript.md`'s "verify each field against the route handler's res.json(...) payload" rule, but enforced automatically rather than by manual review. Putting the schema in `shared/` is what makes a same-named, same-object reference from a server test possible without dragging client-only runtime deps (React, React Navigation, Expo modules, TanStack Query, etc.) into a `supertest`-based server test file — see `@shared/types/recipe-search`'s `recipeSearchResponseSchema`, consumed by both `client/` (parse) and `server/routes/__tests__/recipe-search.test.ts` (assert), which is the established precedent this rule generalizes.

## Examples

```typescript
// shared/types/barcode-lookup.ts
import { z } from "zod";
export const barcodeLookupResponseSchema = z.object({ /* ... */ });
export type BarcodeLookupResponse = z.infer<typeof barcodeLookupResponseSchema>;
```

```typescript
// client/hooks/useNutritionLookup.ts
import { barcodeLookupResponseSchema } from "@shared/types/barcode-lookup";
const parsed = barcodeLookupResponseSchema.safeParse(rawData);
```

```typescript
// server/routes/__tests__/nutrition.test.ts
import { barcodeLookupResponseSchema } from "@shared/types/barcode-lookup";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
// ...inside an existing happy-path test, after asserting res.status:
expectResponseToMatch(res.body, barcodeLookupResponseSchema);
```

Prefer adding the one-line assertion to an **existing** route test over writing a new test file — the guard only needs the identifier referenced from real, already-passing code exercising the route; it does not require a dedicated test.

**Splitting one catch into two branches needs a test on each branch.** The
fix introduced a flag (`serverResponseInvalid`) that routes a malformed body
away from the old network-failure copy. The new tests only asserted the
negative: the malformed path does *not* say "couldn't reach our service". So
inverting the guard, or a flag stuck true, would have given a real outage the
wrong copy with every test still green. `useNutritionLookup.malformedResponse.test.tsx`
now also pins the unchanged network-failure branch (exact copy, `logger.warn`
once, no `logger.error`). Both mutants fail it.

## Exceptions

- A schema that validates a form, local component state, or any input that never crosses from a server response (`NON_RESPONSE_SCHEMAS` in the guard) — keep it wherever is otherwise appropriate; do not relocate it to `shared/` just to satisfy this guard.
- A schema already `shared/`-hosted for an unrelated reason (e.g. it backs a Drizzle-adjacent shared type) — no relocation needed, just add the provider-side assertion if missing.

## Related Files

- `scripts/__tests__/contract-coverage-guard.test.ts` — the enforcing test, its ratchet/allowlist comments
- `scripts/lib/contract-coverage.ts` — `extractParsedSchemaNames`/`computeCoverage`, the pure identifier-match mechanism
- `test/utils/expect-response-schema.ts` — `expectResponseToMatch`
- `shared/types/recipe-search.ts` — the pre-existing precedent (`recipeSearchResponseSchema`)
- `shared/types/barcode-lookup.ts` — this rule's own worked example (`barcodeLookupResponseSchema`)
- `server/routes/__tests__/nutrition.test.ts` — the provider-side assertions added for the worked example

## See Also

- [Zod safeParse for external API responses](zod-safeparse-external-api-responses-2026-05-13.md)
- [Response types inline over shared](response-types-inline-over-shared-2026-05-13.md) — a narrower, older rule about plain TS response *types*; this rule is specifically about a *validating Zod schema* the client actually parses with, which the contract-coverage guard requires in `shared/` regardless
