---
title: 'Agent-file edits take effect on session reload, not when you save — injection fires only on Edit/Write, the type registry is a session snapshot'
track: knowledge
category: conventions
module: shared
tags: [claude-code, subagents, agents, inject-patterns, hooks, registry, harness, session-lifecycle]
applies_to: [.claude/agents/**/*.md, docs/rules/**/*.md]
created: '2026-07-02'
---

# Agent-file edits take effect on session reload, not when you save

## Rule

Writing or editing a `.claude/agents/*.md` file does not make the change live in the
running session. Two independent harness mechanisms, both with non-obvious timing,
govern when agent-file content actually reaches an agent — do not assume either fires
the moment you save.

1. **Rule injection is Edit/Write-gated.** `.claude/hooks/inject-patterns.sh` is a
   PreToolUse hook on `Edit`/`Write`/`MultiEdit`. An agent receives auto-injected
   `docs/rules/*` content **only when it itself calls one of those tools.** So a pointer
   line that reads "follow `docs/rules/X` (auto-injected)" is:
   - **always false** for a tool-restricted read-only agent (`tools: Read, Grep, Glob,
     Bash, LSP` — the reviewer roster): it can never trigger the hook;
   - **unreliable** for a role-read-only agent (inherits all tools but its flow doesn't
     edit — e.g. a researcher): the hook fires only on the rare edit;
   - **accurate** only for an editing agent (`todo-executor`), which reliably edits.

2. **The subagent-type registry is a session snapshot.** The set of dispatchable
   `subagent_type` values lags the on-disk files. A freshly-written agent file is **not
   dispatchable until the harness re-scans** — a boundary observed at session/commit,
   not at file write.

## Smell patterns

- `(auto-injected)` appended to a pointer in a `Read, Grep, Glob, Bash, LSP`-only agent.
- A plan/skill step that writes a new agent file and, in the same session, immediately
  dispatches `subagent_type: "<new-name>"` to smoke-test it.
- Relying on injected rules inside a reviewer prompt ("the LSP rules will be in your
  context") when the reviewer has no Edit/Write.

## Why

Both mechanisms failed silently in the #490 roster consolidation. The reviewers were
given a pointer that said the LSP guidance was "auto-injected," but as read-only agents
they can never trigger the injection hook — the pointer told them they needn't read a
file they in fact must read. Separately, dispatching the just-written `mobile-reviewer`
type errored `Agent type 'mobile-reviewer' not found` while the registry still listed the
12 now-deleted specialists; it refreshed to the new 5-name roster only later (after the
commit), when the harness re-scanned. Neither is a crash — both are "the change I saved
isn't the change that's running," which reads as a mysterious no-op.

## Examples

- **Pointer wording** — read-only reviewers say "follow `docs/rules/lsp.md` (read it
  directly — it is not auto-injected into read-only agents)"; `todo-executor` (an editing
  agent) keeps "(auto-injected)" because it holds true for it.
- **Smoke-testing a new agent** — do NOT `subagent_type`-dispatch a brand-new agent in
  the session that created it. Content-validate instead: dispatch a `general-purpose`
  agent told to **Read the new agent file and adopt it as its instructions**, which
  proves the definition is coherent without depending on registration. Defer the real
  typed dispatch to after the reload (the #490 `mobile-reviewer` was validated exactly
  this way).

## Exceptions

- `todo-executor` and any agent that actually edits files DO trigger injection, so
  "(auto-injected)" is correct for them — do not strip it there.
- Once the session reloads (or a new session starts), the registry reflects the on-disk
  roster and typed dispatch works normally; this convention is about the write→reload
  window only.

## Related Files

- `.claude/hooks/inject-patterns.sh` — the PreToolUse Edit/Write injection hook
- `.claude/agents/*.md` — reviewer roster (read-only) vs `todo-executor`/`todo-researcher`
  (inherit all tools)
- `docs/rules/lsp.md` — the single-source rule file the agent pointers reference

## See Also

- [../best-practices/grep-verify-single-ownership-after-dedup-consolidation-2026-07-02.md](../best-practices/grep-verify-single-ownership-after-dedup-consolidation-2026-07-02.md) — sibling lesson from the same consolidation: verifying the roster is complicated by this load timing
