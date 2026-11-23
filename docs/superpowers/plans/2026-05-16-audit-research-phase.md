# Audit Skill Research Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a documentation-research phase (Phase 2.5) into the `/audit` skill so audit findings are validated against current docs before the user triages them.

**Architecture:** Three markdown files change. First fix a dead context7 MCP tool name in the `docs-researcher` agent. Then add a `Research` column to the audit manifest template. Then add "Phase 2.5: Research" to the audit skill — it dispatches one `docs-researcher` subagent per audit domain, each validating that domain's findings against current documentation via context7, and moves the user-facing triage gate to the end of that new phase.

**Tech Stack:** Markdown skill/agent files (`.claude/skills/`, `.claude/agents/`), audit manifest template (`docs/audits/`). No code, no automated tests — verification is by `grep` confirmation of the edited text.

---

## Why there are no test steps

All three files are markdown that drives Claude's behavior; they have no unit-test harness. Each task's verification step is a `grep` that confirms the exact edited text is present (and, where relevant, that removed text is gone). This is the honest equivalent of "run the test" for prompt/skill files.

## File Structure

| File                                | Change          | Responsibility                                                                      |
| ----------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `.claude/agents/docs-researcher.md` | Modify (Task 1) | Fix the context7 MCP tool name so the agent can actually reach the tool             |
| `docs/audits/TEMPLATE.md`           | Modify (Task 2) | Add `Research` column to the four findings tables; fix a stale phase-number heading |
| `.claude/skills/audit/SKILL.md`     | Modify (Task 3) | Add "Phase 2.5: Research"; move the triage gate out of Phase 2 into Phase 2.5       |

Tasks are ordered so the agent fix (Task 1) lands before the phase that dispatches it (Task 3). Each task is one self-contained commit. The pre-commit Kimi review gate fires only on staged `.ts`/`.tsx` files, so these markdown-only commits pass through without review.

---

### Task 1: Fix the dead context7 tool name in `docs-researcher`

The `docs-researcher` agent instructs itself to call `mcp__plugin_compound-engineering_context7__query-docs`. That tool does not exist in this environment — the context7 MCP is namespaced `plugin:context7:context7`, so the real tools are `mcp__plugin_context7_context7__query-docs` and `mcp__plugin_context7_context7__resolve-library-id`. This is the root cause of context7 being unused; it must be fixed before any phase dispatches this agent.

**Files:**

- Modify: `.claude/agents/docs-researcher.md`

- [ ] **Step 1: Locate the current text**

Run: `grep -n "compound-engineering" .claude/agents/docs-researcher.md`
Expected: one match, inside the `### Step 2: Gather Documentation` list — the line:

```
1. **Context7 MCP** (`mcp__plugin_compound-engineering_context7__query-docs`) - Preferred for library docs. Query current documentation for any dependency.
```

- [ ] **Step 2: Apply the edit**

Use the Edit tool on `.claude/agents/docs-researcher.md`.

old_string:

```
1. **Context7 MCP** (`mcp__plugin_compound-engineering_context7__query-docs`) - Preferred for library docs. Query current documentation for any dependency.
```

new_string:

```
1. **Context7 MCP** - Preferred for library docs. Call `mcp__plugin_context7_context7__resolve-library-id` to resolve a package name to its Context7 library ID, then `mcp__plugin_context7_context7__query-docs` to fetch current documentation for that dependency.
```

- [ ] **Step 3: Verify the edit landed**

Run: `grep -n "context7" .claude/agents/docs-researcher.md`
Expected: matches for both `mcp__plugin_context7_context7__resolve-library-id` and `mcp__plugin_context7_context7__query-docs`.

Run: `grep -c "compound-engineering" .claude/agents/docs-researcher.md`
Expected: `0` (the dead name is fully gone).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/docs-researcher.md
git commit -m "$(cat <<'EOF'
fix: correct dead context7 MCP tool name in docs-researcher agent

The agent referenced mcp__plugin_compound-engineering_context7__query-docs,
which does not exist. The context7 MCP is namespaced plugin:context7:context7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add the `Research` column to the audit manifest template

The manifest template's four findings tables (Critical/High/Medium/Low) need a `Research` column to hold each finding's research verdict. While in the file, fix a stale heading: `## Codification (Phase 7)` — the skill calls codification Phase 8.

**Files:**

- Modify: `docs/audits/TEMPLATE.md`

- [ ] **Step 1: Locate the current tables**

Run: `grep -n "Verification |" docs/audits/TEMPLATE.md`
Expected: four header rows, one per severity table, each currently:
`| ID  | Finding       | Domain | Agent                 | File(s)     | Status | Verification |`

- [ ] **Step 2: Update the Critical table**

Use the Edit tool on `docs/audits/TEMPLATE.md`.

old_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | ------ | ------------ |
| C1  | [description] | —      | [agent that found it] | `path:line` | open   | —            |
```

new_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Research | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | -------- | ------ | ------------ |
| C1  | [description] | —      | [agent that found it] | `path:line` | —        | open   | —            |
```

- [ ] **Step 3: Update the High table**

Use the Edit tool on `docs/audits/TEMPLATE.md`.

old_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | ------ | ------------ |
| H1  | [description] | —      | [agent that found it] | `path:line` | open   | —            |
```

new_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Research | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | -------- | ------ | ------------ |
| H1  | [description] | —      | [agent that found it] | `path:line` | —        | open   | —            |
```

- [ ] **Step 4: Update the Medium table**

Use the Edit tool on `docs/audits/TEMPLATE.md`.

old_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | ------ | ------------ |
| M1  | [description] | —      | [agent that found it] | `path:line` | open   | —            |
```

new_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Research | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | -------- | ------ | ------------ |
| M1  | [description] | —      | [agent that found it] | `path:line` | —        | open   | —            |
```

- [ ] **Step 5: Update the Low table**

Use the Edit tool on `docs/audits/TEMPLATE.md`.

old_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | ------ | ------------ |
| L1  | [description] | —      | [agent that found it] | `path:line` | open   | —            |
```

new_string:

```
| ID  | Finding       | Domain | Agent                 | File(s)     | Research | Status | Verification |
| --- | ------------- | ------ | --------------------- | ----------- | -------- | ------ | ------------ |
| L1  | [description] | —      | [agent that found it] | `path:line` | —        | open   | —            |
```

- [ ] **Step 6: Fix the stale codification heading**

Use the Edit tool on `docs/audits/TEMPLATE.md`.

old_string:

```
## Codification (Phase 7)
```

new_string:

```
## Codification (Phase 8)
```

- [ ] **Step 7: Verify all edits landed**

Run: `grep -c "Research | Status" docs/audits/TEMPLATE.md`
Expected: `4` (one updated header per severity table).

Run: `grep -n "Codification (Phase" docs/audits/TEMPLATE.md`
Expected: one match — `## Codification (Phase 8)`.

- [ ] **Step 8: Commit**

```bash
git add docs/audits/TEMPLATE.md
git commit -m "$(cat <<'EOF'
docs: add Research column to audit manifest template

Adds a Research column to the four findings tables to hold Phase 2.5
research verdicts. Also corrects a stale Phase 7 -> Phase 8 heading.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add "Phase 2.5: Research" to the audit skill and move the triage gate

Phase 2 currently ends with step 5 — the user-facing triage gate ("show the findings table, ask which to fix/defer"). That step moves to the end of the new Phase 2.5, so the user triages with research verdicts already in the manifest. A single Edit replaces Phase 2's step 5 plus the `## Phase 3` heading with the full Phase 2.5 section followed by the unchanged `## Phase 3` heading.

**Files:**

- Modify: `.claude/skills/audit/SKILL.md`

- [ ] **Step 1: Locate the Phase 2 / Phase 3 boundary**

Run: `grep -n "Show the user the complete findings table\|## Phase 3: Fix" .claude/skills/audit/SKILL.md`
Expected: two consecutive matches — Phase 2 step 5, then the `## Phase 3: Fix (one at a time)` heading a few lines below it.

- [ ] **Step 2: Replace Phase 2 step 5 with Phase 2.5**

Use the Edit tool on `.claude/skills/audit/SKILL.md`.

old_string:

```
5. **Show the user the complete findings table** and ask: "Which findings should I fix now, and which should be deferred?"

## Phase 3: Fix (one at a time)
```

new_string:

````
## Phase 2.5: Research

Validate the Phase 2 findings against current documentation before the user triages them. The orchestrator's training knowledge lags real-world docs by months; this phase catches stale false positives (a finding the docs contradict) and stale knowledge gaps (a current best practice no agent knew to flag).

1. **Launch `docs-researcher` agents in parallel** — one per audit domain that has at least one finding:
   - `full` or `pre-launch`: launch one `docs-researcher` per domain with findings, batched the same way Phase 2 batches its specialist agents (first 4 domains, then the rest)
   - Named scope: launch one `docs-researcher` for that domain
   - **Skip rule:** a domain with zero findings gets no researcher
   - Each agent runs as a subagent via the Agent tool with the `docs-researcher` agent type
2. Use this dispatch prompt for each `docs-researcher` (fill in `[DOMAIN]` and the findings list):

   ```
   You are validating audit findings for the [DOMAIN] domain against current library documentation.

   Findings to validate:
   [paste this domain's findings — for each: ID, description, file:line, the pattern/rule cited]

   For EACH finding, you MUST check current documentation: call
   `mcp__plugin_context7_context7__resolve-library-id` to resolve the relevant
   library, then `mcp__plugin_context7_context7__query-docs` to fetch its current
   docs. A verdict with no doc citation is invalid — do not rely on training knowledge.

   Return exactly one verdict per finding:
   - `confirmed` — current docs agree the finding is valid
   - `better-fix` — the finding is real, but current docs show a cleaner or different
     fix than the discovering agent assumed; describe the doc-informed approach
   - `contradicted` — current docs say the flagged pattern is fine, or the
     "deprecated" API is not deprecated; cite the doc
   - `not-applicable` — the finding does not hinge on external library/framework
     behavior (e.g. IDOR, missing userId check, N+1 query, dead code); skip it,
     no doc call needed

   Every non-`not-applicable` verdict MUST cite the specific doc retrieved (library + section).

   Additionally: if, while validating, you notice a current-doc best practice clearly
   unmet in code you ALREADY viewed, report it as a NEW finding candidate with
   file:line and the doc citation. Do not perform a broad code audit — only report
   gaps noticed incidentally.

   Do NOT fix anything. Report verdicts and any new finding candidates only.
   ```

3. As each `docs-researcher` completes, update the manifest `Research` column for each finding:
   - `confirmed` → `Research` = `confirmed`; finding stays `open`
   - `better-fix` → `Research` = `better-fix`; finding stays `open`; record the doc-informed approach in the Verification column so Phase 3 uses it
   - `contradicted` → `Research` = `contradicted ⚠`; finding stays `open` — do **not** auto-mark `false-positive`, the user decides at triage
   - `not-applicable` → `Research` = `—`
4. For each **new finding candidate** a researcher surfaced, verify it exists in the current code before adding it — same discipline as Phase 2 step 3:
   - Read the file at the reported line
   - Grep for the pattern
   - If confirmed, add it to the manifest with status `open`, `Agent` = `docs-researcher`, `Research` = `confirmed`
   - If not confirmed, discard it (do not add it to the manifest)
5. **Show the user the complete findings table** (with the `Research` column populated) and ask: "Which findings should I fix now, and which should be deferred? Note the research verdicts — `contradicted ⚠` findings may be false positives."

## Phase 3: Fix (one at a time)
````

- [ ] **Step 3: Verify the new phase landed and the triage gate moved**

Run: `grep -n "## Phase 2.5: Research" .claude/skills/audit/SKILL.md`
Expected: one match, positioned between `## Phase 2: Discovery` and `## Phase 3: Fix`.

Run: `grep -n "Show the user the complete findings table" .claude/skills/audit/SKILL.md`
Expected: exactly one match, and it is inside the Phase 2.5 section (it must no longer appear under Phase 2).

Run: `grep -n "context7" .claude/skills/audit/SKILL.md`
Expected: matches for `mcp__plugin_context7_context7__resolve-library-id` and `mcp__plugin_context7_context7__query-docs` inside the dispatch prompt.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "$(cat <<'EOF'
feat: add Phase 2.5 research to the audit skill

Inserts a documentation-research phase that dispatches one docs-researcher
per audit domain to validate findings against current docs via context7
before triage. Moves the user triage gate from Phase 2 to the end of Phase 2.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** — every spec acceptance criterion maps to a task:

- `docs-researcher.md` references only real context7 tool names → Task 1
- `SKILL.md` has a "Phase 2.5: Research" section between Phase 2 and Phase 3 → Task 3 Step 2
- Phase 2 triage step moved to end of Phase 2.5 → Task 3 Step 2 (old_string removes it from Phase 2; new_string places it as Phase 2.5 step 5)
- One `docs-researcher` per domain, parallel, Phase-2 batching, zero-finding skip rule → Task 3 Step 2, Phase 2.5 step 1
- Dispatch prompt mandates a context7 call per finding, rejects uncited verdicts → Task 3 Step 2, Phase 2.5 step 2
- Four verdicts documented with manifest effects → Task 3 Step 2, Phase 2.5 steps 2–3
- Opportunistic new findings routed through Phase 2 current-code verification → Task 3 Step 2, Phase 2.5 step 4
- `TEMPLATE.md` `Research` column in all four tables + Phase 7→8 heading fix → Task 2

**Placeholder scan** — the `[DOMAIN]` and `[paste this domain's findings ...]` tokens inside the dispatch prompt are intentional fill-in slots for the audit operator at runtime, not plan placeholders; they are the literal content the skill must contain. No "TBD"/"implement later"/"add error handling" placeholders exist.

**Consistency** — verdict names (`confirmed`, `better-fix`, `contradicted`, `not-applicable`), the `Research` column name, and the tool names (`mcp__plugin_context7_context7__resolve-library-id`, `mcp__plugin_context7_context7__query-docs`) are identical across Tasks 1–3 and match the spec. The `contradicted ⚠` manifest value (with the warning glyph) is consistent between Task 2's column-value description and Task 3's step 3.
