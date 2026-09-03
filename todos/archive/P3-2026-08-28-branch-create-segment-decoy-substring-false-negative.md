---
title: "cmd_git_branch_create_segment's loose segment grep can pick a decoy over the real create"
status: done
priority: low
created: 2026-08-28
updated: 2026-09-02
assignee:
labels: [deferred, harness, security]
github_issue:
---

# cmd_git_branch_create_segment's loose segment grep can pick a decoy over the real create

## Summary

`cmd_git_branch_create_segment` (`.claude/hooks/lib/cmd-detect.sh`) extracts "checkout ..."/
"switch ..." segments with an un-anchored `grep -oE`, so a decoy token where "checkout"/
"switch" appears as a substring immediately followed by whitespace (e.g. a made-up word like
`gcheckout -b decoy origin/main`) can be selected ahead of a REAL, later branch-create in the
same compound command. If that decoy segment also carries a trailing non-flag token, the
extraction computes `HAS_START_POINT=1` and `branch-preflight.sh`'s stale-base check silently
skips itself for the real create that follows — even though the real create has no start-point
and IS relying on local's possibly-stale HEAD.

## Background

Surfaced by a third review pass (2026-08-28) while verifying PR #863's compound-command fix
(`cmd_git_branch_create_segment`, closing the "an earlier unrelated checkout hides a later real
create" regression). The reviewer confirmed this specific decoy-substring shape is
**pre-existing and byte-identical across every version of this PR** — the original `head -1`
extraction, both round-1 fix attempts, and the final shared-segment extraction all select the
same wrong segment for this input. It is not a regression introduced by PR #863; it's a gap the
PR's fixes never touched.

## Severity

Low. The whole check this feeds (`branch-preflight.sh`'s check 2) is explicitly documented as a
**hygiene nudge, not a security gate** — it already fails open by design (`SKIP_BRANCH_PREFLIGHT=1`
escape hatch, no-upstream case, fetch-failure case all silently skip it) and only ever prevents
redundant work, never data loss. The trigger shape (a decoy word starting with "checkout"/
"switch" as a substring, immediately followed by whitespace and a trailing non-flag token, in a
compound command that ALSO contains a real create with no start-point) is contrived and unlikely
in ordinary interactive typing or scripting.

## Acceptance Criteria

- [x] `cmd_git_branch_create_segment`'s segment extraction is anchored so a decoy substring
      match (not a real `checkout`/`switch` word) cannot be selected ahead of — or instead of —
      the segment that actually carries a create flag.
- [x] Regression test in `test-cmd-detect.sh` pinning the exact decoy shape from this todo.
- [x] Full `bash scripts/run-hook-tests.sh` suite still passes.

## Implementation Notes

The existing STRICT stage-1 check in `cmd_is_git_branch_create` (command-position anchored via
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`) already correctly rejects a decoy as the sole basis for
detection — this gap is specifically in the LOOSE stage-2 segment extraction
(`cmd_git_branch_create_segment`), which currently has no equivalent anchor. Options: (a) anchor
the segment-extraction regex the same way stage-1 is anchored, or (b) after loosely extracting
candidate segments, re-validate each one against the strict command-position pattern before
accepting it as "the" segment. Whichever approach, `branch-preflight.sh`'s own extraction reuses
this same shared function (see PR #863's fix history), so a single fix here closes it for both
the boolean matcher and the start-point extraction — do not re-introduce two independent
call-site implementations.

## Scope Contract

- **Mechanisms to use:** extend `cmd_git_branch_create_segment` in
  `.claude/hooks/lib/cmd-detect.sh` only — no new detection mechanism.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/test-cmd-detect.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Follows PR #863 (`feat/branch-fetch-staleness-check`), which introduced
  `cmd_git_branch_create_segment`.

## Risks

- Low — this is a narrowing fix to an already-loose extraction; verify it doesn't reintroduce
  the "first segment wins" regression PR #863's second fix round closed
  (`git checkout main && git checkout -b foo` must still resolve to the SECOND segment).

## Updates

### 2026-08-28

- Filed from PR #863's third review pass, per the "Low-severity item → auto-file" rule
  (pre-existing gap, confirmed out of scope for that PR's own diff).

### 2026-09-02

- Implemented: `cmd_git_branch_create_segment`'s extraction now requires a real bash word
  boundary (start-of-string, whitespace via `[[:blank:]]`, or `;&|()` `` ` `` — a whitelist, not
  a blacklist) before `checkout`/`switch`, closing the `gcheckout`-style decoy-substring false
  negative this todo describes. Three review rounds (code-reviewer + security-auditor, the third
  narrowly scoped) found successive regressions the character-class narrowing itself introduced,
  and each was either fixed or, where fixing risked being worse than the miss, deliberately
  reverted in favor of a documented residual:
  - Round 1 (CRITICAL): the first whitelist attempt included `!`/`{`/`}`/`<`/`>`, none of which
    are real bash word boundaries when GLUED (`x!checkout` tokenizes as one literal word) —
    narrowed to `;&|()` `` ` ``.
  - Round 2 (2 CRITICALs): (a) the boundary whitespace class was POSIX `[[:space:]]`
    (space/tab/newline/VT/FF/CR), three bytes wider than what bash's tokenizer treats as
    word-separating — narrowed to `[[:blank:]]`. (b) dropping `}` (to close round 1's bare-glue
    bug) also broke detection of `${x}checkout`, a genuinely live parameter-expansion-glued
    create — a same-day fix neutralized `${...}` spans via a dedicated `sed` pass before the
    boundary check.
  - Round 3, targeted at the round-2 fixes specifically (2 more CRITICALs, both in the new
    `${...}` pass): a single-pass ERE substitution cannot balance nested braces, so
    `${a:-${b}}checkout` (confirmed live) was a TOTAL MISS at both detection stages; and the pass
    could not distinguish an expansion that can be empty from one that never can, so
    `${#x}checkout` (length expansion, ALWAYS non-empty, confirmed NEVER live) was deleted
    unconditionally, manufacturing a false decoy that shadowed a real later create end-to-end
    through `branch-preflight.sh`'s own `HAS_START_POINT` computation — reproducing the exact bug
    class this todo exists to close, via the mechanism meant to close a different instance of it.
    RESOLVED by reverting the `${...}` neutralization pass entirely rather than attempting a
    fourth cycle: `${x}checkout`-glued creates (bare or nested) are now a documented, safe-fail
    MISS (matching this check's own already-extensive fail-open design), not a risk of a false
    decoy. Verified: with the pass removed, both round-3 repro cases resolve correctly to the
    real segment when a real create is present elsewhere, and to "not detected" in isolation —
    never to the fake segment.
    All fixes (round 1, round 2a, round 3's reversion) are mutation-tested (each guard pin
    confirmed RED against a scratch copy of the relevant prior/reverted state, GREEN against the
    current code) and the full suite (`test-cmd-detect.sh`, 415 assertions; `run-hook-tests.sh`,
    34/34 suites) passes with zero regressions. `git diff HEAD -- .claude/hooks/lib/cmd-detect.sh`
    net change is smaller than round 2's peak — the reverted pass and its comments are gone, its
    lesson kept as a KNOWN RESIDUAL instead.
- Residuals surfaced by review are deliberately NOT closed here (documented in the function's own
  KNOWN RESIDUALS comment, 5 items, none excluded by this todo's Scope Contract but all either a
  materially larger change than a character-class fix, or — for the `${...}`/brace-expansion
  glue items — a change whose only attempted form was shown to be worse than the miss it would
  close): (1) the extraction doesn't require the matched word to be a `git` subcommand at all —
  needs Implementation Notes option (b), re-validating each candidate against the strict
  command-position anchor; (2) no concept of `&&`/`||` control-flow reachability, so a decoy on
  the unreached side of a short-circuit can still shadow a real, reachable create; (3) a real
  create glued via `${...}` (bare or nested) is missed, not shadowed — the safe-fail trade-off
  from round 3 above; (4) the worked example of why a naive `${...}` neutralizer is dangerous
  (`${#x}`, provably never empty, would be wrongly deleted); (5) bare brace EXPANSION
  (`{,}checkout`) is an equally missed glue mechanism, though no successful exploitation of it
  was found — git's own `>=2`-alternative grammar always leaves a colliding junk argv word.
