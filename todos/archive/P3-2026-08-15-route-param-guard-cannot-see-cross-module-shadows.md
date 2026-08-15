---
title: "check-route-params.js cannot see a cross-module route-param shadow — close the residual by construction, not by a wider regex"
status: completed
priority: low
created: 2026-08-15
updated: 2026-08-15
assignee:
labels: [deferred, typescript, react-native, navigation, harness]
github_issue:
---

# The route-param guard has residuals a text scanner cannot close

## Summary

`scripts/check-route-params.js` (PR #812) catches every route-param shadow form that has
actually occurred, but it is a single-file text scanner and four residuals remain. One is
structural rather than a regex gap: a shadow **declared in another module and imported**
is unreachable in principle, and it is the natural next mutation of the exact bug the
guard was written for.

## Background

The defect class: a screen that restates its route params instead of indexing the
canonical `RootStackParamList` forks the contract, and the compiler then defends the
fork. `NutritionDetailScreen` lost two user-captured photo URIs to it (PR #742) — a user
completed a three-step capture flow and got back a stock image, with strict mode and CI
green throughout. Root cause doc:
`docs/solutions/logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md`.

PR #812 fixed the three live instances and added the guard. Three review rounds each found
the same shape of problem — a rule that _correlated_ with the intended condition instead of
_testing_ it — which is why this todo exists at all: the honest conclusion from that PR is
that detection-by-text has a ceiling here, and the residuals are documented rather than
closed. They are listed in `scripts/check-route-params.js` (KNOWN RESIDUALS) and in
`docs/solutions/conventions/completeness-claim-from-single-line-grep-is-unverified-2026-08-15.md`:

1. anything breaking the literal `type <Name> = {` adjacency — a type-parameter list
   between the name and `=` (even unused, over a plain object-literal RHS), or a
   non-literal RHS like `Readonly<{ … }>`;
2. an exported alias declared inside a screen — indistinguishable from a navigator's own
   canonical declaration;
3. **a shadow declared in another module and imported** — unreachable for a single-file
   text scanner;
4. a same-line comment ahead of the declaration, which defeats the line anchor.

Residual 3 is the one worth spending on. `tsc` cannot help either: a shadow is
type-_correct_ by construction — that is the whole defect.

## Two ways to close it — B recommended

### Option A — detect it (type-aware pass, CI only)

A `ts-morph` script resolving each `RouteProp<X, …>`'s first type argument to its
declaration and asserting the declaration lives in `client/navigation/`. Precedent exists:
`scripts/pg-lab/symbol-graph.ts` is the repo's only current `ts-morph` consumer, and
`ts-morph` is already a devDependency — no new infrastructure.

- Closes all four residuals.
- Touches **zero** app code.
- Needs a full program load, so CI-only. That matches the existing split — type-aware
  ESLint already runs in CI and is disabled in lint-staged via `ESLINT_NO_TYPE_AWARE`.
- Must call `getAliasedSymbol()` to follow re-exports: `client/types/navigation.ts`
  re-exports every ParamList, so naive symbol resolution lands there rather than on the
  navigator module and would false-positive.

### Option B — make it unrepresentable (recommended)

Export canonical per-navigator route helpers and ban bare `RouteProp` in screens:

```ts
// client/types/navigation.ts — alongside the existing ...NavigationProp exports
export type RootRoute<K extends keyof RootStackParamList> = RouteProp<
  RootStackParamList,
  K
>;
export type ProfileRoute<K extends keyof ProfileStackParamList> = RouteProp<
  ProfileStackParamList,
  K
>;
// …one per navigator
```

```js
// eslint.config.js — screens may not name RouteProp at all
"no-restricted-imports": ["error", { paths: [{
  name: "@react-navigation/native",
  importNames: ["RouteProp"],
  message: "Use RootRoute<K> / ProfileRoute<K> from @/types/navigation — a screen must not name its own ParamList.",
}]}]
```

A screen that cannot import `RouteProp` cannot pass a non-canonical ParamList to it, so
**every residual closes at once, including cross-module** — the wrong thing stops being
expressible rather than becoming detectable.

- Uses a **stock ESLint rule**, no type information, so it runs in lint-staged _and_ CI.
- **Verified 2026-08-15** against this repo's eslint + `@typescript-eslint/parser`, because
  it is the mechanism the whole option rests on and base `no-restricted-imports` is not
  obviously type-import aware. It flags **both** forms:

  ```
  typeonly.ts     1:15  error  'RouteProp' import from '@react-navigation/native' is restricted
  valueimport.ts  1:20  error  'RouteProp' import from '@react-navigation/native' is restricted
  ```

  So no `@typescript-eslint/no-restricted-imports` upgrade is needed. (That variant exists
  and adds `allowTypeImports` — which is the option you would want if you ever needed the
  opposite behaviour. We do not.)

- Cost is a one-time mechanical migration: **32 files** reference `RouteProp` under
  `client/` (31 under `client/screens/`, plus `client/hooks/useHistoryData.ts`).
  `tsc --noEmit` verifies the migration completely — a missed site cannot compile.
- Residual of B: a screen could still hand-write the raw route shape
  (`useRoute<{ params: X; name: string; key: string }>()`). Vanishingly unlikely and
  visible in review; the existing regex scanner also still runs.

**Recommendation: B.** It is strictly stronger (unrepresentable beats detectable), needs no
new tooling, and gives fast per-commit feedback instead of CI-only. The wider diff is
mechanical and compiler-verified. Take A instead if the 32-file migration is judged not
worth it — A is a genuine fallback, not a consolation.

## Acceptance Criteria

- [x] A route-param shadow declared in a **separate module** and imported into a screen is
      rejected. Add a test that pins exactly this — it is the residual this todo exists for.
      → first `invalid` case of `no-shadowed-route-paramlist`, asserting the message `data`
      so the diagnostic must keep naming the offending module.
- [x] The other three documented residuals are closed, or any still open is re-documented
      accurately (a residual list that silently goes stale is worse than none — see the
      conventions doc). → all four closed; one `invalid` case each. Three _new_, narrower
      residuals documented in the rule header.
- [x] `scripts/check-route-params.js`'s KNOWN RESIDUALS block and the matching section in
      `docs/solutions/conventions/completeness-claim-from-single-line-grep-is-unverified-2026-08-15.md`
      are updated to state what is now closed and by which layer. → the scanner is deleted, so
      its block moved into the rule; the conventions doc's "unreachable in principle" claim is
      corrected **in place** (not merely appended to) and gained a "Where this ended up" section.
- [x] No behavior change to any screen: `route.params` destructuring and downstream
      consumers are identical. `npm run check:types` is the evidence. → stronger than asked:
      **zero** files under `client/` changed. `tsc --noEmit` exit 0.
- [x] The new check runs in CI (and in lint-staged if Option B). → both, via `npm run lint`
      (CI) and the `*.{ts,tsx}` lint-staged eslint entry. Needs no type information, so
      `ESLINT_NO_TYPE_AWARE=1` does not disable it.
- [x] Whole-tree run is clean and reports a non-zero scanned/checked count. → 698 client
      files linted, 0 violations; repo-wide `npm run lint` 0 errors.

## Implementation Notes

- Do **not** try to close residual 1 by widening the regex. It was considered and declined
  in #812: skipping a type-parameter list textually wants `(?:\s*<[^{]*>)?`, which then
  breaks on a brace-containing constraint (`<T extends { x: string }>`) — a new wrong case
  for little gain. The reason to go type-aware is precisely that the text ceiling is real.
- Keep `scripts/check-route-params.js`. Under either option it stays useful as the fast
  per-commit approximation; the new layer is what makes the guarantee. Say so in its header
  rather than leaving two checks with no stated division of labour.
- Screens registered in two navigators (e.g. `FavouriteRecipesScreen`, whose
  `...NavigationProp` uses a `MealPlanStackParamList & ProfileStackParamList` intersection)
  need care under B — check `client/types/navigation.ts` for the existing precedent before
  inventing a new shape.
- Under B, follow the existing export conventions in `client/types/navigation.ts`; it
  already houses ~25 `...NavigationProp` aliases and is the natural home.

## Scope Contract

- **Mechanisms to use:** for B, the existing `client/types/navigation.ts` export module and
  ESLint's built-in `no-restricted-imports` — nothing new. For A, `ts-morph` (already a
  devDependency) following the `scripts/pg-lab/symbol-graph.ts` precedent.
- **Files in scope:** `scripts/check-route-params.js`, `scripts/__tests__/check-route-params.test.ts`,
  `docs/solutions/conventions/completeness-claim-from-single-line-grep-is-unverified-2026-08-15.md`,
  `.github/workflows/ci.yml`; plus for B: `client/types/navigation.ts`, `eslint.config.js`,
  and the 32 `RouteProp` call sites under `client/`; or for A: one new `scripts/` file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #812 landed the guard, the three fixes, and the residual documentation.

## Risks

- **Option B is a 32-file diff for a hypothetical defect.** No instance of residual 3
  exists today. If the migration churn is judged to outweigh the guarantee, take A — but
  make that call explicitly rather than shipping a partial migration, which would leave two
  conventions live at once and is worse than either.
- A false positive in a type-aware check blocks CI for everyone. Whichever option, verify
  the whole-tree run is clean **before** wiring it into CI — #812's guard was green on 697
  files at the moment it was added, and that is the bar.
- Do not let this reopen the screens themselves. The three fixed in #812 are correct and
  in sync with their navigators; this todo is about the guard, not the app code.

## Updates

### 2026-08-15 — RESOLVED, but by neither option above

Shipped **Option C**: a new `ocrecipes/no-shadowed-route-paramlist` rule in the existing
`eslint-plugin-ocrecipes`. It resolves the ParamList argument of `RouteProp` /
`NativeStackScreenProps` through ESLint scope analysis and requires it to bind to an import
from a navigator module (`@/navigation/<X>Navigator`, `./<X>Navigator`) or the
`@/types/navigation` barrel.

**Why the framing above was wrong.** This todo, the scanner's header, and the conventions
doc all asserted residual 3 was "unreachable **in principle** for a single-file scanner".
That is true of a _text_ scanner and false of an _AST_ one: the declaration is in another
module, but the `import` statement is in the linted file, so scope analysis resolves it
with no program load. Verified in-memory against this repo's eslint 9.39.1 +
`@typescript-eslint/parser` before any code was written — a cross-module import reports
`IMPORT<./shadow-types>`, a local alias `LOCAL:TSTypeAliasDeclaration`, a `Readonly<{…}>`
wrapper `NODEF:Readonly`. That single overstatement made a 31-file source migration look
like the only escape, which is the real cost of an imprecise bound.

Option C dominates both options as written:

|                                 | A (ts-morph)      | B (ban `RouteProp`) | **C (shipped)**                       |
| ------------------------------- | ----------------- | ------------------- | ------------------------------------- |
| Closes residual 3               | yes               | yes                 | yes                                   |
| Closes residuals 1, 2, 4        | yes               | yes                 | yes                                   |
| App-code migration              | 0 files           | 31 files            | **0 files**                           |
| Runs in lint-staged             | no (CI only)      | yes                 | **yes**                               |
| Covers `NativeStackScreenProps` | no                | **no**              | **yes**                               |
| New tooling                     | ts-morph consumer | second convention   | none — 6th rule in an existing plugin |

**Departure from the Scope Contract** ("No new mechanisms… for B, `no-restricted-imports`;
for A, `ts-morph`") was explicit and user-approved, not silent. `eslint-plugin-ocrecipes`
already had five rules, a `RuleTester` harness, and scope-manager use — so C adds a rule,
not a mechanism.

`scripts/check-route-params.js` was **deleted**, against this todo's "keep it" note. That
note assumed the new layer would be CI-only (A) or would leave non-screen files uncovered
(B). Under C the rule runs on the same glob, in the same two places, and catches a strict
superset — so there was no division of labour to state, only two residual lists to keep in
sync.

Its ten test cases did **not** all "port" — and in a todo about unverified
completeness claims, the exact accounting is the point:

- **7 ported directly** — inline literal, Prettier-wrapped literal, named local
  alias, `declare`-prefixed alias, canonical ParamList, a `RouteParams` alias
  derived from the canonical list, and a file with no `RouteProp`.
- **2 inverted by design** — `export declare type P = { … }` and an exported
  `ProfileStackParamList` declared inside a screen were `exit 0` (valid) for the
  scanner and are **errors** now. That is residual 2 closing: `export` was only
  ever a proxy for "this is a navigator's own declaration", and the filename
  carve-out tests the real condition. The valid counterpart is the new
  `client/navigation/RootStackNavigator.tsx` case.
- **1 dropped** — "reports how many files it actually scanned". ESLint has no
  equivalent, so the _property_ it protected (a guard that checks nothing is
  green and meaningless) moved to a new `eslint.config.js wiring` test asserting
  the rule resolves to `error` for client paths and to nothing for server paths.
  That pins the glob rather than a file count, and it was verified two-sided:
  removing the rule from `eslint.config.js` fails it with
  `expected null to deeply equal [ 2 ]`.

Evidence: 698 client files linted with 0 violations; a deliberate two-sided control (a real
cross-module shadow planted in `client/screens/`) was rejected with the right diagnostic
before being removed; `npm run lint` 0 errors repo-wide with type-aware rules on;
`tsc --noEmit` exit 0; 569 tests pass; `lint:suppress:check` exit 0 with
`eslint-suppressions.json` unchanged (the rule is not absorbed into suppressions).

Residuals now, all documented in the rule's own header: a wrong ParamList declared in an
allowlisted module (irreducible — something must be the source of truth); `useRoute<{ params;
name; key }>()` hand-written to name no constructor; and navigation-only constructors
(`NativeStackNavigationProp`, `CompositeNavigationProp`), which take a ParamList but carry
no route params, so a shadow there degrades autocomplete rather than dropping a param.

Also filed under an existing todo rather than duplicated: `eslint-plugin-ocrecipes/**`
routes to no injection domain, so editing the repo's own lint rules gets zero pattern
injection — appended to `todos/P3-2026-08-11-unrouted-surfaces-domain-map-decision.md`.

**Review round (code-reviewer, PR #816) found the first cut was wrong in the same way #812
was wrong three times.** `guardedConstructor` ended with a name-match fallback: when a type
name resolved to no import, it matched the literal string `RouteProp`. That is
match-the-characters behaviour smuggled back in at the rule's entry point, and it was worse
than cosmetic:

- **False positive.** An unrelated local `type RouteProp<P, K> = { params: P[K] }` was
  flagged and told to "import the ParamList from its navigator" — advice about a library the
  file never mentions. The fallback had no legitimate trigger to compensate: `RouteProp` and
  `NativeStackScreenProps` are ordinary named exports, never ambient globals, so in code that
  compiles a real reference is always import-bound.
- **It was silently load-bearing for the test suite.** Deleting it failed **11 of 14** invalid
  cases — those cases had never imported the constructor, so they were passing through the
  fallback, not through scope resolution. The suite's own header claimed to prove "where the
  identifier is BOUND, not what the text near it looks like", and for most cases proved the
  opposite. The valid case pinning the navigator filename carve-out was worse still: it would
  have passed if the rule did nothing at all.

Fixed by deleting the fallback, importing the constructor in every case, and re-verifying by
mutation: breaking `importBindingOf` now fails **15 of 15** invalid cases (was 4). A second
finding — `Nav.RouteProp<…>` through a namespace import was unguarded, because
`shadowDetail` walked `TSQualifiedName` on the ParamList side and `guardedConstructor` did
not on the constructor side — was closed rather than documented, since it was three lines of
symmetry. Whole-tree re-verified after both changes: 698 files, 0 violations.

The lesson is the todo's own, one level up: **a guard's tests can pass through the exact
mechanism the guard was written to abolish, and a green suite will not tell you.** Only
deleting the suspect branch and re-running did.

### 2026-08-15

- Created from the residual flagged when PR #812 merged. The guard closed every form that
  had actually occurred; this is about the forms it structurally cannot see.
