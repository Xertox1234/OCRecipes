---
title: "guard-outward-cli.sh: a SPACE-separated redirect target named --auto forges the merge carve-out, allowing an immediate merge"
status: backlog
priority: critical
created: 2026-09-07
updated: 2026-09-07
assignee:
labels: [security, harness]
github_issue:
---

# A redirect target spelled `--auto` grants the carve-out it is not

## Summary

`gh pr merge 42 > --auto` is ALLOWED. Real argv is `gh pr merge 42` — **no `--auto` reaches
gh at all** — so the PR merges IMMEDIATELY, which is the exact thing the `--auto` carve-out
exists to prevent. The `--auto` token the guard reads is the redirect's _filename_.

## Background

Found 2026-09-07 while closing the interior-redirect P0 (PR for
`P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family`). **Pre-existing and
unchanged by that fix** — measured identical on `main` and on the fix branch. Surfaced rather
than folded in, because it is a different mechanism from that todo's scope contract (which
authorised exactly one interior separator absorber).

The mechanism is the `--auto` field scan at `guard-outward-cli.sh`'s
`HAS_REAL_AUTO` assignment:

```
HAS_REAL_AUTO=$(awk -v flags="$GH_MERGE_VALUE_FLAGS" '
  { prev = ""
    for (i = 1; i <= NF; i++) {
      if ($i == "--auto" && prev !~ flags) { print "yes"; exit }
      prev = $i } }' <<< "$CLAUSE")
```

awk splits `$CLAUSE` on WHITESPACE. It has no notion that `<`/`>` are token boundaries in
bash. With a space before the operator, `>` and `--auto` become two separate awk fields, the
`--auto` field compares equal, `prev` is `>` (not in `GH_MERGE_VALUE_FLAGS`), and the
carve-out is granted.

This is the CANDIDATE IMPROVEMENT the file's own DOCUMENTED RESIDUALS block already names and
explicitly declines, in the finding-A ACCEPTED OVER-DENIAL entry: _"teach the `--auto` field
scan itself to treat `<`/`>` as token boundaries"_. That entry frames it as an over-denial
fix; this todo records that the same scan ALSO has an under-denial face, which the entry does
not mention.

### Measured, 2026-09-07

Ground truth by execution, PATH-shadowed argv-printing stubs writing to a sentinel FILE
(a stdout-reporting stub reads "not invoked" for every row — these constructions redirect
stdout). Decisions from the live hook via the standard `jq -cn --arg` envelope.

| construction              | real argv               | main  | fix branch |
| ------------------------- | ----------------------- | ----- | ---------- |
| `gh pr merge 42`          | `gh pr merge 42`        | DENY  | DENY       |
| `gh pr merge 42 > --auto` | `gh pr merge 42`        | ALLOW | ALLOW      |
| `gh pr merge 42 >--auto`  | `gh pr merge 42`        | DENY  | DENY       |
| `gh pr merge 42 --auto`   | `gh pr merge 42 --auto` | ALLOW | ALLOW      |

**The glued row is the attribution control.** `>--auto` glued makes ONE awk field, `>--auto`,
which is not equal to `--auto`, so the scan does not fire and the merge is correctly denied.
The only difference between the two failing/passing rows is the SPACE — which isolates the
defect to the field-splitting, not to anything else in the block.

### The forge also works at the INTERIOR slots (added 2026-09-07)

The table above varies only the TRAILING position. The `_OUT_SEP` interior absorber makes the
same forge reachable at the tool→namespace and namespace→verb slots, because the absorbed
redirect becomes part of the extracted CLAUSE and its target is a separate awk field:

| construction                       | real argv        | main  | with \_OUT_SEP |
| ---------------------------------- | ---------------- | ----- | -------------- |
| `gh > --auto pr merge 42`          | `gh pr merge 42` | ALLOW | ALLOW          |
| `gh pr > --auto merge 42`          | `gh pr merge 42` | ALLOW | ALLOW          |
| `gh > --auto pr > --auto merge 42` | `gh pr merge 42` | ALLOW | ALLOW          |

**Not a regression — the decision is unchanged on both trees, so no row was opened.** But the
MECHANISM differs, and that matters for whoever fixes this: on `main` these allow because the
detector never fires at all (the interior-redirect gap); with `_OUT_SEP` the detector fires
and they allow because the forged `--auto` GRANTS the carve-out. A fix that only teaches the
trailing position to treat `<`/`>` as token boundaries would leave these three live. Include
them in the acceptance criteria's mutation controls, not just the trailing row.

### Severity

`critical`. This is a silent ALLOW on an immediate, unarmed `gh pr merge` — the single
outcome the `--auto` carve-out is built to gate, and the carve-out's own stated premise
(branch protection still applies) does not save it, since an immediate merge of a
protection-satisfying PR is exactly what a reviewer expected not to happen unattended.

Honest qualifier, same as its sibling P0s: nobody writes `> --auto` by accident. It is filed
critical for effect, not for likelihood.

## Acceptance Criteria

- [ ] Reproduced first against unmodified `main` — construct each row, run the hook, record
      actual exit codes. If a row does not reproduce, report that rather than fixing
      something that is not broken.
- [ ] The `--auto` scan treats `<` and `>` as token boundaries, so a redirect target can
      never be read as a flag.
- [ ] **The CLAUSE is not truncated to achieve it.** The file already reverted one attempt to
      make `<`/`>` closers in `_OUT_POS_SUFFIX_MERGE_CLAUSE` branch 1, because truncating the
      clause hid a LATER `$`-bearing sigil from the unverifiability mask and silently allowed
      `gh pr merge 42 --auto >anyfile ${x:---admin}`. That regression test exists; it must
      stay green. Fix the SCAN, not the cut.
- [ ] Two-sided regression tests with reasons asserted, including the glued attribution
      control above (which must stay DENY for its own reason, not incidentally).
- [ ] Mutation-tested per row: stub the fix, confirm the named assertions FAIL, restore.
- [ ] False-positive population measured by execution over real command history, both
      directions, with the harness validated against a known flip.
- [ ] Check whether the sibling value-flag logic has the same blindness: `gh pr merge 42
  -b>x --auto` reads `prev` as `-b>x`, which does not match `^-b$`, so the `--auto` is
      counted as real — while bash gives `-b` the `--auto` as its VALUE. Measure it; if it
      reproduces it belongs in this same fix, since it is the same field-splitting cause.

## Implementation Notes

- The scan is the ONE grant-shaped read in the file. Widening what it accepts turns denies
  into allows, unlike every other check here — so every change needs a paired control that
  would catch over-granting, not only under-granting.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH` writing to a
  sentinel FILE; shadow a binary rather than stripping `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive, and
  `ALLOW_OUTWARD_CLI=1` clears only the single check that fired. Use file tools, not shell
  command strings.

## Scope Contract

- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`,
  and the disclosure sites for any residual this closes or opens.
- No new parsing layer, no expansion evaluation, no new dependency.
