---
title: "guard-outward-cli.sh: the narrow-deny expansion shape (b) closes with a narrower class than every sibling, so a trailing redirect escapes it"
status: backlog
priority: high
created: 2026-09-07
updated: 2026-09-07
assignee:
labels: [security, harness]
github_issue:
---

# Narrow-deny shape (b) uses `([[:space:]]|$)` where its siblings use `_OUT_POS_SUFFIX`

## Summary

`${e:-eas} update>log` is ALLOWED. Real argv is `eas update` with stdout redirected — an OTA
publish to real users. The literal-verb sibling `eas update>log` correctly DENIES, so this is
a hole in one pattern, not a missing family.

## Background

Found 2026-09-07 while closing the interior-redirect P0. **Pre-existing and unchanged by that
fix** — measured identical on `main` and on the fix branch. Surfaced rather than folded in:
this is finding A's axis (the closer class), not the separator axis that todo's scope
contract authorised.

The 2026-09-03 narrow-deny ruling added three shapes. Shape (b) — an expansion in command
position followed by a gated VERB — ends with a hand-written `([[:space:]]|$)` instead of the
`${_OUT_POS_SUFFIX}` every other detector in the file uses:

```
grep -Eq "${_OUT_POS_PREFIX}${_OUT_EXPANSION_TOKEN}${_OUT_SEP}${_OUT_GATED_VERB}([[:space:]]|$)"
```

`_OUT_POS_SUFFIX` is `([[:space:]]|[);&|`{}<>]|$)`. It gained `<`/`>`on 2026-09-05 as
finding A's fix, and`{`/`}`and backtick before that. Shape (b)'s inline closer got none of
them, so every boundary character finding A closed is open again at this one call site.
Shapes (a) and (a-pr) are unaffected — they have no trailing closer at all, because`\_OUT_EXPANSION_TOKEN` self-terminates.

This is the `occurrence-ambiguity-guard-applied-selectively-not-uniformly` shape once more:
a class was widened, and one consumer spelled its own copy instead of referencing the
constant.

### Measured, 2026-09-07

Ground truth by execution (PATH-shadowed argv-printing stubs writing to a sentinel FILE);
decisions from the live hook.

| construction           | real argv        | main  | fix branch |
| ---------------------- | ---------------- | ----- | ---------- |
| `${e:-eas} update`     | `eas update`     | DENY  | DENY       |
| `${e:-eas} update>log` | `eas update`     | ALLOW | ALLOW      |
| `eas update>log`       | `eas update`     | DENY  | DENY       |
| `${e:-eas} update log` | `eas update log` | DENY  | DENY       |

Rows 2 and 3 are the attribution pair: same verb, same trailing redirect, differing only in
whether the TOOL is literal or an expansion. The literal path denies (finding A closed it);
the expansion path does not.

### Severity

`high`. The effect is an OTA publish — the 2026-08-16 incident class — but reaching it needs
an expansion in command position, a more deliberate construction than the interior-redirect
P0's `eas 2>&1 update`. Filed high rather than critical on likelihood, not on effect.

## Acceptance Criteria

- [ ] Reproduced first against unmodified `main`, per row, with actual exit codes recorded.
- [ ] Shape (b) closes with `${_OUT_POS_SUFFIX}` (or a documented reason why it cannot), so
      it can never again lag a widening of that constant.
- [ ] **Enumerate every other inline closer in the file before changing this one.** If shape
      (b) hand-spelled its closer, check whether anything else did too — a `grep` for
      `([[:space:]]|$)` and similar hand-written classes on code lines. Fixing one instance of
      a selectivity defect while leaving its siblings is this file's most repeated mistake.
- [ ] Consider a structural test asserting no detector uses a hand-written closer class where
      `_OUT_POS_SUFFIX` exists — counting OCCURRENCES (`grep -o | wc -l`), never `grep -c` or
      `grep -m1`, and skipping comment lines (the header quotes these fragments verbatim).
- [ ] Two-sided regression tests with deny reasons asserted, including the literal-verb
      sibling as an attribution control.
- [ ] Mutation-tested per row; false-positive population measured by execution.
- [ ] Corpus rows added for the newly covered boundary characters at this position, as a
      GENERATED axis (NOTE6 makes generation binding — hand-listing is how the tool position
      came to be missing).

## Implementation Notes

- Widening a closer here only ever ADDS denies at this call site: the narrow-deny block is
  pure deny-shaped, with no carve-out. That makes it far lower-risk than the merge CLAUSE,
  but the false-positive controls are still the deliverable — the ruling is explicit that
  the NARROWING (a bare expansion in command position is not denied; an expansion in argument
  position is not denied) is what makes the rule acceptable.
- Never execute a real outward-facing CLI; argv-printing stubs on `PATH`, reporting to a
  sentinel FILE.

## Scope Contract

- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`,
  plus disclosure sites.
- No new mechanisms, files, or abstractions.
