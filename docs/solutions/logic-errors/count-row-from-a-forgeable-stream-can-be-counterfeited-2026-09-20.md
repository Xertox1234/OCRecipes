---
title: "A count row re-derived from the same forgeable text stream can be counterfeited by the same injection"
track: bug
category: logic-errors
module: shared
severity: medium
tags: [harness, security, guard-script, jq, injection, text-flattening, bash, structural-validation]
applies_to: ["scripts/todo-automerge-guard.sh", "scripts/**/*.sh", ".claude/hooks/**/*.sh"]
symptoms: [A count or consistency check re-derived by re-parsing the SAME flattened text stream the data was emitted into can be defeated by one crafted input value that forges both the data row and a compensating count row, A completeness/consistency check trusts a value extracted from text that the same malicious field could also have produced, Adding a second derived-count check next to an existing one still shares the same forgeable text channel and inherits the same injection surface, A regression test asserts only the exit code — not the diagnostic — so it can still pass under a weaker fix that reaches the same status for a different reason]
created: 2026-09-20
---

# A count row re-derived from the same forgeable text stream can be counterfeited by the same injection

## Problem

A bash+jq pipeline reads structured JSON from an API, classes each element into a text row (e.g.
`"F " + .filename`), and re-parses those FLATTENED TEXT rows downstream (`grep`/`sed`) to build
both the data list and a completeness/consistency count. Because every downstream consumer reads
the SAME forgeable text stream, a single malicious JSON string value containing an embedded
newline can inject an entire extra, well-formed-looking text row — including one that forges a
SECOND derived value (e.g. a row-count sentinel) meant to validate the first. A check that
re-derives its "trusted" count by re-parsing the same text it is trying to validate is not
independent evidence against the forgery it exists to catch.

## Symptoms

- A count or consistency check re-derived by re-parsing the SAME flattened text stream the data
  was emitted into can be defeated by one crafted input value that forges both the data row and a
  compensating count row.
- A completeness/consistency check trusts a value extracted from text that the same malicious
  field could also have produced.
- Adding a second derived-count check next to an existing one still shares the same forgeable text
  channel and inherits the same injection surface.
- A regression test asserts only the exit code — not the diagnostic — so it can still pass under a
  weaker fix that reaches the same status for a different reason.

## Root Cause

`scripts/todo-automerge-guard.sh` reads `pulls/{n}/files` via `gh api --paginate --jq '...'` and
classes each array element into a text row (`F` destination, `P` rename source, `X` unusable rename
source) by string-concatenating `"F " + .filename` etc. and letting jq raw-print the result. A
`.filename` value containing a literal embedded newline raw-prints as TWO physical text lines; if
the attacker crafts the second line to itself read `"F <some-path>"`, it is indistinguishable from
a genuine second destination row once the output is flattened and re-classed by regex.

The originally-proposed fix (and this todo's own Acceptance Criteria, as filed) was to add a
SECOND derived value to the SAME jq pass — a `"N " + (length|tostring)` row carrying the page's
real array-element count — and require the row count re-parsed from the flattened `F` lines to
equal it. This closes the SIMPLE case (a lone forged `F` row) because the text now carries one more
`F` line than the JSON array has elements. It does **not** close the general case: because the `N`
row is ALSO emitted as flattened text in the same stream, the identical malicious `.filename` value
can embed a THIRD line that itself reads `"N <compensating-value>"`, chosen so that
`(forged F count) == (real N) + (forged N)`. Constructing this input
(`"client/a.ts\nF client/b.ts\nN 1"`) and running it through a hand-built filter implementing only
the N-row check (no structural refusal) reproduces a genuine bypass: `total_N` and the raw `F` row
count balance at the same value while the forged row still reaches every downstream consumer
(here, both the completeness count and a second consumer, the TODO GATE, which discovers an
archived todo by grepping the same `files` variable for `^todos/archive/.+\.md$`). Two
independently-computed values are not independent evidence when both are extracted by re-parsing
text the attacker also controls.

## Solution

Reject the malformation at the point where the data is still STRUCTURED — operate on the JSON
values themselves (jq string tests), before any of it is concatenated into a shared, re-parseable
text stream:

```jq
(.[] | if ((.filename // "") | test("\n")) or ((.previous_filename // "") | test("\n"))
       then "B"
       else ("F " + .filename), (select(...) | "P " + .previous_filename), (select(...) | "X")
       end)
```

`test("\n")` runs on the actual JSON string value — a structural fact jq reads directly from the
parsed input, not a property of flattened text — so it cannot itself be spoofed by injecting more
text; and because the `if` suppresses the ENTIRE `F`/`P`/`X` branch for that element (not merely
the one field that looked suspicious), a refused item contributes NO forgeable text at all, real or
crafted, to the downstream stream. A parallel structural cross-check (e.g. a per-page
`"N " + (length|tostring)` row, summed across pages and compared to the RAW, non-deduped `F` row
count) is legitimate defense-in-depth **once the injection channel is closed this way** — but used
alone as the primary defense, it re-derives from the same forgeable channel it is meant to check,
and the compensating-payload construction above defeats it.

## Prevention

- When a downstream check re-derives a count or consistency value by re-parsing FLATTENED text
  built from attacker-influenced structured fields, ask: could one malicious field value forge
  BOTH the row this check watches AND a compensating value for the check itself, in the same
  string? If yes, the check is not independent evidence — it needs a structural refusal upstream,
  not another derived value downstream.
- Validate structure (refuse the malformed input) at the point data is still typed — the JSON
  value in jq, not the bash string after `$(...)` — before it is flattened. `$(...)` command
  substitution in bash also strips embedded NUL bytes, so a NUL-based row delimiter is not a
  substitute for rejecting the malformation earlier.
- `gh api --paginate --jq <expr>` re-runs `<expr>` once PER PAGE, not once over a merged array
  (`gh help api`: "Each page is a separate JSON array or object" — `--slurp` is what would merge
  them, and is easy to forget to pass). A per-page-emitted count must be SUMMED across pages, not
  read from the first page alone, or the check fails-closed on every ordinary multi-page result —
  itself a fail-closed regression, not a security hole, but one that reads as "the gate is broken."
- Write the adversarial regression test using the SAME payload construction the attacker would
  use — one crafted string embedding both a forged data row and a forged compensating check-value
  — not just a simple single-field forgery. Measured here: under a mutant with the structural
  (root-cause) refusal disabled, a test built only from the simple single-field forgery still
  fails CLOSED (exit 2) via the weaker additional-derived-value check alone, just through a
  different diagnostic arm — so a test asserting ONLY the exit code cannot tell the sound fix from
  the insufficient one, and even a diagnostic-string assertion only shows a DIFFERENT message, not
  a bypass. Only the compensating-payload test flips all the way to a genuine bypass (exit 0, "OK")
  under that same mutant — that is the one input that actually distinguishes "the structural
  refusal is doing the work" from "the derived-value check alone would have sufficed." Assert on
  the specific diagnostic in every case (several arms in a fail-closed guard can share a status),
  but treat the compensating-payload case as the load-bearing regression pin, not the simple one.

## Related Files

- `scripts/todo-automerge-guard.sh` — the `B` sentinel (jq-level newline refusal, before any
  text-flattening) and the STRUCTURAL ROW COUNT cross-check that sits behind it
- `scripts/__tests__/todo-automerge-guard.test.ts` — the compensating-row regression test
  ("a filename that forges BOTH a self-classing row AND a compensating count row cannot survive
  the B sentinel")
- `.claude/hooks/test-merge-review-guard.sh` — the sibling stub widened to emit the same row format
  so its own fixture does not silently mask the guard's new structural check

## See Also

- [A comparison over a lossy projection of the value reports a false match](comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md) — sibling failure mode: deriving from a reduced/flattened view of structured data, here exploited adversarially (a forged compensating value) rather than merely under-specified
- [A gate test needs a two-sided negative control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — companion testing discipline behind this file's Prevention: assert the gate actually fires on the adversarial input, not only that it passes an ordinary one
- [Flipping a test's expected outcome after narrowing a multi-gate check can silently stop testing the gate it was written for](../code-quality/flipped-test-expectation-must-recheck-which-gate-it-now-hits-2026-08-28.md) — same script, same discipline of re-fixturing (not just re-expecting) when a gate's behavior changes underneath an existing test
</content>
