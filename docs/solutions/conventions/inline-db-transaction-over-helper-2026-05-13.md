---
title: "Inline `db.transaction()` Instead of a `withTransaction()` Helper"
track: knowledge
category: conventions
tags: [drizzle, abstraction, simplicity, postgres, transactions]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Inline `db.transaction()` Instead of a `withTransaction()` Helper

## Rule

Use `db.transaction(async (tx) => { ... })` directly at the call site. Do not wrap it in a project-local `withTransaction()` helper.

## Smell patterns

- A `withTransaction<T>(callback)` helper whose body is `return await db.transaction(callback)`.
- A "transaction utils" module that exports a single one-line wrapper.
- Stack traces show an extra frame in `transaction-utils.ts` for every storage call.

## Why

An early version of the storage layer wrapped `db.transaction()` in a reusable helper:

```typescript
// ❌ Over-abstracted — zero added value
async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(callback);
}

const result = await withTransaction(async (tx) => {
  // Multi-step operation
});
```

The wrapper added zero value:

- It only forwarded the callback to `db.transaction()`.
- It made stack traces harder to read (extra frame in every trace).
- It added indirection — readers had to jump to the helper to confirm it wasn't doing anything special.
- It provided no consistency benefit, because actual transactions vary too much (different tables, isolation levels, error handling) for a shared template to constrain them.

```typescript
// ✅ Inline — simpler and clearer
const result = await db.transaction(async (tx) => {
  // Multi-step operation
});
```

## Exceptions

Add an abstraction only when it earns its keep:

| ✅ Justify wrapping when…                                                       | ❌ Don't wrap when…                         |
| ------------------------------------------------------------------------------- | ------------------------------------------- |
| The wrapper reduces real duplication (3+ uses with the same setup/teardown)     | "Might need it later"                       |
| It encapsulates non-trivial logic (retry-on-deadlock, telemetry spans, etc.)    | "Looks cleaner"                             |
| It enforces an invariant (e.g., wraps every call in a span with the route name) | The wrapper is one line with no added logic |

Concretely: if `db.transaction()` ever grows project-specific cross-cutting concerns (deadlock retry, OpenTelemetry, audit logging), _that's_ when a helper becomes warranted. Until then, inline.

## Related Files

- All `server/storage/*.ts` modules — direct `db.transaction()` use, no wrapper.

## See Also

- [../logic-errors/toggle-favourite-race-condition-2026-05-13.md](../logic-errors/toggle-favourite-race-condition-2026-05-13.md) — Canonical example of where `db.transaction()` is actually needed.
- [response-types-inline-over-shared-2026-05-13.md](response-types-inline-over-shared-2026-05-13.md) — Same "inline over abstraction" principle applied to API response types.
