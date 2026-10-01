---
title: 'Migrating a Vite/Vitest-loaded TS config to survive the future native config loader default'
track: knowledge
category: best-practices
module: shared
tags: [vitest, vite, testing, typescript, esm, eslint, tsconfig, tooling]
applies_to: ['vitest.config.mts', 'vitest.*.config.ts']
created: '2026-09-23'
---

# Migrating a Vite/Vitest-loaded TS config to survive the future `configLoader: 'native'` default

## When this applies

Vite ≥8 warns: `Your Vite config uses features that are unsupported by
configLoader: 'native', which is planned to become the default in a future
major version of Vite`. It fires under the *current* default loader
(`configLoader: 'bundle'`) as a forward-looking compat check — you don't have
to opt into the native loader to see it. Re-run this checklist any time that
warning appears on a config file this repo owns (`vitest.config.mts` today;
any sibling `vitest.*.config.ts` or a future `vite.config.ts` if one is ever
added).

## Smell patterns

- The warning names your config file and says "ESM syntax in a file loaded as
  CommonJS" — the repo has no `"type": "module"` in `package.json`, so a
  `.ts` file with `import`/`export` is CJS-loaded despite ESM syntax.
- After renaming to `.mts` to silence that, the warning reappears listing
  `__dirname`/`__filename` or an extensionless relative import instead — these
  are a **second, independent** check that only runs once the file is
  classified as ESM (see Root Cause below).

## Why

Read straight from the installed `vite` package
(`node_modules/vite/dist/node/chunks/node.js`,
`createNativeConfigCompatPlugin`/`formatNativeConfigIncompatWarning`), not
inferred: the compat plugin runs on the config file and everything it
statically or dynamically imports (`ImportDeclaration`/`ImportExpression`
with a `Literal` source), and its checks are gated in two stages:

1. `isFilePathESM(id)` — true only for a `.mjs`/`.mts` extension
   (`/\.m[jt]s$/`), or a `.cjs`/`.cts` extension (→ false), or (for anything
   else) the nearest `package.json`'s `"type"` field. **Not** decided per-file
   by syntax content.
2. If **not** ESM: any `import`/`export` statement in the file is flagged as
   `esm-syntax-in-cjs` ("Use a `.mjs` extension or set `"type": "module"`").
   This is the warning you see first, and it's the only one Vite can detect
   before the file is renamed.
3. If **ESM**: a *different* set of checks runs instead —
   `__dirname`/`__filename` usage (→ `import.meta.dirname`/`import.meta.filename`),
   and any relative `import`/`export … from`/dynamic `import()` specifier that
   lacks a `.{,m,c}{j,t}s{,x}` extension on its last path segment (→
   `extensionless-import`, "Add the file extension") or resolves to a
   directory index (→ `directory-index-import`). **These only surface after
   you fix #2** — a single rename-and-rerun cycle is not enough; budget for a
   second pass.

Renaming to `.mts` is the minimal fix (vs. project-wide `"type": "module"`,
which has much larger blast radius on a mixed CJS/ESM repo like this one) —
`isFilePathESM` treats `.mts` as ESM unconditionally, regardless of the
nearest `package.json`. This matches the two-part fix documented by the
`niondigital/vitest-expo` migration guide for the identical Expo-app-with-no-
`"type":"module"` shape.

## Examples

Full checklist, in order, each item empirically verified during the todo that
produced this doc (`todos/archive/P3-2026-09-23-vite-native-config-loader-warning.md`):

1. **Rename** `foo.config.ts` → `foo.config.mts` (`git mv`, preserves
   history). Vitest's own config-file discovery
   (`node_modules/vitest/dist/chunks/constants.*.js`'s `CONFIG_NAMES`/
   `CONFIG_EXTENSIONS`) already covers `.mts` — no `--config` flag needed
   anywhere that currently omits one.
2. **`__dirname`/`__filename` → `import.meta.dirname`/`import.meta.filename`**
   everywhere in the renamed file (safe on this repo's pinned Node `24.x`;
   stable since Node 20.11/21.2).
3. **Add the extension to every relative import of the renamed file** —
   including in files you are *not* renaming (a sibling config that does
   `import base from "./vitest.config"` must become `"./vitest.config.mts"`
   even though the sibling itself stays `.ts`), and dynamic
   `await import("../foo")` → `await import("../foo.mts")`.
4. **`tsconfig.json`**: add `"**/*.mts"` to `include` (TypeScript's `*.ts`
   include glob does **not** match `.mts`, so the renamed file silently drops
   out of `tsc --noEmit` type-checking otherwise — a real, silent coverage
   loss, not just a lint nit) and `"allowImportingTsExtensions": true`
   (required once a specifier carries an explicit `.mts`; inert under
   `noEmit`, which every `tsc`-consuming script in this repo already sets via
   `expo/tsconfig.base.json`. Confirm no OTHER tsconfig in the repo emits via
   `tsc -p`/`tsc --project` before relying on that — this repo's server build
   uses `esbuild` directly, so it was safe here).
5. **`tsconfig.check.json`** (or any other tsconfig with a hardcoded
   `"exclude": ["...", "foo.config.ts"]` literal) — update the literal to
   `.mts` or it silently stops excluding what it meant to.
6. **`eslint.config.js`**: `eslint-config-expo/flat/utils/typescript.js` (and
   most hand-rolled flat configs) assign the TS parser only to
   `**/*.ts`/`**/*.tsx`/`**/*.d.ts` — **not** `.mts`. Verify empirically
   (`npx eslint <renamed file>`); a bare `.mts` file with no parser
   assignment is silently **ignored** ("File ignored because no matching
   configuration was supplied", exit 0 — not a lint error, so it won't fail a
   `--max-warnings`-less CI step, but the file loses ALL lint coverage,
   including type-aware `no-floating-promises`/`no-misused-promises` on any
   async code in it). Add a `files: ["**/*.mts"]` block assigning
   `languageOptions.parser` (and mirror any project-specific unused-vars
   overrides expo's own `.ts` block carries, or `no-unused-vars` false-flags
   every intentionally-unused destructured/rest param), and widen any
   project-added type-aware block's `files` glob (e.g.
   `"**/*.{ts,tsx}"` → `"**/*.{ts,tsx,mts}"`).
7. **`package.json`**: widen the `lint-staged` glob and any `prettier
   --check`/`--write` glob (`"**/*.{js,ts,tsx,...}"`) to include `mts`, or
   commits/format runs silently stop touching the renamed file. Low
   consequence if `npm run lint`'s `prettier/prettier` ESLint rule already
   covers `.mts` (step 6) — but still worth fixing for consistency.
8. **Any shell script that gates CI/preflight on a changed-file pathspec**
   (`git diff --name-only -- '*.ts' '*.tsx'`) needs `'*.mts'` added too, or a
   push that ONLY touches the renamed file silently skips scoped
   lint/type/test steps that key off that list. Measure it, don't infer it:
   run the gate and grep its own echoed command for the renamed file.
9. **Any script with a hardcoded default path** to the old filename
   (`path.resolve(dir, "../foo.config.ts")`, used when no `--config-file` /
   `--config` flag is passed) — grep the whole repo for the old filename,
   not just the obviously-related files; this is the kind of reference a
   local diff review misses because the two files never appear in the same
   hunk.

## Exceptions

A config file some OTHER tool loads by `require()`/CJS resolution (not Vite's
`loadConfigFromFile`) should stay `.ts`/`.cjs` — the `.mts` rename is specific
to Vite/Vitest's own config loader compat check, not a blanket "ESM is
better" rule. `vitest.integration.config.ts` and `vitest.mutation.config.ts`
were deliberately left as `.ts` in the todo this doc documents (only their
`import … from "./vitest.config"` specifier needed the `.mts` extension) —
each will independently print the same `esm-syntax-in-cjs` warning until
someone renames it too; that is tracked as a `DEFERRED_WARNINGS` item, not
silently "fixed" by proxy.

## Related Files

- `vitest.config.mts`, `scripts/pg-lab/vitest-flake-reporter.mts` — the two
  files this todo renamed
- `tsconfig.json`, `tsconfig.check.json`, `eslint.config.js`,
  `scripts/preflight.sh`, `scripts/coverage-ratchet.ts`,
  `scripts/__tests__/coverage-ratchet.test.ts`, `package.json` — the
  mechanically-required companion edits enumerated above
- `node_modules/vite/dist/node/chunks/node.js` — `nativeConfigCompat.ts`'s
  compiled output; the primary source for the Why section (re-read this on
  a future Vite bump — the check's exact shape is not a public API and can
  change)

## See Also

- [pre-commit-skips-type-aware-eslint-run-it-before-push](../conventions/pre-commit-skips-type-aware-eslint-run-it-before-push-2026-06-19.md) — another case where a repo-added type-aware ESLint block's `files` glob has to be kept in sync with what actually needs coverage
