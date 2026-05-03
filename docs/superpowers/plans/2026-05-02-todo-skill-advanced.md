# Advanced /todo Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `/todo` skill with a live research subagent (Context7 + GitHub MCP), per-todo GitHub PRs from worktree branches, and uniform worktree isolation for all todos including sequential ones.

**Architecture:** Five tasks across three files. Tasks 1–3 touch different files and can run in parallel. Tasks 4–5 both touch `SKILL.md` and must run sequentially.

**Spec:** `docs/superpowers/specs/2026-05-02-todo-skill-advanced-design.md`

---

## File Structure

| File                                | Action | Responsibility                                                                         |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `.claude/agents/todo-researcher.md` | Create | Research subagent: Context7 + GitHub MCP, two-turn parallel strategy, ≤300-word brief  |
| `.claude/agents/todo-executor.md`   | Modify | Step 3 spawns researcher; Step 6 Agent() template; Step 10 PR creation; Step 11 Report |
| `.claude/skills/todo/SKILL.md`      | Modify | BASE_BRANCH capture; sequential worktrees; no merge-back; PR summary table             |

---

### Task 1: Create `.claude/agents/todo-researcher.md`

**Files:**

- Create: `.claude/agents/todo-researcher.md`

- [ ] **Step 1: Write the agent file**

Create `.claude/agents/todo-researcher.md`. The agent receives two inputs via spawn prompt: `Todo file` (path) and `Affected files` (comma-separated list).

Sections required:

- **Inputs**: two-input model (todo file path + affected files); remaining fields read from todo file
- **Step 1**: path→library detection table (`client/` → React Native/Expo, `client/navigation/` → React Navigation, `client/hooks/` → TanStack Query, `client/components/` → React Native/Reanimated, `server/` → Express.js, `server/storage/` → Drizzle ORM, `server/services/` → OpenAI API, `shared/` → Zod/TypeScript, `*.test.*`/`__tests__/` → Vitest). A single file can match multiple rows. Guards: empty Affected files → skip 2a, proceed to 2b/2c; non-empty but no matches → skip 2a, write "No library lookup performed — no affected file paths matched the library table."
- **Step 2**: Two-turn parallel strategy. Turn 1: all `resolve-library-id` calls + 2b + 2c simultaneously. Turn 2: each `query-docs` fires as its ID arrives. Subsections 2a (Context7), 2b (repo GitHub search — issues + PRs, 5 results each), 2c (global GitHub search, 5 results, no `site:github.com`).
- **Step 3**: Return brief with exact structure (no code fence): `## Library Notes`, `## Project Context`, `## Global Patterns`. Always include all three headers even with placeholder text.
- **Guidelines**: always include three headers; concise; no speculation; no new dependencies.

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/todo-researcher.md
git commit -m "feat: add todo-researcher subagent for live library and GitHub research"
```

---

### Task 2: Update executor Step 3 and Step 6 (`.claude/agents/todo-executor.md`)

**Files:**

- Modify: `.claude/agents/todo-executor.md`

- [ ] **Step 1: Replace Step 3 with researcher spawn**

Replace the existing Step 3 (static label→doc mapping) with a researcher spawn:

```
Agent({
  description: "Research: <todo title>",
  subagent_type: "general-purpose",
  prompt: "You are a todo researcher. Follow .claude/agents/todo-researcher.md exactly.\n\nTodo file: todos/<filename>.md\nAffected files: <comma-separated list>\n\nReturn a research brief."
})
```

Fallback trigger: Agent() throws, or returned text contains none of the section headers (`## Library Notes`, `## Project Context`, `## Global Patterns`). On fallback: log "researcher unavailable" and read label-mapped pattern docs. CLAUDE.md only if researcher failed AND no label matches. Always also grep LEARNINGS.md, grep archive/, read source files.

- [ ] **Step 2: Replace Step 6 with Agent() template**

Replace the bare `git diff` block with a full Agent() call:

```
Agent({
  description: "Code review: <todo title>",
  subagent_type: "superpowers:code-reviewer",
  prompt: "You are reviewing uncommitted changes in a git worktree for the OCRecipes project. Follow .claude/agents/code-reviewer.md exactly.\n\nRun `git diff` to see the changes. Return a structured report with Critical, High, Medium, and Low findings."
})
```

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "feat: update executor Step 3 to spawn todo-researcher; add Step 6 Agent() template"
```

---

### Task 3: Add executor Step 10 (PR creation) and rename Report to Step 11 (`.claude/agents/todo-executor.md`)

**Files:**

- Modify: `.claude/agents/todo-executor.md`

- [ ] **Step 1: Add Step 10 — Create PR**

Insert new Step 10 between Codify (Step 9) and Report (Step 11). Step 10:

1. Determine slug: strip `.md` from todo filename
2. `git branch -m todo/<slug>` — if fails (local branch exists): `git branch -D todo/<slug>` + retry
3. `git push -u origin todo/<slug>` — if rejected: `git push --force-with-lease -u origin todo/<slug>` (slug is deterministic → remote branch is always from prior failed run)
4. `mcp__github__create_pull_request` with owner/repo/title/head/base/body
5. If create fails (PR exists): `mcp__github__list_pull_requests` with `head: xertox1234:todo/<slug>`, `state: open` to recover URL. If still fails: `PR_URL: null`, continue to Step 11.

PR body template: `## Summary`, `## Changes`, `## Resolves`, `## Test plan`, attribution line.

- [ ] **Step 2: Rename Report to Step 11**

Rename `## Step 10 — Report` to `## Step 11 — Report`. Add `PR_URL: <GitHub PR URL, or "null" if PR creation failed>` to the success output block. Update `REVIEW_ROUNDS` to `<0 if LGTM first pass; 1 if one fix cycle; 2 if two fix cycles>`. Update Failure Path "see Step 10" reference to "see Step 11". Add researcher to Key Files list.

- [ ] **Step 3: Update Failure Path note**

Replace "The orchestrator must ensure a clean working tree" with "This agent always runs in an isolated git worktree — the working tree starts clean. Revert operations only affect this worktree and cannot touch the base branch."

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "feat: add PR creation step to executor and shift Report to Step 11"
```

---

### Task 4: Update SKILL.md Phase 1 and Phase 4 spawn prompts

**Files:**

- Modify: `.claude/skills/todo/SKILL.md`

- [ ] **Step 1: Add BASE_BRANCH capture to Phase 1**

After step 2 (record baseline), insert step 3:

```bash
git branch --show-current
# If empty (detached HEAD), fallback:
git rev-parse --abbrev-ref HEAD
# If that returns HEAD: stop with error, do not proceed to Phase 2
```

Store as `BASE_BRANCH`. Pass to every executor spawn via `Base branch:` line. Renumber existing step 3 to step 4.

- [ ] **Step 2: Update parallel batch spawn prompt**

Add `isolation: "worktree"` (already present) substitution warning: "Never pass the literal text `<BASE_BRANCH>`." Update prompt to include `Base branch: <BASE_BRANCH>` and "Execute all 11 steps".

- [ ] **Step 3: Update sequential batch spawn prompt**

Add `isolation: "worktree"` to sequential Agent() call. Add substitution warning. Add `Base branch: <BASE_BRANCH>`. Update to "Execute all 11 steps". Move "Run one at a time. Wait for each to complete before starting the next." to BEFORE the Agent() block.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/todo/SKILL.md
git commit -m "feat: capture BASE_BRANCH in Phase 1 and add worktree isolation to sequential todos"
```

---

### Task 5: Update SKILL.md After Each Batch and Phase 5 summary

**Files:**

- Modify: `.claude/skills/todo/SKILL.md`

- [ ] **Step 1: Remove merge-back from After Each Batch**

Replace the merge-back logic (items 3 and 4 of After Each Batch) with:

- Item 2: Record PR URLs and commit hashes (executor reports `PR_URL` and `COMMIT`)
- Item 3: `npm run check:types` on base branch only. If fails: halt. If passes: proceed to next batch.

- [ ] **Step 2: Update Phase 5 summary table**

Change `Commit` column to `PR` column. Add a 5th example row showing `PR_URL: null` case ("pending manual creation").

Update tallies: `Completed: N (list PR URLs; note "PR pending manual creation" for any where PR_URL is null)`.

- [ ] **Step 3: Update Rules section**

Replace "Verify after merging parallel work" with "Verify after each batch. Run `npm run check:types` on the base branch before starting the next batch. The full test suite runs only in Phase 5 — never run `npm run test:run` between batches. This is an accepted tradeoff: type-check only between batches trades speed for test-failure latency."

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/todo/SKILL.md
git commit -m "feat: remove merge-back from orchestrator; collect PR URLs; update session summary"
```
