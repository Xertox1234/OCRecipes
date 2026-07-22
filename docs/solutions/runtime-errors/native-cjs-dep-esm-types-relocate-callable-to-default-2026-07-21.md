---
title: 'A native/CJS dependency that adds ESM .d.mts type declarations in a minor bump relocates its callable export to `.default`'
track: bug
category: runtime-errors
tags: [dependency-upgrade, esm-cjs-interop, dynamic-import, typescript, sharp, native-module]
module: shared
applies_to: ['scripts/**/*.ts', '**/*.ts']
symptoms: ['tsc TS2739 — namespace return type no longer assignable from the .default export', 'tsc TS2349 — the pkg(...) call site is not callable', 'would-be runtime TypeError pkg is not a function if the type error is bypassed', 'break appears purely from a dependency version bump — consumer code unchanged']
created: 2026-07-21
severity: medium
---

# A native/CJS dependency that adds ESM .d.mts type declarations in a minor bump relocates its callable export to `.default`

## Problem

A minor version bump of a CJS-published native dependency (concretely `sharp` `^0.34.5` → `^0.35.0`, resolving 0.35.3) broke a dynamic-import loader that had worked for years, with a `tsc` compile error and a latent runtime crash — even though the loader code itself was untouched. The break was caught by the push fast gate's whole-program `tsc`, which matters because the consuming script (`scripts/generate-ingredient-icons.ts`) is **never run by CI** — `tsc` was its only safety net.

The pre-bump loader:

```ts
async function loadSharp(): Promise<typeof import("sharp")> {
  const mod = await import("sharp");
  return mod.default ?? mod;
}
// caller: const sharp = await loadSharp(); sharp(buf).resize(256, 256).png().toBuffer();
```

After the bump, `tsc` reported:

```
scripts/generate-ingredient-icons.ts(40,3): error TS2739: Type 'SharpConstructor' is missing
  the following properties from type 'typeof import(".../sharp/dist/index")': sharp, sharp
scripts/generate-ingredient-icons.ts(183,29): error TS2349: This expression is not callable.
```

## Symptoms

- `TS2739` "missing properties … from type `typeof import("pkg")`" on `return mod.default` — the declared namespace return type no longer matches the default export.
- `TS2349` "This expression is not callable" at the `pkg(...)` call site downstream.
- The error appears purely from a version bump; no consumer code changed.
- If the type error were suppressed, `pkg(...)` throws `pkg is not a function` at runtime (the module **namespace** object is not callable).

## Root Cause

`sharp` 0.35 kept its **CJS runtime** (`package.json`: `"type": "commonjs"`, `"main": "./dist/index.cjs"`, ships `export = sharp`) but pointed `"types"` at a new **ESM declaration** — `"./dist/index.d.mts"` (`export const sharp: SharpConstructor; export default sharp;`).

Under `esModuleInterop` + `moduleResolution: bundler`, `await import("sharp")` is now typed as the ESM **namespace**: the callable `SharpConstructor` is the `default` export, and the namespace object itself is **not callable** (it only re-exports `sharp`, named helpers, etc.). The old loader:

1. **Return type** `typeof import("sharp")` = the namespace → no longer assignable from `mod.default` (`SharpConstructor`) → `TS2739`.
2. **Call site** `sharp(...)` where `sharp` is typed as the namespace → `TS2349` not callable.
3. The `?? mod` fallback was **dead and wrong** for the new shape: at runtime `typeof (await import("sharp")) === "object"` and calling it throws — only `.default` is the function.

This is the general trap: **a dependency can change its `exports`/`types` map (CJS↔ESM interop shape) in a non-major release**, relocating the callable from the namespace to `.default`. Semver "minor" describes the public API contract, not the module-resolution shape TypeScript sees.

## Solution

Type the loader as the **default export's type** and return `mod.default` directly:

```ts
async function loadSharp(): Promise<(typeof import("sharp"))["default"]> {
  // sharp ships CJS (`export = sharp`) with ESM type declarations (0.35+); under
  // ESM interop the callable constructor is the `.default` export, not the
  // (non-callable) module namespace.
  const mod = await import("sharp");
  return mod.default;
}
```

Verified empirically before dropping the fallback (do not just trust the types):

```
$ node -e "import('sharp').then(m => console.log(typeof m, typeof m.default))"
object function        # namespace is not callable; .default is the constructor
```

No `as` cast is needed — `mod.default` already resolves to `SharpConstructor` under the new `.d.mts`. (Reaching for `(x) as SomeType` here would only paper over the shape mismatch.)

## Prevention

- On **any** dependency bump — especially native/CJS libs (`sharp`, `bcrypt`, `canvas`, image/crypto/db drivers) — check whether its `package.json` `exports`/`types`/`type` changed, not just its version number. A `.d.ts` → `.d.mts` switch is the tell.
- Keep dynamic-import loaders typed as the **thing you actually use** (`(typeof import("pkg"))["default"]` for a default-exported callable), not the whole namespace — the narrower type surfaces this break at the loader instead of at every call site.
- Empirically confirm interop shape with `node -e "import('pkg').then(m => console.log(typeof m, typeof m.default))"` before adding or removing a `?? mod`-style fallback.
- Rely on **whole-program `tsc`** (the push fast gate) to catch this for scripts CI never executes — a bump that breaks a build-only script is invisible to the test suite.

## Related Files

- `scripts/generate-ingredient-icons.ts` — the fixed `loadSharp()` (PR #691, `f5e83dad`)
- `package.json` — `devDependencies.sharp` bump; note `sharp` is dev-only (asset-generation script, omitted from the prod bundle via `npm ci --omit=dev`)

## See Also

- [../design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md](../design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md) — another dynamic-`import()` interop nuance (module-cache reset for env-dependent tests)
- [../conventions/vitest-transform-no-typecheck-use-tsc-for-type-evidence-2026-07-14.md](../conventions/vitest-transform-no-typecheck-use-tsc-for-type-evidence-2026-07-14.md) — why whole-program `tsc`, not the test transform, is the authoritative type gate
