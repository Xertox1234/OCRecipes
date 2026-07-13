---
title: 'fast-check property tests: pin the seed, keep them out of Stryker testInclude'
track: knowledge
category: conventions
tags: [testing, property-based, fast-check, vitest, mutation-testing, flakiness]
module: shared
applies_to: ['**/__tests__/**/*.property.test.ts']
created: 2026-07-12
last_updated: 2026-07-12
---

# fast-check property tests: pin the seed, keep them out of Stryker testInclude

## Rule

When adding property-based tests with fast-check to a pure numeric module:

1. **PIN THE SEED**: every `fc.assert` call must pass a pinned seed (e.g. `{ seed: 20260712, numRuns: 100 }`). Reason: `vitest.config.ts` sets `retry: 2` to absorb CPU-contention flakes; an UNSEEDED property that finds a real counterexample re-runs with a fresh random seed on retry and can pass — masking a genuine bug as an absorbed flake. With a pinned seed a failure reproduces identically on all 3 attempts (verified during implementation: a deliberately-wrong invariant failed all 3 retries with the same shrunk counterexample).

2. **STAY OUT OF STRYKER testInclude**: do not add `*.property.test.ts` files to a target's `testInclude` in `stryker.targets.mjs`. The registry deliberately scopes each mutation run to the module's dedicated example unit test to measure THAT test's trustworthiness in isolation; folding 100-run properties into the mutant loop multiplies per-mutant runtime and worsens nondeterministic timeout classification. The signals are complementary: mutation finds untested branches in the example suite, properties find untested input classes.

3. **RUN LOCATION**: property files are named `<module>.property.test.ts`, co-located in the same `__tests__/` dir as the example suite, discovered by the normal `'**/*.test.ts'` vitest glob — they run in the push-time fast gate (vitest related) and full CI; no separate slow suite (at 100 runs per property over pure functions a 12-property file costs tens of milliseconds).

4. **fast-check v4 API gotcha**: the legacy unicode string arbitraries (`fc.unicodeString`, `fc.fullUnicodeString`, `fc.asciiString`, `fc.char`, `fc.stringOf`) were REMOVED in v4. Use `fc.string({ unit: 'grapheme' })` for full-Unicode content, or pass a custom `Arbitrary<string>` as `unit` for targeted codepoint ranges, e.g. `fc.string({ unit: fc.integer({ min: 0x4e00, max: 0x9fff }).map((cp) => String.fromCodePoint(cp)) })`. Also use `import * as fc from "fast-check"` (namespace import) — the default import triggers ~7 `import/no-named-as-default-member` ESLint warnings.

## Why

Property-based tests are a powerful complement to example-based mutation testing, but their random-sampling nature introduces nondeterminism that conflicts with two design choices of this repo:

- The vitest `retry: 2` config is there to absorb CPU-contention flakes. An unpinned property that finds a bug on the first attempt, then passes on retry with a fresh seed, consumes the retry budget and lets the CI green-light a real defect. The pinned-seed strategy forces the same shrunk counterexample on every attempt, ensuring the failure is always visible.

- The mutation gate measures whether a single dedicated test covers every branch in a module. Adding properties to the per-mutant loop would multiply per-mutant runtime (each property body executes `numRuns` times per mutant) and worsen nondeterministic timeout classification on targets that already carry a threshold margin for it. The two techniques are best kept separate: mutation gates the example suite's coverage; properties check input classes the examples miss.

## Examples

- **`chat-history-truncate.property.test.ts`** — the first property suite in the repo. Every `fc.assert` call uses a shared `FC_PARAMS = { seed: 20260712, numRuns: 100 }`. Verified during implementation: a deliberately wrong invariant (asserting `totalTokens(result) <= budget` unconditionally, false when the protected last user message alone exceeds the budget) failed all 3 retry attempts with the identical shrunk counterexample `[[{"role":"user","content":" "}], 0]`.

- **`fc.string({ unit: 'grapheme' })`** — the general full-Unicode content arbitrary in `chat-history-truncate.property.test.ts` (replaces the removed `fc.fullUnicodeString()`); the CJK/supplementary-plane exactness properties use custom codepoint-range units via `fc.string({ unit: fc.integer({ min, max }).map((cp) => String.fromCodePoint(cp)) })`.

- **`stryker.targets.mjs`** — no property test file appears in any target's `testInclude`. The mutation gate runs only `chat-history-truncate.test.ts` (the example suite), while `chat-history-truncate.property.test.ts` runs in the regular vitest glob.

## Exceptions

- A property that must explore new inputs on every run (e.g. a scheduled deep-fuzz job) may read the seed from an `env` var and LOG it — but the default suite stays pinned.

## Related Files

- `server/lib/__tests__/chat-history-truncate.property.test.ts` — first property suite, canonical example
- `server/lib/chat-history-truncate.ts` — module under test
- `vitest.config.ts` — the `retry: 2` setting
- `stryker.targets.mjs` — the `testInclude` registry
- `scripts/__tests__/fast-check-property-seed-guard.test.ts` — automated grep-based guard test
  enforcing Rule item 1 (seed pinning) across every `**/__tests__/**/*.property.test.ts` file,
  wired into the normal Vitest suite via its `.test.ts` filename (no separate hook needed)

## See Also

- [mutation-target-and-break-threshold-selection-2026-06-27.md](mutation-target-and-break-threshold-selection-2026-06-27.md) — how mutation targets/thresholds are chosen, complementary to the property-testing pattern