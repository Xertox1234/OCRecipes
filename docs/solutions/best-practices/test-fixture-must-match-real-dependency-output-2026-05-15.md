---
title: "Regression-test fixtures must reproduce the real dependency's output verbatim"
track: knowledge
category: best-practices
tags: [testing, fixtures, stubs, mocks, regression-tests, parsing]
module: shared
applies_to:
  [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.tsx",
    ".claude/hooks/*.sh",
  ]
created: 2026-05-15
---

# Regression-test fixtures must reproduce the real dependency's output verbatim

## When this applies

When a test uses a stub, mock, or fixture to stand in for a real dependency —
another tool's output, an API response, a CLI's stdout — and the code under
test **parses** that output to make a decision. The fixture's fidelity to the
real output is part of what the test verifies; a paraphrased fixture quietly
tests a strawman.

## Why

A test is only as good as its fixture. If the stub emits a simplified or
paraphrased string instead of the dependency's real output, the test can pass
while the actual bug ships — because the bug lives in the gap between the
paraphrase and reality.

Concrete case: the kimi-review pre-commit hook's CRITICAL-detection regex
matched the bare word `CRITICAL` anywhere in the review output. The real tool's
clean-output message is `No findings in requested tiers: CRITICAL, WARNING` — so
the detector false-blocked **every** clean review. The hook had a test with a
`clean` stub, but that stub emitted `no findings` — a string containing no
`CRITICAL` token at all. The test passed; the bug shipped. The fixture
paraphrased the dependency, so it never exercised the failure.

## Examples

```bash
# Strawman fixture — does not resemble the real tool's clean output
clean) echo "no findings";;

# Faithful fixture — kimi-review's actual clean-output message
clean) echo "No findings in requested tiers: CRITICAL, WARNING";;
```

The faithful fixture reproduces the bug on a red test; the strawman never does.

## How to apply

- Copy the dependency's output strings into fixtures **verbatim** — including
  status/summary lines, not just the payload. Pull them from the dependency's
  own source or a captured real run, not from memory.
- When testing parsing logic, fixture the **clean / empty / success** output as
  carefully as the error output. Bugs of the form "the matcher tripped on the
  tool's own status message" only reproduce against a faithful clean fixture.
- A regression test for a parsing bug must contain the exact substring that
  triggered the bug. If it does not, the test does not cover the bug.

## Exceptions

- Fixtures may be **trimmed** (drop irrelevant fields/lines) as long as every
  string the code under test inspects is kept verbatim. Trimming is fine;
  paraphrasing is not.

## Related Files

- `.claude/hooks/test-kimi-review.sh` — hook test whose `clean` stub now emits
  the real kimi-review clean-output message

## See Also

- `../logic-errors/tier-detection-matched-clean-output-message-2026-05-15.md`
  — the parsing bug this fixture-fidelity gap allowed to ship
