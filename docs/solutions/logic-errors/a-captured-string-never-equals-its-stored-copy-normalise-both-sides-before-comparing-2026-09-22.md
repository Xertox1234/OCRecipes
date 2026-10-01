---
title: "A string captured through `$(...)` never equals its stored copy when that copy ends in a newline — bash strips the trailing run, the transcript keeps it, and an exclusion-by-value silently fails; normalise both sides inside the comparison"
track: bug
category: logic-errors
module: shared
tags: [harness, hooks, security, testing, bash, jq]
applies_to: [".claude/hooks/**/*.sh"]
symptoms: ['An exclusion-by-value (`select(. != $cur)`) that works on every fixture and fails on real inputs that end in a newline', 'A hook that compares a `$(jq -r …)` capture against a raw JSON string field and treats a mismatch as a distinct value', 'A record that goes missing only for deliveries ending in a newline or CRLF, while identical text without the tail records fine']
created: '2026-09-22'
severity: medium
---

# A string captured through `$(...)` never equals its stored copy when that copy ends in a newline — bash strips the trailing run, the transcript keeps it, and an exclusion-by-value silently fails; normalise both sides inside the comparison

## Problem

`review-stamp-writer.sh` guard (c) reads the transcript's prior report texts and must EXCLUDE the
delivered text itself, or a single-stop findings report would refuse its own record. The first
version passed the delivered text into jq and compared by value:

```bash
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
…
jq -rs --arg cur "$MSG" '… | select(. != $cur)' "$TP"
```

`MSG` came through command substitution, which strips every trailing newline. The transcript's
`.text` for the same message keeps them. And the writer's CR normalisation ran LATER in the file
than this guard. So a findings delivery whose text ended in `\n` (or differed from its stored
copy by CR alone) was not excluded, re-entered the prior-report set as its own prior report,
tripped an objection arm, and the hook exited without writing — where `origin/main` had written
`verdict: findings`. Two confirmation reviewers found it independently; a generated 69-row probe
(3 verdicts × 7 tail shapes × 2 pre-existing-record states, plus CR-mismatch, byte-identical,
contract-free and narration rows, under bash 5.3.15 and 3.2.57) put the cost at 16 rows, every
one with the delivered text and its stored copy differing only by trailing newlines or CR.

The suite had not caught it because every fixture was a bash single-quoted literal, which never
carries a trailing newline — the self-exclusion's only tested input was the byte-exact case.

## Symptoms

- Fixtures pass, real deliveries fail, and the real deliveries differ from fixtures only in
  their last byte.
- A comparison between a value that crossed a `$(...)` boundary and one that did not.
- The failure is fail-closed (no record) and so reads as "the review never ran" rather than as
  a comparison bug.

## Root Cause

Two copies of one string reached the comparison through different channels with different
whitespace semantics: bash command substitution deletes the trailing newline run; a JSON string
field preserves it; and a later normalisation step in the same file (CRLF → LF) had not run yet
at the point of comparison. Byte equality was the wrong predicate for "is this the same
message".

## Solution

Normalise BOTH sides inside the comparison, symmetrically, with the same operations:

```bash
jq -rs --arg cur "$MSG" '… | select((. | gsub("\r"; "") | sub("\\s+$"; ""))
                                     != ($cur | gsub("\r"; "") | sub("\\s+$"; "")))' "$TP"
```

Stripping only CRs and one trailing whitespace run cannot make two DIFFERENT messages compare
equal: they would have to agree on every other byte, so a prior text excluded this way carries
exactly the delivery's own content. Do NOT replace the value comparison with positional exclusion
of the last transcript entry — a transcript flushed before the delivery is appended would then
drop a genuine prior report, which is the fail-open direction.

Pin it with fixtures that CROSS the boundary the capture strips: the same findings text with a
trailing newline in both fields (must record), with a seeded same-type clean record already at the
head (must replace it), a CR-only mismatch between payload and stored copy (must record), and a
trailing SPACE as the control (bash does not strip spaces, so byte-identical both sides and green
before and after — which is what shows the other rows are about the strip).

## Prevention

- When a value crosses `$(...)` and is later compared to a copy that did not, name the
  whitespace semantics of each channel before choosing the predicate.
- Fixtures built from single-quoted literals cannot exercise trailing-whitespace behaviour;
  append `$'\n'` explicitly to at least one.
- If a file normalises input somewhere, every comparison must run AFTER that normalisation or
  carry its own.

## Related Files

- `.claude/hooks/review-stamp-writer.sh` — guard (c), the normalised comparison and its comment
- `.claude/hooks/test-review-stamp-writer.sh` — cases 48-51
- `todos/archive/P1-2026-09-22-stamp-writer-takes-contract-bearing-text-over-its-own-objection.md`
  — confirmation round 2 entry
- `todos/archive/P3-2026-09-22-guard-c-passes-the-delivered-text-as-one-argv-string-so-a-1mib-delivery-writes-no-record.md`
  — the argv-limit follow-up on the same `--arg` call

## See Also

- [bash read collapses tab-delimited empty fields and strips the trailing newline](bash-read-tab-ifs-collapse-and-trailing-newline-strip-2026-07-06.md) — the `read` builtin's version of the same trailing-newline surprise
- [command substitution unsets errexit](command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md) — the other thing `$(...)` silently changes
- [a resumed reviewer never stamps; re-adjudicate by fresh dispatch](../conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md) — the guard this comparison serves
