# AI Drift Checklist

This file is the canonical saved follow-up list for recurring AI-workflow drift checks.

Keep row IDs stable so scheduled jobs can parse and update the file. Prefer updating `status`, `last_checked`, `next_check`, and `notes` over renaming or reordering rows.

Recommended status values:

- `pending`
- `ok`
- `drift-detected`
- `manual-review`

| id        | item                                 | interval  | status  | last_checked | next_check | canonical_files                                                    | automated_check                                                                                                                                                                                                                                 |
| --------- | ------------------------------------ | --------- | ------- | ------------ | ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRIFT-001 | Todo researcher pinned docs bindings | monthly   | pending | —            | —          | `.claude/agents/todo-researcher.md`                                | Verify the pinned tool names `fetch_webpage`, `github_text_search`, `github_repo`, and `mcp_github_search_code` still exist and that the researcher still uses them consistently. Flag stale tool names, changed assumptions, or missing tools. |
| DRIFT-002 | Todo executor PR tooling             | monthly   | pending | —            | —          | `.claude/agents/todo-executor.md`                                  | Verify the PR step still matches the available GitHub PR creation and PR lookup tooling. Flag stale tool names, changed required fields, or fallback logic that no longer matches the environment.                                              |
| DRIFT-003 | Inline codification targets          | monthly   | pending | —            | —          | `.claude/agents/todo-executor.md`, `.claude/skills/audit/SKILL.md` | Confirm codification still targets `docs/patterns/*.md`, `docs/LEARNINGS.md`, `.claude/agents/code-reviewer.md`, and specialist agents instead of retired indirection.                                                                          |
| DRIFT-004 | Retired-agent tombstones             | quarterly | pending | —            | —          | `.claude/agents/`, `docs/`                                         | Grep for retired agent names such as `pattern-codifier` and flag active-sounding references outside explicit deprecation notes or clearly historical docs.                                                                                      |
| DRIFT-005 | Review-routing guidance              | quarterly | pending | —            | —          | `docs/AI_WORKFLOW.md`, `CLAUDE.md`, `.claude/skills/`              | Diff review-policy docs for inconsistent tier names, escalation rules, or references to outdated review paths.                                                                                                                                  |
| DRIFT-006 | Repo memory maintenance rules        | quarterly | pending | —            | —          | `docs/AI_WORKFLOW.md`, `/memories/repo/ocrecipes-architecture.md`  | Check that repo-memory guidance is still short, factual, and aligned with the current architecture, CI strategy, and pattern index.                                                                                                             |
| DRIFT-007 | Historical design-doc drift          | quarterly | pending | —            | —          | `docs/superpowers/`                                                | Grep for stale MCP call names, retired agent names, and superseded workflow wording. Update misleading references or mark them clearly historical.                                                                                              |

For automation, prefer a lightweight report per row with:

- `id`
- `status`
- `checked_at`
- `triggering_files`
- `summary`

If a scheduled check edits this file automatically, append short notes rather than rewriting the meaning of an existing row.
