---
title: A CI job with no DATABASE_URL cannot import any module that reaches server/db.ts — local .env hides it
track: bug
category: runtime-errors
module: server
severity: low
tags: [testing, harness, ci, database-url, dotenv, stryker, import-time-throw]
applies_to: [.github/workflows/**, server/db.ts, test/setup.ts, stryker*.mjs, vitest*.mts]
symptoms: [Stryker "ConfigError: No tests were executed" for a module whose co-located test exists and passes, Stryker "Vitest failed to find test files related to mutated files" just before it, Vitest "No tests were found" in a CI job that runs tests without a Postgres service, The same command passes on a laptop every time, Other modules in the same job score normally]
created: '2026-11-06'
---

# A CI job with no DATABASE_URL cannot import any module that reaches server/db.ts — local .env hides it

## Problem

The advisory Mutation-on-diff check failed on PR #1783 for
`server/services/label-override.ts` with `No tests were executed`, while its
test file existed and passed. It failed the same way on a rerun, and every
local run of the same command scored the module (78.33%).

## Symptoms

- Stryker: `Vitest failed to find test files related to mutated files`, then
  `No tests were executed. Stryker will exit prematurely.`
- With `vitest.related: false` the warning goes away but the dry run still
  says `No tests were found`. The related-file warning was a symptom, not the cause.
- Only some modules fail; others in the same job score normally.

## Root Cause

`server/db.ts` throws at import when `DATABASE_URL` is unset. Any module whose
import chain reaches it can't be loaded without that variable. Here the chain was
`label-override.ts` → `barcode-lookup.ts` (value import `scaleNutrients`) →
`../storage` → `../db`. The mutation workflow runs no Postgres and set no
`DATABASE_URL`, so the test file failed to load. Stryker reports that as "no
tests", not as an import error.

Locally it can't happen by accident: `test/setup.ts` does `import "dotenv/config"`,
and every checkout (worktrees too, via post-checkout) has a `.env` with the URL.

## Solution

Give the step a placeholder URL, matching CI's test URL, with no service behind it:

```yaml
- name: Mutation-on-diff
  env:
    DATABASE_URL: postgresql://ocrecipes:ocrecipes@localhost:5432/ocrecipes_test
```

`db.ts` builds a lazy `pg.Pool`: nothing connects until a query runs, so the
import succeeds. A test that does query fails fast with ECONNREFUSED instead of
hanging. Keep the host `localhost`: `test/setup.ts` refuses any URL that isn't
local or a `_test`/`_dev` database.

## Prevention

- **Reproduce with the variable blanked, not unset:** `DATABASE_URL= <command>`.
  dotenv never overrides a variable that's already set, even to an empty value, so
  this beats `.env` and recreates the CI condition. `env -u DATABASE_URL` doesn't:
  dotenv would just load it back from `.env`.
- When a new DB-less CI job runs tests or imports server code, set the
  placeholder from the start.
- A job that passes for other modules proves nothing: they may never import `db.ts`.

## Related Files

- `.github/workflows/mutation-on-diff.yml` — the step env and its comment
- `scripts/__tests__/mutation-on-diff.test.ts` — pins the env line
- `server/db.ts` — the import-time throw
- `test/setup.ts` — the dotenv load and the local-database guard

## See Also

- [shell NODE_ENV=production breaks vitest jsdom](shell-node-env-production-breaks-vitest-jsdom-2026-07-17.md) — another case where the local shell environment differs from CI and changes test behaviour
