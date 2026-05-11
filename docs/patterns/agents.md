# Claude Code Agent Patterns

Patterns for building Claude Code agents and skills (`.claude/agents/`, `.claude/skills/`). These concern agent-to-agent communication and MCP tool orchestration, not production AI features for users (see `ai-prompting.md` for those).

---

### Two-Turn Parallel Strategy for Chained MCP Calls

When an agent needs to make MCP calls that have a dependency within one track but are independent across tracks, use a two-turn model rather than serializing everything or attempting true parallelism across dependent calls.

**The problem:** Some MCP workflows require a "discovery" call whose result is an input to a "retrieval" call (e.g., `resolve-library-id` → `query-docs`). You cannot fire both in the same turn because the second depends on the first's output. But you _can_ fire all discovery calls together alongside independent tracks, then fire retrieval calls as each discovery responds.

**Pattern:**

```
Turn 1 — fire all in parallel:
  - discovery-call(library-A)    ← returns ID-A
  - discovery-call(library-B)    ← returns ID-B
  - independent-track-1()        ← no dependencies
  - independent-track-2()        ← no dependencies

Turn 2 — as each discovery responds, fire immediately (don't batch-wait):
  - retrieval-call(ID-A)         ← fire as soon as ID-A arrives
  - retrieval-call(ID-B)         ← fire as soon as ID-B arrives
```

**Common failure modes this prevents:**

- **Serializing everything**: `discovery-A → retrieval-A → discovery-B → retrieval-B` — 4× slower than necessary for independent libraries
- **Premature retrieval**: firing `retrieval-call` before `discovery-call` responds (causes tool error or null ID)
- **Batch-waiting**: waiting for all discoveries before starting any retrievals — wastes the overlap window

**When to write this in instructions:** Whenever an agent must call MCP tools where some pairs are `(resolve → fetch)` and there are multiple independent pairs plus other unrelated tracks. State the two-turn model explicitly in the instructions; do not rely on the agent to infer it.

**Origin:** `todo-researcher.md` Step 2 — researcher fires `resolve-library-id` per library alongside GitHub repo and global searches in Turn 1, then fires `query-docs` per library in Turn 2 as IDs arrive.

---

### Section-Header Detection as Agent-to-Agent Protocol

When one agent produces a structured document that another agent must validate, use required section headers as the validity signal — not emptiness checks or truthy tests.

**The problem:** An agent subagent can "succeed" (return a response, no error thrown) while still failing to produce useful output. Checking for `response !== ""` or `response.length > 0` misses cases where the subagent returned error prose, a generic refusal, or partial content missing key sections.

**Pattern:**

```
# Producing agent (researcher)
Always return the brief using this exact structure:

## Library Notes
[...]

## Project Context
[...]

## Global Patterns
[...]

# Consuming agent (executor)
If returned text contains none of the section headers
  (## Library Notes, ## Project Context, ## Global Patterns):
  → treat as unavailable, activate fallback
```

**Why headers outperform other signals:**

- An empty-response check fails when the subagent returns "I couldn't find anything" — that's not empty but it's not the brief
- A word-count check fails for the same reason
- A header check is robust: a well-formed brief with "No results found" in all sections passes; a completely failed subagent that returns prose fails — exactly the right behavior

**Contract requirements:**

- The producing agent must be instructed to always emit the headers, even when sections have no useful content (use placeholder text instead of omitting the header)
- The consuming agent checks for header presence, not header content
- The fallback logic should log which detection triggered it for observability

**When to use:** Any pattern where Agent A spawns Agent B and uses B's structured output. Define the headers as the contract boundary, not the content.

**Origin:** `todo-executor.md` Step 3 — executor spawns researcher and triggers the local-docs fallback if none of the three section headers appear in the returned text. This correctly handles: researcher subagent unavailable, researcher returned generic error prose, researcher returned partial content missing sections.

---

### Context Variables vs Shell Variables in Agent Instructions

When an agent instruction needs a value to persist across multiple steps — each of which may require a separate Bash tool invocation — using `$BASH_VAR` syntax is wrong because shell state dies between tool calls.

**The problem:** A step sets `$REVIEW_OUTPUT` in a Bash block, but a later step (several tool calls later) tries to reference it. By then the shell process has exited and the variable is gone. The agent may hallucinate a value or silently proceed with stale context.

**Pattern:**

```
Step 6 — run review and store result:
  - Execute: kimi-review ...
  - Store the output as review_output in your working context

Step 9 — reference the stored result:
  - Use the review_output you stored earlier to determine ...
```

**Naming convention:**

- `review_output` (unsigiled) → LLM working-context variable, persists across turns
- `$REVIEW_OUTPUT` (sigiled) → Bash-scoped variable, dies with the shell process

**Contract requirements:**

- The instruction must explicitly tell the agent to "store this in your working context"
- The consuming step must reference the unsigiled name to signal retrieval from context
- Never assume shell variables survive across separate Bash tool invocations

**Common failure modes this prevents:**

- **Shell variable leakage**: Assuming `$VAR` set in Step 6 is available in Step 9 — it is not
- **Hallucinated state**: The agent inventing a value because the shell variable expired and no context instruction was given
- **Sigil confusion**: Mixing `$var` and `var` references, causing the agent to treat context variables as shell commands

**When to use:** Whenever an agent instruction spans multiple steps with separate Bash invocations and needs to recall a previous result. State the storage instruction explicitly; do not rely on the agent to infer persistence.

**Origin:** `todo-executor.md` Step 6 — executor set `$REVIEW_OUTPUT` in a bash block, but Step 9 (several steps and tool calls later) referenced it and found the shell empty. The fix was renaming to `review_output` and adding an explicit "store in your working context" instruction.

---

### kimi-review stdin vs --base for Pre-Commit Review

When an agent needs to review uncommitted working-tree changes before committing, `kimi-review --base <branch>` produces an empty diff because it only covers committed changes.

**The problem:** `kimi-review --base <branch>` diffs `<branch>..HEAD`, which is strictly the commit range. Uncommitted changes — whether staged or unstaged — are invisible to `--base`. An agent running pre-commit review with `--base` will see no diff and may incorrectly conclude there are no changes to review.

**Pattern:**

```
# Capture working-tree changes first
git_diff_output=$(git diff HEAD -- .)

# Guard against empty output
if [ -z "$git_diff_output" ]; then
  → no changes to review, skip review step
else
  → echo "$git_diff_output" | kimi-review
fi
```

**Why this works:**

- `kimi-review` reads stdin before checking `--base`
- When stdin has content, it takes priority over `--base`
- `git diff HEAD -- .` captures ALL working-tree changes (both staged and unstaged) relative to `HEAD`

**Common failure modes this prevents:**

- **Empty pre-commit review**: Using `--base main` when changes are uncommitted — the tool sees zero diff and returns an empty or generic result
- **Undefined behavior on empty stdin**: Piping an empty string directly to `kimi-review` without a guard has undefined behavior
- **Missing staged changes**: Using `git diff` without `HEAD` omits staged changes; `git diff HEAD -- .` includes both staged and unstaged

**Contract requirements:**

- Always capture the diff into a variable first
- Always guard for empty output before piping to `kimi-review`
- Use `git diff HEAD -- .` as the source, not `git diff` alone

**When to use:** Any agent step that reviews local modifications before they are committed. State the stdin pattern explicitly in the instructions; do not rely on the agent to infer the correct git invocation.

**Origin:** `todo-executor.md` pre-commit review step — redesign of the /todo skill system (PR #107). The executor initially used `--base main` for pre-commit review and received empty diffs because the changes were not yet committed.

---

### PreToolUse Hook Contract

When writing a Claude Code `PreToolUse` hook that injects `additionalContext`, three non-obvious constraints apply:

**1. Always exit 0 — never block an edit.**
Use `set -uo pipefail` (not `set -euo pipefail`). `-e` causes the script to exit non-zero on benign failures like a missing `jq` field or an empty `grep` result, which blocks the tool call. Guard every failure path explicitly with `|| exit 0` or `|| true` instead of relying on `-e`.

**2. Build multi-line output in a tmpfile, not a subshell.**
Subshell command substitution (`$(...)`) strips trailing newlines, collapsing multi-line context into a single line. Build the string by appending to a tmpfile and `cat` it at the end:

```bash
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
printf '[RULES — %s]\n' "$domain" >> "$TMPFILE"
cat "$rules_file" >> "$TMPFILE"
CONTEXT=$(cat "$TMPFILE")
jq -n --arg ctx "$CONTEXT" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$ctx}}'
```

**3. Output JSON shape for `additionalContext`:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "..."
  }
}
```

The hook must exit 0 and write this JSON to stdout. Any other exit code or output shape is silently ignored or causes the hook to block.

**Additional practices:**

- Use `printf '%s' "$INPUT" | jq ...` not `echo "$INPUT" | jq ...` — `echo` interprets `\n`, `\t` on some shells, corrupting JSON with backslash sequences
- Use `grep -F` for basename matching in `LEARNINGS.md` lookups — the basename is treated as a literal string, not a BRE regex (prevents `.` in filenames matching unrelated lines)
- Use `head -n 80` not `head -80` — the `-N` flag form is deprecated in POSIX

**When to use:** Any hook that injects context before a tool call. The exit-0 contract and tmpfile pattern apply to all PreToolUse hooks regardless of what they inject.

**Origin:** `.claude/hooks/inject-patterns.sh` — write-time pattern injection system (2026-05-10). The tmpfile pattern was required because initial subshell-based context building collapsed multi-line rule files into a single line.
