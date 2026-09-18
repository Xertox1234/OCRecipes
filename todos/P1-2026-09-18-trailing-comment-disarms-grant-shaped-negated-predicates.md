---
title: "A trailing comment or redirect operand disarms every grant-shaped negated predicate in both merge guards"
status: backlog
priority: high
created: 2026-09-18
updated: 2026-09-18
assignee:
labels: [deferred, security, hooks]
github_issue:
---

# A trailing comment or redirect operand disarms every grant-shaped negated predicate in both merge guards

## Summary

The implicit-POST arms added by #995 are both anchored on the **absence** of a method flag
(`! grep -Eq "$_GH_API_ANYMETHOD"` / `! … "$MRG_API_ANYMETHOD"`). The clause they read retains text
that never reaches `argv` — shell comments and redirect operands — so appending one token that
merely _looks_ like a method flag makes the negated conjunct false and the whole arm stands down.
Measured on `f129c2da`; both guards, both vectors.

## Background

Filed rather than fixed under the binding 2026-09-17 one-pass decision for the batched guard P1s
(see `feedback_batch_remaining_p1_guards_one_review_pass` in auto-memory). **This is an unclosed
gap, not a regression**: before #995 the field-only form was allowed outright by both guards, so
the arm being narrower than advertised leaves `main` no worse than it was. That is precisely the
category the decision says to file.

It is still worth a P1, because the arm's own `DOCUMENTED RESIDUALS` block
(the `DOCUMENTED RESIDUALS` block above the arm) did not name this class when this was filed — so the written residual accounting is
**narrower than the actual gap**, which is this file's most expensive recurring defect.

The governing rule is already written down elsewhere in the same tree: `merge-review-guard.sh` records
that `cmd_bare` does not strip comments, warns that this "would hand the agent a one-comment bypass",
and states that extra tokens are "fatal for a grant-shaped check". **Cited by symbol and quoted
phrase on purpose** -- the first version of this todo cited line numbers that the very commit adding
it had already shifted by ~23 lines, which is the defect this file exists to complain about.
#995 introduced the first grant-shaped (negated) predicate in these blocks, so that standing rule
now applies to it and nothing yet enforces it.

## Measured evidence

All rows fed as `PreToolUse` payloads on stdin at `f129c2da`; no outward command executed.

| payload                                                        | outward | merge gate |
| -------------------------------------------------------------- | ------- | ---------- |
| `gh api repos/o/r/pulls/42/merge -f k=v # -X GET`              | ALLOW   | ALLOW      |
| `gh api repos/o/r/pulls/42/merge -f k=v # --method GET`        | ALLOW   | ALLOW      |
| `gh api repos/o/r/pulls/42/merge -f k=v > -X`                  | ALLOW   | ALLOW      |
| **control** `… -f k=v # harmless note`                         | DENY    | DENY       |
| **control** `… -f k=v` (no trailing token)                     | DENY    | DENY       |
| `gh api /repos/o/r/merges -f base=main -f head=x # -X GET`     | ALLOW   | n/a        |
| **control** same row unmodified (corpus id `apicolfp-oneshot`) | DENY    | n/a        |

The controls are what make these evidence: the benign comment denies, so the `-X` _inside the
comment_ is what flips the verdict. `argv` was dumped under `/bin/bash 3.2.57` and `/bin/zsh 5.9`
for both bypass rows and reads `[repos/o/r/pulls/42/merge] [-f] [k=v]` — **no method token reaches
gh**, so `!opts.RequestMethodPassed && len(params) > 0` holds and gh sends POST.

The last pair matters most: it is the corpus row `apicolfp-oneshot` that #995 deliberately moved
from ALLOW to DENY. One appended comment returns it to ALLOW.

## Two more vectors in the same class, found 2026-09-18 (round 3)

**(a) A METHOD-SHAPED TOKEN IN ANOTHER FLAG'S VALUE SLOT.** A field flag followed by
`--template -X` (also `-t`, and `-p`/`--preview`) reads ALLOW on both guards, while the same
carriers holding an ordinary value deny -- so the decoy token is what flips the verdict.
**The remedy in the Acceptance Criteria below cannot close this one**, and that is the point of
recording it separately: the `-X` here genuinely reaches `argv` as another flag's value, so it
survives any cut of text-that-never-reaches-argv. Closing it needs the guard to know which flags
CONSUME a following token, which is a different mechanism from stripping comments.

Grade the carriers honestly when fixing. `--template`/`-t`/`-p` are the confident ones: pflag
takes the next argument as the value with no leading-dash check, and the template/preview value is
consumed only after the response returns. The `--jq`/`-q` variants additionally assume the filter
is applied after the request is issued -- cite `api.go` for that or mark it unverified rather than
carrying it as measured.

**(b) THE FIELD-FLAG CLOSER IS HAND-SPELLED.** `_GH_API_FIELD` / `MRG_API_FIELD` close the three
LONG field flags with `([[:space:]]|=|$)` instead of the exported `${_OUT_POS_SUFFIX}` /
`${_CMD_POS_SUFFIX}`. A redirect operator terminates a shell word without whitespace, so a
redirect glued directly to a long field flag escapes that class and stands the arm down on BOTH
guards, with no bypass token and with `argv` identical to the spaced form that denies. The short
`-f`/`-F` forms survive only accidentally, because they carry no closer at all. This is the exact
defect the adjacent comment says was fixed for the ENDPOINT closer and must not be re-spelled.

**AND THE LINT THAT EXISTS TO CATCH IT IS BLIND TO IT.** Both suites carry a structural check
asserting no code line hand-spells a closer class; both grep for the literal `([[:space:]]|$)` and
therefore do not see the `([[:space:]]|=|$)` variant. They report PASS on the very lines they were
written to catch. **Widening that lint is step one of this fix, not a separate cleanup** -- do it
first, watch it go red, then fix what it flags. Fixing the closer without widening the lint leaves
the next `|=|` spelling equally invisible.

## Acceptance Criteria

- [ ] Both negated conjuncts evaluate over a clause with **non-argv text removed**: cut at an
      unquoted `[[:space:]]#`, and blank redirect-operator operands.
- [ ] The cut reuses the `_CMD_REDIR` / `_OUT_SEP` grammar already exported by `lib/cmd-detect.sh`
      rather than hand-spelling a new redirect grammar.
- [ ] If the clause carries a field flag **and** a comment that cannot be cleanly cut, the guards
      DENY (cannot verify → deny, matching the 2026-09-05 unreadable-method ruling).
- [ ] Both sites fixed in the **same change** — `guard-outward-cli.sh` and `merge-review-guard.sh`
      carry byte-identical patterns, and fixing one is exactly the cross-file miss that the
      closer-class invariant in `test-merge-review-guard.sh` (`_mrgcloser_hits`) exists to prevent.
- [ ] Suite rows added for both vectors on both guards, **each with the benign-comment control**,
      so a future regression cannot pass by denying for the wrong reason.
- [ ] `guard-outward-cli.sh`'s `DOCUMENTED RESIDUALS` block updated so the written accounting is no
      longer narrower than the code.
- [ ] Corpus DENY-SITE COVERAGE / pins re-derived from a real run if any deny site moves.
- [ ] The closer in `_GH_API_FIELD` / `MRG_API_FIELD` uses the exported suffix constant rather
      than a hand-spelled class, and the structural closer-class lint in BOTH suites is widened
      first so it actually flags the `|=|` variant before the fix silences it.
- [ ] Value-position decoys (`--template -X` and the other consuming carriers) are either closed
      or named in the `DOCUMENTED RESIDUALS` block with the carriers graded by confidence.

## Implementation Notes

Sites: `_GH_API_ANYMETHOD` in `guard-outward-cli.sh` and `MRG_API_ANYMETHOD` in
`merge-review-guard.sh`, plus the negated conjunct that consumes each. The two patterns are
byte-identical. **Grep the symbols, not line numbers** -- every edit to these two files moves them.

Do **not** fix this by making the predicate presence-shaped — denying whenever a field is present
would deny an explicit read (`-X GET … -f a=b`), which is the failure mode that gets a guard
switched off rather than fixed. The arm must stay anchored on absence, exactly as gh anchors on
`!RequestMethodPassed`; the fix is to make the _text it reads_ match what reaches `argv`.

Editing `.claude/hooks/**` triggers the ~17-minute corpus job, and a deep check is unreachable
unless `cmd_fastpath_has` carries a needle for it. `*gh*` is already a needle
(it is in `cmd_fastpath_has`'s needle list), so no needle work is needed for these two sites.

## Scope Contract

- **Mechanisms to use:** the existing `_CMD_REDIR` / `_OUT_SEP` grammar from `lib/cmd-detect.sh`,
  and the existing deny sites — no new abstraction, no new guard file.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`, `.claude/hooks/merge-review-guard.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/test-merge-review-guard.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- A comment-stripping cut is itself parser work on a shared, fail-closed file; getting it wrong
  over-denies ordinary commands carrying a `#`, which is a worse outcome than the gap.
- Quoted `#` must not be cut (`-f body='a # b'` is not a comment). Quoted spans are already blanked
  before the clause is cut, so verify that ordering holds rather than assuming it.

## Dependencies

- None. #995 merges independently; this narrows an arm that PR introduced.

## Updates

### 2026-09-18

- Round-3 review added two further vectors in the same class (value-position decoy, hand-spelled field-flag closer) and the lint blind spot; line-number
  citations replaced with symbols after the fix commit shifted them.

- Filed from the one-pass roster review of PR #995 at `f129c2da`, per the binding 2026-09-17
  batched-guard decision. Evidence above re-measured independently before filing.
