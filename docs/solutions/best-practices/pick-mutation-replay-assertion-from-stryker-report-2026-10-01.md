---
title: "Pick a mutation replay-control assertion from the Stryker report (a killed mutant covered by exactly one test), not by reading the tests"
track: knowledge
category: best-practices
module: shared
tags: [testing, harness, mutation-testing, stryker, controls]
applies_to: ["scripts/ci/mutation-on-diff.mjs", "scripts/mutation-explore.mjs", "stryker*.mjs", ".github/workflows/mutation-*.yml"]
created: 2026-10-01
---

# Pick a mutation replay-control assertion from the Stryker report, not by reading the tests

## When this applies

You need to prove a mutation-score signal can drop: a "replay control" that deletes one
assertion and expects the score to fall and the survivor list to name the newly unguarded
mutant. Lane F's done criterion (spec F0) is exactly this. The same applies to any check
that a mutation gate notices a weakened test.

## Rule

Choose the assertion **from the JSON report**, not by reading the test file:

1. Run the module once with the JSON reporter (`STRYKER_EXPLORE_JSON=1
   STRYKER_EXPLORE_JSON_FILE=<path> npm run mutation:explore -- <file> <test>`).
   Explore uses `coverageAnalysis: "perTest"`, so every mutant records `coveredBy` and
   `killedBy` test ids, and `testFiles` maps the ids to test names.
2. List the **Killed** mutants whose `coveredBy` has exactly **one** test. Deleting that
   test's assertion must turn the mutant into a survivor.
3. Delete that assertion, re-run, and write down the prediction first: one more survivor at
   the mutant's line, and the score drops to `(killed - 1) / scored`.

## Why

An assertion that looks protective can guard **no** mutant. On `server/lib/civil-date.ts`
(2026-10-01), two hand-picked deletions left the score unchanged at 80.9%:

- `expect(() => civilHourInTz(new Date(), "Not/AZone")).toThrow(RangeError)`: the throw
  comes from `Intl`, not from a branch in our code, so no mutant depends on it.
- Both "returns 0 at local midnight" expects: the `"h23"` → `""` StringLiteral mutant makes
  `Intl.DateTimeFormat` throw, so **every** test that calls the function kills it.

The report named three mutants killed by a single test each (the `tz = "UTC"` defaults at
lines 101, 125 and 147). Deleting the one assertion in "civilHourInTz defaults to UTC"
predicted 54/68 = 79.4% with a line-147 survivor. That is exactly what came back, locally
and on Actions (throwaway PR #1203).

A replay whose score does not move proves nothing about the job: the deleted assertion was
simply redundant. Picking from `coveredBy` turns the control into a prediction you can check.

## Examples

```python
import json
r = json.load(open("report.json"))
names = {t["id"]: t["name"] for tf in r["testFiles"].values() for t in tf["tests"]}
for m in list(r["files"].values())[0]["mutants"]:
    if m["status"] == "Killed" and len(m.get("coveredBy", [])) == 1:
        print(m["location"]["start"]["line"], m["mutatorName"], names[m["coveredBy"][0]])
```

## Exceptions

- With `coverageAnalysis` other than `perTest`, `coveredBy` is absent; fall back to deleting
  a test and checking the survivor diff, and expect misses.
- Stryker stops at the first killing test by default, so `killedBy` usually lists one test
  even when several would kill the mutant. Use `coveredBy`, not `killedBy`, for the
  "only one test" check.

## Related Files

- `scripts/ci/mutation-on-diff.mjs`: the Lane F orchestrator whose summary shows the drop
- `stryker.explore.conf.mjs`: the JSON reporter behind `STRYKER_EXPLORE_JSON`
- `server/lib/__tests__/civil-date.test.ts`: the worked example

## See Also

- [stryker-vitest4-mutation-testing-harness-2026-06-05.md](stryker-vitest4-mutation-testing-harness-2026-06-05.md): harness gotchas and the report format
- [../conventions/mutation-testing-suppress-only-equivalent-mutants-2026-06-05.md](../conventions/mutation-testing-suppress-only-equivalent-mutants-2026-06-05.md): reading survivors honestly
