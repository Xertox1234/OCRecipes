---
name: todo-fast
description: Use when the user names one specific medium/high/critical todo in todos/ to be implemented now, in this session, rather than waiting for a /todo backlog sweep — including a todo gated by blocked_until or human_led that the user wants to override for one run — and when resuming a /todo-fast run with `/todo-fast continue` after a compaction.
---

You are running `/todo-fast` for one todo, the file you were given, and then for every followup todo that work generates, until none is left. It never scans the backlog. **A run is finished only when the todo AND every followup it generated is merged, or handed to the user with a reason.** It never leaves a filed followup behind.

All the implementation work belongs to `.claude/agents/todo-executor.md`: pre-flight, research, advisor, implementing, verifying, reviewing, committing, codifying and opening the PR. This skill adds four things around it: a priority and gate check (with the one legal gate override), the merge, cleanup, and the followup loop. Never restate or re-sequence executor steps here. When the executor changes, `/todo-fast` follows automatically.

`/todo-fast continue` resumes a run after a compaction: go straight to Step 6.3's `continue` rule.

## Step 1 — Priority and gate

1. **Priority.** Read the todo's frontmatter. If `priority` is `low`, stop and report: "This todo is priority `low` — `/todo` already lands it on its own through the auto-merge guard path. Use `/todo` instead." This check applies only to the todo the user named. A followup from Step 6 runs at any priority.

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

Check the rows in order and take the first that matches. Read the PR's labels with `mcp__github__pull_request_read`.

| Report                                                                                   | Action                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No PR (`skipped`, `blocked`, `failed`)                                                   | Nothing to merge. Go to Step 5.                                                                                                                                                                                                                                    |
| The PR carries a `security` label                                                        | Do not merge. In an interactive session, send a `PushNotification`, then `AskUserQuestion` with the readiness assessment, and merge only on the user's explicit yes for this PR. In a non-interactive session, report `waiting on user (security label)` and stop. |
| `MERGE_ELIGIBLE: yes (auto-merge enabled)`                                               | It lands itself on green CI. Wait until the PR is `MERGED`, reading its state rather than assuming. If a required check fails, fix forward as on the `/land` path below. Then go to Step 5.                                                                        |
| Anything else (`held`, `review-required`, `unknown`, `yes (auto-merge enable FAILED …)`) | Invoke `/land` and merge.                                                                                                                                                                                                                                          |

On the `/land` path:

- **No review record.** If `merge-review-guard.sh` denies because no record exists for the PR's final head, re-run the executor's Step 10 step 7 confirmation review against the current head.
- **Blocking findings or a red CI run.** Fix forward on the PR branch from a fresh worktree, and re-review at the new head before merging. Never revert.

## Step 5 — Report

Give the executor's Step 11 report fields verbatim, plus the two lines below. If the run stopped at Step 1, there is no executor report: give `STATUS: skipped`, the `REASON_CODE` (`GATE_BLOCKED`, or `NONE` for the priority stop), the reason, and `RUN_MODE: stopped at Step 1`. Step 3 does not apply then, because no worktree exists.

```
RUN_MODE: dispatched | in-session (gate override) | stopped at Step 1
MERGED: <merge commit sha> | waiting on user (security label) | n/a (no PR)
```

Then continue to Step 6. Do not end the run at this report.

## Step 6 — Followups, then pause for a compaction

User ruling (2026-10-04): no loose ends. Filing a followup todo during the work is fine. Leaving one behind is not. The run loops this skill over every followup the work generated, with a fresh context window for each.

1. **Collect.** List the todo files the work added: every PR this todo produced (the executor's PR plus any repair PR from Step 4), excluding the archive:

   ```bash
   gh pr view <n> --json files --jq '.files[] | select(.changeType=="ADDED") | .path' | grep '^todos/P.*\.md$'
   ```

   `^todos/P` already excludes `todos/archive/` (where Step 8 moves the finished todo) and `TEMPLATE.md`. Also add any todo you filed yourself during this run. If the todo produced no merged PR (`skipped`, `blocked`, `failed`, or a security PR waiting on the user), it is not finished: collect nothing from it, record it under `handed_to_user` in 6.2, and carry on with the queue.

2. **Save the run state** to `todo-fast-run.json` in your scratchpad directory. This file and the ledger note are how the run survives the compaction. Write the file every time it changes:

   ```json
   {
     "root": "<todo the user named>",
     "base": "<BASE_BRANCH from the root's Step 2>",
     "current": null,
     "done": [{ "todo": "...", "pr": 1300, "merged": "<sha>" }],
     "queue": ["todos/P3-...md"],
     "handed_to_user": [{ "todo": "...", "reason": "..." }],
     "followups_run": 0
   }
   ```

   - Record the todo you just finished (the root, or `current`) under `done` if its PR merged. Otherwise record it under `handed_to_user` with its reason, and include the PR URL if one exists.
   - Set `current` to `null`.
   - Append each new followup to `queue`, unless that path is already in `queue`, `done` or `handed_to_user`.

   Then record a ledger note:

   ```bash
   bash .claude/hooks/ledger-note.sh VERIFIED "/todo-fast run: <root>; done <n>; queue <paths>; state <scratchpad>/todo-fast-run.json" "cat <scratchpad>/todo-fast-run.json"
   ```

3. **Next followup.** Re-read `todo-fast-run.json`; never trust your memory of it, since a compaction may have summarized it away.
   - **On `/todo-fast continue`:**
     - If `current` is set, run Steps 1–6 on `current`, at any priority, using the file's `base` as `BASE_BRANCH` (never re-derive it from whatever branch the shared checkout is on now). Do not take another path off `queue`: `current` is the one you already took before the pause. A gated followup gets the same Step 1 gate as any todo; with no human override, it goes to `handed_to_user` in 6.2.
     - If `current` is `null`, continue with the next bullet as if you had just finished 6.2.
   - **After 6.2, queue empty** → go to 6.4.
   - **After 6.2, `followups_run` has reached 10** → stop. Show the user what's left in `queue` and ask whether to keep going. On their yes, reset `followups_run` to 0 and take the next followup as below, including the pause.
   - **After 6.2, otherwise:**
     - Sync local `base` with the block in `.claude/skills/todo/SKILL.md` Phase 0 step 4 (ff-only, and it never touches a branch another session has checked out). The followup's file exists only on the merged base, and the executor's worktree starts from the local copy.
     - Move the first path from `queue` into `current` and add 1 to `followups_run`. If `git cat-file -e <base>:<path>` fails, the base still lacks the file: put the path under `handed_to_user` with reason `not on <base> after sync` instead, and take the next one.
     - Save the file.
     - Tell the user: "`<finished todo>` is done (PR #<n> merged). Next followup: `<current>` (<k> left in the queue). Ready to compact: run `/compact`, then `/todo-fast continue`." Then end your turn. Do not start the followup in this window.
   - **Non-interactive session** (a `/goal` loop, or a background or headless run): no one can run `/compact`, and no one can answer the 10-followup question. Do not pause. Give the 6.4 summary with the remaining `queue` listed as not done, keep the file, and stop.

4. **Run summary.** When the queue is empty and `current` is `null`, report every todo the run handled: each one's PR and merge commit, and each `handed_to_user` entry with its reason. Delete `todo-fast-run.json`. Then the run is over.
