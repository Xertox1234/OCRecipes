---
title: A screen that restates its own route params SHADOWS the canonical ParamList — the compiler enforces the wrong contract
track: bug
category: logic-errors
module: client
severity: medium
tags: [typescript, react-navigation, route-params, navigation, type-safety, shadowing]
symptoms: ['A screen ignores route params the navigator provably passes — the producer is correct, the ParamList declares the field, and the value still never appears on screen', 'Strict mode, `noUncheckedIndexedAccess`, and CI all stay green over a user-visible data loss', 'A test already pins the navigate payload and passes, so the boundary looks covered', 'The screen declares its own `type RouteParams = {...}` instead of indexing `RootStackParamList`', 'Adding a param to the navigator produces no error anywhere, and the param silently never arrives']
applies_to: [client/screens/**/*.tsx, client/navigation/**/*.tsx]
created: '2026-07-30'
---

# A screen that restates its own route params SHADOWS the canonical ParamList — the compiler enforces the wrong contract

## Problem

`NutritionDetailScreen` declared a local `type RouteParams` listing four of
the six params `RootStackParamList["NutritionDetail"]` actually declares. The
two it omitted were `nutritionImageUri` and `frontImageUri` — the photos a
user captures in steps 2 and 3 of a barcode scan.

Every other link in the chain was correct. The reducer carried both URIs
through `SESSION_COMPLETE`. `buildNutritionDetailParams` deliberately derived
its return type from the route params so a rename could not silently drop a
field, and a test already asserted both URIs survive the navigate. The
navigator declared both keys with doc comments explaining their purpose.

The screen then read `route.params` through its own narrower type and
displayed neither photo. The user worked through a three-step capture flow and
got back a database stock image.

## Symptoms

- A param the navigator guarantees never reaches the screen, with no error at
  any layer.
- The producer side is well-typed and tested; the consumer silently ignores
  fields.
- `git grep` shows the field declared in `RootStackParamList` and referenced
  nowhere in the screen — and nothing complains.
- Renaming the field in `RootStackParamList` breaks nothing, because the
  screen never referenced it to begin with.

## Root Cause

**A local restatement of a shared type is not a duplicate — it is a shadow.**

TypeScript cannot warn that you ignored a field your own type says does not
exist. From inside the screen there is no `nutritionImageUri` to fail to read.
The checker faithfully enforced the contract it was given; the contract was
wrong. This is the failure mode strict mode structurally cannot catch, because
strictness is about honouring the declared type, and the declared type is the
defect.

The narrowing is also invisible at the call site. `navigation.navigate(...)`
type-checks against `RootStackParamList`, so the producer sees a six-field
contract while the consumer sees four. Nothing sits between them to compare.

The local type is easy to write for a reason: it puts the params next to the
code that reads them, and it looks like documentation. It survives because it
starts out accurate — it only becomes a lie when someone extends the
navigator, which is exactly when nobody is looking at the screen.

## Solution

Index the canonical list. Never restate it.

```typescript
// GOOD — one contract, and an added param shows up as an unread field
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NutritionDetailRoute = RouteProp<RootStackParamList, "NutritionDetail">;

const route = useRoute<NutritionDetailRoute>();
const { barcode, itemId, ocrText, nutritionImageUri, frontImageUri } =
  route.params || {};
```

```typescript
// BAD — a second contract that the compiler will defend against the first
type RouteParams = {
  barcode?: string;
  itemId?: number;
  ocrText?: string | null;
  // nutritionImageUri and frontImageUri omitted — no error, ever
};
const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
```

`route.params || {}` still type-checks against the indexed type: an
all-optional member type makes `{}` assignable, so the defensive fallback
costs nothing.

Deriving does not narrow a three-valued field. `ocrText?: string | null`
(`undefined` = no label step ran, `null` = captured but unreadable, string =
read) survives the indirection intact — which matters here, because collapsing
`null` into `undefined` would make an unreadable label indistinguishable from
a barcode-only scan and defeat the log gate.

## Prevention

- **A screen should never declare a `RouteParams` type.** If you are writing
  one, you are forking a contract. Index `RootStackParamList` instead.
- The same rule applies in reverse to producers: `buildNutritionDetailParams`
  annotates both its return type and its local accumulator from the route
  params, because a hand-written subset defeats TypeScript's excess-property
  check at the `navigate(...)` call site.
- **A green payload-boundary test is not evidence the consumer reads the
  payload.** Both ends need pinning. The screen-side test here builds its
  fixture by calling the real `buildNutritionDetailParams` rather than
  hand-writing a params object — a hand-written fixture reproduces the same
  omission and hides the same bug.
- When a feature "works everywhere except the last step", suspect a type that
  disagrees with its source rather than a missing line of code.

## Related Files

- `client/screens/NutritionDetailScreen.tsx` — the derived `NutritionDetailRoute`
  that replaced the local restatement
- `client/navigation/RootStackNavigator.tsx` — `RootStackParamList["NutritionDetail"]`,
  the single source of truth
- `client/screens/scan-screen-utils.ts` — `buildNutritionDetailParams`, the
  producer that derives its own shape for the same reason
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the screen-side
  test whose fixture comes from the real producer

## See Also

- [Align route params across dual-navigator screens](../conventions/align-route-params-dual-navigator-screens-2026-05-13.md) — the sibling case: one screen, two navigators, two ParamLists to keep in sync
- [Assert the rendered source, not the labelled node, when a fallback shares the label](../conventions/assert-source-not-label-when-fallback-shares-it-2026-07-30.md) — the test-side weakness found alongside this fix
