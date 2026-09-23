---
title: "git-safety.sh parameterised the SKIP_REASON clauses but not the six resolved-path outcome clauses, which the gh pr close arm also reaches"
status: backlog
priority: low
created: 2026-09-15
updated: 2026-09-15
assignee:
labels: [deferred, harness]
github_issue:
---

# The `gh pr close` arm gets branch-deletion guidance from six clauses

## Summary

`.claude/hooks/git-safety.sh` introduced `${SUBJ}`/`${VERB}` so the shared ref-processing
block could speak correctly for both the branch-delete and PR-close directions. The
parameterisation was applied to the three `SKIP_REASON` clauses only. Six resolved-path
outcome clauses still hardcode branch-deletion nouns, and the `gh pr close` arm reaches all
of them.

This contradicts the hook's own comment, which is why it is worth fixing rather than
accepting: "the shared block is reached by every arm, so a hardcoded noun is wrong for
whichever arms it was not written for".

## Measured

For `gh pr close 42`, across all four gh outcomes:

| gh outcome     | emitted guidance                                  | why it is wrong here                               |
| -------------- | ------------------------------------------------- | -------------------------------------------------- |
| MERGED         | "deletion is safe."                               | nothing is being deleted                           |
| OPEN           | "deleting this branch will CLOSE THE PR UNMERGED" | closing the PR is the intent, not a side effect    |
| CLOSED         | "Never sweep this branch silently"                | no branch is in play                               |
| unparseable    | "confirm merge state manually"                    | the subject is the PR's state                      |
| no PR found    | "deleting it may lose never-pushed work"          | nothing is deleted and no unpushed work is at risk |
| gh unavailable | "confirm merge state manually before deleting"    | should be "before closing"                         |

Not a security issue: the advisory still fires, and `guard-outward-cli.sh` independently
denies the destructive action. The cost is that a reader following PR-close guidance is told
about branch deletion.

## Acceptance Criteria

- [ ] Interpolate the existing `${SUBJ}`/`${VERB}` into these six `warn` strings, or add a
      third variable for the action noun ("this branch" / "this PR") that the OPEN and
      no-PR-found clauses need — `${SUBJ}`/`${VERB}` alone do not carry it.
- [ ] Assert BOTH directions for each of the four gh outcomes, not just the direction the
      string was originally written for. The existing suite pinned only the branch side,
      which is exactly how this survived.
- [ ] Check first whether any current assertion pins these strings as substrings; changing
      them may redden rows that are asserting the old wording.
- [ ] Re-derive `EXPECTED_TOTAL` from a run rather than adding a delta.

## Implementation Notes

- The six clauses are in the resolved-path `case "$STATE"` block and the `else` branch after
  it, in `git-safety.sh`'s shared ref-processing section — search for `Fresh PR check`.
- `${SUBJ}` currently takes "this PR's state" / "this branch's merge state" and `${VERB}`
  takes "closing" / "deleting", which fit the SKIP_REASON sentences but not the OPEN and
  no-PR-found ones, whose grammar needs a bare noun.

## Risks

- These are user-facing advisory strings the reader is expected to act on; a careless
  rewrite that makes the branch direction vaguer to accommodate the PR direction is worse
  than the current state. Keep both directions specific.

## Updates

### 2026-09-15

- Filed from the first review of the shared-extractor port PR. Scoped out of it because the
  PR delivers the SKIP_REASON half with a two-sided assertion, while this needs a third
  variable and roughly eight new rows across two directions and four outcomes.
