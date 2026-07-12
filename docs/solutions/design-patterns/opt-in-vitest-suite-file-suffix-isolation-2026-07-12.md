---
title: Isolate an opt-in vitest suite via file-suffix, not exclude config
track: knowledge
category: design-patterns
module: server
tags: [testing, vitest, integration-tests, ci, preflight]
applies_to: [vitest.*.config.ts, test/**/*.itest.ts]
created: '2026-07-12'
---

# Isolate an opt-in vitest suite via file-suffix, not exclude config

## When this applies

Standing up a new test tier (a real-DB HTTP integration suite, an E2E-adjacent
suite, anything slower/flakier than the default unit suite) that must NEVER
be picked up by `npm run test:run`, the default `vitest`/`vitest run`, or
`preflight:fast`'s `npx vitest related --run <changed files>` step — even
when the changed files are ones the new suite imports.

## Why

The naive approach is: keep the new files named `*.test.ts` (so the default
`include: ["**/*.test.ts"]` glob matches them), then add an `exclude` entry
for their directory to the base `vitest.config.ts` so `test:run` skips them,
and spread the base config into a new dedicated config
(`vitest.<tier>.config.ts`, mirroring `vitest.mutation.config.ts`) that
overrides `include` to target only the new directory.

This has an inheritance trap: the dedicated config spreads
`...baseConfig.test`, which means it inherits the base config's `exclude`
array TOO — including the entry you just added to keep the suite out of the
base config. The dedicated config's own target files are now excluded from
the config meant to run them, and the dedicated npm script silently runs
zero tests.

The second, subtler problem: `vitest related --run <files>` (the mechanism
`preflight:fast` uses) computes relevance by import-graph traversal against
the ACTIVE config's `include`/`exclude`, not by any drift-detection or fixed
list. If the new suite imports a file that later changes (e.g.
`server/middleware/auth.ts`), and the suite is merely excluded-by-directory
rather than genuinely unreachable from the base config's file-discovery, a
future edit to the base config's `exclude` array (or a refactor that moves
the suite) can silently re-admit it into the fast gate. An `exclude` entry
is enforcement by omission — it only holds as long as nobody touches it.

## Rule

Give the opt-in suite's files a filename suffix that literally cannot match
the base config's `include` glob — e.g. `*.itest.ts` when the base `include`
is `["**/*.test.ts", "**/*.test.tsx"]`. `"itest.ts"` does not end in the
literal substring `".test.ts"` (there is no `.` immediately before
`test.ts`), so the glob genuinely cannot match it, structurally, at every
consumer of the base config — `vitest`, `vitest run`, `vitest related`, and
any other tool that just resolves the base `vitest.config.ts`. Zero
`exclude` entries are needed on either side:

- The base config needs no new `exclude` entry — the suffix already
  prevents a match.
- The dedicated config (spread-override pattern, per
  `vitest.mutation.config.ts`) needs no `exclude` override either — since
  the base config's `exclude` was never touched, there is nothing to
  inherit and defeat.

```typescript
// vitest.integration.config.ts — spread base, override ONLY include
import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["test/integration/**/*.itest.ts"],
  },
});
```

Verify the isolation empirically before shipping it — don't trust the glob
reasoning alone:

```bash
# Confirm the base config genuinely can't discover the new suite:
npx vitest list --run | grep -i itest   # expect: no output

# Confirm `vitest related` — preflight:fast's actual mechanism — doesn't
# pick it up even for files the new suite imports:
npx vitest related --run <a file the new suite imports>   # expect: the
# existing test files only, none from the new suite's directory
```

## Examples

`vitest.integration.config.ts` + `test/integration/*.itest.ts` (a real-DB
HTTP integration suite) vs. `vitest.mutation.config.ts` + Stryker's
env-driven `include` (which achieves isolation differently — it scopes
`include` to a single target file per mutation run, and explicitly drops
`globalSetup`/`retry`, but does NOT need the suffix trick because Stryker
never runs through the base config's `include` at all).

## Exceptions

If the new suite's files must ALSO be runnable by a tool that hardcodes
`**/*.test.ts` and cannot be pointed at a custom config (rare — most of this
project's own tooling accepts `--config`), the suffix approach doesn't apply
and an explicit `exclude` is the only option; accept the inheritance trap
and defend against it with the same empirical check above, re-run after any
change to either config.

## Related Files

- `vitest.integration.config.ts` — the dedicated config
- `test/integration/auth-routes.itest.ts` — the first suite using this
  pattern
- `vitest.mutation.config.ts` — the sibling spread-override pattern for
  Stryker

## See Also

- [Storage integration tests with transaction rollback](storage-integration-tests-transaction-rollback-2026-05-13.md) — the DB-isolation half of this suite; this solution covers only the suite-discovery half
- [LLM evaluation as a separate testing tier](llm-evaluation-separate-testing-tier-2026-05-13.md) — the same "opt-in slow tier" concept in evals/, achieved via directory location alone rather than a filename-glob trick (evals/ is never in the base vitest include at all)
- [../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md](../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md) — the wiring-seam gap this suite exists to close
