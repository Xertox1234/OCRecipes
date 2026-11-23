# GitHub MCP for audit + todo skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `audit` and `todo` skills use the GitHub MCP server (`mcp__github__*`) for pull-request operations, replacing leftover Copilot-CLI-era placeholder tooling and adding PR creation to the audit flow.

**Architecture:** Two independent edits to prompt/instruction documents. (1) `todo-executor.md` Step 10 swaps its abstract PR tooling for concrete `mcp__github__*` calls — a behavior-preserving drop-in. (2) `audit/SKILL.md` gains a new Phase 9 that pushes the audit branch and opens a PR via MCP, plus a worktree branch-naming fix so the branch is pushable.

**Tech Stack:** Markdown skill/agent files under `.claude/`; GitHub MCP tools (`mcp__github__create_pull_request`, `mcp__github__list_pull_requests`); git worktrees.

**Spec:** `docs/superpowers/specs/2026-05-21-github-mcp-audit-todo-skills-design.md`

---

## Important context for the implementer

- **These are prompt documents, not code.** There is no Vitest/pytest suite for them. Each task's "verify" step is a `grep` assertion: confirm the old text is gone and the new text is present. Do not invent unit tests.
- **The kimi-review pre-commit gate auto-skips** for these commits — it only runs when `.ts`/`.tsx` files are staged, and these are `.md`-only. Expect no review output at commit time.
- **Both target files are git-tracked**, so the commit steps below are real.
- **This plan file is local-only.** `docs/superpowers/` is gitignored (`.gitignore:94`); do not try to commit this plan or the spec.
- **`mcp__github__*` tools are deferred** — they must be loaded with `ToolSearch` before the first call, or they error with `InputValidationError`. The new instruction text says so; that is intentional, not redundant.
- **Owner casing:** the GitHub API canonicalizes the owner to `Xertox1234`; lowercase `xertox1234` also works as input. The executor's existing field list keeps `xertox1234` (works); the new audit text uses `Xertox1234`.

---

## Task 1: Migrate `todo-executor.md` PR tooling to GitHub MCP

**Files:**

- Modify: `.claude/agents/todo-executor.md` (Step 10, lines ~397-399 and ~427)

- [ ] **Step 1: Verify the current placeholder text exists**

Run:

```bash
grep -nE "activate_pull_request_management_tools|the PR creation tool exposed|the PR listing tool exposed" .claude/agents/todo-executor.md
```

Expected: three matches — lines ~398, ~399, and ~427.

- [ ] **Step 2: Replace the "Create the PR" tool-path lines**

Use the Edit tool. Find this exact block:

```
3. **Create the PR** using the current pull-request tool path for this environment:
   - First call `activate_pull_request_management_tools`
   - Then use the PR creation tool exposed by that category with these fields:
```

Replace it with:

```
3. **Create the PR.** The GitHub MCP tools are deferred — first load them with `ToolSearch` (query: `select:mcp__github__create_pull_request,mcp__github__list_pull_requests`), then call `mcp__github__create_pull_request` with these fields:
```

(The field list that follows — `owner: xertox1234`, `repo: OCRecipes`, `title`, `head`, `base`, `body` — stays exactly as-is.)

- [ ] **Step 3: Replace the PR-exists fallback line**

Use the Edit tool. Find this exact line:

```
4. **If PR creation fails** because a PR already exists for `todo/<todo-slug>`, use the PR listing tool exposed after `activate_pull_request_management_tools` to look up an existing open PR for `head: xertox1234:todo/<todo-slug>`. If a PR is found, use its URL as `PR_URL`. If no open PR is found or the lookup fails for any other reason (network error, auth error, missing tool, etc.): log `PR_URL: null`, do not retry, and continue to Step 11. The code is already committed and the PR can be opened manually.
```

Replace it with:

```
4. **If PR creation fails** because a PR already exists for `todo/<todo-slug>`, call `mcp__github__list_pull_requests` (`state: open`) and match the PR whose head branch is `todo/<todo-slug>`. If a PR is found, use its URL as `PR_URL`. If no open PR is found or the lookup fails for any other reason (network error, auth error, missing tool, etc.): log `PR_URL: null`, do not retry, and continue to Step 11. The code is already committed and the PR can be opened manually.
```

- [ ] **Step 4: Verify the swap (grep assertions)**

Run:

```bash
echo "old placeholders (expect 0):"; grep -cE "activate_pull_request_management_tools|the PR creation tool exposed|the PR listing tool exposed|current pull-request tool path" .claude/agents/todo-executor.md
echo "new MCP refs (expect >=1 each):"; grep -c "mcp__github__create_pull_request" .claude/agents/todo-executor.md; grep -c "mcp__github__list_pull_requests" .claude/agents/todo-executor.md
```

Expected: first count `0`; the two `mcp__github__*` counts each `>= 1`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "refactor(todo): use GitHub MCP tools for executor PR creation"
```

---

## Task 2: Add MCP-based PR creation to `audit/SKILL.md`

**Files:**

- Modify: `.claude/skills/audit/SKILL.md` (Phase 1 step 6 ~lines 59-67; Phase 7 step 3 ~line 237; insert new Phase 9 before `## Rules` ~line 291)

- [ ] **Step 1: Verify current anchors exist**

Run:

```bash
grep -nE "git worktree add .worktrees/audit|After the Phase 6 commit|Ask if the user wants to push|^## Rules" .claude/skills/audit/SKILL.md
```

Expected: matches for the worktree-add line (~61), the "After the Phase 6 commit" note (~63), "Ask if the user wants to push" (~237), and "## Rules" (~291).

- [ ] **Step 2: Name the audit branch at worktree creation**

Use the Edit tool. Find this exact line:

```
   git worktree add .worktrees/audit-$(date +%Y-%m-%d) HEAD
```

Replace it with:

```
   git worktree add -b "audit/$(date +%Y-%m-%d)-<scope>" .worktrees/audit-$(date +%Y-%m-%d) HEAD
```

(Replace `<scope>` with the audit scope slug, e.g. `security` or `full`. Creating the branch now — instead of a detached HEAD — makes it pushable in Phase 9.)

- [ ] **Step 3: Fix the worktree-removal timing note**

Use the Edit tool. Find this exact text:

```
   Or use `EnterWorktree` if available. All Phases 2–6 (Phase 2.5 included) run from this worktree. After the Phase 6 commit, remove it with:
```

Replace it with:

```
   Or use `EnterWorktree` if available. All phases run from this worktree. The worktree is removed at the end of Phase 9 (after the PR is opened, or after the final commit if no PR was opened) with:
```

- [ ] **Step 4: Remove the early "ask to push" line from Phase 7**

Use the Edit tool. Find this exact line:

```
3. Ask if the user wants to push
```

Replace it with:

```
Do not push or open a PR here — pushing and PR creation happen in Phase 9.
```

- [ ] **Step 5: Insert the new Phase 9 before `## Rules`**

Use the Edit tool. Find this exact text (start of the Rules section):

```
## Rules

- **The manifest is the source of truth.** Every finding must be in it. Every status change must be recorded.
```

Replace it with (new Phase 9, then the unchanged Rules header and first bullet):

````
## Phase 9: Push & Open PR

After the fix commit (Phase 7) and the codification commit (Phase 8) both exist on the audit branch:

1. **Ask the user:** "Push the audit branch and open a PR?" If no, leave the work local and skip to step 6 (worktree removal) — done.
2. **Push the branch:**
   ```bash
   git push -u origin audit/YYYY-MM-DD-<scope>
   ```
   (use the branch created in Phase 1 step 6 — substitute the real date and scope)
3. **Create the PR.** The GitHub MCP tools are deferred — first load them with `ToolSearch` (query: `select:mcp__github__create_pull_request,mcp__github__list_pull_requests`), then call `mcp__github__create_pull_request` with:
   - `owner`: `Xertox1234`
   - `repo`: `OCRecipes`
   - `base`: the branch captured in Phase 1 step 5 (usually `main`)
   - `head`: `audit/YYYY-MM-DD-<scope>`
   - `body`: the template below
4. **If PR creation fails** because a PR already exists for the branch, call `mcp__github__list_pull_requests` (`state: open`) and match the PR whose head branch is `audit/YYYY-MM-DD-<scope>`. If found, use its URL. If no open PR is found or the lookup fails for any other reason, report that no PR URL is available — the branch is pushed and the PR can be opened manually.
5. **Report the PR URL** in the final summary.
6. **Remove the audit worktree** (run from the main repo root, not inside the worktree):
   ```bash
   git worktree remove .worktrees/audit-YYYY-MM-DD
   ```

**Audit PR body template** (summary only — fill from the manifest):

```
## Summary
[scope] audit — N findings fixed, M deferred to todos.

## Fixed
- <one line per verified finding, from the manifest>

## Manifest
docs/audits/YYYY-MM-DD-<scope>.md

🤖 Generated by Claude Code /audit skill
```

## Rules

- **The manifest is the source of truth.** Every finding must be in it. Every status change must be recorded.
````

- [ ] **Step 6: Verify the edits (grep assertions)**

Run:

```bash
echo "Phase 9 present (expect 1):"; grep -c "^## Phase 9: Push & Open PR" .claude/skills/audit/SKILL.md
echo "named-branch worktree (expect 1):"; grep -c 'git worktree add -b "audit/' .claude/skills/audit/SKILL.md
echo "MCP create call (expect 1):"; grep -c "mcp__github__create_pull_request" .claude/skills/audit/SKILL.md
echo "old early-push line gone (expect 0):"; grep -c "^3. Ask if the user wants to push" .claude/skills/audit/SKILL.md
echo "old Phase-6 removal note gone (expect 0):"; grep -c "After the Phase 6 commit, remove it" .claude/skills/audit/SKILL.md
echo "Rules header intact (expect 1):"; grep -c "^## Rules" .claude/skills/audit/SKILL.md
```

Expected: Phase 9 `1`; named-branch `1`; MCP create `1`; old early-push `0`; old removal note `0`; Rules header `1`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat(audit): open a PR via GitHub MCP after fixes"
```

---

## Final verification

- [ ] **Confirm both files changed and committed**

Run:

```bash
git log --oneline -2
git status --short
```

Expected: the two commit subjects above appear in the log; `git status` shows no uncommitted changes to the two target files. (The local-only spec/plan under `docs/superpowers/` will not appear — it is gitignored.)
