---
title: "Injection session-dedup starves subagent context windows of first-touch payloads"
status: done
priority: low
created: 2026-07-18
updated: 2026-07-19
assignee:
labels: [deferred, harness, injection]
github_issue:
---

# Injection session-dedup starves subagent context windows of first-touch payloads

## Summary

`inject-patterns.sh` dedups the DISCIPLINE preamble and deferred-domain payloads per `session_id` — but subagents share the parent's session id, so a freshly spawned implementer subagent's first Edit/Write receives the ~156 B "already injected earlier this session" pointer instead of the full domain-rules payload that was only ever injected into the _parent's_ context window. Decide and implement how injection should behave per context window.

## Background

Found by the 2026-07-18 harness audit (finding M1, manifest `docs/audits/2026-07-18-harness.md`). Proven live: a verification subagent's very first scratchpad Write got the pointer variant because the orchestrator had already consumed the preamble slot. The claim "domain rules are auto-injected on edit" holds per-session, not per-context-window — and implementer subagents (todo-executor dispatches, general-purpose implementers) are exactly the contexts doing the most editing. Mitigation today: the pointer text instructs a re-read of `docs/rules/<domain>.md`, so a compliant agent recovers at the cost of an extra read (and a non-compliant one edits without the rules).

## Acceptance Criteria

- [x] A written decision: per-context-window dedup, per-session with forced re-injection on subagent spawn, or accept-and-document the pointer-mitigation status quo
- [x] If dedup keying changes: `.claude/hooks/test-inject-patterns.sh` covers the subagent-first-touch case (fresh key ⇒ full payload)
- [x] `MEMORY.md`/memory note `reference_subagent_shared_session_id` updated to reflect the decision
- [x] CLAUDE.md Key Patterns paragraph stays accurate

## Implementation Notes

- Dedup state: `/tmp/ocrecipes-pattern-inject-<session_id>` (`inject-patterns.sh:144-175`).
- Claude Code exposes no per-context-window id to hooks; candidate discriminators need investigation (e.g. `CLAUDE_AGENT_ID`-style env if available, hook-input fields, or PPID heuristics — verify against real hook input before trusting any of them).
- Simplest robust option may be: key the marker on `session_id` + the hook process's controlling agent, falling back to session-only when no discriminator exists (fail toward re-injection, not starvation — a duplicated 1 KB preamble is cheaper than a missing rules payload).
- Interaction: the deferral mechanism (payload tuning, archived todos P3-2026-07-02/-03) assumes the first-touch full payload lands — the starved-subagent case defeats that assumption.

## Scope Contract

- **Mechanisms to use:** the existing marker-file dedup in `inject-patterns.sh` — no new services or state stores
- **Files in scope:** `.claude/hooks/inject-patterns.sh`, `.claude/hooks/test-inject-patterns.sh`, memory notes, CLAUDE.md (local)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- No stable per-context-window discriminator may exist in hook input; the fallback must not regress the working per-session dedup.

## Updates

### 2026-07-18

- Initial creation from harness-audit finding M1 (deferred at triage: design decision).

### 2026-07-19

- **Decision: per-context-window dedup, keyed on `session_id` + `agent_id`.** The Implementation
  Notes assumed "Claude Code exposes no per-context-window id to hooks" — that assumption was
  wrong. Investigated empirically by temporarily adding a debug line to `inject-patterns.sh`
  (`printf '%s' "$INPUT" >> /tmp/hook-debug-input.jsonl`, reverted before implementing the real
  fix) and triggering a live Write tool call from inside this todo-executor subagent. The
  captured real hook stdin (redacted — session/transcript/tool_use ids are this run's, not
  reusable):

  ```json
  {
    "session_id": "<redacted>",
    "transcript_path": "<redacted>",
    "cwd": "/Users/williamtower/projects/OCRecipes/.claude/worktrees/agent-acd6e215a4e04d6c7",
    "prompt_id": "<redacted>",
    "permission_mode": "auto",
    "agent_id": "acd6e215a4e04d6c7",
    "agent_type": "general-purpose",
    "effort": { "level": "xhigh" },
    "hook_event_name": "PreToolUse",
    "tool_name": "Write",
    "tool_input": { "file_path": "...", "content": "..." },
    "tool_use_id": "<redacted>"
  }
  ```

  `agent_id` matches this subagent's own `.claude/worktrees/agent-<id>` suffix exactly — a
  per-dispatch identifier distinct from `session_id` (which stays parent-identical, confirming
  the existing `reference_subagent_shared_session_id` memory note is still correct about the
  env-var side). This session's own edits reproduced the bug live: before the fix landed, this
  subagent's first-ever edit got the full DISCIPLINE preamble (fresh session-only dedup state);
  once the `agent_id`-qualified `DEDUP_STATE` fix was saved, the very next edit — same
  `session_id`, but now hashing to a not-yet-seen key — got the full preamble again instead of
  the "already injected" pointer, exactly reproducing and then resolving M1 in one session.

- **Known limitation (flagged in code review):** this evidence is one empirical capture from one
  Claude Code version (2.1.214) and one dispatch path (todo-executor via the `Agent` tool); there
  is no independent second consumer of `agent_id` elsewhere in the repo to cross-check against,
  and the fix cannot be verified from inside a subagent that the top-level orchestrator's own
  hook JSON genuinely omits the field (unverifiable from this vantage point). The fallback is
  fail-safe either way: `agent_id` absent ⇒ key falls back to `session_id` alone, i.e. today's
  pre-fix behavior — never worse, only potentially not-yet-fixed if a future Claude Code version
  reshapes or removes the field. See
  `docs/solutions/conventions/hook-json-agent-id-per-context-window-2026-07-19.md` for the
  codified version of this finding.
- Fixed 2 review WARNINGs (dead fixed-string conjunct in a new test assertion;
  this durable-evidence gap) and this hygiene SUGGESTION inline — see PR for the diff.
