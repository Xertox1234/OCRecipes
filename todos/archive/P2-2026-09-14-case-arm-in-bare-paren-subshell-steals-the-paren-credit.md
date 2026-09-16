---
title: "cmd-detect: a case arm inside a bare-paren subshell steals the paren credit, so the subshell's `)` still closes $(...) early"
status: done
priority: medium
created: 2026-09-14
updated: 2026-09-14
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A case arm inside a bare-paren subshell composes two mechanisms and escapes both

## Summary

PR #966 taught `lib/cmd-detect.sh` to recognise `case`/`esac` at a genuine command-word
start, so a case arm's unmatched `)` no longer closes the enclosing `$(...)` early. A case
arm wrapped in a **bare-paren subshell** still escapes: the subshell's own `(` consumes the
paren credit, and its `)` closes the substitution early anyway.

## Background

Found 2026-09-14 in the post-implementation review of #966, then reproduced independently
against the branch, its merge-base parent, and `main`, with a live positive control in every
run (`eas update --branch preview` → DENY at all three refs).

| construction                                                 | branch    | parent | main  |
| ------------------------------------------------------------ | --------- | ------ | ----- |
| `e$( ( case x in a) : ;; esac ) )as update --branch preview` | **ALLOW** | ALLOW  | ALLOW |
| `e$({ case x in a) : ;; esac; })as update --branch preview`  | DENY      | ALLOW  | ALLOW |
| `e$(case x in a) : ;; esac)as update --branch preview`       | DENY      | ALLOW  | ALLOW |

**Pre-existing, not opened by #966** — it allows on `main` too. #966 closed the bare and
brace-grouped forms; this composition survives.

The brace-group row is the control that isolates the mechanism: `{ … }` does not consume
`parens[d]` while `( … )` does, and that single character is the whole difference between
DENY and ALLOW on two commands that reconstruct the identical live invocation.

## Why this was filed rather than fixed in #966

#966's disclosure heading read "CLOSED … FOR AN UNTERMINATED OR **COMMENT-FREE** ARM", and
this shape is comment-free — so the wording asserted a property of a class from the one form
that had been tested. That wording was corrected in #966 (the heading now says "bare or
brace-grouped", and this residual is named in `DOCUMENTED RESIDUALS` with the table above).
Carrying it as a measured corpus row is the remaining work, and it is a new axis rather than
a correction to that diff.

## Acceptance Criteria

- [x] Corpus rows for the composition, following the `vcasecomment` convention already used
      for the sibling comment-composition residual (a `TOOL_MIDS`/`SPAN2_IDS` variant rather
      than hand-listed rows — the axis's own rule is that new dimensions are GENERATED).
      Done: `vcaseparen` added to `TOOL_MECHS`/`TOOL_MIDS` and `SPAN2_MECHS`/`SPAN2_IDS`.
- [x] Rows are EXPECTED-DENY and therefore report as gaps by design, exactly as the
      `toolvcasecomment-*`/`verbvcasecomment-*` rows do, until the mechanism is closed.
      Measured: 17 of 18 `*vcaseparen-*` rows report as precise-path gaps (`flagvcaseparen-
    ghadmin` denies for a pre-existing, unrelated "no REAL --auto" reason, matching the
      `flagvcasearm-ghadmin`/`flagvcasecomment-ghadmin` precedent).
- [x] The brace-group control is carried alongside as an EXPECTED-DENY row that actually
      passes, so the pair discriminates rather than both sitting in the gap list.
      Done: `vcasebrace` added to the same two arrays. Measured at all three splice positions
      (tool/verb/flag) before wiring it in — all 18 rows DENY, 0 gaps.
- [x] `EXPECTED_ROWS`, `EXPECTED_PRECISE_GAPS` and the manifests re-derived from a run, never
      hand-incremented (a branch can LOWER a gap pin, so neither the old nor the new value is
      safe to assume).
      Done: `EXPECTED_ROWS` 876->912, `EXPECTED_PRECISE_GAPS` 24->41, `EXPECTED_ALLPATH_GAPS`
      279->303, `EXPECTED_DENY_ATTRIB_ROWS` 761->780, all copied verbatim from the script's own
      printed diff after a full run. Corpus now reports a clean pin (rows=912, precise-path
      gaps=41, all-path gaps=303, 780 deny reasons attributed).
- [ ] If the mechanism is actually closed rather than just measured: the `casedepth` tracking
      needs to survive a bare-paren subshell boundary, which is a change to how `parens[d]`
      and `casedepth` interact — verify the blind pass stays case-blind so the union is
      preserved.
      NOT attempted, deliberately: this is the conditional item. Per the Scope Contract
      ("no new scanner, no comment-state tracking") and the Risks section's own warning
      against over-scoping ("measuring this one shape is worth more than an attempt to close
      'all compositions'"), and per this todo's immediate predecessor being reclassified the
      same way (model B: deliberate-construction-only, documented residual, not a critical
      defect), this todo ships the measurement-only path. `.claude/hooks/lib/cmd-detect.sh`
      and `.claude/hooks/test-cmd-detect.sh` carry zero diff.

## Implementation Notes

- The state machine lives in `.claude/hooks/lib/cmd-detect.sh` (`cmd_extract_substitutions`
  and `_cmd_vanish_pass`), with the `casedepth` increments gated to the counting pass.
- `guard-outward-cli.sh`'s `DOCUMENTED RESIDUALS` block already carries the measured table;
  keep the two in sync if the verdicts change.
- Probe shape used (no outward-facing CLI is executed — the guard only prints a decision):
  `printf '%s' "$cmd" | jq -Rs '{tool_name:"Bash",tool_input:{command:.}}' | bash guard-outward-cli.sh`
  Run it from the hooks directory, or `$HERE/lib/cmd-detect.sh` will not resolve and the
  guard silently degrades — a broken harness reports ALLOW for everything and looks like a
  finding.

## Scope Contract

- **Mechanisms to use:** the existing `TOOL_MIDS`/`SPAN2_IDS` corpus-variant convention and
  the existing `casedepth`/`parens[d]` state — no new scanner, no comment-state tracking
  (already considered and rejected as "a fifth grammar bet").
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`, `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-cmd-detect.sh`
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- The composition space is open-ended (if/while/until-nested case is a separate disclosed
  residual). Measuring this one shape is worth more than an attempt to close "all
  compositions", which is how the axis got over-scoped before.
- Widening `casedepth` handling touches the union between the precise and blind passes; the
  blind pass is the backstop and must stay case-blind.

## Updates

### 2026-09-14

- Filed from #966's post-implementation review, after reproducing the three-row table above
  at branch, parent and main with a positive control in each run.

### 2026-09-16

- Implemented, measurement-only path: `vcaseparen`/`vcasebrace` added to
  `repro-outward-cli-corpus.sh`'s `TOOL_MECHS`/`TOOL_MIDS` and `SPAN2_MECHS`/`SPAN2_IDS`
  generator arrays. All 18 `vcaseparen` rows (tool/verb/flag) measured ALLOW except
  `flagvcaseparen-ghadmin` (denies for a pre-existing unrelated reason); all 18 `vcasebrace`
  control rows measured DENY at every position, confirmed via direct probe before wiring
  into the arrays (per an advisor pre-check gate on exactly this question) and again via the
  full corpus run.
- Pins re-derived from a full run, never hand-computed: `EXPECTED_ROWS` 876->912,
  `EXPECTED_PRECISE_GAPS` 24->41, `EXPECTED_ALLPATH_GAPS` 279->303,
  `EXPECTED_DENY_ATTRIB_ROWS` 761->780, plus the three ID-manifest heredocs, all copied
  verbatim from the script's own printed diff.
- `guard-outward-cli.sh`'s existing DOCUMENTED RESIDUALS entry (already fully written up)
  updated with a one-line pointer to the new row ids, mirroring the `vcasecomment` sibling's
  phrasing. No new residual paragraph added.
- `.claude/hooks/lib/cmd-detect.sh` and `.claude/hooks/test-cmd-detect.sh` carry zero diff —
  the conditional AC item (actually closing the mechanism) was deliberately not attempted;
  see the Acceptance Criteria section for the reasoning.
- Reviewed by `code-reviewer` and `security-auditor`: zero CRITICAL findings from either.
  Two WARNINGs — a stale prose decomposition paragraph (fixed inline) and the
  `todos/archive/...` pointer paths in the two DOCUMENTED RESIDUALS comments referencing a
  location that didn't exist yet at review time (resolved by this same archive move).
- Hook self-tests (38 suites, including `test-cmd-detect.sh` 659/0 and
  `test-guard-outward-cli.sh` 784/0), full `npm run test:run` (531/531 files, 8514/8514
  tests), `npm run check:types`, and `npm run lint` all pass clean.
