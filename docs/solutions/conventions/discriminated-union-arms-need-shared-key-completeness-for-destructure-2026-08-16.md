---
title: A discriminated union's arms must all declare every field consumers destructure, or the destructure breaks
track: knowledge
category: conventions
module: client
tags: [typescript, discriminated-unions, react-navigation, react-native, route-params, destructuring]
applies_to: [client/navigation/**/*.tsx, client/screens/**/*.tsx]
created: '2026-08-16'
---

# A discriminated union's arms must all declare every field consumers destructure, or the destructure breaks

## Rule

When converting a flat "several independent optional fields" type into a
discriminated union of mutually-exclusive arms, every arm must declare
**every** field any consumer destructures from it — the fields the arm
doesn't own get `?: never`, not omission. TypeScript's property-access rule
on a union requires a property to exist (with some type, possibly `never`)
on **every** constituent; a field present on only one arm makes the whole
union un-destructurable for that field, even though each arm looks correct
in isolation.

## When this applies

Any type union consumed via a single destructuring statement rather than
narrowed first — most commonly `const { a, b, c } = value || {}` on a
React Navigation `route.params`, but the rule is general TypeScript, not
navigation-specific.

## Why

TypeScript's rule for `(A | B).x` is: `x` must exist on **every**
constituent of the union, or the access is a compile error — regardless of
whether `x` is optional on the members that do have it. An arm that simply
omits a field (rather than typing it `?: never`) does not have that
property at all, so a union built that way reads correctly as three
separate legal shapes, but the moment a caller destructures all shared
fields in one statement, the fields that are missing from any single arm
become compile errors.

This is easy to miss because the union type-checks fine on its own — the
error surfaces at the *consumer*, not at the type declaration, and only
once someone actually destructures a field that isn't universal.

## Examples

`RootStackParamList["NutritionDetail"]` was a flat type with six optional
fields: three mutually-exclusive entry-mode selectors (`barcode`, `itemId`,
`imageUri`) and three companions that only make sense on the `barcode`
mode (`ocrText`, `nutritionImageUri`, `frontImageUri`). The natural first
draft of a discriminated union only put the companions on the barcode arm:

```typescript
// BAD — companions omitted (not `?: never`) from the non-barcode arms
type NutritionDetail =
  | { barcode: string; imageUri?: never; itemId?: never;
      ocrText?: string | null; nutritionImageUri?: string; frontImageUri?: string }
  | { itemId: number; barcode?: never; imageUri?: never }
  | { imageUri: string; barcode?: never; itemId?: never };
```

`NutritionDetailScreen` destructures all six fields in one statement —
`const { barcode, imageUri, itemId, ocrText, nutritionImageUri, frontImageUri } = route.params || {}`
— which produced three real `tsc` errors (`TS2339: Property 'ocrText' does
not exist on type 'NutritionDetail | {}'`, and likewise for the other two
companions), reproduced empirically with `tsc --noEmit --strict` before
this was ever wired into the real navigator. The fix declares all six keys
on every arm, `?: never` on the ones an arm doesn't own:

```typescript
// GOOD — every arm declares all six keys
type NutritionDetail =
  | {
      barcode: string;
      itemId?: never;
      imageUri?: never;
      ocrText?: string | null;
      nutritionImageUri?: string;
      frontImageUri?: string;
    }
  | {
      itemId: number;
      barcode?: never;
      imageUri?: never;
      ocrText?: never;
      nutritionImageUri?: never;
      frontImageUri?: never;
    }
  | {
      imageUri: string;
      barcode?: never;
      itemId?: never;
      ocrText?: never;
      nutritionImageUri?: never;
      frontImageUri?: never;
    };
```

This also confirmed two adjacent, easy-to-doubt behaviors empirically
(don't assume, verify with `tsc`):

- An **intersection** of the union with an object type
  (`NutritionDetail & { barcode: string }`, the shape
  `scan-screen-utils.ts`'s `buildNutritionDetailParams` builds against)
  compiles cleanly and correctly selects only the barcode arm — the other
  arms' `barcode?: never` intersected with `barcode: string` collapses to
  an uninhabitable `never` property, so the intersection is effectively
  "the barcode arm," not a broken three-way union.
- A **cast** (`params as NutritionDetail`, from `Record<string, unknown> |
  undefined`) and a **fresh object literal** assigned to a union field
  (`{ screen: "NutritionDetail", params: { barcode } }`) both still compile
  once every arm carries the full six-key shape.

## Exceptions

- **A consumer that narrows before reading.** `if ("itemId" in value) { … }`
  or a `switch` on a literal discriminant only needs the fields relevant to
  the narrowed branch to exist on that branch — the "every field on every
  arm" requirement is specifically about destructuring the **union type
  itself** in one unnarrowed statement.
- **A union with no shared consumer.** If nothing ever destructures more
  than one arm's fields at once, incomplete arms cost nothing — the
  requirement is driven by the consumer's access pattern, not the union's
  shape in isolation.

## Related Files

- `client/navigation/RootStackNavigator.tsx` — `RootStackParamList["NutritionDetail"]`,
  the discriminated union with all-six-keys-per-arm
- `client/screens/NutritionDetailScreen.tsx` — the `route.params || {}` six-field
  destructure this rule protects
- `client/screens/scan-screen-utils.ts` — `NutritionDetailParams`, the
  intersection-with-union type built against the corrected union

## See Also

- [../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md](a-stated-invariant-is-not-an-enforced-one-2026-08-06.md) — the meta-pattern: the original flat-optionals type stated an exclusivity invariant in a comment that nothing enforced; this rule is how to make that invariant a structural one without breaking the consumer
- [../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md](../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md) — the sibling failure mode on the same screen: a local restatement of route params silently drops fields instead of erroring
- [vitest-transform-no-typecheck-use-tsc-for-type-evidence-2026-07-14.md](vitest-transform-no-typecheck-use-tsc-for-type-evidence-2026-07-14.md) — why the evidence for "this combination is now a compile error" has to be `tsc --noEmit`, not a passing Vitest run
