---
title: Replace `any` with Proper Types — Use `unknown` + Narrowing as a Fallback
track: knowledge
category: conventions
module: shared
tags: [typescript, type-safety, any, unknown, type-guards]
applies_to: ['**/*.ts', '**/*.tsx']
created: '2026-05-13'
---

# Replace `any` with Proper Types — Use `unknown` + Narrowing as a Fallback

## Rule

Don't reach for `any`. If you know the shape, define a type. If you don't,
use `unknown` and narrow it with a type guard or a Zod schema before you use
the value.

## Smell patterns

- `function foo(data: any)` — almost always a sign the shape is known but
  someone skipped writing it down.
- `as any` casts to silence compiler complaints.
- `: any` on a navigation callback param or event payload.
- `any[]` arrays of structured records.
- `Record<string, any>` for known JSON shapes — use a proper interface or Zod
  schema.

## Why

`any` opts out of the type system entirely. Once `any` enters a chain, every
downstream call site silently becomes unsafe:

- **No autocomplete** in the IDE — the developer can't see what fields exist.
- **No compile-time error checking** — typos in property names compile fine.
- **No refactoring safety** — renaming a field doesn't update call sites.
- **No self-documentation** — readers can't tell what the function actually
  expects.

`unknown` keeps the type system engaged but forces narrowing at the boundary
where the data enters the typed world. That narrowing is where validation
belongs.

## Examples

### Before — `any` hides the contract

```typescript
function handleSubmit(data: any) {
  navigation.navigate("NextScreen", { data });
}
```

The reader can't tell what `data` contains, the IDE offers nothing, and a
typo like `data.usrname` compiles silently.

### After — narrow type at the call boundary

```typescript
import type { HomeScreenNavigationProp } from "@/types/navigation";

function handleSubmit(data: { username: string; password: string }) {
  navigation.navigate("NextScreen", { data });
}
```

### When the shape really is unknown — use `unknown` plus a guard

```typescript
function handleExternalPayload(payload: unknown) {
  // Narrow before you touch anything.
  const parsed = ExternalPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Invalid payload");
  }
  // `parsed.data` is fully typed below this line.
  return process(parsed.data);
}
```

For network responses, prefer `zod.safeParse` over hand-written guards (see
the related convention).

## Exceptions

- **Third-party type holes.** A library's `.d.ts` file types something as
  `any` and you can't change it. Wrap the boundary call in a helper that
  immediately narrows to a proper local type.
- **Genuine variadic dispatch.** Rare. Even then, prefer a tagged union over
  `any`.

## Related Files

- `client/types/navigation.ts` — composite navigation prop types are the
  canonical replacement for `(navigation: any)` parameters.

## See Also

- [delete-unused-code-aggressively](delete-unused-code-aggressively-2026-05-13.md) — the
  other simplification principle from the same review pass.
- [type-guard-over-as-cast-runtime-safety](type-guard-over-as-cast-runtime-safety-2026-05-13.md) —
  narrowing instead of casting at the runtime boundary.
- [zod-safeparse-external-api-responses](zod-safeparse-external-api-responses-2026-05-13.md) —
  validate untyped network responses with Zod.
