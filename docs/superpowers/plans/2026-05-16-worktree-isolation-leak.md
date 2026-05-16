# Worktree Isolation Leak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine why `isolation: "worktree"` agent edits leaked into the main working tree during the 2026-05-15/16 `/todo` run, and add an in-repo guardrail so it cannot silently recur.

**Architecture:** Investigation first (forensic capture → controlled reproduction → root-cause determination), gated by a checkpoint, then a three-part mitigation: a `PreToolUse` guardrail hook that fail-closes when a worktree-isolated session targets the main checkout, instruction hardening in the todo-executor agent, and a codified prevention pattern.

**Tech Stack:** Bash hook scripts, Claude Code `PreToolUse` hooks, `jq`, git worktrees.

**Spec:** `docs/superpowers/specs/2026-05-16-worktree-isolation-leak-design.md`

---

## File Structure

- `docs/research/2026-05-16-worktree-isolation-leak-rca.md` — **create.** Working investigation log; accumulates evidence from Tasks 1–3. The conclusion is also copied into the todo's `Updates` section.
- `.claude/hooks/guard-worktree-isolation.sh` — **create.** The M1 guardrail hook. One responsibility: deny an `Edit`/`Write`/`MultiEdit` whose absolute `file_path` is under the main checkout when the session is running inside an agent worktree.
- `.claude/settings.json` — **modify.** Register the guardrail hook on `Edit`/`Write`/`MultiEdit`.
- `.claude/agents/todo-executor.md` — **modify.** Add a `Step 0 — Workspace assertion` before `Step 1 — Parse`.
- `docs/solutions/best-practices/agent-worktree-isolation-2026-05-16.md` — **create.** Codified prevention pattern.
- `todos/2026-05-16-investigate-worktree-isolation-leak.md` — **modify.** Record the RCA conclusion and check off acceptance criteria.

**Investigation note:** Tasks 1–3 are diagnostic — their steps run commands and record findings rather than following test-first development. Tasks 4–6 are the testable mitigation and follow a test-first structure.

---

## Task 1: Forensic capture

Capture the incident evidence **before** anything is cleaned up. The locked worktree `agent-a22fa743e844965e6` must survive until Task 6.

**Files:**

- Create: `docs/research/2026-05-16-worktree-isolation-leak-rca.md`

- [ ] **Step 1: Create the RCA log with its skeleton**

Create `docs/research/2026-05-16-worktree-isolation-leak-rca.md` with this content:

```markdown
# Worktree Isolation Leak — Root Cause Analysis

- **Date:** 2026-05-16
- **Spec:** docs/superpowers/specs/2026-05-16-worktree-isolation-leak-design.md
- **Incident CC version:** 2.1.136 — **Investigation CC version:** 2.1.142

## Phase 1 — Forensic capture

(filled in by Task 1)

## Phase 2 — Controlled reproduction

(filled in by Task 2)

## Phase 3 — Root cause

(filled in by Task 3)
```

- [ ] **Step 2: Capture the locked worktree's git state**

Run:

```bash
git -C .claude/worktrees/agent-a22fa743e844965e6 log --oneline -10
git -C .claude/worktrees/agent-a22fa743e844965e6 reflog --date=iso | head -30
git -C .claude/worktrees/agent-a22fa743e844965e6 status --short
git worktree list
```

Paste the output into the `Phase 1` section of the RCA log under a `### Locked worktree state` heading.

- [ ] **Step 3: Capture the leaked-edit set from the merged PRs**

Run:

```bash
git show --stat --oneline 808abb71   # PR #189
git show --stat --oneline effbc56f   # PR #190
```

Record the file lists under a `### PR #189 / #190 file lists` heading in the RCA log. These are the edits that also appeared uncommitted in `main`.

- [ ] **Step 4: Locate and scan the incident agents' transcripts**

Claude Code transcripts live in `~/.claude/projects/`, keyed by working-directory path. Run:

```bash
ls -dt ~/.claude/projects/-Users-williamtower-projects-OCRecipes*/
```

For each candidate directory, find session files from 2026-05-15/16:

```bash
ls -lt ~/.claude/projects/-Users-williamtower-projects-OCRecipes*/*.jsonl | head -20
```

In the relevant `.jsonl` session file(s), search the `/todo` run's `Edit`/`Write`/`Bash` tool calls for absolute paths under the main repo root that are **not** under a worktree path:

```bash
grep -oE '/Users/williamtower/projects/OCRecipes/[^"]*' <session>.jsonl | grep -v '/.claude/worktrees/' | sort -u | head -40
```

Record under a `### Transcript scan` heading: whether any executor agent issued an absolute main-repo path to `Edit`/`Write`. This is the smoking gun for the path-based hypothesis. Note explicitly if transcripts for the incident's worktree-isolated sessions could not be found.

- [ ] **Step 5: Commit**

```bash
git add docs/research/2026-05-16-worktree-isolation-leak-rca.md
git commit -m "docs(research): forensic capture for worktree isolation leak"
```

---

## Task 2: Controlled reproduction

Test whether `2.1.142` still leaks, and — critically — establish whether a worktree-isolated agent's working directory actually points at its worktree.

**Files:**

- Modify: `docs/research/2026-05-16-worktree-isolation-leak-rca.md`

- [ ] **Step 1: Confirm a clean baseline**

Run `git status --short` on the main checkout. Expected: only the in-flight files of this plan. Record the baseline in the RCA log's `Phase 2` section under `### Baseline`. If there are unexpected uncommitted files, stop and resolve them first — a dirty baseline makes the leak test unreadable.

- [ ] **Step 2: Dispatch the reproduction agent**

Dispatch one agent with worktree isolation. Use this exact `Agent` call:

```
Agent({
  description: "Worktree isolation repro probe",
  isolation: "worktree",
  subagent_type: "general-purpose",
  prompt: "You are a diagnostic probe. Do exactly these steps and report the raw output of each, nothing else:\n1. Run: pwd\n2. Run: git rev-parse --show-toplevel\n3. Use the Write tool to create a file named repro-marker-relative.txt (RELATIVE path, no leading slash) containing the text PROBE.\n4. Run: ls -la repro-marker-relative.txt && cat repro-marker-relative.txt\n5. Run: git status --short\nReport every command's exact output."
})
```

- [ ] **Step 3: Record the probe agent's report**

Copy the agent's reported output of `pwd`, `git rev-parse --show-toplevel`, and `git status --short` into the RCA log under `### Probe agent report`.

- [ ] **Step 4: Determine where the relative-path write landed**

After the agent finishes, run from the main checkout:

```bash
ls -la repro-marker-relative.txt 2>/dev/null && echo "LANDED IN MAIN — LEAK REPRODUCED"
find .claude/worktrees -name repro-marker-relative.txt 2>/dev/null
```

Interpretation, recorded under `### cwd semantics` in the RCA log:

- Marker file in **main checkout** → the agent's relative paths resolved against the main repo → its cwd was **not** the worktree. Harness-level isolation failure.
- Marker file **only inside a `.claude/worktrees/agent-*` worktree** → the agent's cwd **was** the worktree. The leak (if it still occurs) is path-based, not cwd-based.

- [ ] **Step 5: Note whether hooks fire for the worktree agent**

In the probe agent's run, note whether the `inject-patterns.sh` status message ("Loading patterns for this file...") appeared when it used the `Write` tool. Record yes/no under `### Hooks fire for worktree agents` — this is the load-bearing fact for whether the M1 hook (Task 4) will execute at all for worktree-isolated agents.

- [ ] **Step 6: Clean up the probe artifact**

If `repro-marker-relative.txt` landed in the main checkout, delete it: `rm -f repro-marker-relative.txt`. Confirm `git status --short` shows only this plan's in-flight files.

- [ ] **Step 7: Commit**

```bash
git add docs/research/2026-05-16-worktree-isolation-leak-rca.md
git commit -m "docs(research): controlled reproduction for worktree isolation leak"
```

---

## Task 3: Root-cause determination + checkpoint

Synthesize Tasks 1–2 into a definitive root cause, then gate the mitigation design on what was found.

**Files:**

- Modify: `docs/research/2026-05-16-worktree-isolation-leak-rca.md`
- Modify: `todos/2026-05-16-investigate-worktree-isolation-leak.md`

- [ ] **Step 1: Write the root-cause conclusion**

In the RCA log's `Phase 3` section, state which hypothesis holds, citing the Task 1–2 evidence:

- (a) Harness does not set the agent's cwd to the worktree (Task 2 Step 4 = "landed in main").
- (b) Agent issued absolute main-repo paths to `Edit`/`Write` (Task 1 Step 4 transcript scan found them; Task 2 cwd semantics = worktree).
- (c) `2.1.136`-specific, not reproduced on `2.1.142` (Task 2 Step 4 marker landed only in a worktree and no leak observed).

If none reproduce and the transcript scan is inconclusive, state that explicitly and record it as "not reproduced — guardrail added as defense-in-depth."

- [ ] **Step 2: Copy the conclusion into the todo**

Append a dated entry to the `## Updates` section of `todos/2026-05-16-investigate-worktree-isolation-leak.md` summarizing the root cause (3–6 sentences), and check off the acceptance criteria for "Root cause identified", "Determined whether the cause is...", and "Reproduced the leak, or conclusively ruled out each hypothesis".

- [ ] **Step 3: CHECKPOINT — verify the M1 design assumption**

Task 4 builds the guardrail hook on the assumption that the `PreToolUse` hook event's `cwd` field reflects the worktree for a worktree-isolated agent. Confirm against the evidence:

- **Task 2 Step 4 = "landed only in a worktree"** AND **Task 2 Step 5 = hooks fire for worktree agents** → assumption holds. Proceed to Task 4 as written.
- **Task 2 Step 4 = "landed in main"** (cwd is not the worktree) → the `cwd`-based anchor in Task 4 will never match. **Stop here.** The guardrail needs a different anchor; return to the brainstorming/spec step to redesign M1 before continuing.
- **Hooks do not fire for worktree agents** → an in-process hook cannot guard them. **Stop here.** M1 is not viable; reconsider M2-only or an upstream report.

Record the checkpoint decision in the RCA log.

- [ ] **Step 4: Commit**

```bash
git add docs/research/2026-05-16-worktree-isolation-leak-rca.md todos/2026-05-16-investigate-worktree-isolation-leak.md
git commit -m "docs(research): root cause + checkpoint for worktree isolation leak"
```

---

## Task 4: M1 — worktree isolation guardrail hook

A `PreToolUse` hook that denies an `Edit`/`Write`/`MultiEdit` whose absolute `file_path` is under the main checkout while the session runs inside an agent worktree. Proceed only past the Task 3 checkpoint.

**Files:**

- Create: `.claude/hooks/guard-worktree-isolation.sh`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Write the failing test case (hook does not exist yet)**

Run this — it should fail because the script is absent:

```bash
echo '{"cwd":"/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc","tool_input":{"file_path":"/Users/x/projects/OCRecipes/server/app.ts"}}' | bash .claude/hooks/guard-worktree-isolation.sh
```

Expected: `bash: .claude/hooks/guard-worktree-isolation.sh: No such file or directory`.

- [ ] **Step 2: Create the guardrail hook**

Create `.claude/hooks/guard-worktree-isolation.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse hook — block worktree-isolated agents from editing the main checkout.
# When the session cwd is inside .claude/worktrees/agent-*, an Edit/Write/MultiEdit
# whose absolute file_path is under the main repo root but outside that worktree
# is the isolation-leak signature — deny it. Relative paths resolve against the
# (in-worktree) cwd and are always allowed. Fails open on parse failure, matching
# the other hooks in this directory.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -re '.cwd' 2>/dev/null) || exit 0
FILE_PATH=$(printf '%s' "$INPUT" | jq -re '.tool_input.file_path' 2>/dev/null) || exit 0

# Only act when the session is running inside an agent worktree.
case "$CWD" in
  */.claude/worktrees/agent-*) ;;
  *) exit 0 ;;
esac

# Worktree root = cwd truncated at (and including) the agent-<id> path component.
WT_ROOT=$(printf '%s' "$CWD" | sed -E 's#(.*/\.claude/worktrees/agent-[^/]+).*#\1#')
# Main repo root = everything before /.claude/worktrees/.
MAIN_ROOT="${WT_ROOT%/.claude/worktrees/agent-*}"

# Relative file_path resolves against cwd (inside the worktree) — always safe.
case "$FILE_PATH" in
  /*) ;;
  *) exit 0 ;;
esac

# Absolute file_path: classify it.
case "$FILE_PATH" in
  "$WT_ROOT"|"$WT_ROOT"/*) exit 0 ;;   # inside the worktree — allowed
  "$MAIN_ROOT"/*) ;;                   # under main repo, outside worktree — the leak
  *) exit 0 ;;                         # entirely outside the repo (e.g. /tmp) — allowed
esac

REASON=$(printf '%s\n  %s\n%s' \
  "Worktree isolation guard: this session is running inside the agent worktree" \
  "$WT_ROOT" \
  "but the edit targets the absolute path $FILE_PATH under the main checkout. Re-issue the edit with a path inside the worktree (a relative path resolves correctly).")

jq -n --arg r "$REASON" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
exit 0
```

Then make it executable: `chmod +x .claude/hooks/guard-worktree-isolation.sh`.

- [ ] **Step 3: Run the deny test case and verify it now denies**

```bash
echo '{"cwd":"/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc","tool_input":{"file_path":"/Users/x/projects/OCRecipes/server/app.ts"}}' | bash .claude/hooks/guard-worktree-isolation.sh
```

Expected: JSON containing `"permissionDecision":"deny"` and the worktree path in the reason.

- [ ] **Step 4: Run the allow test cases and verify each exits silently**

Each command below must produce **no output** (allowed):

```bash
# (a) absolute path inside the worktree
echo '{"cwd":"/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc","tool_input":{"file_path":"/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc/server/app.ts"}}' | bash .claude/hooks/guard-worktree-isolation.sh
# (b) relative path
echo '{"cwd":"/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc","tool_input":{"file_path":"server/app.ts"}}' | bash .claude/hooks/guard-worktree-isolation.sh
# (c) session NOT in a worktree (normal main session)
echo '{"cwd":"/Users/x/projects/OCRecipes","tool_input":{"file_path":"/Users/x/projects/OCRecipes/server/app.ts"}}' | bash .claude/hooks/guard-worktree-isolation.sh
# (d) absolute path entirely outside the repo
echo '{"cwd":"/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc","tool_input":{"file_path":"/tmp/scratch.txt"}}' | bash .claude/hooks/guard-worktree-isolation.sh
```

Expected: all four print nothing.

- [ ] **Step 5: Register the hook in `.claude/settings.json`**

In `.claude/settings.json`, the `hooks.PreToolUse` array currently has four entries (`Edit`, `Write`, `MultiEdit`, `Bash`). Add three new entries immediately before the closing `]` of the `PreToolUse` array — after the `Bash` entry:

```json
      ,{
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/guard-worktree-isolation.sh",
            "timeout": 10,
            "statusMessage": "Checking worktree isolation..."
          }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/guard-worktree-isolation.sh",
            "timeout": 10,
            "statusMessage": "Checking worktree isolation..."
          }
        ]
      },
      {
        "matcher": "MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/guard-worktree-isolation.sh",
            "timeout": 10,
            "statusMessage": "Checking worktree isolation..."
          }
        ]
      }
```

- [ ] **Step 6: Verify the JSON is well-formed**

```bash
jq empty .claude/settings.json && echo "settings.json OK"
```

Expected: `settings.json OK`.

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/guard-worktree-isolation.sh .claude/settings.json
git commit -m "feat(hooks): add worktree isolation guardrail hook"
```

---

## Task 5: M2 — todo-executor workspace assertion

Make executor agents fail fast with a clear message if they are not running in an isolated worktree, instead of silently editing `main`.

**Files:**

- Modify: `.claude/agents/todo-executor.md`

- [ ] **Step 1: Insert the workspace-assertion step**

In `.claude/agents/todo-executor.md`, insert the following block immediately **before** the line `## Step 1 — Parse` (and before the `---` separator that precedes it):

````markdown
## Step 0 — Workspace assertion

You are dispatched with `isolation: "worktree"` and must operate entirely inside your own git worktree. Before doing anything else, confirm your workspace:

```bash
pwd
git rev-parse --show-toplevel
```
````

- If `pwd` is **not** inside a `.claude/worktrees/agent-*` directory, report `blocked` with reason `"not running in an isolated worktree — pwd is <pwd>"` and stop. Do not edit files.
- For every `Edit`, `Write`, and `MultiEdit` call in later steps, use **worktree-relative paths** (e.g. `server/routes/foo.ts`), never absolute paths under `/Users/...`. Relative paths resolve against your worktree; an absolute path under the main checkout would leak your edits into `main`.

---

````

- [ ] **Step 2: Verify the insertion**

```bash
grep -n "Step 0 — Workspace assertion" .claude/agents/todo-executor.md
grep -n "Step 1 — Parse" .claude/agents/todo-executor.md
````

Expected: `Step 0` appears at a lower line number than `Step 1`.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "docs(agents): add workspace assertion step to todo-executor"
```

---

## Task 6: End-to-end verification, codification, and cleanup

Prove the guardrail works against a real worktree agent, codify the pattern, and remove the stale incident worktree.

**Files:**

- Create: `docs/solutions/best-practices/agent-worktree-isolation-2026-05-16.md`
- Modify: `todos/2026-05-16-investigate-worktree-isolation-leak.md`

- [ ] **Step 1: Confirm a clean baseline**

Run `git status --short`. Expected: clean (all prior tasks committed). Resolve anything unexpected before continuing.

- [ ] **Step 2: Dispatch a verification agent**

```
Agent({
  description: "Worktree guardrail verification",
  isolation: "worktree",
  subagent_type: "general-purpose",
  prompt: "You are a verification probe. Do exactly these steps and report each result:\n1. Use the Write tool to create verify-marker.txt (RELATIVE path) containing OK. Report whether it succeeded.\n2. Attempt to use the Write tool with the ABSOLUTE path /Users/williamtower/projects/OCRecipes/verify-leak.txt containing LEAK. Report the exact result — including any tool denial message you receive.\nDo not retry a denied call. Report both outcomes verbatim."
})
```

- [ ] **Step 3: Verify the guardrail denied the leak attempt**

The agent's report for step 2 must show a denial citing the worktree isolation guard. Then run on the main checkout:

```bash
ls -la verify-leak.txt 2>/dev/null && echo "FAIL — LEAK FILE PRESENT IN MAIN" || echo "PASS — no leak file in main"
git status --short
```

Expected: `PASS — no leak file in main`, and `git status` shows no `verify-leak.txt`. If the leak file is present, the guardrail failed — return to Task 4.

- [ ] **Step 4: Codify the prevention pattern**

First check a sibling file's frontmatter format: `head -8 "$(ls docs/solutions/best-practices/*.md | head -1)"`. Then create `docs/solutions/best-practices/agent-worktree-isolation-2026-05-16.md`, matching that frontmatter format, with this content:

```markdown
---
title: "Agent worktree isolation must not leak into the main checkout"
tags: [agents, tooling]
---

# Agent worktree isolation must not leak into the main checkout

Agents dispatched with `isolation: "worktree"` work in `.claude/worktrees/agent-*`.
Their `Edit`/`Write`/`MultiEdit` calls must use **worktree-relative paths**. An
absolute path under the main repo root (`/Users/.../OCRecipes/...`) bypasses the
worktree and leaves uncommitted edits in `main`.

**Guardrail:** `.claude/hooks/guard-worktree-isolation.sh` is a `PreToolUse` hook
that denies an absolute-path edit targeting the main checkout when the session
cwd is inside an agent worktree. **Prevention:** the `todo-executor` agent
asserts its workspace in `Step 0` and uses relative paths only.

See the RCA: `docs/research/2026-05-16-worktree-isolation-leak-rca.md`.
```

- [ ] **Step 5: Close out the todo**

In `todos/2026-05-16-investigate-worktree-isolation-leak.md`: check off the remaining acceptance criteria ("Root-cause fix applied / workaround documented", "In-repo guardrail added", "Recurrence-prevention pattern codified", "A follow-up agent run verified..."), and append a dated `## Updates` entry recording the guardrail, the M2 hardening, and the verification result.

- [ ] **Step 6: Commit the codification and todo closeout**

```bash
git add docs/solutions/best-practices/agent-worktree-isolation-2026-05-16.md todos/2026-05-16-investigate-worktree-isolation-leak.md
git commit -m "docs(solutions): codify agent worktree isolation pattern"
```

- [ ] **Step 7: Remove the stale incident worktree (CONFIRM WITH USER FIRST)**

Removing a worktree is destructive — **ask the user to confirm** before running this. Once confirmed:

```bash
git worktree unlock .claude/worktrees/agent-a22fa743e844965e6
git worktree remove .claude/worktrees/agent-a22fa743e844965e6
git worktree list
```

Then delete the orphaned branch if present (also confirm): `git branch -D worktree-agent-a22fa743e844965e6`. Leave the unrelated `.worktrees/feature/curated-recipes` worktree untouched.

- [ ] **Step 8: Final verification**

```bash
git status --short
git worktree list
```

Expected: `git status` clean; `git worktree list` no longer shows `agent-a22fa743e844965e6`.

---

## Self-Review

**Spec coverage:**

- Phase 1 (forensic capture) → Task 1. ✓
- Phase 2 (controlled reproduction, cwd semantics, hook-fire check) → Task 2. ✓
- Phase 3 (root cause, checkpoint) → Task 3. ✓
- Phase 4 M1 (guardrail hook) → Task 4. ✓
- Phase 4 M2 (todo-executor hardening) → Task 5. ✓
- "Done when": RCA recorded → Tasks 1–3; guardrail + hardening merged → Tasks 4–5; prevention codified in `docs/solutions/` → Task 6 Step 4; fresh agent run leaves `main` clean → Task 6 Steps 2–3. ✓
- The hook-copy question is resolved by registering M1 on `main` (worktrees branched from `main` inherit `.claude/settings.json` and `.claude/hooks/`); Task 6's live agent run empirically confirms the hook fires for a worktree agent.

**Placeholder scan:** No TBD/TODO. Investigation steps (Tasks 1–3) carry exact commands; mitigation steps (Tasks 4–6) carry complete code. The Task 3 checkpoint is a documented decision gate, not a placeholder.

**Type consistency:** Hook script path `.claude/hooks/guard-worktree-isolation.sh`, RCA path `docs/research/2026-05-16-worktree-isolation-leak-rca.md`, and codification path `docs/solutions/best-practices/agent-worktree-isolation-2026-05-16.md` are used identically across all tasks.
