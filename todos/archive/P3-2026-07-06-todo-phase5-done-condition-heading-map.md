<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Tighten /goal DONE-condition mapping to Phase 5's exact listing headings"
status: done
priority: low
created: 2026-07-06
updated: 2026-07-06
assignee:
labels: [deferred, todo-skill]
github_issue:

---

# Tighten /goal DONE-condition mapping to Phase 5's exact listing headings

## Summary

The `/goal` completion-condition paste block in `docs/todo-automation-runbook.md` enumerates
terminal states by prose ("open PR, auto-merging on green CI, gated on a dependency,
dependency not yet implemented, stale branch, Skipped — quality flags") rather than matching
the exact Phase 5 listing headings in `.claude/skills/todo/SKILL.md`. There's no explicit
phrase for the "Needs individual review" group (held/unknown/review-required PRs) — it's
presumably absorbed into the generic "open PR" catch-all.

## Background

Surfaced during code review of PR #525 (restore-guard-eligible-automerge). That PR added a
7th distinct Phase 5 listing heading ("Auto-merging on green CI") without tightening this
mapping. Not a functional bug today — the DONE condition still resolves — but the looseness
means a future edit to Phase 5's headings could silently drop a group from the "every listing
group is a terminal state" guarantee without the `/goal` paste block's enumeration catching it.

## Acceptance Criteria

- [x] The `/goal` paste block's DONE-condition enumeration in `docs/todo-automation-runbook.md`
      lists each Phase 5 listing heading from `.claude/skills/todo/SKILL.md` by exact name (or
      a 1:1 documented mapping), including "Needs individual review"
- [x] A comment or cross-reference ties the two lists together so a future heading rename in
      one file prompts an update in the other

## Implementation Notes

Relevant files: `docs/todo-automation-runbook.md` (the `/goal` paste block, ~lines 99-138) and
`.claude/skills/todo/SKILL.md` Phase 5 (the listing headings under "report auto-merge status",
"list todos awaiting merge and gated dependents", "surface actionable blocks").

## Dependencies

- None

## Risks

- Low — documentation/prompt-clarity only, no behavior change

## Updates

### 2026-07-06

- Initial creation, filed from PR #525 code review (SUGGESTION-level finding)
- Implemented: rewrote the `/goal` paste block's terminal-state enumeration in
  `docs/todo-automation-runbook.md` to list each Phase 5 listing heading from
  `.claude/skills/todo/SKILL.md` by exact name (including the previously-missing "Needs
  individual review"), and added a reciprocal cross-reference between the runbook's
  enumeration and SKILL.md's Phase 5 step 4 Producer contract paragraph so a future
  heading rename in either file prompts an update in the other. code-reviewer pass: no
  CRITICAL/WARNING findings; two SUGGESTIONs applied inline (exact-quote fix in SKILL.md,
  this Updates entry).
