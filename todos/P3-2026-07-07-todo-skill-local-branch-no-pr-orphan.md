<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "todo skill: surface local todo/\* branches that were renamed but never got a PR"
status: backlog
priority: low
created: 2026-07-07
updated: 2026-07-07
assignee:
labels: [deferred, tooling]
github_issue:

---

# todo skill: surface local todo/\* branches that were renamed but never got a PR

## Summary

`.claude/skills/todo/SKILL.md`'s Phase 0 local branch sweep (added in PR #547) correctly
never deletes a local `todo/<slug>` branch that has no PR in any state — but it also never
surfaces one anywhere, so it's a permanent, invisible local orphan.

## Background

Found during code review of PR #547 (local `todo/*` branch cleanup). A todo-executor renames
its worktree branch to `todo/<slug>` at Step 10, then pushes and opens a PR. If the process
crashes or the push/`gh pr create` fails _after_ the rename but _before_ a PR exists, the
resulting local branch has no PR record at all. The Phase 0 sweep's `merged_only()` join
(against merged/open/closed PR lists) correctly excludes it from deletion — good, it might be
genuine in-flight work — but nothing lists it either, unlike the analogous closed-unmerged
case (which the same PR wired into Phase 5's "Blocked — needs a one-time manual fix" section).

The executor's own Step 10 collision-triage (`.claude/agents/todo-executor.md`) only fires
when a _push_ is rejected as non-fast-forward — it never runs at all if the branch was simply
never pushed, so it can't backstop this case either.

**Why:** rated low severity and deferred (not fixed inline) because it's narrow (a crash in the
specific window between rename and successful PR creation) and non-destructive (the branch and
its commits are never touched, just invisible) — confirmed via `advisor()` review during the
PR #547 review-fix cycle, which recommended de-scoping it to a follow-up rather than building
detection under review pressure.

## Acceptance Criteria

- [ ] Phase 0 step 2 computes local `todo/*` branches with NO PR in any state (present in
      `/tmp/todo-local-branches.txt` but absent from merged/open/closed PR lists) into a new
      `/tmp/todo-local-no-pr-branches.txt`
- [ ] Never auto-delete or auto-push these branches — only detect and surface
- [ ] Phase 5's "Blocked — needs a one-time manual fix" section prints this list, mirroring how
      it already surfaces local/remote closed-unmerged branches
- [ ] Phase 0 step 3's Report instruction mentions carrying this list to Phase 5
- [ ] Verified with a live fixture: a local `todo/<slug>` branch with genuinely zero PR record
      survives the sweep and is surfaced in a dry run of the Phase 5 reporting logic

## Implementation Notes

`.claude/skills/todo/SKILL.md` — Phase 0 step 2 (~local branch cleanup block) and Phase 5's
"surface actionable blocks" section (~"Then **surface actionable blocks.**"). Reuse the
existing `merged_only()` shared function pattern already introduced for the remote/local
merged-branch join; the no-PR set is `/tmp/todo-local-branches.txt` minus the union of
merged/open/closed PR name lists — build via a real `/tmp` file (not process substitution,
per this file's established `comm`-with-real-files idiom, since `comm` needs sorted file
arguments and portability across the environments this skill runs in is unverified).

## Dependencies

- None — builds on PR #547's local sweep, already merged.

## Risks

- Low — detection-only, no deletion logic changes.

## Updates

### 2026-07-07

- Filed during PR #547's code-review fix cycle; de-scoped from that PR per advisor review.
