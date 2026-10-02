---
title: 'Migrating a Vite/Vitest-loaded TS config to survive the future native config loader default'
track: knowledge
category: best-practices
module: shared
tags: [vitest, vite, testing, typescript, esm, eslint, tsconfig, tooling]
applies_to: ['vitest.config.mts', 'vitest.*.config.ts', 'vitest.*.config.mts']
created: '2026-09-23'
last_updated: '2026-10-02'
---

# Migrating a Vite/Vitest-loaded TS config to survive the future `configLoader: 'native'` default

## When this applies

Vite ≥8 warns: `Your Vite config uses features that are unsupported by
configLoader: 'native', which is planned to become the default in a future
major version of Vite`. It fires under the *current* default loader
(`configLoader: 'bundle'`) as a forward-looking compat check — you don't have
to opt into the native loader to see it. Re-run this checklist any time that
warning appears on a config file this repo owns (`vitest.config.mts` and its
two siblings `vitest.integration.config.mts` / `vitest.mutation.config.mts`
are migrated; any new `vitest.*.config.ts` or a future `vite.config.ts` needs
the same pass).

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

Full checklist, in order, each item empirically verified: items 1-9 during the
todo that produced this doc
(`todos/archive/P3-2026-09-23-vite-native-config-loader-warning.md`), items 10-11
and the closing verification recipe during the follow-up that renamed the two
sibling configs
(`todos/archive/P3-2026-09-24-vitest-sibling-configs-native-loader-warning.md`):

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
   `"**/*.{ts,tsx}"` → `"**/*.{ts,tsx,mts}"`). That restores parsing, not the
   whole TS ruleset: measured with `npx eslint --print-config` on one root path
   spelled both ways, `.ts` gets 436 rules and `.mts` 426. The ten `.mts` lacks
   are the base `no-useless-constructor` and nine `@typescript-eslint/*` rules
   (`array-type`, `consistent-type-assertions`, `no-dupe-class-members`,
   `no-empty-object-type`, `no-extra-non-null-assertion`, `no-redeclare`,
   `no-require-imports`, `no-useless-constructor`, `no-wrapper-object-types`);
   immaterial for a spread-and-override config like these.
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
10. **Path regexes in CI gates — the reference a literal grep cannot find.**
    The two required mutation gates (`.github/workflows/mutation-goal-safety.yml`,
    `.github/workflows/mutation-non-excluded.yml`) decide whether to run Stryker by
    `grep -qE`-ing `git diff --name-only` against an ERE that names the harness
    config with escaped dots (`vitest\.mutation\.config\.mts` since the rename,
    `vitest\.mutation\.config\.ts` before it), so a literal
    `git grep vitest.mutation.config.mts` finds nothing there. Sweep with
    `git grep -nP 'vitest\\?\.(integration|mutation)\\?\.config\\?\.ts'` (`-P`: under
    `-E`, `\b` silently matches nothing on this git) and update the regex in the same
    change. Do not read the rename PR's own green as proof it was updated:
    `git diff --name-only` lists a rename by its NEW path only, and the PR will
    usually also edit another file the same regex matches. Measured 2026-10-02
    (bash 5.3, with a positive and a negative control): the OLD regex fired on the
    rename PR's whole changed-file list, because it also edits `stryker.conf.mjs`, another
    alternative of the same ERE, but did NOT fire on `vitest.mutation.config.mts`
    alone, which the new regex does. A rename-only PR, or the next edit of the
    renamed file, would have self-scoped both required gates to green without running
    Stryker. Probe the regex against a changed-file list holding only the renamed path.
11. **Pattern-injection routing.** The injection hook (`.claude/hooks/inject-patterns.sh`) and the
    routing CLI (`scripts/lib/path-domains.ts --typescript-crosscut`) fall back to the
    `typescript` domain for `.ts`/`.tsx` paths only, so a root `.mts` file is routed only if a
    basename rule names it (`vitest.config.*` does). Measured 2026-10-02 by running the real
    hook (`PATTERN_INJECT_NO_LOG=1`, one Edit event per path): `vitest.mutation.config.ts` and
    `vitest.integration.config.ts` each got a payload of about 4.9 KB (a `typescript` rules
    section and a solutions list that included this doc); the `.mts` spellings got about 1.2 KB,
    the discipline preamble only, and an unmatched `zzz-no-rule.ts` / `zzz-no-rule.mts` pair
    (about 5.0 KB vs 1.2 KB) shows the extension is the cause. Retrieval selects by routed
    domain first (`docs/solutions/README.md`), so the `applies_to` entries for
    `vitest.*.config.mts` here and in the other two docs cannot fire from the hook for these
    files; they still serve a todo executor's direct `applies_to` grep. Run the routing CLI on
    the new spelling before renaming. Widening the rule means editing
    `scripts/lib/path-domains.ts` and regenerating `domain-map.sh` and
    `copilot-instructions.md`, which the follow-up that renamed the siblings left out of its
    scope.

Close the loop with a before/after pair per file, each with a denominator:

- `npx vitest list --config <renamed>` prints the `(!) Your Vite config uses features …`
  block while the problem is present. Assert zero such lines AND at least one test
  listed — a config that fails to load prints no warning either. For
  `vitest.mutation.config.mts`, set `STRYKER_VITEST_INCLUDE='["<test file>"]'` first or it
  lists nothing.
- A config Stryker consumes: `MUTATION_TARGET=<target> npx stryker run --dryRunOnly`
  (Stryker 9.6.1) runs only the initial test pass, in seconds, and must report
  `Initial test run succeeded. Ran N tests` with N equal to the `vitest list` count.
  `stryker.explore.conf.mjs` needs its own run, with `STRYKER_EXPLORE_MUTATE` and
  `STRYKER_EXPLORE_TEST` set: `npx stryker run stryker.explore.conf.mjs --dryRunOnly`.
- A config an npm script consumes: run the script (`npm run test:integration:http`) and
  grep its output for the warning marker.

## Exceptions

A config file some OTHER tool loads by `require()`/CJS resolution (not Vite's
`loadConfigFromFile`) should stay `.ts`/`.cjs` — the `.mts` rename is specific
to Vite/Vitest's own config loader compat check, not a blanket "ESM is
better" rule. `vitest.integration.config.ts` and `vitest.mutation.config.ts`
were deliberately left as `.ts` in the first todo this doc documents (only
their `import … from "./vitest.config"` specifier needed the `.mts`
extension), so each independently printed the same `esm-syntax-in-cjs`
warning. They were renamed to `.mts` afterwards
(`todos/archive/P3-2026-09-24-vitest-sibling-configs-native-loader-warning.md`),
which is why `applies_to` carries both `vitest.*.config.ts` (a future
unmigrated sibling still finds this doc) and `vitest.*.config.mts`.

## Related Files

- `vitest.config.mts`, `scripts/pg-lab/vitest-flake-reporter.mts` — the two
  files the first todo renamed
- `vitest.integration.config.mts`, `vitest.mutation.config.mts` — the two
  sibling configs the follow-up todo renamed
- `stryker.conf.mjs`, `stryker.explore.conf.mjs` — the two consumers that
  name `vitest.mutation.config.mts` literally (`configFile:`)
- `.github/workflows/mutation-goal-safety.yml`,
  `.github/workflows/mutation-non-excluded.yml` — the two required gates that
  carry the full filename only inside an escaped-dot ERE
  (`vitest\.mutation\.config\.mts`), which a literal grep cannot find (item 10)
- `scripts/lib/path-domains.ts` — the routing source behind item 11
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
- [pipefail echo|grep condition fails open](../logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — the other way the same self-scoping gates fail open: shell mechanics, where item 10 is the keyed paths
- [gh pr diff --name-only lists renames by new path only](../conventions/gh-pr-diff-name-only-lists-renames-new-path-only-2026-07-10.md) — why a rename shows only its new path (item 10)
