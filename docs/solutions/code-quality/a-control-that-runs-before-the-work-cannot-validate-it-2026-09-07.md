---
title: "A harness control that runs BEFORE the work cannot validate the work — the chunked run died and the report said 0 flips over a population of zero"
track: bug
category: code-quality
tags: [harness, verification, security, false-negative, testing]
module: server
applies_to: [".claude/hooks/**", "scripts/**"]
symptoms: ["A measurement harness reports a clean zero and the denominator is also zero", "A validated harness still produces a meaningless result because the control covers a different code path than the measurement", "A parallel/chunked runner fails silently and the aggregation step finds no input files but still prints a summary", "$0 re-invocation works when the script is called by absolute path and fails when called by a bare name", "A run prints 0 regressions and 0 improvements and both are believed"]
created: 2026-09-07
severity: high
---

# A control that runs before the work cannot validate the work

## Problem

A false-positive harvest re-ran every Bash command in local transcript history through
the old and new versions of `.claude/hooks/guard-outward-cli.sh` and diffed the decisions.
It opens with a deliberate self-check — a command known to flip must read `ALLOW -> DENY`,
and a command known not to move must not move — precisely so that a zero result is
trustworthy.

The run reported:

```
harness control: known flip reads ALLOW -> DENY
...
evaluated: 0
ALLOW -> DENY (new over-denials): 0
DENY -> ALLOW (must be 0):        0
```

**The control passed and the measurement was empty.** Both flip counts are trivially zero
when nothing runs, and in a summary they look exactly like success. The only distinguishing
line is `evaluated: 0`, sitting above two numbers that read as a clean bill of health.

## Root cause

Two independent things, and the second is what made the first invisible.

**1. The chunk dispatch could not exec.** The runner splits the population and re-invokes
itself per chunk:

```bash
for p in "$CH"/part*; do ( "$0" chunk "$p" "$p.out" ) & done
wait
cat "$CH"/part*.out > "$SP/harvest-results.txt"
```

`$0` is the path the script was invoked with. Called as `bash /abs/path/harvest.sh diff`
it is absolute and works; called as `bash harvest.sh diff` from inside its own directory
it is the bare name `harvest.sh`, which is not on `PATH` and has no `./`. Every chunk died
with `command not found`, `cat` matched no files, and the aggregation carried on.

**2. The control ran before the chunking.** It calls the same `decide()` helper the chunks
use, so it proves the hooks are reachable and the diff logic is sound — and it runs
*inline, in the parent*, never through the `$0` re-invocation. The one path that was broken
is the one path the control does not touch. It was a real control, correctly written, for
a different question than the one the run's zero was being read to answer.

## Solution

Two changes, and the second is the durable one.

```bash
  # NOT "$0": invoked as `bash harvest.sh diff`, $0 is the bare relative name and
  # the subshell cannot exec it.
  for p in "$CH"/part*; do ( bash "$SP/harvest.sh" chunk "$p" "$p.out" ) & done
  wait
  cat "$CH"/part*.out > "$SP/harvest-results.txt" 2>/dev/null
  n=$(wc -l < "$SP/harvest-results.txt" | tr -d ' ')
  # A ZERO DENOMINATOR IS FATAL, NEVER A CLEAN RESULT.
  want=$(wc -l < "$POP" | tr -d ' ')
  if [ "$n" -eq 0 ] || [ "$n" -lt "$want" ]; then
    echo "FATAL: evaluated $n of $want population rows -- every number below would be meaningless." >&2
    exit 1
  fi
```

Resolve the re-invocation from a path the script computes itself, not from `$0`. Then make
the denominator an assertion: compare rows *evaluated* against rows *in the population* and
fail on any shortfall, not just on zero — a partially-dead fan-out is the same defect with
a more plausible-looking number.

## Prevention

**Report the denominator next to every rate, and make it fail the run.** "0 regressions"
is not a result; "0 regressions out of 31,382 evaluated" is. Any summary that can print
a reassuring number over an empty population will eventually do so.

**A control validates the code path it runs through, and no other.** Ask of every harness
self-check: *does this exercise the same execution path as the measurement, including the
fan-out, the subprocess, the aggregation?* A setup-time control cannot speak for a
work-time failure. Where the work is chunked, validate a chunk — or, cheaper, assert the
output shape the chunks are supposed to produce.

**Silent-failure surfaces multiply in parallel dispatch.** `( ... ) &` discards exit status
by default, `wait` without arguments returns the last job's status, and a `cat` over a
missing glob is a warning on stderr at most. None of those is individually wrong; together
they let every worker die without the summary noticing.

**This was the second empty-population zero in one session.** The first was an argv-probe
harness where every row read "(not invoked)" because `timeout` does not exist on macOS and
each construction failed to exec, with stderr sent to `/dev/null`. Same shape, different
mechanism: work that never ran, reported as work that found nothing. That one was caught by
building a positive control *into* the harness — a row that MUST invoke, fatal if it does
not. Do that as a matter of course.

## Related

- [A union over renderings does not cover selection within one](../logic-errors/union-over-renderings-does-not-cover-selection-within-one-2026-09-07.md)
  — the same review round; there the measurement ran and answered a different question,
  here it did not run at all.
- [A test pin whose two outcomes a later pipeline stage normalises stays green](test-pin-normalised-by-a-later-pipeline-stage-is-a-decoration-2026-09-06.md)
  — a check that cannot fail, rather than a check over nothing.
