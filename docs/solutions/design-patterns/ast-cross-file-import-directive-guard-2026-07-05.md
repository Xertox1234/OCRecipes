---
title: AST-based cross-file static guard (TypeScript compiler API) for a per-declaration property, placed in scripts/
track: knowledge
category: design-patterns
tags: [static-guard, typescript-compiler-api, ast, cross-file, vitest, testing, reanimated, worklets, source-scanning]
module: client
created: '2026-07-05'
---

# AST-based cross-file static guard (TypeScript compiler API) for a per-declaration property, placed in scripts/

## When this applies

You need a static guard that checks a **property of a declaration in a DIFFERENT file** than the call site — not just "is this name called anywhere" (a regex call-shape guard suffices for that, see [../design-patterns/facade-only-enforced-by-source-grep-guard-test-2026-06-26.md](./facade-only-enforced-by-source-grep-guard-test-2026-06-26.md)). Example: "does the imported function this worklet calls carry a `\"worklet\"` directive at its own definition?" That requires resolving the import to a file, parsing THAT file, and inspecting its declaration — a regex on the call site alone can't see across the file boundary. A full TypeScript AST (via the `typescript` compiler API, already a direct devDependency — no new package needed) gets this right where a regex heuristic gets noisy: bare-identifier calls vs. member-expression calls, arrow/function bodies vs. object-literal handler forms, named vs. type-only vs. renamed imports, and scope/shadowing all need real syntax tree structure, not string matching.

## Why

Two things distinguish this from a routine "cross-file invariant" script call per [custom-lint-scripts-accessibility-colors-2026-05-13.md](../best-practices/custom-lint-scripts-accessibility-colors-2026-05-13.md):

1. It needs to check a **declaration-level property** (does this exported function's body start with a directive?), not just detect a forbidden call shape.
2. It's enforced as part of the **Vitest suite** (`npm run test:run`, i.e. the CI gate), not pre-commit `lint-staged` — matching the precedent in `server/routes/__tests__/auth-route-wiring.test.ts` ([route-tests-mock-auth-hide-wiring-seam-2026-06-26.md](../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md)), which is itself a source-scanning cross-file guard living in the test suite, not `scripts/check-*.js`.

**File location:** even though the guard's SUBJECT MATTER is client/React-Native/Reanimated-specific, the guard ITSELF is Node-only static-analysis tooling with zero runtime/RN dependency (just `typescript` + `node:path`/`node:fs`). This repo's established convention places that class of tool in `scripts/` + `scripts/__tests__/` (e.g. `scripts/check-hardcoded-colors.js`, `scripts/check-idor-storage.js`, and Vitest-integrated precedents `scripts/__tests__/build-domain-map.test.ts`, `scripts/__tests__/check-eval-dataset-secrets.test.ts`) — by **tooling kind**, not by the domain it inspects. A first pass at this guard was placed in `client/lib/` (the domain directory) and a code review caught the mismatch; moving it to `scripts/` was a pure location change with no logic change.

## Examples

`scripts/worklet-directive-guard.ts` + `scripts/__tests__/worklet-directive-guard.test.ts` (this todo): scans `client/**` for worklet-context call sites (`runOnUI`, `useAnimatedStyle`, `useAnimatedScrollHandler`, Gesture-builder callbacks, etc.), and for each bare-identifier call inside a worklet body that resolves to a named import (relative path or `@/`/`@shared/` alias only — default/namespace imports and bare package specifiers are out of scope), parses the resolved target file and checks whether the exported declaration's body opens with a `"worklet";` directive statement.

Key structural choices worth reusing:

```ts
// 1. A minimal filesystem seam makes the core logic unit-testable with
//    synthetic in-memory fixtures, with a separate integration test doing the
//    real fs walk — you get both a fast, precise regression proof AND a real
//    "does the whole repo pass today" gate, without conflating the two:
export interface ScanFsAdapter {
  readFile(absPath: string): string | null;
}

// 2. Resolve ONLY named imports whose specifier is relative or a known alias;
//    everything else (default/namespace/bare-package imports) is explicitly
//    out of scope — this both narrows the surface area to what's checkable
//    and, as a side effect, naturally excludes library built-ins (they're
//    never resolvable to a local file) without needing an allowlist of names.

// 3. A local declaration ALWAYS shadows a same-named import. Skipping the
//    scope-walk (isLocallyShadowed) is the single easiest way to introduce a
//    false positive in this class of guard — a nested function/const/param/
//    catch-clause/for-loop variable sharing an import's name must never be
//    attributed to the import. Walk the identifier's parent chain up to (not
//    including) the SourceFile, checking each enclosing function's parameters
//    and each enclosing Block's statements for a matching declaration.

// 4. Every "can't confidently resolve" branch (unresolvable module path,
//    re-export chain, non-function export) returns null and is treated as
//    SKIP, never as a flag — false-negative-over-false-positive is the
//    correct default for a guard whose job is to be trusted, not exhaustive.
```

**Testing shape:** pair unit tests using in-memory fixtures (prove both the regression — directive removed → flagged — and the compliant shape — directive present → not flagged, plus every deliberate scope boundary: built-ins/`Math.*` not flagged, same-file helpers not flagged, renamed/type-only imports handled, `@shared/` alias resolved, and — critically — that the shadow-check doesn't OVER-suppress a genuine offender sitting next to an unrelated local variable) with one integration test that walks the real source tree and asserts zero offenders today, with a "scans a sane number of files" floor so a broken walker can't pass vacuously.

## Exceptions

- If the check only needs to detect a forbidden call SHAPE (not a cross-file declaration property), a regex call-shape guard is simpler and sufficient — don't reach for a full AST parse. See [facade-only-enforced-by-source-grep-guard-test-2026-06-26.md](./facade-only-enforced-by-source-grep-guard-test-2026-06-26.md).
- If the check is naturally single-file (no cross-file resolution needed), prefer a `no-restricted-syntax` ESLint rule instead — the developer gets live editor feedback, which a Vitest-only guard can't provide.
- The shadow-check in this pattern only matches simple identifier bindings, not destructuring patterns (`const { badFn } = ...`) — a destructured local/parameter sharing an import's name reproduces a false positive. Accepted as a rare, documented gap rather than solved, to avoid over-engineering a guard whose value is in catching the common case cheaply.

## Related Files

- `scripts/worklet-directive-guard.ts` — the guard implementation
- `scripts/__tests__/worklet-directive-guard.test.ts` — unit + integration tests
- `server/routes/__tests__/auth-route-wiring.test.ts` — the sibling precedent (regex-based, not AST) that established "source-scanning Vitest test as a CI-enforced static guard" in this repo
- `docs/rules/react-native.md` — the one-line project rule this guard enforces

## See Also

- [facade-only-enforced-by-source-grep-guard-test-2026-06-26.md](./facade-only-enforced-by-source-grep-guard-test-2026-06-26.md) — the simpler regex call-shape guard mechanism for when cross-file declaration inspection isn't needed
- [route-tests-mock-auth-hide-wiring-seam-2026-06-26.md](../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md) — the wiring-seam guard that established source-scanning Vitest tests as a repo pattern
- [custom-lint-scripts-accessibility-colors-2026-05-13.md](../best-practices/custom-lint-scripts-accessibility-colors-2026-05-13.md) — when a pre-commit `scripts/check-*.js` lint-staged script is the right mechanism instead
- [reanimated-worklet-util-needs-directive-across-imports-2026-06-27.md](../runtime-errors/reanimated-worklet-util-needs-directive-across-imports-2026-06-27.md) — the incident this guard defends against
