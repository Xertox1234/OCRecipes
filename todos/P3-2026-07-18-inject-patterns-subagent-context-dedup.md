---
title: "Injection session-dedup starves subagent context windows of first-touch payloads"
status: backlog
priority: low
created: 2026-07-18
updated: 2026-07-18
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

- [ ] A written decision: per-context-window dedup, per-session with forced re-injection on subagent spawn, or accept-and-document the pointer-mitigation status quo
- [ ] If dedup keying changes: `.claude/hooks/test-inject-patterns.sh` covers the subagent-first-touch case (fresh key ⇒ full payload)
- [ ] `MEMORY.md`/memory note `reference_subagent_shared_session_id` updated to reflect the decision
- [ ] CLAUDE.md Key Patterns paragraph stays accurate

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
