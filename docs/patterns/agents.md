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
