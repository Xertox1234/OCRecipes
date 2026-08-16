---
title: A lint harness that matched no config still returns messages — its "did not run" is indistinguishable from a verdict
track: bug
category: code-quality
module: shared
severity: medium
tags: [testing, harness, typescript, verification, false-negative, eslint, lint-rules]
applies_to: [eslint-plugin-ocrecipes/__tests__/**/*.test.ts, scripts/__tests__/**/*.test.ts, client/**/__tests__/**/*.test.ts, server/**/__tests__/**/*.test.ts]
symptoms: [An ad-hoc lint probe reports every case the same way — all rejected or all accepted, including cases that must differ, A rule you just verified by hand behaves differently under the real CLI, A "no violations" result that is really "the rule never ran", Confident probe results that contradict a passing test suite]
created: '2026-08-15'
---

# A lint harness that matched no config still returns messages — its "did not run" is indistinguishable from a verdict

## Problem

Reaching for ESLint's `Linter` to probe a custom rule is the fastest way to answer "does
this input get flagged?" — no fixture files, no CLI. But a flat config whose `files` glob
does not match the filename you pass produces a **non-empty** result:

```js
linter.verify(code, config, "client/screens/Foo.tsx");
// → [{ ruleId: null, message: "No matching configuration found for client/screens/Foo.tsx." }]
```

The harness never bound the rule. It reports that as data, and whichever predicate you wrote
turns it into a confident, wrong answer:

| Your predicate | What it says when the config never matched |
| --- | --- |
| `messages.length === 0` | "violation found" — every case reads as **rejected** |
| `messages.filter(m => m.ruleId).length === 0` | "clean" — every case reads as **accepted** |

Neither is "the harness didn't run", which is the truth.

## Symptoms

- A probe over several deliberately-different inputs returns the *same* verdict for all of
  them — including a case you are certain must differ.
- The probe's answer contradicts the real CLI or a green test suite.
- A rejection-direction probe looks "extra safe" (everything rejected) and is actually inert.

## Root Cause

Two easy omissions, one silent failure mode.

The flat-config array form requires `files` for a config object to apply to a path. Passing a
bare config **object** (not wrapped in an array), or an array whose `files` glob is `**/*.ts`
while the probe filename ends `.tsx`, both leave the file unmatched. ESLint does not throw and
does not return `[]` — it returns one synthetic message with `ruleId: null`.

That message is the collision. Real rule findings also arrive as messages; the only
distinguishing field is `ruleId`, and neither of the two obvious predicates checks it for the
*right* reason. `length === 0` treats the synthetic message as a finding; filtering on
`ruleId` discards it and lands on the empty array that means "clean".

Observed while verifying a custom rule's path handling. Four probe rows returned
`REJECTED` — including a row that used the repo's real canonical import and could not
possibly be rejected. That impossible row is the only reason the harness was questioned; the
three plausible rows would have been believed:

```
REJECTED  nested client/navigation via @/
REJECTED  climb above repo root
REJECTED  sibling FakeNavigator
REJECTED  genuine navigator            <-- cannot be true; this is what exposed the harness
```

## Solution

Make the harness fail loudly on the state that has no verdict, rather than folding it into
one:

```js
const messages = linter.verify(code, [{ files: ["**/*.{ts,tsx}"], /* … */ }], filename);

// A config that matched nothing yields a message with a null ruleId, which
// otherwise reads as a verdict. There is no answer here — refuse to give one.
const unmatched = messages.find((m) => !m.ruleId);
if (unmatched) throw new Error(`harness misconfigured: ${unmatched.message}`);

return messages.length === 0; // now genuinely "no findings"
```

Two structural points beyond the guard:

- **Include an input whose expected answer is impossible to get wrong.** The probe above was
  only caught because one row asserted a case that could not legitimately be rejected. A probe
  made entirely of cases you are unsure about cannot tell you it is broken.
- **Confirm the guard fires.** Break the config on purpose (`files: ["**/*.NOPE"]`) and check
  the harness throws instead of passing every row. A guard against a silent failure is itself
  silent until proven otherwise.

Where the answer must be trusted, prefer the real CLI over an in-memory harness — plant a
file and run `npx eslint <path>` against the repo's actual `eslint.config.js`. It cannot
disagree with production because it *is* production.

## Prevention

- Any harness with a **binding step** (config resolution, glob matching, plugin registration,
  fixture discovery) can fail at that step and still produce output. Treat "did the subject
  actually run?" as a separate assertion from "what did it say?".
- `RuleTester` does not have this failure mode — it binds the rule directly — which is exactly
  why the ad-hoc `Linter` probe reached for during exploration is the risky one. The
  disciplined suite and the throwaway check have different trust levels; do not let a
  throwaway check overrule a suite.
- Same shape, different tool: a `jq all()` over an empty array is vacuously `true`, so a CI
  gate reading "all checks green" must also assert a non-zero check count.

## Related Files

- `eslint-plugin-ocrecipes/__tests__/rules.test.ts` — the `accepts()` helper and its
  `harness misconfigured` guard, in the specifier-resolution table
- `eslint-plugin-ocrecipes/index.js` — `no-shadowed-route-paramlist`, the rule being probed
  when this surfaced

## See Also

- [A verification that scans ZERO inputs is green and meaningless](verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the sibling failure: the subject ran but its input set was silently empty. There the tell is an empty result; here it is a *non-empty* one that means nothing
- [A test comment must claim only what its own harness can observe](a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the same trust boundary, one layer out in prose
- [A completeness claim backed by a single-line grep is unverified](../conventions/completeness-claim-from-single-line-grep-is-unverified-2026-08-15.md) — the rule this harness was probing, and its four-instance history of checks that correlate instead of testing
- [Probes that signal absence by empty output must also check the exit code](../logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md)
