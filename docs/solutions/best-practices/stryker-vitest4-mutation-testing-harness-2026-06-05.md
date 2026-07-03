---
title: Stryker + Vitest 4 mutation-testing harness (Expo/RN repo gotchas)
track: knowledge
category: best-practices
module: server
tags: [mutation-testing, stryker, vitest, testing, expo, react-native, ci]
applies_to: [stryker.conf.mjs, stryker.targets.mjs, vitest.mutation.config.ts]
created: '2026-06-05'
---

# Stryker + Vitest 4 mutation-testing harness (Expo/RN repo gotchas)

## When this applies

Running or extending Stryker mutation testing in this repo (`npm run test:mutation`,
`MUTATION_TARGET=<name> npm run test:mutation`), or adding a new target to
`stryker.targets.mjs`. Mutation testing measures whether tests *assert*, not just
*execute*: Stryker corrupts each line and a surviving mutant is a line a test runs
but never checks. See [[mutation-testing-suppress-only-equivalent-mutants-2026-06-05]]
for the integrity rules on interpreting results.

## Why (the five gotchas that make or break the harness)

Each of these cost a debug cycle to discover; configure them up front.

1. **`mutate` and Vitest `include` are independent axes.** `mutate` (in
   `stryker.conf.mjs`) picks which source files get mutants; which *tests run* still
   follows the Vitest config's `include`. Stryker's required dry run (perTest
   coverage) runs *whatever Vitest discovers* — without scoping, that boots all
   ~386 test files **plus the real-Postgres storage integration tests**, needing
   `DATABASE_URL` and tripping the `retry:2` flake. Fix: a dedicated
   `vitest.mutation.config.ts` that overrides `include` to ONLY the target's unit
   test (see env-handoff below).

2. **`mergeConfig()` concatenates arrays.** Building `vitest.mutation.config.ts`
   with `mergeConfig(base, {test:{include:[...]}})` *keeps* the base whole-suite
   globs and appends — defeating the scoping. Use **object spread** and override
   `include` explicitly.

3. **Stryker sandboxes by COPYING the whole project → crashes on iOS native dirs.**
   `ENOTSUP: operation not supported on socket, copyfile … ios/Pods/hermes-engine/
   …/hermes.framework/Resources`. The gitignored `ios/`/`android/` CocoaPods dirs
   contain framework sockets `copyfile` can't handle. Fix: `ignorePatterns: ["ios",
   "android", ".expo", "server_dist", "coverage"]` in `stryker.conf.mjs`. (Stryker
   does not auto-skip gitignored dirs from the sandbox copy.)

4. **Stryker's type-check stripper conflicts with the Expo babel config.**
   `WARN DisableTypeChecksPreprocessor … Cannot use the decorators and
   decorators-legacy plugin together`. Fix: `disableTypeChecks: false` — the Vitest
   runner transpiles via esbuild (no type-check), so type-invalid mutants run
   regardless; the preprocessor is unnecessary here.

5. **The Vitest runner forces coverage off and ignores `coverageAnalysis`.** Per
   the vitest-runner docs it sets `coverage: { enabled: false }` (non-overridable),
   so the `coverage.thresholds` inherited from `vitest.config.ts` are **never
   evaluated** during the dry run, and `coverageAnalysis` is always `perTest`
   regardless of config. Don't waste time defending against a threshold failure.

Plus one DX footgun: add `.stryker-tmp` to `vitest.config.ts`'s `test.exclude`, or a
local `test:run` after `test:mutation` discovers the sandbox's copied `*.test.ts`
and spuriously fails.

## Examples

**Single source of truth for targets** — `stryker.targets.mjs` maps a friendly name
to BOTH axes; `stryker.conf.mjs` resolves it and hands the test glob to the Vitest
config via env (Stryker evaluates its config in the main process before spawning
runner workers, which inherit `process.env`). This avoids a `.ts`→`.mjs` import
(which would trip type-aware ESLint's project-service) AND keeps the two axes from
drifting:

```js
// stryker.conf.mjs
import { resolveTarget } from "./stryker.targets.mjs";
const targetName = process.env.MUTATION_TARGET ?? "macro-gap-context";
const { mutate, testInclude } = resolveTarget(targetName);
process.env.STRYKER_VITEST_INCLUDE = JSON.stringify(testInclude); // handoff
export default { testRunner: "vitest", vitest: { configFile: "vitest.mutation.config.ts" },
  coverageAnalysis: "perTest", ignorePatterns: ["ios","android",".expo","server_dist","coverage"],
  disableTypeChecks: false, mutate, /* incremental, reporters, tempDirName */ };
```

```ts
// vitest.mutation.config.ts — object spread, NOT mergeConfig
import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";
const env = process.env.STRYKER_VITEST_INCLUDE;
const include: string[] = env ? (JSON.parse(env) as string[]) : [];
export default defineConfig({ ...baseConfig,
  test: { ...baseConfig.test, include, globalSetup: [], retry: 0 } });
```

**Run DB-free** (proves no DB dependency for pure targets):
`DATABASE_URL= MUTATION_TARGET=verification-consensus npm run test:mutation`.
`test/global-teardown.ts` no-ops when `DATABASE_URL` is unset, and the scoped
`include` keeps storage tests out.

## Exceptions

- DB-bound (`server/storage/**`) and crypto/external (`receipt-validation`) modules
  are mutable but slower and need `DATABASE_URL`; out of scope for the pure-logic
  pilot. Hard-Exclusion modules (auth, goal-safety, IAP) require a human-authored
  plan — the registry's policy-guard test enforces this.

## Related Files

- `stryker.conf.mjs`, `stryker.targets.mjs`, `vitest.mutation.config.ts`
- `.github/workflows/mutation.yml` (manual `workflow_dispatch`; DB-free; off the PR gate)
- `docs/mutation-testing/baselines.md` (tracked scores), `docs/mutation-testing/README.md`

## See Also

- [mutation-testing integrity rule](../conventions/mutation-testing-suppress-only-equivalent-mutants-2026-06-05.md) — when to suppress vs kill vs remove dead code
