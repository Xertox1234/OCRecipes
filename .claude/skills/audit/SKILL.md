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
- The specific pattern or rule being violated (reference docs/solutions/, docs/rules/, or docs/legacy-patterns/ where applicable)

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
   git worktree add -b "audit/$(date +%Y-%m-%d)-<scope>" .worktrees/audit-$(date +%Y-%m-%d) HEAD
   ```
   Or use `EnterWorktree` if available. All phases run from this worktree. The worktree is removed at the end of Phase 9 (after the PR is opened, or after the final commit if no PR was opened) with:
   ```bash
   git worktree remove .worktrees/audit-YYYY-MM-DD
   ```
   (in the create command, substitute the audit `<scope>` — e.g. `security` — and note `-b` creates the branch the Phase 9 PR will push; replace `YYYY-MM-DD` with the date suffix used when creating it)

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
   - For **symbol-level findings** (unused export, dead code, signature-change or rename impact), confirm with the LSP tool (`findReferences` / call-hierarchy), not grep — it resolves `@/` and `@shared/` aliases and avoids false "unused"/"safe to change" verdicts. (`kimi-review` / `kimi-multi-review` are an external model with no LSP access; this applies to Claude-driven verification only.) See `docs/rules/lsp.md`.
   - If the code doesn't match the finding, mark `false-positive` with evidence
4. Write all verified findings to the manifest with status `open`, including which agent reported each finding

## Phase 2.5: Research

Validate the Phase 2 findings against current documentation before the user triages them. The orchestrator's training knowledge lags real-world docs by months; this phase catches stale false positives (a finding the docs contradict) and stale knowledge gaps (a current best practice no agent knew to flag).

1. **Launch `docs-researcher` agents in parallel** — one per audit domain that has at least one finding:
   - `full` or `pre-launch`: launch one `docs-researcher` per domain with findings, batched the same way Phase 2 batches its specialist agents (first 4 domains, then the rest)
   - Named scope: launch one `docs-researcher` for that domain
   - **Skip rule:** a domain with zero findings gets no researcher; if Phase 2 produced no findings at all, skip Phase 2.5 entirely
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
     no doc call needed. Also use `not-applicable` when a finding concerns custom
     project code with no resolvable Context7 library.

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
   - For **symbol-level candidates** (unused export, dead code, signature-change or rename impact), confirm with the LSP tool (`findReferences` / call-hierarchy), not grep — it resolves `@/` and `@shared/` aliases and avoids false "unused"/"safe to change" verdicts. Same rationale as Phase 2 step 3. See `docs/rules/lsp.md`.
   - If confirmed, add it to the manifest with status `open`, `Agent` = `docs-researcher`, `Research` = `confirmed`
   - If not confirmed, discard it (do not add it to the manifest)
5. **Show the user the complete findings table** (with the `Research` column populated) and ask: "Which findings should I fix now, and which should be deferred? Note the research verdicts — `contradicted ⚠` findings may be false positives."

## Phase 3: Fix (one at a time)

For **each** finding the user wants fixed:

1. Update manifest status to `fixing`
2. Read the relevant code. For a **symbol-changing fix** (rename, signature change, removing or altering an exported symbol), first map the blast radius with the LSP tool (`findReferences` / call-hierarchy), not grep, so the fix reaches every call site across `routes → services → storage → db`. See `docs/rules/lsp.md`.
3. Make the fix (minimal, surgical — no drive-by improvements)
4. Run the targeted tests for the affected files
5. If tests fail, fix until they pass
6. **Verify** the fix landed:
   - Grep/read the fixed code to confirm the change is present
   - For a **symbol-changing fix**, re-run `findReferences` to confirm the change propagated to every call site with no stale callers or dangling references — grep can miss alias-resolved usages.
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

   Response handling (project convention — see `CLAUDE.md` and `docs/AI_WORKFLOW.md`):
   - **CRITICAL finding**: stop the audit loop, surface to user — do not mark `verified` or move to the next finding until resolved.
   - **WARNING finding**: judgment call. **Fix inline** when the change is clearly in scope and small (a few lines, same files already touched, no new architectural decision) — then re-run steps 4–7. Otherwise **record it in the manifest's Deferred Items table** as a surfaced WARNING and continue — do NOT auto-create a todo. The user reviews the manifest at close (Phase 5) and decides which deferred items become todos. WARNING is not a mandatory blocker.
   - **SUGGESTION**: proceed — note in manifest Verification column if worth tracking for codification.

8. Update manifest:
   - Status → `verified`
   - Verification column → what you checked (e.g., "grep confirms userId param; 83/83 tests pass; kimi-review: no findings"; for a symbol-changing fix: "findReferences shows 0 stale callers; 83/83 tests pass; kimi-review: no findings")
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
3. For MEDIUM findings: use judgment — fix if quick, otherwise record in the manifest's Deferred Items table (do not auto-create a todo)
4. For LOW findings: fix if a trivial one-liner, otherwise record in the manifest's Deferred Items table
5. Re-run `npm run test:run` and `npm run check:types` after any review fixes

## Phase 7: Commit Fixes

After code review is clean:

1. Stage all changed files: code fixes + review fixes + any new todos. (The manifest and `docs/audits/CHANGELOG.md` are gitignored/local-only — they will not stage; keep them updated in the working tree but expect them absent from the commit and PR.)
2. Commit with message format:
   ```
   fix: resolve [scope] audit findings ([N] verified, [M] deferred)
   ```
   Do not push or open a PR here — pushing and PR creation happen in Phase 9.

## Phase 8: Codify (patterns, learnings & agent updates)

After fixes are committed, extract reusable knowledge inline from the audit manifest and update specialist agents with new checks.

**Important:** Codify all findings from Phase 3, including any corrections triggered by kimi-review — this Phase 8 pass should see the complete picture.

1. Review the manifest for codification candidates. Look for:
   - **Patterns** — Fixes that established reusable approaches (used/needed in 3+ places, non-obvious, project-specific)
   - **Learnings** — Findings that revealed gotchas, bugs with interesting root causes, or security/performance lessons
   - **Code reviewer updates** — New checks the code-reviewer agent should enforce going forward
   - **Specialist agent updates** — New domain-specific checks that a specialist agent should catch in future audits
2. For each candidate, apply this decision matrix:
   - Reusable knowledge (recurring solution, gotcha, bug root cause, performance issue, security rule, etc.) → **Solution** → create one new file at `docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md`. See `.claude/skills/codify/SKILL.md` Step 5 for the 7-way category routing rubric (by finding nature) and Step 6 for the body template. Do **not** append to `docs/legacy-patterns/*.md` or `docs/LEARNINGS.md` — those monoliths are a frozen archive (retired in the Phase 2 pattern-codification refactor).
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
   - For **solutions**, create one new file at `docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md`. Frontmatter per `docs/solutions/README.md`. Body per the track template (bug-track: `## Problem` / `## Symptoms` / `## Root Cause` / `## Solution` / `## Prevention` / `## Related Files` / `## See Also`; knowledge-track: `## Rule` or `## When this applies` / `## Why` / `## Examples` / `## Related Files` / `## See Also`).
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

- kimi-review runs per-fix inside Phase 3, so every fix is reviewed and verified before Phase 6 (Code Review) deepens the inspection across files
- Phase 6 (Code Review) is a subagent-based audit pass over the multi-file diff; Phase 7 (Commit) follows once review is clean
- Committing before codifying keeps the fix diff clean and reviewable without docs noise
- Codification (Phase 8) happens last so the codifier sees the complete picture — all verified fixes, including any corrections triggered by kimi-review or by the Phase 6 review
- If codification reveals issues, the fixes are already safely committed

## Phase 9: Push & Open PR

After the fix commit (Phase 7) and the codification commit (Phase 8) both exist on the audit branch:

1. **Ask the user:** "Push the audit branch and open a PR?" If no, leave the work local and skip to step 6 (worktree removal) — done.
2. **Push the branch:**
   ```bash
   git push -u origin audit/YYYY-MM-DD-<scope>
   ```
   (use the branch created in Phase 1 step 6 — substitute the real date and scope)
3. **Create the PR.** The GitHub MCP tools are deferred — first load them with `ToolSearch` (query: `select:mcp__github__create_pull_request,mcp__github__list_pull_requests`), then call `mcp__github__create_pull_request` with:
   - `owner`: `Xertox1234`
   - `repo`: `OCRecipes`
   - `base`: the branch captured in Phase 1 step 5 (usually `main`)
   - `head`: `audit/YYYY-MM-DD-<scope>`
   - `body`: the template below
4. **If PR creation fails** because a PR already exists for the branch, call `mcp__github__list_pull_requests` (`state: open`) and match the PR whose head branch is `audit/YYYY-MM-DD-<scope>`. If found, use its URL. If no open PR is found or the lookup fails for any other reason, report that no PR URL is available — the branch is pushed and the PR can be opened manually.
5. **Report the PR URL** in the final summary.
6. **Remove the audit worktree** (run from the main repo root, not inside the worktree):
   ```bash
   git worktree remove .worktrees/audit-YYYY-MM-DD
   ```

**Audit PR body template** — fill inline from the manifest. The manifest itself is **gitignored/local-only** (`docs/audits/` is in `.gitignore`), so it is never in the repo: do NOT link it — the body must be self-contained.

```
## Summary
[scope] audit — N findings fixed, M deferred to todos. No regressions.

## Fixed
- <one line per verified finding (ID + file)>

## Deferred
- <one line per deferred finding + its todo path, or "none">

🤖 Generated by Claude Code /audit skill
```

## Rules

- **The manifest is the source of truth.** Every finding must be in it. Every status change must be recorded.
- **Zero open findings at close.** Everything is either verified, deferred (with todo), or false-positive.
- **No documentation during the fix phase.** Fix code first (Phases 3-6). Codify patterns only after the fix commit in Phase 8.
- **kimi-review is not optional.** Every fix in Phase 3 must pass kimi-review before being marked `verified`. It catches what test-based verification misses and gives Phase 8 the full context needed for codification and agent updates.
- **Deferred is not dropped.** Findings the user explicitly chose to defer at Phase 2.5 triage get a todo (Phase 4) with priority and rationale. Surfaced WARNING/MEDIUM/LOW findings from Phases 3 and 6 stay in the manifest's Deferred Items table — they are NOT auto-filed as todos. The manifest is their record; the user decides at close whether any warrant a todo. "We'll get to it" is not a rationale.
- **The changelog is append-only.** Never edit previous entries.
- **Codification is not optional.** Every audit must run Phase 8 to extract knowledge. Do not spawn `.claude/agents/pattern-codifier.md`; codify directly from the manifest after fixes are committed.
