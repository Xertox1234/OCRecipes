---
title: "Make /codify handle the post-merge case (empty main...HEAD after squash)"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, tooling, docs]
github_issue:
---

# /codify should handle a post-merge (empty main...HEAD) diff

## Summary

`.claude/skills/codify/SKILL.md` Step 1 assumes you are on a live feature branch
and runs `git diff main...HEAD`. When `/codify` is invoked **after** the branch
has been squash-merged and you've switched back to `main`, that diff is **empty**
— Step 1's "If the diff is empty … stop." rule then aborts the codify even though
there are real findings to capture from the just-merged work.

## Background

Hit during the email-verification codify run (2026-06-19, after PR #403 merged).
Worked around it manually by diffing the squash commit against its own parent:
`git diff d2f29da2^ d2f29da2`. The skill should do this automatically (or accept
an explicit commit/range) so the post-merge path is a first-class flow, not a
manual hack.

## Acceptance Criteria

- [ ] Step 1 detects an empty `git diff main...HEAD` and, before stopping, falls
      back to "the most recently merged change" — e.g. diff `HEAD^ HEAD` when
      `HEAD` is a merge/squash commit on the default branch, or prompt for a
      commit SHA / range.
- [ ] `/codify <sha>` (or `/codify --since <ref>`) lets the caller name the
      commit/range explicitly, overriding the `main...HEAD` default.
- [ ] The "Nothing to codify" early-exit only fires when BOTH the branch diff and
      the fallback are genuinely empty.
- [ ] The domain-label derivation (`path-domains.ts`) and the review-signal reuse
      note still work against whichever diff range is selected.

## Implementation Notes

- `.claude/skills/codify/SKILL.md` — Step 1 (and the Step 3 "confirm there is a
  diff" check). Both currently hardcode `main...HEAD`.
- Detection heuristic for "just merged": on the default branch with an empty
  `main...HEAD`, treat `HEAD` (the squash/merge commit) as the unit to codify →
  `git diff HEAD^ HEAD`. Guard against codifying an unrelated prior commit by
  confirming `HEAD` is recent / matches the session's merged PR when known.
- Consider whether sibling branch-diff skills (e.g. anything else keying off
  `main...HEAD`) share the assumption — out of scope here, but worth a note.

## Dependencies

- None.

## Risks

- Low — skill-prose/tooling change. A botched heuristic could codify the wrong
  commit, so the fallback should be explicit/confirmable, not silent.
