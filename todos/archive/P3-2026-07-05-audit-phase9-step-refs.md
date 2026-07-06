<!-- Filename: P3-2026-07-05-audit-phase9-step-refs.md -->

---

title: "Fix stale Phase-1 step references in /audit skill Phase 9"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, harness]
github_issue:

---

# Fix stale Phase-1 step references in /audit skill Phase 9

## Summary

`.claude/skills/audit/SKILL.md` Phase 9 cites the wrong Phase-1 step numbers for the
branch name and the PR base branch. An orchestrator that follows the pointers literally
looks at the wrong Phase-1 step.

## Background

Surfaced by the code review of PR #510 (skill dedup) as a **pre-existing** coherence bug
in a section that PR did **not** touch — deferred to keep #510 surgical. Phase 1's actual
step order is: step 1 captures `BASE_BRANCH`, step 2 captures `MAIN_CHECKOUT`, step 3 creates
the worktree branch (`git worktree add -b`), step 4 records the baseline, step 5 checks the
CHANGELOG, step 6 creates the manifest.

## Acceptance Criteria

- [ ] Phase 9 step 2 ("use the branch created in Phase 1 **step 6**") → correct to **step 3**
      (the worktree branch is created there, not by the manifest step).
- [ ] Phase 9 step 3 (`base`: "the branch captured in Phase 1 **step 5**") → correct to
      **step 1** (`BASE_BRANCH` is captured there, not by the CHANGELOG-check step).
- [ ] Re-scan Phase 9 (and any other phase) for further stale "Phase 1 step N" citations
      after the correction.

## Implementation Notes

- Single file: `.claude/skills/audit/SKILL.md`, Phase 9 ("Push & Open PR"), steps 2–3.
- Pure documentation fix — no code, no tests. Verify by reading Phase 1's step list and
  confirming each Phase 9 citation points at the step that actually performs the named action.

## Dependencies

- None. (Independent of PR #510; can be done any time.)

## Risks

- Trivial. Only risk is citing yet another wrong step number — mitigated by the re-scan AC.

## Updates

### 2026-07-05

- Filed from PR #510 review (out-of-scope pre-existing finding).
