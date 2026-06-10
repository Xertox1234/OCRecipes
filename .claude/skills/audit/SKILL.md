---
name: audit
description: Run a structured code audit with manifest tracking, per-fix verification, and pattern codification
---

You are running a structured code audit. The scope is: $ARGUMENTS (defaults to "full" if empty).

This workflow enforces finding tracking, per-fix verification, and a persistent audit trail. **Never skip steps.**

## Specialist Agent Mapping

Each audit domain maps to specialist agents in `.claude/agents/` that have deep knowledge of the project's patterns, conventions, and common pitfalls for that domain. Launch them as subagents during Phase 2 discovery.

| Audit Domain      | Primary Agent(s)                                                      | What They Check                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security`        | `security-auditor` + `ai-llm-specialist`                              | IDOR, rate limiting, JWT, SSRF, prompt injection, AI safety                                                                                                                                                                                                                                                                                             |
| `performance`     | `performance-specialist` + `database-specialist`                      | FlatList memoization, useCallback stability, streaming UI, Promise.all, N+1 queries, missing indexes                                                                                                                                                                                                                                                    |
| `data-integrity`  | `database-specialist` + `nutrition-domain-expert`                     | Soft deletes, polymorphic FK orphans, cache dedup, nutrition accuracy                                                                                                                                                                                                                                                                                   |
| `architecture`    | `architecture-specialist` + `api-specialist`                          | Service/storage layering, dependency direction, route module structure, SSE patterns, singleton init                                                                                                                                                                                                                                                    |
| `code-quality`    | `quality-specialist` + `typescript-specialist` + `testing-specialist` | Error handling, naming, type guards, Zod schemas, nav typing, test coverage gaps                                                                                                                                                                                                                                                                        |
| `camera`          | `camera-specialist` + `rn-ui-ux-specialist`                           | Permissions, scan debouncing, frame processors, lifecycle management                                                                                                                                                                                                                                                                                    |
| `accessibility`   | `accessibility-specialist` + `rn-ui-ux-specialist`                    | Modal focus trapping, VoiceOver/TalkBack announcements, touch targets, WCAG contrast, aria-invalid                                                                                                                                                                                                                                                      |
| `reliability`     | _cluster dispatch — see "Reliability Scope" below_                    | 10 failure-mode classes (config fail-fast, network resilience, idempotency, offline, persistence, auth lifecycle, deep links, boundary validation, time/units, observability) — `pre-launch` + standalone only, NOT `full`                                                                                                                              |
| `maintainability` | `code-reviewer` (with `maintainability-checklist.md` mindset)         | Structural-quality lens — missed code-judo simplifications, files crossing 600 lines, spaghetti growth into unrelated flows, thin wrappers, avoidable orchestration. Opportunity-finder, not violation-finder — overlaps with `architecture`/`code-quality` but selects different findings. `pre-launch` + `code-quality` + standalone only, NOT `full` |

**For `full` scope:** Launch **one agent invocation per structural domain row** (the 7 rows above `reliability`; 7 total). Batch in two groups — first 4 domains, then 3 — to avoid overwhelming context. The "Primary Agent(s)" column shows which agent type to use for each invocation. **When a row lists multiple agents, use the first-listed agent as the `subagent_type` and explicitly name each remaining agent's focus in the prompt body** (e.g., for `security`: "Apply both the security-auditor lens (IDOR, JWT, rate limiting, SSRF) and the ai-llm-specialist lens (prompt injection, AI safety)"). `full` does **not** include `reliability` or `maintainability`.

**For `pre-launch` scope:** Launch the 7 structural-domain invocations as for `full`, **plus** the `reliability` scope's 4 cluster dispatches (see "Reliability Scope" below), **plus** the single `maintainability` dispatch (see "Maintainability Scope" below) — 12 invocations total, batched 4+4+4.

**For named scopes:** Launch only the primary agent(s) for that domain. **Exceptions:** `reliability` is dispatched per _cluster_ (4 dispatches) — see "Reliability Scope" below. `code-quality` includes the maintainability dispatch as a parallel second perspective — see "Maintainability Scope" below.

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

## Reliability Scope (cross-cutting failure-mode lens)

`reliability` is an _operational_ lens (does the code survive bad conditions?), orthogonal to the seven _structural_ domains above. Its discovery is dispatched per **cluster** (4 dispatches), not per single domain. It is a standalone named scope and is included in `pre-launch`, but **not** in `full`.

Each cluster dispatch uses the standard discovery prompt template (see above) plus: "apply `.claude/skills/audit/reliability-checklist.md` classes [N-M]", the genuine-empty-vs-error caveat, and the reachability requirement (trace the consumer; demote latent/dead findings).

| Cluster                   | Classes | Agent(s)                                                                    |
| ------------------------- | ------- | --------------------------------------------------------------------------- |
| Server resilience         | 1-3     | `api-specialist` + `security-auditor` + `architecture-specialist`           |
| Client reliability        | 4-7     | `rn-ui-ux-specialist` + `typescript-specialist`                             |
| Cross-cutting correctness | 8-9     | `database-specialist` + `nutrition-domain-expert` + `typescript-specialist` |
| Detection / observability | 10      | `architecture-specialist` + `quality-specialist`                            |

**Human-in-the-loop:** findings in classes 3 (idempotency/money) and 6 (auth lifecycle) touch IAP/auth — never auto-fix; surface for manual, fully-verified handling per the never-delegate rule.

**Dedup note:** dedup Class 9 timezone findings against `docs/superpowers/specs/2026-05-16-timestamp-timezone-consistency-design.md` and the audit CHANGELOG before reporting — that work may already partially address the day-boundary issue.

**No new infrastructure:** reliability reuses the existing specialist agents and the existing `docs/rules/` files. It does **not** add a `reliability-specialist` agent or a `docs/rules/reliability.md`.

## Maintainability Scope (structural-quality lens — opportunity finder)

`maintainability` is a _structural_ lens (does the change make the codebase simpler or messier?), with an explicit **bias toward deletion over rearrangement**. It overlaps in target area with `architecture` and `code-quality` but has a different selection function — it flags missed simplifications and structural regressions, not pattern violations.

Adapted from Cursor's "Thermo-Nuclear Code Quality Review" skill, project-tuned (600-line file threshold rather than 1000; explicit dedup guard against sibling specialists). Standalone named scope, included in `pre-launch` and `code-quality`, but **not** in `full` — same reason `reliability` is excluded: opportunity-finders are noisier than defect-finders by design.

Dispatched as a **single invocation** (not cluster-based — the lens is one mindset, not multiple failure-mode classes). Uses the standard discovery prompt template plus: "apply `.claude/skills/audit/maintainability-checklist.md`" and an explicit dedup guard from that file. **Override the template's "specific pattern or rule being violated" bullet with "the simpler design that would replace this"** — maintainability is opportunity-finding, not violation-finding, and the template's default framing pulls the agent toward defect mode. The dispatched agent is `code-reviewer` (generalist); the checklist supplies the mindset. We reuse an existing agent rather than creating a new `maintainability-reviewer.md` — same precedent as `reliability` ("No new infrastructure"). The mindset lives in the checklist file, not in an agent persona.

**Standalone caveat:** `/audit maintainability` alone is _one_ perspective. The "two perspectives at discovery" benefit only shows up when this lens runs in parallel with structural specialists (`pre-launch` and `code-quality`). Use standalone when you want a focused structural-simplification pass without the defect lens.

**Codification routing:** maintainability findings codify to existing rules files — `docs/rules/architecture.md` (boundary/layer rules), `docs/rules/typescript.md` (type-contract rules). There is no `docs/rules/maintainability.md`. The 600-line threshold and code-judo mindset live in `.claude/skills/audit/maintainability-checklist.md`, not in a rules file (it is a review lens, not a "never do X" rule).

## Phase 1: Setup

The audit produces two classes of artifact:

- **Tracked** — code fixes, `docs/rules/` edits, `.claude/agents/` edits. These live in the worktree and ride the audit branch.
- **Gitignored** — manifest (`docs/audits/YYYY-MM-DD-<scope>.md`), `docs/audits/CHANGELOG.md` append, codified solution files (`docs/solutions/...`). These have no branch to persist on, so they live in the **main checkout** and survive when `git worktree remove` runs in Phase 9.

Phase 1 sets up both correctly.

1. **Capture the base branch** (for the Phase 9 PR base):

   ```bash
   BASE_BRANCH="$(git branch --show-current)"
   # If output is empty (detached HEAD), use: BASE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
   ```

2. **Capture the main checkout's absolute path.** Use `git rev-parse --git-common-dir`, **not** `pwd` — `pwd` resolves to wherever `/audit` was invoked from, which is wrong if it was invoked from inside another worktree. `--git-common-dir` is worktree-aware (it returns the shared `.git` regardless of which working tree you're in):

   ```bash
   MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
   ```

   > **Important:** Shell state does not persist between tool calls — each Bash call runs in a fresh shell. Record the literal output of this command (e.g. `/Users/yourname/projects/OCRecipes`) and substitute it wherever `$MAIN_CHECKOUT` appears in the steps below. Do not re-run this command in later phases; use the saved value.

3. **Create and enter the audit worktree.** All subsequent phases (Phase 2 onward) run from here:

   ```bash
   git worktree add -b "audit/$(date +%Y-%m-%d)-<scope>" .worktrees/audit-$(date +%Y-%m-%d) HEAD
   cd .worktrees/audit-$(date +%Y-%m-%d)
   ```

   Or use `EnterWorktree` if available. Substitute the audit `<scope>` (e.g. `security`) — `-b` creates the branch the Phase 9 PR will push. The worktree is removed at the end of Phase 9 (after the PR is opened, or after the final commit if no PR was opened) with:

   ```bash
   git worktree remove .worktrees/audit-YYYY-MM-DD
   ```

4. **Record the baseline** (inside the worktree, which is at HEAD of the base branch):
   - Run `npm run test:run` — note pass count
   - Run `npm run check:types` — note error count
   - Run `npm run lint` — note error/warning count

5. **Check the main checkout's CHANGELOG** for previous audit findings that may still be relevant:

   ```bash
   cat "$MAIN_CHECKOUT/docs/audits/CHANGELOG.md"
   ```

6. **Create the manifest at the main checkout's path** — `"$MAIN_CHECKOUT/docs/audits/$(date +%Y-%m-%d)-<scope>.md"` — using the template from `"$MAIN_CHECKOUT/docs/audits/TEMPLATE.md"`. Record the baseline from step 4 in the manifest header.

## Phase 2: Discovery

1. **Launch specialist agents in parallel** using the mapping table above:
   - `full`: launch one agent invocation per structural domain row (7 total) in two batches — first 4 domains, then 3. `full` does NOT include `reliability` or `maintainability`.
   - `pre-launch`: the 7 structural-domain invocations **plus** the 4 `reliability` cluster dispatches (see "Reliability Scope") **plus** the 1 `maintainability` dispatch (see "Maintainability Scope") — 12 total, batched 4+4+4
   - Named scope (e.g., `security`): launch only the primary agent(s) for that domain
   - `code-quality` scope: launch the trio (`quality-specialist + typescript-specialist + testing-specialist`) **plus** the maintainability dispatch — 2 invocations in parallel, the second perspective being the structural-quality lens
   - `reliability` scope: launch the 4 cluster dispatches from the "Reliability Scope" section (not per-domain); each prompt names the checklist classes for that cluster
   - `maintainability` scope: launch the single dispatch from the "Maintainability Scope" section. The dispatch prompt is the standard discovery template with `[DOMAIN]` = "structural maintainability" and an inlined instruction to apply `.claude/skills/audit/maintainability-checklist.md` including its dedup guard against sibling specialists
   - Use the agent prompt template from the mapping section, specifying the domain and scope
   - Each agent runs as a subagent via the Agent tool with the corresponding `.claude/agents/*.md` agent type
2. As each agent completes, **deduplicate** its findings against:
   - The previous audit's manifest (if one exists) — mark already-fixed items as `false-positive`
   - Other agents in this run — combine duplicates into single findings (agents with overlapping domains may flag the same issue)
3. For each **genuinely new finding**, verify it exists in the current code:
   - Read the file at the reported line
   - Grep for the pattern the agent flagged
   - For **symbol-level findings** (unused export, dead code, signature-change or rename impact), confirm with the LSP tool (`findReferences` / call-hierarchy), not grep — it resolves `@/` and `@shared/` aliases and avoids false "unused"/"safe to change" verdicts. See `docs/rules/lsp.md`.
   - If the code doesn't match the finding, mark `false-positive` with evidence
4. Write all verified findings to the manifest with status `open`, including which agent reported each finding

## Phase 2.5: Research

Validate the Phase 2 findings against current documentation before the user triages them. The orchestrator's training knowledge lags real-world docs by months; this phase catches stale false positives (a finding the docs contradict) and stale knowledge gaps (a current best practice no agent knew to flag).

1. **Launch `docs-researcher` agents in parallel** — one per audit domain that has at least one finding:
   - `full`: launch one `docs-researcher` per structural domain with findings, batched the same way Phase 2 batches its specialist agents (first 4 domains, then the rest)
   - `pre-launch`: as `full`, **plus** one `docs-researcher` per `reliability` _cluster_ with findings (see the `reliability` bullet below)
   - Named scope: launch one `docs-researcher` for that domain
   - `reliability` scope: launch one `docs-researcher` per _cluster_ that has findings (1-4 researchers), batched the same way
   - **Maintainability skip:** do **not** dispatch a `docs-researcher` for maintainability findings — they are structural opportunities, not library-API-driven. Mark each maintainability finding `Research` = `not-applicable` directly and skip to Phase 3 triage for those rows.
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
7. **Review the fix** using the orchestrator-dispatched model in `docs/AI_WORKFLOW.md` → Review Policy, scoped to just the files this fix touched. The finding already carries a **domain** (the specialist that discovered it), so the natural reviewer is that domain's specialist — select it from the roster (usually **1**, cap **2** if the fix genuinely spans domains; content overrides the recorded domain). **Working-tree safety:** you run inside the audit worktree but the reviewer subagent does not inherit that cwd, so capture `WORKTREE=$(git rev-parse --show-toplevel)` (+ `git rev-parse --abbrev-ref HEAD` / `--short HEAD`) and require the reviewer to use `git -C "$WORKTREE"` (not `cd`) — otherwise it diffs an empty main checkout and falsely returns "No findings". Dispatch via the Agent tool:

   ```
   Agent({
     description: "Audit fix review (<domain>): <finding ID>",
     subagent_type: "<domain specialist, e.g. security-auditor>",
     prompt: "Your ambient cwd is the main checkout, NOT the audit tree. Use `git -C \"<WORKTREE>\"` for every git command and read files at <WORKTREE>/<path>; do not cd.\n\nFirst confirm the tree: `git -C \"<WORKTREE>\" rev-parse --abbrev-ref HEAD` and `git -C \"<WORKTREE>\" rev-parse --short HEAD` must be <audit branch>/<short HEAD> — if not, STOP and report 'wrong working tree'.\n\nThen review a single audit fix through your <domain> lens — correctness, security, and OCRecipes pattern compliance.\n\nFix: <one-line fix description>\n\nRun `git -C \"<WORKTREE>\" diff HEAD -- <files this fix touched>` to see only this fix's changes; read surrounding code at <WORKTREE>/<path> and use LSP for full context. Do NOT review unchanged code.\n\nReturn findings using exactly this format:\n[CRITICAL] file:line — description\n[WARNING] file:line — description\n[SUGGESTION] file:line — description\nIf there are no issues, return exactly: No findings."
   })
   ```

   Reviewers have full tool access (LSP, file reads). Scope to the single fix so each finding is verified before you move on (Phase 6 later deepens the inspection across the whole multi-file diff). If multiple reviewers are selected, merge their findings before applying the tier rule.

   Response handling (project convention — see `CLAUDE.md` and `docs/AI_WORKFLOW.md`):
   - **CRITICAL finding**: stop the audit loop, surface to user — do not mark `verified` or move to the next finding until resolved.
   - **WARNING finding**: judgment call. **Fix inline** when the change is clearly in scope and small (a few lines, same files already touched, no new architectural decision) — then re-run steps 4–7. Otherwise **record it in the manifest's Deferred Items table** as a surfaced WARNING and continue — do NOT auto-create a todo. The user reviews the manifest at close (Phase 5) and decides which deferred items become todos. WARNING is not a mandatory blocker.
   - **SUGGESTION**: proceed — note in manifest Verification column if worth tracking for codification.

8. Update manifest:
   - Status → `verified`
   - Verification column → what you checked (e.g., "grep confirms userId param; 83/83 tests pass; security-auditor review: no findings"; for a symbol-changing fix: "findReferences shows 0 stale callers; 83/83 tests pass; review: no findings")
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

## Phase 5: Verify & Summarize

1. Run the full verification suite:
   - `npm run test:run` — all tests must pass
   - `npm run check:types` — zero errors
   - `npm run lint` — zero errors
2. Update the manifest summary table with final counts
3. Append an entry to the main checkout's CHANGELOG (`"$MAIN_CHECKOUT/docs/audits/CHANGELOG.md"`) — the worktree's copy would vanish at Phase 9
4. **Report the final summary to the user:**
   - Findings: X total (C/H/M/L breakdown)
   - Verified: N fixed with evidence
   - Deferred: M with linked todos
   - False-positive: P (agent errors or already fixed)
   - Open: should be **0** — if not, explain why
5. Report the final summary to the user — do **not** ask about committing yet. Proceed directly to Phase 6.

## Phase 6: Code Review

This phase reviews the **whole multi-file diff** — a deeper pass than Phase 3's per-fix, per-finding reviews. Audit work is one of the places where the extra token cost is justified because reviewers may need to reason across multiple files, patterns, and fix interactions that a single-fix scoped review cannot see. Dispatch per the `docs/AI_WORKFLOW.md` → Review Policy model.

1. **Select reviewers for the full diff** (per Review Policy): the relevant **domain specialists** for the union of all touched domains across the fixes, **plus** the `code-reviewer` generalist — always, here, because Phase 6's distinctive value is the cross-file + structural-quality pass that only the generalist carries. Dispatch them **in parallel** over the list of all modified files from Phase 3, giving each the one-line fix descriptions (from the manifest) for context. **Working-tree safety:** capture `WORKTREE=$(git rev-parse --show-toplevel)` in your own cwd and require every reviewer prompt (specialists and `code-reviewer` alike) to use `git -C "$WORKTREE"` for all git commands + read files at `$WORKTREE/<path>` and begin with a tree check (per Review Policy → "Working-tree safety") — do not `cd`; a subagent does not inherit this worktree's cwd and would otherwise review an empty main checkout.
   - **Domain specialists**: use the Review-Policy dispatch prompt, scoped to the modified-file set, reviewing through each lens.
   - **`code-reviewer`** (`.claude/agents/code-reviewer.md`): give it the cross-cutting instruction:

     > Report CRITICAL / HIGH / MEDIUM / LOW / PASS per file. Focus on correctness, security, and pattern compliance across files. Do not flag style preferences.
     >
     > **Additionally, apply the structural-quality approval bar** from `.claude/skills/audit/maintainability-checklist.md`. Treat as presumptive CRITICAL blockers when the fix:
     >
     > - Pushes a file from under 600 lines to over 600
     > - Adds ad-hoc branching that makes an existing flow more tangled
     > - Solves the original finding by scattering feature checks across shared code
     > - Adds a wrapper / cast / optionality layer rather than simplifying the boundary
     > - Misses an obvious code-judo move that would delete complexity rather than rearrange it
     > - Duplicates an existing canonical helper or puts logic in the wrong layer
     >
     > A fix that resolves the original finding but introduces a structural regression is **not** "verified" — flag it CRITICAL and propose the simpler design.

2. For each CRITICAL or HIGH finding: fix immediately (follow Phase 3 rules — read, fix, verify, update manifest)
3. For MEDIUM findings: use judgment — fix if quick, otherwise record in the manifest's Deferred Items table (do not auto-create a todo)
4. For LOW findings: fix if a trivial one-liner, otherwise record in the manifest's Deferred Items table
5. Re-run `npm run test:run`, `npm run check:types`, and `npm run lint` after any review fixes

## Phase 7: Commit Fixes

After code review is clean:

1. Stage all changed files: code fixes + review fixes + any new todos. (The manifest, `docs/audits/CHANGELOG.md`, and codified solution files live in the **main checkout** — `$MAIN_CHECKOUT/docs/audits/...` and `$MAIN_CHECKOUT/docs/solutions/...` — per Phase 1's setup. They are gitignored and never stage from the worktree; their persistence is by living outside the worktree, not by commit.)
2. Commit with message format:
   ```
   fix: resolve [scope] audit findings ([N] verified, [M] deferred)
   ```
   Do not push or open a PR here — pushing and PR creation happen in Phase 9.

## Phase 8: Codify (patterns, learnings & agent updates)

After fixes are committed, extract reusable knowledge inline from the audit manifest and update specialist agents with new checks.

**Important:** Codify all findings from Phase 3, including any corrections triggered by the per-fix review — this Phase 8 pass should see the complete picture.

1. Review the manifest for codification candidates. Look for:
   - **Patterns** — Fixes that established reusable approaches (used/needed in 3+ places, non-obvious, project-specific)
   - **Learnings** — Findings that revealed gotchas, bugs with interesting root causes, or security/performance lessons
   - **Code reviewer updates** — New checks the code-reviewer agent should enforce going forward
   - **Specialist agent updates** — New domain-specific checks that a specialist agent should catch in future audits
2. For each candidate, apply this decision matrix:
   - Reusable knowledge (recurring solution, gotcha, bug root cause, performance issue, security rule, etc.) → **Solution** → create one new file at `"$MAIN_CHECKOUT/docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md"` — in the main checkout, not the worktree (see Phase 1 setup). See `.claude/skills/codify/SKILL.md` Step 5 for the 7-way category routing rubric (by finding nature) and Step 6 for the body template. Do **not** append to `docs/legacy-patterns/*.md` or `docs/LEARNINGS.md` — those monoliths are a frozen archive (retired in the Phase 2 pattern-codification refactor).
   - New check needed → **Code reviewer update** → add to `.claude/agents/code-reviewer.md`
   - Domain-specific check → **Specialist agent update** → add to the relevant `.claude/agents/*.md` checklist
3. **Specialist agent update routing:** When a finding reveals a new domain-specific check, add it to the appropriate specialist agent's review checklist:

   | Finding Domain  | Update Agent(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Security        | `security-auditor.md`, `ai-llm-specialist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | Performance     | `performance-specialist.md`, `database-specialist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
   | Data integrity  | `database-specialist.md`, `nutrition-domain-expert.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | Architecture    | `architecture-specialist.md`, `api-specialist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
   | Code quality    | `quality-specialist.md`, `typescript-specialist.md`, `testing-specialist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
   | Camera/vision   | `camera-specialist.md`, `rn-ui-ux-specialist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
   | Accessibility   | `accessibility-specialist.md`, `rn-ui-ux-specialist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
   | Reliability     | route by cluster to the agents in the "Reliability Scope" table (no `reliability-specialist`); rules go to the matching existing `docs/rules/{domain}.md` (e.g. Class 8 → `typescript.md`/`database.md`, Class 9 → `database.md`, Class 6 → `security.md`) — never a new `reliability.md`                                                                                                                                                                                                                                                    |
   | Maintainability | reinforce `.claude/skills/audit/maintainability-checklist.md` itself (the mindset doc) — sharpen rule 0, the dedup guard, or the approval bar when a finding reveals a missing structural-quality lens. **Do NOT** add maintainability checks to specialist agents' checklists (they would dilute the specialist's defect focus). High-severity findings whose root cause is a "never do X" boundary or type-contract rule may also append a bullet to `docs/rules/architecture.md` or `docs/rules/typescript.md` per the Phase 5b criteria. |

4. Update the target files directly. Only codify items that are recurring, non-obvious, and project-specific. Skip standard fixes.
   - For **solutions**, create one new file at `"$MAIN_CHECKOUT/docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md"` (main checkout, not the worktree). Frontmatter per `docs/solutions/README.md`. Body per the track template (bug-track: `## Problem` / `## Symptoms` / `## Root Cause` / `## Solution` / `## Prevention` / `## Related Files` / `## See Also`; knowledge-track: `## Rule` or `## When this applies` / `## Why` / `## Examples` / `## Related Files` / `## See Also`).
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

- the per-fix domain-specialist review runs inside Phase 3, so every fix is reviewed and verified before Phase 6 (Code Review) deepens the inspection across files
- Phase 6 (Code Review) is a subagent-based audit pass over the multi-file diff; Phase 7 (Commit) follows once review is clean
- Committing before codifying keeps the fix diff clean and reviewable without docs noise
- Codification (Phase 8) happens last so the codifier sees the complete picture — all verified fixes, including any corrections triggered by the per-fix review or by the Phase 6 review
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
- **Per-fix review is not optional.** Every fix in Phase 3 must pass its selected reviewer(s) (the finding's domain specialist, per the Review Policy roster) before being marked `verified`. It catches what test-based verification misses and gives Phase 8 the full context needed for codification and agent updates.
- **Deferred is not dropped.** Findings the user explicitly chose to defer at Phase 2.5 triage get a todo (Phase 4) with priority and rationale. Surfaced WARNING/MEDIUM/LOW findings from Phases 3 and 6 stay in the manifest's Deferred Items table — they are NOT auto-filed as todos. The manifest is their record; the user decides at close whether any warrant a todo. "We'll get to it" is not a rationale.
- **The changelog is append-only.** Never edit previous entries.
- **Codification is not optional.** Every audit must run Phase 8 to extract knowledge. Do not spawn `.claude/agents/pattern-codifier.md`; codify directly from the manifest after fixes are committed.
