---
title: "Agent-tool dispatch is turn-ending and notification-driven, not an in-turn blocking wait"
track: knowledge
category: conventions
module: shared
tags: [harness, agents, orchestration, worktree]
applies_to: [".claude/skills/**/*.md", ".claude/agents/**/*.md"]
created: '2026-08-29'
---

# Agent-tool dispatch is turn-ending and notification-driven, not an in-turn blocking wait

## Rule

An orchestrator skill (a `.claude/skills/**/SKILL.md` a live session follows) that dispatches
background agents via the Agent tool and needs to react to one finishing MUST be written around
turn-ending + re-invocation, never phrased as "wait for the next completion" — there is no
in-turn mechanism to block on an agent, and an orchestrator that tries to (polling, sleeping,
reaching for a scheduling/wakeup tool) is fighting the actual mechanism instead of using it.

When several agents can be in flight and results need to be handled one at a time as they land —
a rolling dispatcher refilling a slot the instant one frees, rather than a fixed batch waiting
for everyone — persist whatever cross-completion state the loop needs (a running set, a
remaining queue, accumulated results) to a scratch file, re-read at the start of each
re-invocation, rather than trusting conversational memory: a long-running session can have
earlier turns' context summarized away, and that state has to survive many turn boundaries
instead of one barrier per batch.

## Why

Dispatching an `Agent()` call does not block the current turn. The turn completes normally — the
orchestrator can respond to the user, or simply stop — and later, when ONE dispatched agent
finishes, the harness re-invokes the session as a NEW turn carrying that agent's result. This
happens one agent at a time: finishing agent #2 out of 4 does not wait for #1, #3, or #4. An
orchestrator's own prose describing this as "wait for the next notification" invites the wrong
mental model — an LLM following that instruction literally will try to block or poll within a
single turn, or reach for a tool built for a different purpose (e.g. a `/loop`-specific
scheduling tool, which errors outside that mode) instead of simply ending its turn and trusting
the harness to re-invoke it.

This surfaced concretely while rewriting `.claude/skills/todo/SKILL.md`'s Phase 4 from a
barrier-batch model ("dispatch up to 4, wait for the whole batch, dispatch the next batch") to a
rolling dispatcher (refill a slot the instant it frees). The design's first draft said "wait for
the next single agent-completion notification" — accurate about WHAT arrives, but wrong about
the MECHANISM: nothing in the session blocks for it, the turn simply ends and a later, separate
turn receives it. Once the loop spans potentially many turns instead of one barrier per batch,
the running/queue/results state it needs also has to survive across all of them — conversational
memory is not durable enough on its own, since this exact session's own system prompt documents
that long conversations get summarized.

## Smell patterns

- SKILL.md prose says "wait for X" about an Agent-tool dispatch, with no mention of the turn
  ending.
- An orchestrator reaches for a scheduling/wakeup tool to "wait" for a background agent instead
  of simply ending its turn.
- A rolling/incremental dispatch loop's state (running set, remaining queue, accumulated
  results) is described as something the orchestrator "keeps track of," with no persistence
  mechanism named — a bet that conversational memory will still be intact many turns later.

## Examples

`.claude/skills/todo/SKILL.md`'s "How dispatch actually resumes" note (Phase 4) states the
mechanism directly rather than implying it, and the rolling loop persists
`/tmp/todo-scheduler-state.json` (`{queue, running, results}`) on every change, re-reading it at
the start of every turn rather than trusting remembered state — the same pattern Phase 0 already
uses for its own cross-step state (`/tmp/todo-*.txt`), just as JSON instead of line-delimited
text.

## Exceptions

A `Workflow`-tool script genuinely IS different: its `agent()` calls are real JavaScript
`await`s inside one running script, so "wait for it to resolve" is the correct, literal
description there — this rule is specifically about a live interactive session (a `SKILL.md` a
session follows turn-by-turn) dispatching via the plain `Agent` tool, not about workflow scripts.

## Related Files

- `.claude/skills/todo/SKILL.md` — Phase 4 "How dispatch actually resumes" + the rolling loop
- `scripts/todo-scheduler.ts` — the pure scheduling decision this loop drives

## See Also

- [../logic-errors/documented-mirror-invariant-desyncs-when-only-one-side-is-edited-2026-08-16.md](../logic-errors/documented-mirror-invariant-desyncs-when-only-one-side-is-edited-2026-08-16.md) — a related risk when a shared file (`.claude/agents/todo-executor.md`) is read by more than one orchestrating skill with different assumptions
