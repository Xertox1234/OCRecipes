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

**For `full` or `pre-launch` scopes:** Launch **one agent invocation per domain row** (7 total). Batch in two groups — first 4 domains, then 3 — to avoid overwhelming context. The "Primary Agent(s)" column shows which agent type to use for each invocation; list both agents in the prompt when two are shown.

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
5. Capture the current branch:
   ```bash
   git branch --show-current
   # If output is empty (detached HEAD), use: git rev-parse --abbrev-ref HEAD
   ```
6. Create and enter an audit worktree — all subsequent phases run from it:
   ```bash
   git worktree add .worktrees/audit-$(date +%Y-%m-%d) HEAD
   ```
   Or use `EnterWorktree` if available. All Phases 2–6 run from this worktree. After the Phase 6 commit, remove it with:
   ```bash
   git worktree remove .worktrees/audit-YYYY-MM-DD
   ```
   (replace `YYYY-MM-DD` with the date suffix used when creating it)

## Phase 2: Discovery

1. **Launch specialist agents in parallel** using the mapping table above:
   - `full` or `pre-launch`: launch one agent invocation per domain row (7 total) in two batches — first 4 domains, then 3
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
7. **kimi-review** the fix — run from the audit worktree root:

   ```bash
   kimi-review --scope "[one-line fix description]" --patterns [domain]
   ```

   Domain → `--patterns` mapping:

   | Finding Domain | `--patterns` value |
   | -------------- | ------------------ |
   | security       | `security`         |
   | performance    | `performance`      |
   | data-integrity | `database`         |
   | architecture   | `architecture`     |
   | code-quality   | `typescript,api`   |
   | camera / RN-UX | `react-native`     |
   | accessibility  | `react-native`     |

   Response handling:
   - **CRITICAL finding**: stop the audit loop, surface to user — do not mark `verified` or move to the next finding until resolved
   - **WARNING finding**: return to step 3 for the kimi-review finding, then re-run steps 4–7
   - **SUGGESTION**: proceed — note in manifest Verification column if worth tracking for codification

8. Update manifest:
   - Status → `verified`
   - Verification column → what you checked (e.g., "grep confirms userId param; 83/83 tests pass; kimi-review: no findings")
9. Move to the next finding

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
4. For low/deferred items that are straightforward boilerplate or test-only work with clear files and acceptance criteria, use `kimi-write` to generate a first pass — review the output before committing. For items requiring human judgment or broad architecture decisions, leave the todo local and note the rationale clearly in the Deferred Items table.

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
5. Report the final summary to the user — do **not** ask about committing yet. Proceed directly to Phase 6.

## Phase 6: Code Review

This phase intentionally keeps the deeper subagent-based review path. Audit work is one of the places where the extra token cost is justified because the reviewer may need to reason across multiple files, patterns, and fix interactions. Use `kimi-review` as the cheaper default in repetitive implementation workflows, but keep this audit pass as a deep inspection gate.

1. Run the code-reviewer subagent (`.claude/agents/code-reviewer.md`) with:
   - The list of all modified files from Phase 3
   - A one-line description of each fix (copy from the manifest)
   - The instruction: "Report CRITICAL / HIGH / MEDIUM / LOW / PASS per file. Focus on correctness, security, and pattern compliance. Do not flag style preferences."
2. For each CRITICAL or HIGH finding: fix immediately (follow Phase 3 rules — read, fix, verify, update manifest)
3. For MEDIUM findings: use judgment — fix if quick, defer with todo if non-trivial
4. For LOW findings: defer unless trivial one-liners
5. Re-run `npm run test:run` and `npm run check:types` after any review fixes

## Phase 7: Commit Fixes

After code review is clean:

1. Stage all changed files (code fixes + review fixes + manifest + changelog + any new todos)
2. Commit with message format:
   ```
   fix: resolve [scope] audit findings ([N] verified, [M] deferred)
   ```
3. Ask if the user wants to push

## Phase 8: Codify (patterns, learnings & agent updates)

After fixes are committed, extract reusable knowledge inline from the audit manifest and update specialist agents with new checks.

**Important:** Codify all findings from Phase 3, including any corrections triggered by kimi-review — this Phase 8 pass should see the complete picture.

1. Review the manifest for codification candidates. Look for:
   - **Patterns** — Fixes that established reusable approaches (used/needed in 3+ places, non-obvious, project-specific)
   - **Learnings** — Findings that revealed gotchas, bugs with interesting root causes, or security/performance lessons
   - **Code reviewer updates** — New checks the code-reviewer agent should enforce going forward
   - **Specialist agent updates** — New domain-specific checks that a specialist agent should catch in future audits
2. For each candidate, apply this decision matrix:
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

4. Update the target files directly. Only codify items that are recurring, non-obvious, and project-specific. Skip standard fixes.
   - For **patterns**, extend the relevant `docs/patterns/*.md` file with a concise rule, rationale, and an example or constraint when useful.
   - For **learnings**, add an entry to `docs/LEARNINGS.md` describing the root cause and the practical takeaway.
   - For **code reviewer updates**, add checklist items to `.claude/agents/code-reviewer.md` and update `Common Mistakes to Catch` when the issue reflects a recurring review gap.
   - For **specialist agent updates**, add checklist items to the appropriate `.claude/agents/*.md` file and update `Common Mistakes to Catch` when the finding represents a repeatable failure mode.
5. Review the codification diff for accuracy and scope. Keep it limited to the reusable knowledge extracted from the audit.
   5b. **Rules routing**: For each codified finding that was CRITICAL or HIGH severity, evaluate whether it warrants a `docs/rules/{domain}.md` entry. Criteria — all three must be true:
   - It is a "never do X" class (not a preference or style choice)
   - It can be stated in one bullet line
   - The domain has a corresponding `docs/rules/{domain}.md` file

   The domain name is the rules file basename (e.g., `Security` → `docs/rules/security.md`, `Accessibility` → `docs/rules/accessibility.md`). All 13 domain files exist: `api`, `architecture`, `database`, `security`, `react-native`, `accessibility`, `design-system`, `hooks`, `client-state`, `typescript`, `performance`, `testing`, `ai-prompting`. If a rule entry is warranted, append the bullet to the matching file and include it in the codification commit.

6. Commit documentation separately:
   ```
   docs: codify patterns and learnings from [scope] audit
   ```

**Why the order is fix → commit → codify:**

- kimi-review runs per-fix inside Phase 3, so every fix is reviewed and verified before it reaches Phase 6 (Commit)
- Committing before codifying keeps the fix diff clean and reviewable without docs noise
- Codification happens last so the codifier sees the complete picture — all verified fixes, including any corrections triggered by kimi-review
- If codification reveals issues, the fixes are already safely committed

## Rules

- **The manifest is the source of truth.** Every finding must be in it. Every status change must be recorded.
- **Zero open findings at close.** Everything is either verified, deferred (with todo), or false-positive.
- **No documentation during the fix phase.** Fix code first (Phases 3-6). Codify patterns only after the fix commit in Phase 8.
- **kimi-review is not optional.** Every fix in Phase 3 must pass kimi-review before being marked `verified`. It catches what test-based verification misses and gives Phase 8 the full context needed for codification and agent updates.
- **Deferred is not dropped.** Deferred items must have a todo with priority and rationale. "We'll get to it" is not a rationale.
- **The changelog is append-only.** Never edit previous entries.
- **Codification is not optional.** Every audit must run Phase 8 to extract knowledge. Do not spawn `.claude/agents/pattern-codifier.md`; codify directly from the manifest after fixes are committed.
