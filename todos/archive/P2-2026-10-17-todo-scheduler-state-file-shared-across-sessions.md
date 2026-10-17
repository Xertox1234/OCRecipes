---
title: "Two /todo orchestrators in parallel sessions overwrite each other's /tmp/todo-scheduler-state.json and Phase 0 lists"
status: done
priority: medium
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, harness, todo-skill]
github_issue:
---

# Two /todo orchestrators in parallel sessions overwrite each other's /tmp/todo-scheduler-state.json and Phase 0 lists

## Summary

`.claude/skills/todo/SKILL.md` keeps its cross-turn state in fixed paths under `/tmp` (`/tmp/todo-scheduler-state.json`, `/tmp/todo-open-prs.txt`, `/tmp/todo-all-prs.json`, the delete/closed/no-PR lists). Two `/todo` runs in different sessions share and clobber them. Seen on 2026-10-17: this session's state file (one result, queue empty) was replaced mid-run by another session's `{"running": [recipe-import…], "results": []}`; Phase 5 would have read the wrong results and its `rm -f` would have deleted the other session's live state.

## Background

Phase 4 says: "Persist it instead: write `/tmp/todo-scheduler-state.json` … re-read it at the start of each turn rather than trusting what you remember." That instruction is right for compaction but wrong for concurrency — the path has no session key, so the re-read returns whichever orchestrator wrote last. Phase 0 step 2 likewise `rm -f`s and rewrites the shared `/tmp/todo-*.txt` lists "so this step can trust it", which a concurrent run defeats the same way. The scratchpad already has the fix shape for executors (keyed by session uuid — see the auto-memory `reference_scratchpad_shared_across_parallel_executors`), and `/tmp/claude-worktree-contracts-<session-id>/` shows the convention for a per-session `/tmp` dir.

## Acceptance Criteria

- [x] Every `/tmp/todo-*` path the `/todo` skill writes is keyed by the session (e.g. `/tmp/todo-<CLAUDE_CODE_SESSION_ID>/…` or the session scratchpad directory), so two orchestrators never read or delete each other's files.
- [x] Phase 5's cleanup removes only this session's files.
- [x] `docs/todo-automation-runbook.md` and any other doc that names `/tmp/todo-scheduler-state.json` literally are updated to the new path form.
- [x] A short "two sessions at once" note in the skill explains that the Phase 0 worktree/branch sweep is still shared state by nature (git) and relies on `wt_in_use` + the fresh per-branch merge check — only the file-based bookkeeping moves.

## Implementation Notes

- Files: `.claude/skills/todo/SKILL.md` (Phase 0 step 2 rm/write block, Phase 2 step 3 open-PR reuse, Phase 4 "How dispatch actually resumes" + rolling loop, Phase 5 load/delete), `docs/todo-automation-runbook.md` (grep for `todo-scheduler-state`).
- `CLAUDE_CODE_SESSION_ID` is already used by Phase 5's `EXCLUDE_SESSION`; reuse it. Fall back to `$$`-free deterministic form only if it is unset (it is set in Claude Code sessions).
- The `/todo-fast` skill does not use these files: `grep -c "/tmp/todo-" .claude/skills/todo-fast/SKILL.md` → 0 on 2026-10-17 (its Step 6 followup loop keeps its own `current`/`queue` state). Re-run that grep before touching it.
- This is a skill-text change (no hooks), so the harness freeze on `.claude/hooks/**` does not apply; it still needs the usual `/todo` dry run to confirm the new paths are created and removed.

## Scope Contract

- **Mechanisms to use:** path substitution to a session-keyed directory — nothing new.
- **Files in scope:** `.claude/skills/todo/SKILL.md`, `docs/todo-automation-runbook.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A long run that compacts must still find its own file — the session id is stable across compaction, so a session-keyed path is safe; a per-turn random key would not be.

## Updates

### 2026-10-17

- Initial creation (deferred from the in-session run of `P3-2026-10-12-disable-mfa-concurrent-queries-on-one-transaction`, PR #1481, where the collision was observed).

### 2026-10-17 (executed)

- All `/tmp/todo-*` bookkeeping paths in `.claude/skills/todo/SKILL.md` now live in `$TODO_TMP=/tmp/todo-${CLAUDE_CODE_SESSION_ID}`; Phase 5 cleanup deletes only that dir's `.txt`/`.json` files. `docs/todo-automation-runbook.md` never named the path (nothing to change); two `docs/solutions/conventions/` files that did were updated.
