---
title: "Bash guard scripts must strip quotes on every gated field AND fail-closed on unrecognized values — not just equality-check the happy path"
track: bug
category: logic-errors
tags: [bash, guard-script, frontmatter, fail-closed, quoting, validation, yaml]
module: shared
applies_to: ["scripts/**/*.sh"]
symptoms: [A frontmatter boolean/enum field wrapped in quotes silently fails a gate open instead of matching, An unrecognized or malformed field value (an inline comment, or a YAML boolean synonym like "yes"/"on" instead of true/false) is read as not-matching and silently treated as "not gated", A fail-closed guard script's own header comment promises fail-closed behavior but only some of its extracted fields actually enforce it, A regression test that writes the expected value via host-language string interpolation never actually exercises a quoted or malformed file byte]
created: 2026-07-16
severity: medium
---

# Bash guard scripts must strip quotes on every gated field AND fail-closed on unrecognized values — not just equality-check the happy path

## Problem

A bash script (`scripts/todo-gate-check.sh`) built specifically to be a deterministic,
fail-closed gate — its own header comment promised "fail-closed on bad data" — silently
failed OPEN on two realistic input shapes: a YAML-ish frontmatter field wrapped in quotes
(`human_led: "true"`), and an unrecognized value for the same field (a trailing inline
comment: `human_led: true  # see PR #650 discussion`). Both were caught by two rounds of
code review before merge, not in production, but both defeated the exact guarantee the
script existed to provide.

## Symptoms

- A frontmatter boolean/enum field wrapped in quotes silently fails a gate open instead of
  matching its intended value.
- An unrecognized or malformed field value (inline comment, a YAML boolean synonym like
  `yes`/`on` instead of `true`/`false`) reads as non-matching and is silently treated as
  "not gated" / "clear".
- A guard script's own header comment promises fail-closed behavior, but only SOME of its
  extracted fields actually enforce it — one field (e.g. a date) has an explicit
  unrecognized-value branch, a sibling field (e.g. a boolean) has only a bare equality
  check with no else branch.
- The bug is invisible in the test suite until a fixture deliberately embeds literal quote
  characters or an out-of-vocabulary value in the frontmatter — a fixture built via
  `${key}: ${value}` string interpolation with an unquoted JS string (`human_led: "true"`
  as a JS property value) never actually writes quote characters to the file; it produces
  plain `human_led: true`.

## Root Cause

When a bash script extracts several fields from the same source (YAML-ish frontmatter
here, but the same shape recurs anywhere a script reads semi-structured text) via
near-identical `awk`/`tr` pipelines, it's easy to apply full normalization (quote-stripping,
whitespace-stripping, case-folding) to the field you're actively debugging and skip it on a
sibling field that "looks like" it needs less handling — a boolean reads as simpler than a
date, so it's tempting to skip the quote-strip. Two independent gaps compound: (1) not
every extraction pipeline strips every quote style consistently, so a value that's
syntactically valid YAML (`"true"`) doesn't match the bash string comparison the gate is
built on; (2) a boolean-shaped check (`[ "$field" = "true" ]`) has no `else` branch for
"value present but not recognized" — it only has a branch for the one string it expects, so
anything else, including a corrupted/malformed value, silently falls through to the default
(usually the "not gated" / pass-through) path. `scripts/todo-automerge-guard.sh`'s own
`prio` field extraction already did the quote-strip correctly (`tr -d "[:space:]\"'"`), so
the pattern to copy already existed in the same repo — the gap was not applying it
uniformly to a new script's every field.

## Solution

For every field a bash guard script extracts and gates on:

1. **Strip both quote styles unconditionally**, not just on the field you're actively
   testing: `tr -d "\"'"` (or the combined `tr -d "[:space:]\"'"` idiom
   `scripts/todo-automerge-guard.sh` already uses) on every extracted value before any
   comparison.
2. **Give every gated field an explicit "unrecognized value" branch that fails CLOSED**,
   not just an equality check for the happy-path value. A boolean-shaped field needs three
   branches, not two: exactly `true` (gate), exactly `false` or empty (don't gate on this
   field), and anything else (fail closed — treat as if the file's data is untrustworthy,
   same as a malformed date). Do not let "didn't match the expected string" silently
   collapse into "not gated."
3. **Write regression fixtures with literal embedded quote/malformed characters**, not
   merely a host-language string that happens to spell the expected value. A JS fixture
   `{ human_led: '"true"' }` (produces the file bytes `human_led: "true"`) exercises the
   bug; `{ human_led: "true" }` (produces the file bytes `human_led: true`) does not, even
   though both read as "the same thing" to a human skimming the test.

## Prevention

When writing or reviewing a new bash script in `scripts/` that extracts fields from
frontmatter (or any semi-structured text) to gate a decision, check EVERY extracted field
individually against both failure modes above — do not assume one field's careful handling
generalizes to its siblings. If the script's own header comment claims "fail-closed," treat
that as a testable property per field, not a description of the file as a whole.

## Related Files

- `scripts/todo-gate-check.sh` — the script this was found in; `human_led` extraction
  (quote-strip) and the unrecognized-value `PARSE_ERROR` branch
- `scripts/__tests__/todo-gate-check.test.ts` — regression tests with literal embedded
  quote characters and an inline-comment fixture
- `scripts/todo-automerge-guard.sh` — the sibling script whose `prio` field extraction
  already did the quote-strip correctly (the pattern that should have been copied
  uniformly from the start)

## See Also

- [Values a downstream consumer routes on need a machine form, never prose markers](../conventions/machine-routed-values-need-enum-not-prose-2026-07-02.md) — a sibling finding about the same family of guard/routing scripts: an enum-shaped value needs an explicit, closed vocabulary, not an implicit "match one string, default the rest"
