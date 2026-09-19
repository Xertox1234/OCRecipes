---
title: "The merge gate's endpoint check should key on argv POSITION, not path shape"
status: backlog
priority: low
created: 2026-09-18
updated: 2026-09-18
assignee:
labels: [deferred, hooks]
github_issue:
---

# The merge gate's endpoint check should key on argv POSITION, not path shape

## Summary

`merge-review-guard.sh` decides "is this `gh api` call aimed at a PR-merge endpoint?" with main's
substring test `pulls.*merge` over the whole clause. Since #995's implicit-POST arm, that test
also reads field VALUES, so three prose spellings over-deny. The fix that keeps being reached for
— a "precise" path pattern — has failed open five times and is now forbidden by the guard's own
comment. The correct discriminator is **argv position**: an endpoint is a positional token, a
field value follows `-f`/`-F`/`--field`/`--raw-field`.

## Background

Filed from PR #995 on 2026-09-18. The anchored path pattern went through four review rounds and
five main-DENY/branch-ALLOW shapes (`$`/`:` in segments, `#fragment`, quoted `#`, `merge//`,
`pulls//42/merge`) before being reverted. The full list, with the reason each attempt's own
comment was wrong, is above the predicate in `merge-review-guard.sh`. Read it before starting.

The over-denials are **low** priority because they deny (the safe direction for a merge gate), the
`ALLOW_OUTWARD_CLI=1` bypass exists, and this repo's PR comments go through the GitHub MCP tools
rather than field-carrying `gh api` calls. They are pinned as `ACCEPTED OVER-DENIAL` rows in
`test-merge-review-guard.sh`; a fix must flip those rows deliberately, not silently.

## Acceptance Criteria

- [ ] The endpoint check consumes a **positional-only** view of the clause — field flags and their
      values removed — so a field VALUE can never satisfy it.
- [ ] Positional-only view is derived from the existing `cmd_words_deep` rendering and the
      `MRG_API_FIELD` grammar already in the file; no new tokenizer.
- [ ] The three `ACCEPTED OVER-DENIAL` rows flip back to `assert_allowed`, each with a paired
      DENY control (same endpoint in a positional slot) in the same block.
- [ ] Every one of the 23 endpoint-spelling regression rows added under #995 still denies —
      run them; they are the only corpus this file has.
- [ ] A generated corpus (endpoint spellings × quotings × field-flag placements) measures
      **0 main-DENY/new-ALLOW rows** before the change is proposed, with a mutation control that
      reproduces a non-zero count.
- [ ] The guard comment's "DO NOT RE-NARROW THIS LINE WITHOUT THAT POSITIONAL MODEL IN HAND" is
      updated to point at the positional model rather than forbidding the change outright.

## Implementation Notes

Do **not** touch the substring test itself; wrap what it reads. The failure mode to design
against is the one that produced five rounds: any predicate that models the path's shape is an
allowlist inside a deny gate. A positional view has no shape to model — it only asks _which slot_
the token is in.

Both guards carry byte-identical `_GH_API_FIELD` / `MRG_API_FIELD` grammars; the positional cut
belongs in `lib/cmd-detect.sh` if both guards will consume it, otherwise in the merge gate alone.
Editing `.claude/hooks/**` triggers the ~17-minute corpus job, but that corpus pins
`guard-outward-cli.sh` only — `merge-review-guard.sh`'s suite is its whole coverage.

## Scope Contract

- **Mechanisms to use:** `cmd_words_deep`, the existing `MRG_API_FIELD` grammar, and
  `test-merge-review-guard.sh` rows — nothing new.
- **Files in scope:** `.claude/hooks/merge-review-guard.sh`, `.claude/hooks/test-merge-review-guard.sh`,
  and `.claude/hooks/lib/cmd-detect.sh` only if the cut is shared.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. #995 lands with the substring test; this is a follow-up.

## Risks

- Removing field flags and their values from the clause is itself a small parser; a glued
  `--field=k=v`, a quoted value containing spaces, and a value that is itself `-X` all need rows.
- The three filed vectors in `todos/P1-2026-09-18-trailing-comment-disarms-grant-shaped-negated-predicates.md`
  read the same clause; coordinate so the two changes do not each re-cut it differently.

## Updates

### 2026-09-18

- Filed when the anchored predicate was reverted in PR #995 after its fifth fail-open shape.
