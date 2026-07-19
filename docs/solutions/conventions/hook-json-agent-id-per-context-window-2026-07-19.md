---
title: 'Claude Code hook JSON carries a per-dispatch `agent_id` — use it to key per-context-window state, not `session_id` alone'
track: knowledge
category: conventions
module: shared
tags: [hook-scripts, claude-code, session-id, agent-id, subagent, pattern-injection, dedup]
applies_to: [.claude/hooks/*.sh]
created: '2026-07-19'
---

# Claude Code hook JSON carries a per-dispatch `agent_id` — use it to key per-context-window state, not `session_id` alone

## Rule

When a hook needs to remember "have I already done X in THIS context window" (dedup markers,
first-touch payloads, once-per-agent state), key the state on `session_id` **plus** the hook
JSON's `agent_id` field when present, falling back to `session_id` alone when it is absent:

```bash
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
AGENT_ID=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null || echo "")
STATE_KEY="${SESSION}${AGENT_ID:+-agent-$AGENT_ID}"
```

Do **not** key such state on `session_id` alone. A dispatched subagent (the `Agent` tool) shares
its parent's `session_id` in both the hook JSON and the Bash `CLAUDE_CODE_SESSION_ID` env var —
verified 2026-07-17 (env-var side still holds; see the project's `reference_subagent_shared_session_id`
auto-memory note) — so `session_id` identifies the **session**, not the **context window**. A
parent orchestrator and every subagent it dispatches, including parallel siblings, all share one
`session_id`.

## When this applies

Any hook (`PreToolUse`, `PostToolUse`, `SessionStart`, …) that assembles or gates state meant to
be scoped to "this one agent's context window" — first-touch payload injection, once-per-agent
warnings, per-agent counters. It does **not** apply to state that is genuinely meant to be shared
across the whole agent tree (e.g. a worktree-contract registry, a drift-detection marker) — for
that, see the existing `reference_subagent_shared_session_id` design consequence: use an additive
registry (one entry per resource), not a single-slot file, regardless of whether `agent_id` is
folded in.

## Why

`inject-patterns.sh` deduped its injected context (a DISCIPLINE preamble + per-domain rules and
solution references) per `session_id`, on the assumption that one `session_id` corresponds to one
context window. It does not: a freshly dispatched implementer subagent's first Edit/Write shared
its parent's `session_id`, so if the parent (or a sibling subagent) had already exhausted that
session's dedup state, the fresh subagent's first-ever edit got the one-line "already injected —
re-read the file" pointer instead of the full payload it had never actually seen — silently
starving exactly the contexts doing the most editing (2026-07-18 harness-audit finding M1). The
same root cause also meant two parallel sibling subagents (e.g. `/todo`'s parallel executors, each
in its own worktree) raced on the SAME dedup file, since they too share `session_id`.

Verified empirically (2026-07-19, Claude Code 2.1.214): the hook JSON delivered to `PreToolUse`
includes a top-level `agent_id` field — absent when the calling context is the top-level session,
present and distinct per `Agent`-tool dispatch (its value matched the dispatched subagent's own
`.claude/worktrees/agent-<id>` suffix exactly). No `CLAUDE_AGENT_ID`-style Bash env var exists —
the discriminator is hook-JSON-only. Folding it into the dedup key (with a session-only fallback
when it's absent) gives every context window its own partition: a fresh `agent_id` is a fresh key
(full payload), while repeat edits from the SAME `agent_id` still dedup (pointer), preserving the
original per-session cost bound intact for the case it was designed for (one context editing many
files, e.g. a `/todo` loop).

**Caveat:** this is one empirical observation from one Claude Code version and one dispatch path
(the `Agent` tool). There is no documented guarantee the field's name, nesting, or presence is
stable across versions. The fallback is fail-safe regardless — `agent_id` absent means the key
degrades to `session_id`-only, i.e. the pre-existing (if imperfect) behavior, never worse.

## Examples

`.claude/hooks/inject-patterns.sh` (`DEDUP_STATE` construction, ~line 156-172): the marker-file
path used to gate the DISCIPLINE preamble and per-domain rules/solution-ref payloads is keyed on
`${SESSION}${AGENT_ID:+-agent-$AGENT_ID}` — see the file for the full reasoning comment.
`.claude/hooks/test-inject-patterns.sh` ("Per-context-window dedup (agent_id-qualified key)"
section): fixtures pass the same `session_id` with and without an `agent_id` to prove a
same-session/different-`agent_id` request is treated as a fresh key.

## Exceptions

- Session-less callers (no `session_id` in the hook JSON at all) already disable dedup entirely
  (`DEDUP=0`) and always get the full payload — `agent_id` is irrelevant there.
- Do not use `agent_id` as a substitute for the additive-registry pattern required for state that
  must track **multiple resources per context window** (e.g. more than one declared worktree in
  one agent's own state) — a single `agent_id`-qualified slot answers "have I done X yet," not
  "which of N resources have I registered."

## Related Files

- `.claude/hooks/inject-patterns.sh`
- `.claude/hooks/test-inject-patterns.sh`
- `todos/archive/P3-2026-07-18-inject-patterns-subagent-context-dedup.md`

## See Also

- [priority-order-context-injection-under-size-cap](../design-patterns/priority-order-context-injection-under-size-cap-2026-06-05.md)
- [mirror-inject-patterns.sh applies_to matching](mirror-inject-patterns-applies-to-with-bash-glob-not-globstar-2026-06-13.md)
