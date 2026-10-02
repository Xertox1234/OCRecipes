---
title: "A root-level .mjs file with // @ts-check is type-checked only in the editor unless a .ts file imports it — tsconfig include has no .mjs; prove it with a scoped tsc and a seeded error"
track: knowledge
category: conventions
module: shared
tags: [typescript, harness, tooling, ts-check, jsdoc]
applies_to: ["*.mjs", "scripts/**/*.mjs"]
created: 2026-10-01
---

# A root .mjs with @ts-check is checked only in the editor unless a .ts imports it

## Rule

The root `tsconfig.json` has `"include": ["**/*.ts", "**/*.tsx", "**/*.mts"]`, so no `.mjs`
file is a root of the program. A `// @ts-check` `.mjs` file enters `check:types` and
preflight's whole-program tsc **only** if some included `.ts` file imports it. Expo's base
config sets `allowJs: true`, so an imported `.mjs` is then checked under `strict`.

- `scripts/ci/mutation-on-diff.mjs` **is** checked, because its unit test imports it.
- `stryker.explore.conf.mjs` and `stryker.conf.mjs` are **not** checked, because nothing
  imports them. Their `@ts-check` and JSDoc types catch errors in the editor only.

To check a file the gate cannot see, run a scoped tsc, and prove the check is live with a
seeded error:

```bash
cat > tsconfig.scoped.json <<'EOF'
{ "extends": "./tsconfig.json", "include": [], "files": ["stryker.explore.conf.mjs"],
  "compilerOptions": { "incremental": false, "noEmit": true } }
EOF
npx tsc -p tsconfig.scoped.json          # expect exit 0
# control: append `/** @type {number} */ export const seeded = "x";` → expect TS2322, exit 2
rm tsconfig.scoped.json
```

## Why

A clean tsc on a file it never loaded looks the same as a clean tsc on a checked file. The
control must be a **type** error (TS2322). An annotation-in-JS error such as TS8010 is
syntax-level and fires even without `@ts-check`, so it does not prove type checking ran.

With a typed default export, `/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */`,
the check reaches inside conditional spreads. A misspelt `jsonReporter: { fileNam: … }`
inside `...(flag ? {…} : {})` fails with TS2322 (measured 2026-10-01).

## Exceptions

If a `.mjs` file is already imported by a `.ts` test, the normal gate covers it and no
scoped run is needed.

## Related Files

- `tsconfig.json`: the `include` list
- `stryker.explore.conf.mjs`, `stryker.conf.mjs`: typed configs outside the program

## See Also

- [../best-practices/vite-native-config-loader-mts-migration-2026-09-23.md](../best-practices/vite-native-config-loader-mts-migration-2026-09-23.md): `.mts` configs, which ARE included
