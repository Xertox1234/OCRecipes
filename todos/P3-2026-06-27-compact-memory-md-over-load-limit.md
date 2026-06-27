<!-- Filename: P3-2026-06-27-compact-memory-md-over-load-limit.md -->

---

title: "Compact MEMORY.md — it exceeds the session load limit (tail silently dropped)"
status: backlog
priority: low
created: 2026-06-27
updated: 2026-06-27
assignee:
labels: [deferred, tooling, memory]
github_issue:

---

# Compact MEMORY.md — it exceeds the session load limit (tail silently dropped)

## Summary

The auto-memory index `MEMORY.md` is ~24.8 KB, over its ~24.4 KB read limit, so the
**bottom of the index is silently dropped** when it loads at session start — meaning the
last-listed memories aren't recalled. Compact it to **under ~17 KB** (the post-edit hook's
target) so the whole index loads.

## Background

The memory hook now warns on every `MEMORY.md` edit:

> "The memory index at MEMORY.md is 24.8KB, over the 24.4KB read limit — content beyond
> that is dropped when this index is loaded. Compact it to under 17.1KB now: keep one line
> per entry, move detail into topic files, and merge or drop stale entries."

This predates the 2026-06-27 mutation-scope-expansion session (that session only nudged it
slightly via a 7→8 required-checks edit). The bloat is from index lines that grew past one
line / accumulated detail that belongs in topic files, plus stale entries.

It's a judgment-heavy task (dropping the wrong entry loses real context), so it was
deliberately NOT auto-done — it needs a deliberate pass with the operator able to veto
specific cuts.

## Acceptance Criteria

- [ ] `MEMORY.md` is under ~17 KB and loads in full (no tail-drop warning on next edit).
- [ ] Every retained entry is **one line** (`- [Title](file.md) — hook`, under ~200 chars).
- [ ] Detail that grew into the index is pushed down into the corresponding topic file.
- [ ] Stale/superseded entries are merged or dropped (e.g. consolidate the several
      worktree/parallel-session/git-protection notes that now overlap).
- [ ] No memory's _substance_ is lost — only the index line is trimmed; topic files keep
      the detail.

## Implementation Notes

- The file is the **global** auto-memory index, NOT in this repo:
  `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/MEMORY.md`.
  Topic files live alongside it in that `memory/` dir.
- Approach: scan for index lines longer than ~200 chars; move their overflow into the
  topic file body; look for clusters of related entries (git/branch-protection, worktree
  isolation, /todo orchestration gotchas) that can be merged into a single pointer.
- Candidate consolidations spotted 2026-06-27: the branch-protection note
  (`feedback_auto_merge_bypasses_ci.md`) is very long; the worktree/parallel-session
  cluster (`project_worktree_provisioning`, `feedback_verify_branch_before_commit`,
  `feedback_manual_worktree_remove_leaves_core_bare`, plus the new
  `isolate-into-worktree-when-concurrent-session-guard-warns` solution doc) overlaps.
- Show the operator the proposed merges/drops before saving — don't prune silently.

## Dependencies

- None (standalone memory-hygiene task).

## Risks

- **NOT /todo-automatable** — the target file is outside the repo, so the /todo executor
  (which works on committed repo files in a worktree) can't action it. This is a manual
  fresh-session task. Treat this todo as a reminder, not an auto-merge candidate.
- Dropping an entry whose detail wasn't mirrored into a topic file would lose context —
  verify each cut moves detail down rather than deleting it.

## Updates

### 2026-06-27

- Initial creation. Surfaced by the memory-load-limit hook during the mutation-scope-expansion session.
