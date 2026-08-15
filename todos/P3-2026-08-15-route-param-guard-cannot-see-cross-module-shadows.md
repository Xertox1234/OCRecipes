---
title: "check-route-params.js cannot see a cross-module route-param shadow — close the residual by construction, not by a wider regex"
status: backlog
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

- [ ] A route-param shadow declared in a **separate module** and imported into a screen is
      rejected. Add a test that pins exactly this — it is the residual this todo exists for.
- [ ] The other three documented residuals are closed, or any still open is re-documented
      accurately (a residual list that silently goes stale is worse than none — see the
      conventions doc).
- [ ] `scripts/check-route-params.js`'s KNOWN RESIDUALS block and the matching section in
      `docs/solutions/conventions/completeness-claim-from-single-line-grep-is-unverified-2026-08-15.md`
      are updated to state what is now closed and by which layer.
- [ ] No behavior change to any screen: `route.params` destructuring and downstream
      consumers are identical. `npm run check:types` is the evidence.
- [ ] The new check runs in CI (and in lint-staged if Option B).
- [ ] Whole-tree run is clean and reports a non-zero scanned/checked count.

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

### 2026-08-15

- Created from the residual flagged when PR #812 merged. The guard closed every form that
  had actually occurred; this is about the forms it structurally cannot see.
