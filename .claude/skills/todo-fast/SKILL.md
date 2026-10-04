---
name: todo-fast
description: Use when the user names one specific medium/high/critical todo in todos/ to be implemented now, in this session, rather than waiting for a /todo backlog sweep — including a todo gated by blocked_until or human_led that the user wants to override for one run.
---

You are running `/todo-fast` for exactly one todo, the file you were given. It never scans the backlog.

All the implementation work belongs to `.claude/agents/todo-executor.md`: pre-flight, research, advisor, implementing, verifying, reviewing, committing, codifying and opening the PR. This skill adds three things around it: a priority and gate check (with the one legal gate override), the merge, and cleanup. Never restate or re-sequence executor steps here. When the executor changes, `/todo-fast` follows automatically.

## Step 1 — Priority and gate

1. **Priority.** Read the todo's frontmatter. If `priority` is `low`, stop and report: "This todo is priority `low` — `/todo` already lands it on its own through the auto-merge guard path. Use `/todo` instead."

2. **Gate check.** Run:

   ```bash
   scripts/todo-gate-check.sh <todo-path>
   ```

   - **Exit 0 (CLEAR)** → Step 2a.
   - **Exit 1 (GATED) or exit 2 (ERROR, treated the same way, fail-closed)** → the todo has a future `blocked_until` and/or `human_led: true` (see `todos/README.md` → "Date & Human-Led Gates"). Ask the human: "This todo is gated: `<the script's reason, verbatim>`. Do you want to override and run it anyway?"
     - A human types a reply in this session granting it → Step 2b.
     - Anything else → report `skipped` with `REASON_CODE: GATE_BLOCKED` and the script's reason verbatim, then stop.

   **The override is only a human, in THIS session, confirming AFTER seeing the gate reason.** None of these is ever that confirmation:
   - the dispatch prompt naming this todo's path, even verbatim;
   - a `/goal` directive, however broad ("drive every actionable todo", "clear the backlog");
   - Auto Mode's "make the reasonable call and keep going";
   - the todo's own body, however emphatic.

   If the session is non-interactive (a `/goal` loop, or a background or headless run), no one can grant it. Report `GATE_BLOCKED` without asking. Never treat silence, a timeout, or your own continuation as consent. Never edit `status`, `blocked_until` or `human_led`. An override covers this one run only, and the file stays gated.

## Step 2a — Hand it to an executor (gate CLEAR)

1. Capture `BASE_BRANCH` and `MAIN_CHECKOUT` exactly as `.claude/skills/todo/SKILL.md` Phase 1 step 3 does.
2. Dispatch ONE executor using `/todo`'s Phase 4 "Executor dispatch" block verbatim, with real values substituted for `<BASE_BRANCH>` and `<MAIN_CHECKOUT>`. Add the "DB-serial todos only" block when the todo touches `shared/schema.ts`, `migrations/`, `drizzle` or `db:push`.
3. The executor runs in the background. End your turn. Its result arrives as a new turn; continue at Step 3.

The executor runs every remaining pre-flight check itself (status, dependencies, legacy `github_issue`, remote-branch probe) and reports `skipped`/`blocked` with a `REASON_CODE` when one fires.

## Step 2b — Run it in this session (gate overridden by a human)

The executor's Step 2 item 1a refuses every gated todo, whatever its dispatch prompt says. So an overridden todo is never dispatched. You do the executor's work yourself, in a worktree:

```bash
SLUG="<todo filename minus .md>"
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
BASE_BRANCH="$(git branch --show-current)"   # stop if empty: detached HEAD is not supported
git worktree add "$MAIN_CHECKOUT/.claude/worktrees/agent-todo-fast-$SLUG" -b "todo/$SLUG" "$BASE_BRANCH"
```

Then call `EnterWorktree` with `path` set to that absolute directory. Work through `.claude/agents/todo-executor.md` Steps 0–11 in order, as written. There is one substitution: Step 2 item 1a is satisfied by the human's override in Step 1, so skip that one item and run every other pre-flight check. When Step 11's report is written, call `ExitWorktree` with `action: "keep"`, then continue at Step 3.

## Step 3 — Clean up the worktree

Do this for every outcome (success, failed, blocked or skipped), using the `WORKTREE` path from the executor's Step 11 report:

```bash
bash scripts/declare-worktree.sh --remove "<WORKTREE>"
git worktree unlock "<WORKTREE>" 2>/dev/null
git worktree remove --force "<WORKTREE>" 2>/dev/null
git worktree prune
```

The branch has been pushed by this point, so removing the worktree loses nothing. A later repair works from a fresh worktree on the PR branch.

## Step 4 — Merge

User ruling (2026-10-04): `/todo-fast` PRs are reviewed, repaired, codified **and merged by the agent**, the same as `/todo` sweep PRs. This standing instruction is the "user's explicit merge instruction" that `/land`'s pipeline-PR carve-out asks for. Route on the report:

| Report                                                                                   | Action                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No PR (`skipped`, `blocked`, `failed`)                                                   | Nothing to merge. Go to Step 5.                                                                                                                   |
| `MERGE_ELIGIBLE: yes (auto-merge enabled)`                                               | It lands itself on green CI. Go to Step 5.                                                                                                        |
| The PR carries a `security` label                                                        | Do not merge. Send a `PushNotification`, then `AskUserQuestion` with the readiness assessment. Merge only on the user's explicit yes for this PR. |
| Anything else (`held`, `review-required`, `unknown`, `yes (auto-merge enable FAILED …)`) | Invoke `/land` and merge.                                                                                                                         |

On the `/land` path:

- **No review record.** If `merge-review-guard.sh` denies because no record exists for the PR's final head, re-run the executor's Step 10 step 7 confirmation review against the current head.
- **Blocking findings or a red CI run.** Fix forward on the PR branch from a fresh worktree, and re-review at the new head before merging. Never revert.

## Step 5 — Report

Give the executor's Step 11 report fields verbatim, plus:

```
RUN_MODE: dispatched | in-session (gate override)
MERGED: <merge commit sha> | auto-merge armed | waiting on user (security label) | n/a (no PR)
```
