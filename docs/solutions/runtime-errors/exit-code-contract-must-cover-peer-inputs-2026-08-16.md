---
title: An exit-code contract adopted for one input leaves its peer inputs crashing into a code that means something else
track: bug
category: runtime-errors
tags: [harness, testing, cli, exit-codes, node]
module: shared
applies_to: ["scripts/**", "server/scripts/**"]
symptoms: ["A CLI documents exit 1 = domain failure and exit 2 = usage error, but a malformed input file produces a raw stack trace and exit 1", "A try/catch maps one input's failures to the usage-error code while a sibling read two lines above is unguarded", "The guard's own comment states an invariant ('never the exit 1 an uncaught throw would produce') that is false for the adjacent input"]
created: 2026-08-16
severity: medium
---

# An exit-code contract adopted for one input leaves its peer inputs crashing into a code that means something else

## Problem

`coverage-ratchet.ts` adopted a contract: usage errors (missing/malformed
files) exit 2; exit 1 means "coverage is failing". The config-file path got a
guard with a comment stating exactly that invariant. Two lines above it,
`JSON.parse(fs.readFileSync(coverageFile))` and `computeTotals(data)` stayed
uncaught — a truncated `coverage-final.json` (an interrupted `test:coverage`
run, a real failure mode) threw a `SyntaxError`, and Node's uncaught-exception
default exited **1**: the script reported "coverage is failing" for a file
that was never valid coverage data.

## Symptoms

- The documented exit-code table is violated only for SOME inputs — the ones
  guarded after the contract was adopted behave; the ones read before it crash.
- A raw stack trace where the sibling path prints a clean one-line error.
- CI or a calling script takes the "domain failure" branch (re-run tests,
  page someone) for what is actually a corrupt input file.

## Root Cause

A failure-mapping contract does not propagate by proximity. Every uncaught
throw in Node exits 1, and 1 is rarely a neutral code — in any CLI with a
documented exit table it collides with a specific meaning. Wrapping one
input's read (because a reviewer flagged that one) establishes the contract
without sweeping the function's OTHER fallible reads, and the new guard's
comment then makes a claim ("never the exit 1 an uncaught throw would
produce") that is false one statement earlier. Both `SyntaxError` (malformed
JSON) and wrong-shape `TypeError` (`entry.s` undefined) take the same
uncaught path.

## Solution

Sweep the function for every fallible read when adopting the contract, and
give each the same mapping:

```ts
let actual: Totals;
try {
  const data: CoverageFinal = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
  actual = computeTotals(data);
} catch (err) {
  console.error(red(`Could not read coverage data: ${...}`));
  return 2; // usage error — never the "coverage is failing" 1
}
```

Test each input's malformed case at the CLI level — one truncated-JSON case
and one wrong-shape case per input — asserting the exit code AND the clean
message (no stack trace).

## Prevention

- When a commit or review establishes an exit-code (or any failure-mapping)
  contract, grep the enclosing scope for its other `readFileSync`/parse/
  network reads before closing — each is a peer under the same contract.
- Treat "uncaught = exit 1 = whatever 1 means in your table" as the default
  hazard of every CLI with a documented exit table.

## Related Files

- `scripts/coverage-ratchet.ts` — the swept guard (PR #822, commit 84452b4d).
- `scripts/__tests__/coverage-ratchet.test.ts` — the malformed + wrong-shape CLI cases.

## See Also

- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the sibling exit-code trap on the success side.
- [Probes that signal absence by empty output must also check the exit code](../logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md) — exit codes as load-bearing signal, consumer side.
- [A stated invariant is not an enforced one](../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md) — the guard's comment asserted a property its own function didn't have.
