---
title: Code-Reviewer Subagent as Pre-Commit Review Gate
track: knowledge
category: design-patterns
module: shared
tags: [code-review, subagent, workflow, tooling, todo-executor, pre-commit]
applies_to: [.claude/agents/todo-executor.md, .claude/skills/todo/SKILL.md]
created: '2026-06-09'
---

# Code-Reviewer Subagent as Pre-Commit Review Gate

## When this applies

Any time you need code review before committing during automated todo execution, or before opening a PR. This replaced the kimi-review CLI gates removed on 2026-06-09.

## Rule

Use the `code-reviewer` subagent (Agent tool, `subagent_type: "code-reviewer"`) for working-tree review in todo-executor Step 6. Use the `/code-review` skill for diff-scoped review on PRs or one-off review sessions.

Never call kimi-review, kimi-multi-review, or `scripts/kimi-review.py` for code review — those scripts were removed. The `ask-kimi`, `kimi-write`, `extract-chat`, and `kimi-challenge` I/O tools remain and are still used.

## Why

The per-commit kimi-review gate had 120–330s latency and a non-trivial false-positive rate that required significant hardening (function-context diffs, `<changed-files>` manifest, deterministic temperature). The `code-reviewer` subagent wins on:

- **LSP access** — semantic symbol nav, cross-file go-to-definition; catches renamed exports and dead code kimi's static diff couldn't see
- **Full file context** — reads complete files, not just diff hunks; avoids false positives from incomplete context
- **Cross-file reasoning** — can trace a call from route → service → storage in one pass

The I/O tools (ask-kimi for pattern lookup, kimi-challenge for architecture pressure-testing) remain cost-effective for their purpose and are kept.

## Examples

### Step 6 in todo-executor — standard invocation

```javascript
// Capture working-tree diff
const DIFF = `git diff HEAD -- .` // run via Bash tool

// Guard: skip if nothing to review
if (!DIFF.trim()) {
  review_output = ""  // store in working context
  // proceed to Step 7 (advisor)
}

// Invoke code-reviewer subagent
Agent({
  description: "Code review: <todo title>",
  subagent_type: "code-reviewer",
  prompt: `Review the uncommitted working-tree changes in this repository for correctness bugs, security issues, and adherence to OCRecipes patterns.

Run \`git diff HEAD -- .\` to see the changes. Use LSP and file-reading tools as needed for full context.

This review is for todo: <todo title>.

Return findings using exactly this format:
[CRITICAL] file:line — description
[WARNING] file:line — description

If there are no issues, return exactly: No findings.`
})
```

Store the subagent's full response in working context as `review_output`.

### Finding format contract

| Finding tier | Downstream handling |
|---|---|
| `[CRITICAL] file:line — description` | Block commit. Fix before proceeding. Surface to user. |
| `[WARNING] file:line — description` | Do not block. Append to `DEFERRED_WARNINGS` for Step 7 advisor context. |
| `No findings.` | Proceed to commit. |

### When to use `/code-review` skill instead

- PR review (diff-scoped, not working-tree)
- Ad-hoc review outside of todo execution
- When you want interactive back-and-forth rather than a one-shot structured output

The skill uses the same underlying `code-reviewer` agent type but is invoked differently (via the Skill tool from the main session, not as a dispatched subagent).

## Exceptions

- If the working-tree diff is empty (`git diff HEAD -- .` produces no output), skip the review entirely — there is nothing to review.
- The code-reviewer subagent does NOT replace security-auditor or architecture-specialist for deep, purpose-specific audits. Those remain for `/audit` invocations.

## Related Files

- `.claude/agents/todo-executor.md` — Step 6 is the canonical home of this invocation template
- `.claude/skills/todo/SKILL.md` — orchestrator-level reference (renamed Step 5→4 after kimi-review removal)
- `docs/AI_WORKFLOW.md` — project-wide routing rule: code-reviewer subagent vs /code-review skill

## See Also

- [priority-order-context-injection-under-size-cap](priority-order-context-injection-under-size-cap-2026-06-05.md) — the hook-injection system that provides pattern context to the subagent
