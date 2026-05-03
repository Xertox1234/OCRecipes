---
name: audit
description: Run a structured code audit with manifest tracking, per-fix verification, and pattern codification
---

You are running a structured code audit. The scope is: $ARGUMENTS (defaults to "full" if empty).

This workflow enforces finding tracking, per-fix verification, and a persistent audit trail. **Never skip steps.**

## Specialist Agent Mapping

Each audit domain maps to specialist agents in `.claude/agents/` that have deep knowledge of the project's patterns, conventions, and common pitfalls for that domain. Launch them as subagents during Phase 2 discovery.

| Audit Domain     | Primary Agent(s)                                                      | What They Check                                                                                      |
| ---------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `security`       | `security-auditor` + `ai-llm-specialist`                              | IDOR, rate limiting, JWT, SSRF, prompt injection, AI safety                                          |
| `performance`    | `performance-specialist` + `database-specialist`                      | FlatList memoization, useCallback stability, streaming UI, Promise.all, N+1 queries, missing indexes |
| `data-integrity` | `database-specialist` + `nutrition-domain-expert`                     | Soft deletes, polymorphic FK orphans, cache dedup, nutrition accuracy                                |
| `architecture`   | `architecture-specialist` + `api-specialist`                          | Service/storage layering, dependency direction, route module structure, SSE patterns, singleton init |
| `code-quality`   | `quality-specialist` + `typescript-specialist` + `testing-specialist` | Error handling, naming, type guards, Zod schemas, nav typing, test coverage gaps                     |
| `camera`         | `camera-specialist` + `rn-ui-ux-specialist`                           | Permissions, scan debouncing, frame processors, lifecycle management                                 |
| `accessibility`  | `accessibility-specialist` + `rn-ui-ux-specialist`                    | Modal focus trapping, VoiceOver/TalkBack announcements, touch targets, WCAG contrast, aria-invalid   |

**For `full` or `pre-launch` scopes:** Launch agents for all domains (batch in groups of 4 — e.g., four batches: 4, 4, 4, 3 — not all at once).

**For named scopes:** Launch only the primary agent(s) for that domain.

**Agent prompt template for discovery:**

```
You are auditing the OCRecipes codebase for [DOMAIN] issues.

Scope: [files/modules to focus on, or "full codebase"]

For each finding, report:
- A concise description of the issue
- The exact file path and line number(s)
- Severity: Critical / High / Medium / Low
- The specific pattern or rule being violated (reference docs/patterns/ where applicable)

Do NOT fix anything — only report findings. Do NOT report issues that are already handled correctly.
Focus on genuinely new issues, not style preferences.
```

## Phase 1: Setup

1. Record the current baseline:
   - Run `npm run test:run` — note pass count
   - Run `npm run check:types` — note error count
   - Run `npm run lint` — note error/warning count
2. Check `docs/audits/CHANGELOG.md` for previous audit findings that may still be relevant
3. Create a new manifest file: `docs/audits/YYYY-MM-DD-[scope].md` using the template from `docs/audits/TEMPLATE.md`
4. Record the baseline in the manifest header

## Phase 2: Discovery

1. **Launch specialist agents in parallel** using the mapping table above:
   - `full` or `pre-launch`: launch agents for all domains (batch in groups of 4 — e.g., four batches: 4, 4, 4, 3 — to avoid overwhelming context)
   - Named scope (e.g., `security`): launch only the primary agent(s) for that domain
   - Use the agent prompt template from the mapping section, specifying the domain and scope
   - Each agent runs as a subagent via the Agent tool with the corresponding `.claude/agents/*.md` agent type
2. As each agent completes, **deduplicate** its findings against:
   - The previous audit's manifest (if one exists) — mark already-fixed items as `false-positive`
   - Other agents in this run — combine duplicates into single findings (agents with overlapping domains may flag the same issue)
3. For each **genuinely new finding**, verify it exists in the current code:
   - Read the file at the reported line
   - Grep for the pattern the agent flagged
   - If the code doesn't match the finding, mark `false-positive` with evidence
4. Write all verified findings to the manifest with status `open`, including which agent reported each finding
5. **Show the user the complete findings table** and ask: "Which findings should I fix now, and which should be deferred?"

## Phase 3: Fix (one at a time)

For **each** finding the user wants fixed:

1. Update manifest status to `fixing`
2. Read the relevant code
3. Make the fix (minimal, surgical — no drive-by improvements)
4. Run the targeted tests for the affected files
5. If tests fail, fix until they pass
6. **Verify** the fix landed:
   - Grep/read the fixed code to confirm the change is present
   - Run the specific test file(s) to confirm they pass
7. Update manifest:
   - Status → `verified`
   - Verification column → what you checked (e.g., "grep confirms userId param; 83/83 tests pass")
8. Move to the next finding

**CRITICAL RULES:**

- Fix ONE finding at a time. Do not batch.
- Never mark `verified` without running tests.
- Never mark `verified` based on "I just wrote the code" — re-read the file to confirm.
- If a fix requires changing test mocks, that's part of the fix — don't skip it.

## Phase 4: Defer

For findings the user wants deferred:

1. Create a todo in `todos/` following the template convention
2. Update manifest status to `deferred` with link to the todo file
3. Record the rationale in the Deferred Items table

## Phase 5: Close

1. Run the full verification suite:
   - `npm run test:run` — all tests must pass
   - `npm run check:types` — zero errors
   - `npm run lint` — zero errors
2. Update the manifest summary table with final counts
3. Append an entry to `docs/audits/CHANGELOG.md`
4. **Report the final summary to the user:**
   - Findings: X total (C/H/M/L breakdown)
   - Verified: N fixed with evidence
   - Deferred: M with linked todos
   - False-positive: P (agent errors or already fixed)
   - Open: should be **0** — if not, explain why
5. Ask the user if they want to commit the **code fixes** now (before codification)

## Phase 6: Commit Fixes

If the user says yes:

1. Stage all changed files (code fixes + manifest + changelog + any new todos)
2. Commit with message format:
   ```
   fix: resolve [scope] audit findings ([N] verified, [M] deferred)
   ```
3. Ask if the user wants to push

## Phase 7: Codify (patterns, learnings & agent updates)

After fixes are committed, extract reusable knowledge using the pattern-codifier agent (`.claude/agents/pattern-codifier.md`) and update specialist agents with new checks.

1. Review the manifest for codification candidates. Look for:
   - **Patterns** — Fixes that established reusable approaches (used/needed in 3+ places, non-obvious, project-specific)
   - **Learnings** — Findings that revealed gotchas, bugs with interesting root causes, or security/performance lessons
   - **Code reviewer updates** — New checks the code-reviewer agent should enforce going forward
   - **Specialist agent updates** — New domain-specific checks that a specialist agent should catch in future audits
2. For each candidate, apply the pattern-codifier's decision matrix:
   - Recurring solution → **Pattern** → add to appropriate `docs/patterns/*.md` file
   - Bug/gotcha/unexpected behavior → **Learning** → add to `docs/LEARNINGS.md`
   - New check needed → **Code reviewer update** → add to `.claude/agents/code-reviewer.md`
   - Domain-specific check → **Specialist agent update** → add to the relevant `.claude/agents/*.md` checklist
3. **Specialist agent update routing:** When a finding reveals a new domain-specific check, add it to the appropriate specialist agent's review checklist:

   | Finding Domain | Update Agent(s)                                                              |
   | -------------- | ---------------------------------------------------------------------------- |
   | Security       | `security-auditor.md`, `ai-llm-specialist.md`                                |
   | Performance    | `performance-specialist.md`, `database-specialist.md`                        |
   | Data integrity | `database-specialist.md`, `nutrition-domain-expert.md`                       |
   | Architecture   | `architecture-specialist.md`, `api-specialist.md`                            |
   | Code quality   | `quality-specialist.md`, `typescript-specialist.md`, `testing-specialist.md` |
   | Camera/vision  | `camera-specialist.md`, `rn-ui-ux-specialist.md`                             |
   | Accessibility  | `accessibility-specialist.md`, `rn-ui-ux-specialist.md`                      |

4. Run the pattern-codifier as a subagent with this prompt structure:

   ```
   Review the audit manifest at docs/audits/[manifest-file].md.
   For each verified fix, determine if it should be codified as a pattern,
   learning, code reviewer update, or specialist agent update.
   Follow the workflow in .claude/agents/pattern-codifier.md.
   Only codify items that meet the criteria (recurring, non-obvious,
   project-specific). Skip standard fixes.

   For specialist agent updates, add new checklist items to the "Review
   Checklist" section of the appropriate agent in .claude/agents/.
   Also add entries to the "Common Mistakes to Catch" section if the
   finding represents a recurring mistake pattern.
   ```

5. Review the codifier's output and apply changes to docs and agents
6. Commit documentation separately:
   ```
   docs: codify patterns and learnings from [scope] audit
   ```

**Why codification is a separate phase:**

- Code fixes are urgent and should not be delayed by documentation
- The manifest provides a clean, verified input for the codifier (no guessing what was fixed)
- Separate commits keep the fix diff reviewable without docs noise
- If codification reveals issues, the fixes are already safely committed

## Rules

- **The manifest is the source of truth.** Every finding must be in it. Every status change must be recorded.
- **Zero open findings at close.** Everything is either verified, deferred (with todo), or false-positive.
- **No documentation during the fix phase.** Fix code first (Phases 3-6). Codify patterns after (Phase 7).
- **Deferred is not dropped.** Deferred items must have a todo with priority and rationale. "We'll get to it" is not a rationale.
- **The changelog is append-only.** Never edit previous entries.
- **Codification is not optional.** Every audit must run Phase 7 to extract knowledge. But it happens AFTER fixes ship.
