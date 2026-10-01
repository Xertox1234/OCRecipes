---
title: "docs/legacy-patterns/ still takes the auto-merge markdown exemption, while being the reference body the newly-protected reviewer checklists point at"
status: done
priority: low
created: 2026-09-16
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# docs/legacy-patterns/ is exempt while the files that cite it are protected

## Summary

PR #978 added `.claude/agents/`, `.claude/skills/`, `docs/AI_WORKFLOW.md` and `docs/PATTERNS.md` to
`STRUCTURAL_SENSITIVE`, on the rationale that the files defining what "reviewed" means must not
auto-merge unreviewed. `docs/legacy-patterns/` (16 tracked files) is the reference body those same
checklists point AT, and it still takes the markdown exemption.

## Background

Raised in the PR #978 security review and deliberately deferred rather than folded in, so the PR
stayed inside its Scope Contract.

The citing relationships are real, and stated so a reader can check them with the obvious command:
`grep -c 'docs/legacy-patterns' .claude/agents/code-reviewer.md` returns 7 and the same over
`mobile-reviewer.md` returns 11 (both counts include each file's closing reference list as well as
its inline checklist citations). The security-auditor reference list names
`docs/legacy-patterns/security.md` as the full security pattern documentation. The decision here
does not turn on the exact figure — only on the fact that the newly-held checklists point at this
body — so no narrower hand-filtered count is quoted.

**Why this is low and not high.** It is a frozen archive with no producer:
`.claude/agents/code-reviewer.md` explicitly forbids writing there ("frozen archives, retired as
write targets"), and no hook injects it — a grep over `.claude/hooks/` finds it only in a test
corpus and one comment. So there is no current path by which a change lands there at all, let
alone one that auto-merges. The exposure is latent: it becomes real the moment the archive is
unfrozen or something starts writing to it.

## Acceptance Criteria

- [ ] A deliberate decision is recorded either way, in the `STRUCTURAL_SENSITIVE` comment block
      next to the boundary note PR #978 already added for `.claude/hooks/**`. Leaving it unstated
      is the one outcome this todo exists to prevent — an unexplained asymmetry reads as an
      oversight to the next reader.
- [ ] If covered: `(^|/)docs/legacy-patterns/` is added to BOTH `SENSITIVE_OVERRIDE` and
      `STRUCTURAL_SENSITIVE`, and the drift guard's whole-directory mirror assertion still passes.
- [ ] Either way, measure the effect over the tracked corpus with `git ls-files` and quote the
      count with its denominator — expected 16 PASS→HOLD, 0 HOLD→PASS, but re-derive rather than
      trusting that figure.
- [ ] A must-still-PASS control is included in the same run, so the change is shown to be
      one-directional.

## Implementation Notes

- The whole change is one alternative in each of two constants; PR #978's
  `docs/AI_WORKFLOW`/`docs/PATTERNS` entries are the worked example, including the trailing-`/`
  form that survives a split-into-a-directory refactor.
- Over-HOLD is the cheap direction here per the script's own header, which argues for covering it
  unless there is a reason not to.

## Scope Contract

- **Mechanisms to use:** the existing `SENSITIVE_OVERRIDE` / `STRUCTURAL_SENSITIVE` constants. No
  new gate, no new file, no new classification concept.
- **Files in scope:** `scripts/todo-automerge-guard.sh`,
  `scripts/__tests__/todo-automerge-guard.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Sequenced after PR #978 merges (it introduces `STRUCTURAL_SENSITIVE` and the boundary comment
  this todo extends). Not blocking otherwise.

## Risks

- Widening a denylist that also feeds the skip-gate consumer in `.claude/agents/todo-executor.md`;
  check both consumers, not just the PATH GATE.

## Updates

### 2026-09-16

- Filed from the PR #978 security review, at the user's direction, rather than folded into that PR.
