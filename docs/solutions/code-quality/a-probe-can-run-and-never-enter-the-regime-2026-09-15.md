---
title: "A probe can run, carry a full population and a firing control, and still be void because every input sat below the threshold — print which SIDE each row is on"
track: bug
category: code-quality
tags: [harness, testing, corpus, bash, hooks, code-review, test-fragility]
module: shared
applies_to: [".claude/hooks/test-*.sh", ".claude/hooks/*.sh", ".claude/hooks/lib/*.sh", "scripts/**/*.sh", "docs/AI_WORKFLOW.md"]
symptoms: ["A probe prints a plausible table of rows, byte counts and verdicts, and the conclusion drawn from it is still wrong", "A verification reports the correct behaviour and the defect reproduces in production against the same code path", "A probe's inputs are described by magnitude (bytes=48039) with no statement of which side of the threshold that is", "A control described as 'same size' turns out to be materially smaller than the row it controls", "A pinned regression test still passes after its fixture drifted out of the regime the pin exists to exercise"]
created: 2026-09-15
severity: high
---

# A probe can run and never enter the regime

## Problem

A probe built to answer a threshold-conditioned question ran correctly, enumerated a full
population, carried a positive control that fired, printed a table — and answered a question
it had never asked, because every input sat below the threshold the claim depends on.

This happened three times in one session (PR #957) on one claim: whether a
`printf | grep -q` condition under `pipefail` fails open via SIGPIPE past the 64 KB pipe
buffer.

| # | Input | Verdict printed | Why it was void |
|---|---|---|---|
| 1 | 48,039 bytes, multi-line | `rc=1 REFUSED (correct)` | Never crossed the 64 KB buffer — the padding lines were shorter than assumed |
| 2 | 58,831 bytes, multi-line | refused | Same; caught by the reviewer that built it |
| 3 | 114,039 bytes, **single-line** | refused | Right magnitude, wrong dimension — `grep` cannot exit mid-line, so it drains the input and the writer never blocks |

The third is the expensive one. It examined the defect **directly** and recorded it as a
measured non-issue, which is why the original fail-open survived a review that looked at it.

## Symptoms

- The probe prints rows, counts and verdicts, and a control behaves as expected.
- Inputs are reported as a magnitude (`bytes=48039`) rather than as a comparison.
- A "same size" control was padded by a fixed iteration count rather than byte-matched.
- The conclusion is a clean negative — "the refusal still fires" — with nothing in the output
  that would look different had the probe never reached the interesting regime.

## Root Cause

**This is not the same defect as an uncontrolled probe or an empty population, and the rules
for those do not catch it.** Those failures announce themselves: a harness that never ran
prints a suspicious `0`, and a reviewer is already trained to distrust a clean zero until the
author names a row they expected to be positive.

A probe that ran *below the threshold* prints a **table**. Rows, byte counts, verdicts,
controls behaving. It looks measured because it *is* measured. It measured the wrong regime.
There is nothing in the output to be suspicious of, so no amount of scrutiny applied to the
output recovers the error — the error is in the relationship between the input and a
threshold that the output never mentions.

The second form is dimensional rather than numerical. Size was the obvious knob; **line
structure** was the one the mechanism actually keys on. A probe can be far past the threshold
on the axis it varied and still outside the regime, because the regime was never defined by
that axis.

## Solution

One column. Adding `over64k=YES/no` per row made the void answer obvious on sight:

```text
bytes=48039 over64k=no        <- reads as void
bytes=48039                   <- reads as data
```

Nothing else about the probe changed. The numbers were already correct and already printed;
they simply were not stated as a **comparison against the threshold**, and a magnitude does
not carry its own interpretation.

## Prevention

- **When a claim depends on a threshold, print which SIDE of it every row is on.** Not the
  magnitude — the comparison.
- **A row on the wrong side is a FAILURE, not a data point.** Assert the regime; do not merely
  report it.
- **Ask which DIMENSION the effect keys on, not just the magnitude.** Keep a control that
  differs in that dimension ONLY — and byte-match it by loop rather than by iteration count, or
  it excludes nothing it claims to.
- **Measure the value that actually crosses the boundary**, not the input you constructed. If
  the mechanism reads a rendered-then-truncated string, assert on that string; an assertion on
  the raw input may coincide with it today and go inert silently when the rendering changes.

### The regime precondition (named convention)

In a pinned regression test this becomes its own assertion row. The convention is named and
defined in `.claude/hooks/test-cmd-detect.sh` at the first SIGPIPE pin and is followed by both
pins there:

> A pin whose behaviour depends on a threshold asserts, as its own PASS/FAIL row, that its
> input still reaches the regime the pin exists to exercise.

Its five parts, each of which was a real mistake before it was a rule: the precondition is a
**row, not a comment**; it measures the **value that crosses the boundary**; it asserts **every**
property the regime depends on (the retarget pin also asserts its padding carries no clause
separator, because a `;` would cut the clause below the buffer while every other row stayed
green); the discriminator control is **byte-matched by loop**; and the family keeps a row that
must resolve the **other** way, so a change that refused all large input cannot leave the whole
family green.

Without it the failure is silent in the worst direction — the behaviour row still passes,
because a 39-byte input is also refused, so the pin reads as protecting a fail-open it has
quietly stopped touching.

### Beyond probes

The same shape appears in any measurement, not only a deliberate probe. In the session that
codified this rule, the harness-supplied git status was a well-formed readout of a checkout one
commit behind the remote: `EXPECTED_TOTAL=631` was a real number read out of a real file, and
it described a tree that no longer existed. `git merge-base --is-ancestor` settled in one
command what `git log | grep` had answered misleadingly, because the grep proved only that a
commit existed *somewhere* in the object graph. Prefer the primitive that answers the question
with an exit code over the one that answers a nearby question with text.

## Related Files

- `.claude/hooks/test-cmd-detect.sh` — the named convention block, and both pins that follow it:
  the refuse guard (`cmd_gh_pr_write_subcommand`) and the retarget refusal (`cmd_gh_pr_ref`).
- `.claude/hooks/lib/cmd-detect.sh` — three de-piped SIGPIPE sites. Those two pins cover **two**
  of them.
- `.claude/hooks/test-merge-review-guard.sh` — the remaining site (`cmd_gh_pr_has_merge`, the
  **second** by `lib/cmd-detect.sh`'s own numbering) is pinned here instead, by
  `THE 64KB SIGPIPE ROW`. That row does **not** yet carry a regime precondition:
  it builds a 2,000-line `$_big` and asserts the deny directly, with nothing asserting the input
  still exceeds 65536 bytes. Its own comment notes that no other row in that file is large enough
  to reach the buffer — so if the padding ever drifts, the row goes green and the whole class is
  unpinned silently, which is precisely this rule's failure mode. Filed as
  `todos/P2-2026-09-15-third-sigpipe-pin-has-no-regime-precondition.md`, not fixed here.
- `docs/AI_WORKFLOW.md` — the reviewer dispatch prompt carries the rule for a reviewer's own
  probes; that is its single home, per the note at `.claude/agents/code-reviewer.md`.

## See Also

- [A test asserting a size-threshold crossing must clear it with a wide margin](../best-practices/test-budget-margin-must-clear-threshold-with-headroom-2026-07-05.md) — the
  same trigger, a weaker remedy. It says to pick a wide-margin fixture and, where none exists,
  to *comment* the fragility. For a pin, assert it instead: a measurement that lives in a
  comment does not fail when it stops being true.
- [A `cmd | grep -q` shell condition under `set -o pipefail` fails open via SIGPIPE](../logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — the
  mechanism these probes were investigating, including its 2026-09-15 recurrence on a security
  gate. That doc records that no test row in the suite was large enough to reach the buffer;
  this one records that the probes built to investigate it were not either.
- [A corpus piped through `head` is SAMPLED, not generated](a-sampled-corpus-described-as-generated-2026-09-13.md) — the
  adjacent defect in the **population**: the rows are real but chosen. Here the population is
  fine and every row is in the wrong regime.
- [A pin records a verdict's VALUE; without recording whether that value is CORRECT it is a trap](a-pin-records-its-value-but-must-also-record-whether-it-is-correct-2026-09-13.md) — the
  adjacent defect in the **verdict**. That pin asserts the wrong thing about a real input; this
  one asserts the right thing about an input that no longer reaches the mechanism.
