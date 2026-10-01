---
title: "multer's recommended limits: check-ordering between them, and the @types gap when adding one"
track: knowledge
category: conventions
tags: [security, multer, file-upload, typescript, express]
module: server
applies_to: [server/routes/**/*.ts]
created: '2026-09-23'
---

# multer's recommended limits: check-ordering between them, and the @types gap when adding one

## Rule

multer's README "Security" section recommends five `limits` keys together
(`fileSize`, `files`, `fields`, `fieldNestingDepth`, `fieldArrayIndexLimit`).
Two things aren't obvious from the README alone and matter when you add or
extend them:

1. **The checks aren't independent — read the source for ordering before
   assuming two limits guard different things.** In installed multer 2.4.0
   (`node_modules/multer/lib/make-middleware.js:269-275`), the
   `fieldNestingDepth` check runs strictly before the `fieldArrayIndexLimit`
   check on every field name. Setting `fieldNestingDepth: 0` (no client sends
   a bracketed field name) rejects **any** bracketed name — numeric or
   not — with `LIMIT_FIELD_NESTING` before `fieldArrayIndexLimit` is ever
   consulted. If you already have `fieldArrayIndexLimit` set (e.g. to close a
   specific advisory) and later add `fieldNestingDepth`, the original
   advisory's fix becomes dead code for real inputs — correct, but worth
   documenting explicitly rather than leaving two limits that silently
   overlap with no comment explaining which one actually fires.
2. **A new limit key may not be in `@types/multer`'s `Options.limits`
   interface even though multer itself accepts and validates it.** As of
   `@types/multer@2.1.0`, `fieldNestingDepth` and `fieldArrayIndexLimit` are
   both undeclared (only `fieldNameSize`, `fieldSize`, `fields`, `fileSize`,
   `files`, `parts`, `headerPairs` are typed). TypeScript's excess-property
   checking applies only to a **fresh object literal** passed where a typed
   value is expected — not to properties introduced via a spread of an
   already-typed `const`. So `multer({ limits: { fileSize, ...LIMITS } })`
   type-checks cleanly even when `LIMITS` carries an undeclared key, while
   `multer({ limits: { fileSize, fieldNestingDepth: 0 } })` written inline
   would not. Keep every multer limit in one shared, spread `const` rather
   than inlining a new untyped key directly into a `limits` object literal.

## When this applies

Any time you add a new key to a shared multer `limits` object, especially one
recommended by the multer README's Security section but not yet set.

## Why

Both gotchas produce a false sense of "each limit is independently load
bearing" — reviewers and future editors will read `fieldArrayIndexLimit: 0`
next to `fieldNestingDepth: 0` and assume both fire independently, when in
practice the narrower/earlier check (nesting) fully subsumes the later one
for every real bracketed input. Leaving that unexplained risks someone
"cleaning up" the seemingly-redundant older limit later and reopening the
original advisory if the newer, broader limit is ever loosened without
re-deriving the interaction. The type gap is a separate trap: an editor who
inlines a new option directly into the `limits` literal (rather than the
shared spread const) gets a real TypeScript error for an option multer
happily accepts at runtime, and may reach for an `as` cast or a type
augmentation instead of the much simpler fix (keep using the spread).

## Examples

```typescript
// server/routes/_upload.ts
const MULTIPART_LIMITS = {
  fieldArrayIndexLimit: 0, // GHSA-535w-7cp7-47q4
  fieldNestingDepth: 0, // subsumes fieldArrayIndexLimit above — see Rule §1
  fields: 1,
  files: 3,
} as const;

multer({
  limits: { fileSize: maxSizeBytes, ...MULTIPART_LIMITS }, // spread avoids the @types gap
  storage: multer.memoryStorage(),
  // ...
});
```

Test assertions should target the specific `MulterError.code` each limit is
expected to produce (`LIMIT_FIELD_NESTING`, `LIMIT_FIELD_COUNT`,
`LIMIT_FILE_COUNT`), not a loose `/^LIMIT_/` match — a loose match will not
notice if a broader check silently starts intercepting a case an older,
narrower test was written to exercise.

## Exceptions

None — always read `node_modules/<multer version>/lib/make-middleware.js`
for the actual check order before adding a new count/depth limit alongside
existing ones; don't assume README ordering reflects enforcement ordering.

## Related Files

- `server/routes/_upload.ts`
- `server/routes/__tests__/_upload.test.ts`

## See Also

- [multer-error-handler-pattern-2026-05-13.md](../design-patterns/multer-error-handler-pattern-2026-05-13.md)
