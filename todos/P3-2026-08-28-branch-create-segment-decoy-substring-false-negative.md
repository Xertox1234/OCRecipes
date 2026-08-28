---
title: "cmd_git_branch_create_segment's loose segment grep can pick a decoy over the real create"
status: backlog
priority: low
created: 2026-08-28
updated: 2026-08-28
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

- [ ] `cmd_git_branch_create_segment`'s segment extraction is anchored so a decoy substring
      match (not a real `checkout`/`switch` word) cannot be selected ahead of — or instead of —
      the segment that actually carries a create flag.
- [ ] Regression test in `test-cmd-detect.sh` pinning the exact decoy shape from this todo.
- [ ] Full `bash scripts/run-hook-tests.sh` suite still passes.

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
