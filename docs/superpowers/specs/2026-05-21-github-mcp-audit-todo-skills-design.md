# Design: GitHub MCP for the audit + todo skills

**Date:** 2026-05-21
**Status:** Approved (design); ready for implementation plan
**Author:** Claude Code (brainstorming session with William)

## Goal

Make the `audit` and `todo` skills use the GitHub MCP server (`mcp__github__*`)
for pull-request operations, replacing leftover Copilot-CLI-era placeholder
tooling and finishing the migration mandated by `CLAUDE.md`:

> Prefer the GitHub MCP tools (`mcp__github__*`) over raw `gh` via Bash for
> PR/issue/review/status operations.

## Current state

- **`todo-executor.md`** (the agent the `/todo` skill dispatches) creates PRs
  using Copilot-era abstractions — `activate_pull_request_management_tools` and
  "the PR creation tool exposed by that category." These are not the concrete
  tools this environment exposes.
- **`todo` skill (`SKILL.md`) Phase 0** uses a debugged bash pipeline
  (`gh pr list … | comm | xargs git push --delete`) to find and delete stale
  remote branches.
- **`audit` skill** has no PR creation at all. Phase 7 commits locally and asks
  "want to push?"; it never opens a PR.

## Decisions (from brainstorming Q&A)

1. **Audit gains real PR creation via MCP** (not migration-only).
2. **Audit PR body = summary only** — counts + list of fixed findings + a link
   to the manifest. No "deferred items" section (the manifest is committed in the
   same PR anyway).
3. **Todo Phase 0 stays bash** — the deletion step must be raw git regardless
   (no `mcp__github__delete_branch` exists), and the pipeline is already debugged
   and degrades gracefully when `gh` is unavailable. CLAUDE.md's gh-exception for
   branch ops covers this.
4. **Audit PR is gated behind user confirmation** — preserves the skill's
   existing "ask before push" behavior; PR creation is a shared-state action.
5. **Audit branch is named at worktree-creation time** (via `-b`), not at push
   time.

## Verified facts

- **Subagents can use deferred MCP tools.** A `general-purpose` subagent
  successfully ran the full flow: `ToolSearch` (`select:mcp__github__…`) surfaced
  the schemas, then an authenticated `mcp__github__list_pull_requests` call
  succeeded (it listed open PR #240). This is load-bearing: the `todo-executor`
  runs as a spawned subagent and must be able to create PRs.
- **Owner casing:** the API canonicalizes the owner to `Xertox1234`; lowercase
  `xertox1234` works as input.
- **No `mcp__github__delete_branch` tool exists** — branch deletion stays git.

## Files in scope

1. `.claude/skills/audit/SKILL.md` — add MCP-based PR creation.
2. `.claude/agents/todo-executor.md` — replace placeholder PR tooling with
   `mcp__github__*`.

### Explicitly out of scope

- `.claude/skills/todo/SKILL.md` — unchanged. Phase 0 stays bash (decision 3),
  and the todo skill's only other GitHub touchpoint (PR creation) lives in the
  executor agent. So no edits to `SKILL.md` itself.
- `.claude/worktrees/kimi-verification-layer/…` — a stale duplicate on another
  branch carrying the same outdated text. Reconciles when that branch merges.
- CI failed-log inspection — stays on `gh` / `npm run ci:failed-logs` (MCP
  doesn't cover it; matches CLAUDE.md).
- The Copilot-issue guard at the top of executor Step 10 — left as-is.

## Shared convention: deferred-tool loading

`mcp__github__*` tools are deferred; calling one without loading it first fails
with `InputValidationError`. Both edited files get a one-line directive before
any MCP call:

> Load first via `ToolSearch` (`select:mcp__github__create_pull_request,mcp__github__list_pull_requests`),
> then call the tool.

## Change 1 — `todo-executor.md` Step 10 (drop-in, behavior unchanged)

- **Create PR:** replace `activate_pull_request_management_tools` + "the PR
  creation tool exposed by that category" with: ToolSearch-load, then
  `mcp__github__create_pull_request` with:
  - `owner`: `Xertox1234`
  - `repo`: `OCRecipes`
  - `title`: `<todo title from frontmatter>`
  - `head`: `todo/<todo-slug>`
  - `base`: `<base branch from spawn prompt>`
  - `body`: the existing PR body template (unchanged)
- **PR-exists fallback:** replace "the PR listing tool exposed after
  `activate_pull_request_management_tools`" with `mcp__github__list_pull_requests`
  (`state: open`); match the PR whose head ref is `todo/<todo-slug>`, reuse its
  URL. If none found or the lookup fails for any reason → `PR_URL: null`, no
  retry, continue to Step 11.
- **Unchanged contract:** low-priority still skips the PR (`skipped-low-priority`);
  any failure still → `PR_URL: null`. The orchestrator's `PR_URL` handling needs
  no edits.

## Change 2 — `audit/SKILL.md` gains a PR

- **Phase 1 step 6 (worktree):** create the worktree on a named branch —
  `git worktree add -b audit/YYYY-MM-DD-<scope> .worktrees/audit-YYYY-MM-DD HEAD`
  — instead of detached HEAD. Also fix the pre-existing wrong note that says
  "remove the worktree after the Phase 6 commit" (commits are Phase 7/8) →
  remove after the new Phase 9.
- **Phase 7 (Commit Fixes):** commit fixes; remove the "Ask if the user wants to
  push" line (moves to Phase 9 so the PR captures both the fix and codify
  commits).
- **Phase 8 (Codify):** unchanged — separate `docs:` commit.
- **NEW Phase 9 — Push & open PR:**
  1. Ask the user: "Push the audit branch and open a PR?" No → leave local, done.
  2. Yes → `git push -u origin audit/YYYY-MM-DD-<scope>`.
  3. ToolSearch-load, then `mcp__github__create_pull_request`:
     - `owner`: `Xertox1234`
     - `repo`: `OCRecipes`
     - `base`: branch captured in Phase 1 step 5 (usually `main`)
     - `head`: `audit/YYYY-MM-DD-<scope>`
     - `body`: summary-only template (below)
  4. Same PR-exists fallback as the executor (`mcp__github__list_pull_requests`,
     match head ref, reuse URL; else report no PR URL).
  5. Report the PR URL in the final summary.

### Audit PR body (summary-only)

```
## Summary
[scope] audit — N findings fixed, M deferred to todos.

## Fixed
- <one line per verified finding, from the manifest>

## Manifest
docs/audits/YYYY-MM-DD-<scope>.md

🤖 Generated by Claude Code /audit skill
```

## Risks / notes

- If the user declines the PR in Phase 9, the named `audit/…` branch remains
  locally after the worktree is removed (branches are repo-global). Minor
  leftover; acceptable.
- The audit PR confirmation gate is interactive — fine for `/audit` (a
  human-driven workflow). The executor's PR creation stays autonomous — fine for
  `/todo` (a batch workflow the user already authorized).

## This spec is local-only

`docs/superpowers/` is gitignored (`.gitignore:94`) by project policy, so this
file is not committed to GitHub. It persists locally for reference.
