# /todo Skill Hardening — Targeted Gates

## Overview

Five surgical gates that close known gaps in the `/todo` workflow (`.claude/skills/todo/SKILL.md` + `.claude/agents/todo-executor.md` + `.claude/agents/todo-researcher.md`). The redesign keeps the existing phase structure intact and adds gates where they catch failure modes nothing else does.

Three additional gates were considered and rejected because their failure modes were already covered elsewhere; their rationale is recorded in the "Dropped — rejected gates" section so the analysis isn't lost.

Each gate is independently mergeable. Ship order is in the final section.

---

## Gate 1 — LSP warm-up

### Problem

The TypeScript LSP server returns degraded results on the first symbol-navigation query of a session (`findReferences` often returns only the definition). Both the executor and researcher do symbol work — both can hit this. Today neither warms the server, so a small fraction of runs silently get bad reference data and the agent makes downstream decisions on it.

### Design

Add a mandatory throwaway `hover` call as the first LSP-using action in each agent.

- **Executor:** Append to Step 0 — after the worktree assertion, before Step 1 (Parse). The hover targets `client/constants/theme.ts:210` (`withOpacity`), the project's canonical stable symbol.
- **Researcher:** Append to Step 1 — after library detection, before Step 2 (Gather context). Same target.

The hover result is discarded. Its only purpose is to prime tsserver.

### Failure path

If the LSP tool is unavailable in the session (e.g., subagent without LSP access), log "LSP unavailable — skipping warm-up" and proceed. The gate must never block the agent.

### Key decision: stable target

`client/constants/theme.ts:210 withOpacity` is the documented warm-up symbol (SessionStart hook references it). Using the canonical target avoids the warm-up itself failing because the chosen symbol moved.

---

## Gate 3 — Per-todo advisor pre-check

### Problem

The executor jumps from Research directly into Implementation. `kimi-review` at Step 6 reviews the _diff_, not the _approach_. If the research brief recommends a flawed approach (subtly wrong API, misread project pattern, stale solution reused), the executor writes code on top of the bad approach and the review catches only diff-level issues — not the architectural mismatch.

### Design

A new Step 3.5 in the executor, between Research (Step 3) and Implement (Step 4).

The executor calls the `advisor` tool with this exact context:

- Todo body: Acceptance Criteria, Implementation Notes, Risks
- The research brief (or the verified-solution citation if Step 3 short-circuited)
- The `verified_solutions` note from Step 3a (max 3 entries, one-line each)
- Affected file paths (paths only — not their content)

Source file contents are explicitly **not** sent. The advisor reviews the _approach_, not the code. Code-level review remains kimi-review's job at Step 6.

The advisor returns one of three structured outcomes:

| Outcome  | Format                      | Executor behavior                                                                                                      |
| -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GREEN`  | bare token                  | Proceed. Nothing recorded.                                                                                             |
| `YELLOW` | `YELLOW: <one-line reason>` | Proceed. Add reason to `DEFERRED_WARNINGS` for Phase 5.                                                                |
| `RED`    | `RED: <one-line reason>`    | Return `blocked: advisor red-flag: <reason>`. Orchestrator surfaces in Phase 5 summary. User re-runs after addressing. |

### Failure path

If the advisor tool is not available in the subagent's environment, skip Step 3.5 entirely and proceed to Step 4. Never block on advisor unavailability — the gate is value-add, not load-bearing.

### Key decision: YELLOW vs RED tier split

Two tiers would have been simpler (advisory/blocking) but loses signal: many concerns are real but not show-stoppers. A flat "blocking" gate would either fire too often (annoying) or be tuned so loose it never fires (useless). The three-tier split lets advisor flag concerns without hijacking the run while still preserving a true emergency brake.

### Key decision: paths only, no source content

Sending source file contents would balloon the prompt and tempt the advisor into code-level critique that's kimi-review's job. The advisor here is checking whether the _plan_ makes sense, given what the executor knows from the brief.

### Cost

One advisor call per todo. With 4-parallel batches firing roughly simultaneously, net wall-clock impact is ~10-15s per batch. Token cost scales linearly with todo count but the per-call payload is small (brief + acceptance criteria, no source).

---

## Gate 5 — Codify durability + review

### Problem

Two coupled bugs in Step 9 codification surfaced during the parallel `/audit` skill review (see [`2026-05-30-audit-skill-review-findings-plan.md`](2026-05-30-audit-skill-review-findings-plan.md) Finding 1):

1. **Codify writes to a doomed location.** `kimi-write` generates the file at `docs/solutions/<category>/<slug>.md` inside the executor's worktree. `docs/solutions/` is gitignored (`.gitignore:95`), so two things happen: (a) `git add docs/solutions/...` silently no-ops because git refuses to stage gitignored files by default, leaving the codify commit empty; (b) the file lives only in the worktree, and `git worktree remove` in orchestrator Phase 5 destroys it. The result: codifications never reach the main checkout, and Step 3a's "verified solution read-back" finds nothing the user didn't author by hand.

2. **No review gate before kimi-write output lands.** Even if (1) were fixed, kimi-write output goes straight to commit with no human eye on it. Future executors short-circuit research onto these files; bad codification poisons future runs.

The original Gate 5 design addressed (2) only. Both must be fixed together — sanity-checking a file that's about to vanish doesn't help.

### Design

Fix the destination first, then run the sanity checks against the durable copy.

**Step A — Pin codify destination to the main checkout.** The `/todo` orchestrator's Phase 1 (Baseline) captures `MAIN_CHECKOUT` using the same worktree-aware command the `/audit` skill now uses:

```bash
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
```

The orchestrator passes `MAIN_CHECKOUT` to each executor via the spawn prompt (a new `Main checkout:` line alongside the existing `Base branch:` line). Executor Step 9 writes the codified solution to `"$MAIN_CHECKOUT/docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md"`, not the worktree's `docs/solutions/`. Remove the `git add` / `git commit` for the codify file — it was always a no-op for gitignored paths; the file's persistence comes from living outside the worktree, not from a commit.

**Step B — Two sanity checks against the durable copy.** After kimi-write writes to `$MAIN_CHECKOUT/docs/solutions/...`, the executor performs two checks:

1. **Frontmatter completeness:** Re-read the file (from `$MAIN_CHECKOUT/docs/solutions/...`). Verify every required field per `docs/solutions/README.md` (`name`, `description`, `applies_to`, `tags`, `last_updated`, plus track-specific fields).
2. **Related-files validity:** Extract every backtick-quoted path from `## Related Files`. `test -e` each one resolved relative to `$MAIN_CHECKOUT`. All must exist.

If either check fails, **delete the file from main** (`rm "$MAIN_CHECKOUT/docs/solutions/..."`) and log `codification rejected — <reason>`. The file must be physically removed; leaving a half-baked codification in the corpus poisons future short-circuits at Step 3a — which is exactly the failure mode this gate exists to prevent.

### Failure path

A rejected codification is recorded in the executor's Step 11 report as `CODIFICATION_COMMIT: rejected — <reason>`. The orchestrator's Phase 5 summary surfaces rejections so the user can decide whether to author the solution doc manually.

### Key decision: codify produces no commit

Since `docs/solutions/` is gitignored, codify produces no commit. Earlier drafts of this Gate mentioned "the codify commit" — that framing was inherited from the broken Step 9 and never actually worked. The fix removes the misleading commit step from Step 9 entirely and replaces "commit codification" with "write to main checkout, run checks, done." Codification persists by living outside the worktree, not by riding the todo branch.

### Key decision: coupled to orchestrator Phase 1 change

This gate cannot ship without the orchestrator-level `MAIN_CHECKOUT` capture. Ship order within Gate 5:

1. Orchestrator Phase 1 captures `MAIN_CHECKOUT`; spawn prompt carries it to executors.
2. Executor Step 9 writes to `$MAIN_CHECKOUT/docs/solutions/...` and drops the no-op git add/commit.
3. Add the two sanity checks against the durable copy.

Each is a separate commit; the third (the checks) is the only one that needs the review-gate framing.

### Key decision: two checks only, not a content review

The two structural checks catch the most damaging failure modes (broken frontmatter, dangling file references) without requiring another agent call to subjectively review prose quality. A deeper content review would be expensive and judgment-based — adding another kimi or advisor call to babysit kimi-write defeats the point of codification.

---

## Gate 7 — Researcher tool-reference audit

### Problem

[todo-researcher.md:49-50, 84-90](.claude/agents/todo-researcher.md#L49-L90) instructs the researcher to call tools named `github_text_search`, `github_repo`, and `mcp_github_search_code`. None of these match the `mcp__github__*` pattern that CLAUDE.md, MEMORY.md, and the rest of the project use. Two failure modes:

1. **Tools don't exist in the environment** (verified — `ToolSearch` for these names returned no GitHub tools in this session) → researcher silently produces "No related issues or code patterns found in this repo." regardless of whether anything exists.
2. **GitHub MCP not loaded for this session** (intermittent — the MCP token is in `~/.zshenv`; sessions started outside a terminal lose it per MEMORY.md) → same silent degradation, but the correctly-named `mcp__github__*` tools would at least be discoverable for an audit.

### Design

Three edits to [todo-researcher.md](.claude/agents/todo-researcher.md):

1. **Rename tool references** at lines 49-50 and 84-90 to the `mcp__github__*` pattern. The actual tool names to use (load schemas via `ToolSearch` at runtime): `mcp__github__search_code`, `mcp__github__search_issues`, `mcp__github__search_repositories`. (The exact names need verification at implementation time by running `ToolSearch select:mcp__github__search_code,mcp__github__search_issues,mcp__github__search_repositories` and reading the returned schemas.)

2. **Add ToolSearch preamble** mirroring the Context7 pattern at line 59. Before Turn 1 of Step 2, instruct the researcher to load the GitHub MCP tool schemas. If `ToolSearch` returns no GitHub tools, the MCP server isn't loaded — skip 2b and 2c entirely and write `No repo or global search performed — GitHub MCP not available in this session.` in Project Context and Global Patterns.

3. **Document the failure mode** in a new "When GitHub MCP is unavailable" subsection so future readers understand what triggers the graceful degradation.

### Failure path

When GitHub MCP is unavailable, the researcher continues — only the repo and global search are skipped. Context7 library lookups (Step 2a) are independent and still run. The brief includes the explicit "not available" placeholder so the executor knows the gap.

### Key decision: detect at runtime, not at agent file authoring

Hard-coding "GitHub MCP is available" would require updating the agent file every time MCP availability changes. Runtime detection via `ToolSearch` is robust to session-by-session variation.

---

## Gate 8 — Phase 2 todo-quality check

### Problem

The executor and researcher both invest expensive turns on a todo before noticing it has no Acceptance Criteria, empty Implementation Notes, or no file references. A poorly-written todo can run all the way through Research, Step 3.5 advisor, and into Implementation before failing because the spec was incoherent.

This is the upstream version of "Acceptance Criteria ARE the plan" — if there are no acceptance criteria, the executor has no contract to satisfy.

### Design

Orchestrator addition to Phase 2 (Triage). After parsing each todo's frontmatter and body, run three quality checks:

1. **Acceptance Criteria empty:** No `- [ ]` checkbox lines in the section, or the section is missing entirely.
2. **Implementation Notes thin:** Section body (excluding the heading) shorter than 50 characters.
3. **No file references:** Body contains no path matching the patterns in Phase 3's file-extraction (`path/to/file.ts`, line-ranged paths, or backtick-quoted paths).

Add a "Quality" column to the Phase 2 work-queue table. Values: `OK`, or comma-separated flag list (`empty-AC`, `thin-IN`, `no-files`).

**Default behavior:** Any todo with at least one flag is dropped from this run's queue. Listed in the Phase 5 summary under "Skipped — quality flags" so the user knows what was dropped and why.

### Failure path

Not applicable — Gate 8 is a queue filter, not an agent call. It cannot fail.

### Key decision: default-skip rather than prompt

User watches the run but the brainstorming clarification ("Watching — I sit through the run") doesn't mean every gate should pause for approval. Default-skip + summary list is lighter ceremony and the user can re-author flagged todos and re-run. Adding a per-flagged-todo prompt would bloat Phase 2.

### Key decision: thresholds (50 chars, no-checkbox, no-paths) are heuristics

These thresholds catch the obvious-bad cases without false-positiving well-written todos. They will need tuning. The initial thresholds err on the side of conservative — better to occasionally skip a well-written todo than to admit a broken one.

---

## Dropped — rejected gates

Three candidates that didn't make the cut. Recording them here so the analysis isn't repeated.

### Inter-batch verification (`npm run test:run` between Phase 4 batches)

**Why dropped:** Each executor's worktree branches from `BASE_BRANCH` at spawn time. `BASE_BRANCH` is captured in Phase 1 and nothing on the orchestrator side writes to it during a run (PRs land via human merge, after the /todo run ends). So batch N+1's executors see the same baseline as batch N's — there is no shared state for one batch to corrupt for the next. Each executor's Step 5 already verifies its own branch is green before committing.

The gate would catch nothing the existing per-executor Step 5 doesn't, at a cost of ~2-3 minutes per batch.

### Advisor re-check on Phase 4 failures

**Why dropped:** The Phase 3 file-overlap analysis is computed once from the queue. An executor failing doesn't introduce new overlaps in the remaining queue — it only shrinks the queue. So the advisor would re-evaluate the same overlap data with fewer todos. No new input means no new judgment.

If a failure suggested the failed todo's _neighbors in its batch_ might also be misclassified, that would be a signal worth re-reviewing — but the failure modes that produce that signal (a misread file-overlap) would have triggered at Phase 3 already.

### Researcher pattern injection

**Why dropped:** The executor already loads `docs/rules/<domain>.md` and the first 80 lines of `docs/legacy-patterns/<domain>.md` via Step 3b's file-path mapping. If the researcher's brief recommends an approach that violates a rule the executor knows, the executor course-corrects at Step 4. The cost is a one-step indirection: the researcher might describe "this is how the repo does X" without knowing X is forbidden, but the executor catches it.

The argument _for_ keeping it was that the brief would be cleaner if the researcher knew the rules upfront. But cleaner briefs aren't worth a new injection mechanism, and the rules already auto-inject via the `inject-patterns.sh` hook when the executor writes — which is the moment they matter most.

---

## Implementation phasing

Ship independently in this order. Each PR is self-contained.

1. **Gate 7 (researcher tool audit)** — pure bug fix, no behavior change for working callers. Smallest blast radius. Run `ToolSearch select:mcp__github__search_code,mcp__github__search_issues,mcp__github__search_repositories` first to confirm exact tool names.
2. **Gate 1 (LSP warm-up)** — two-line addition to both agent files. No interaction with other gates.
3. **Gate 8 (Phase 2 quality check)** — orchestrator-only change. New "Quality" column in the work-queue display.
4. **Gate 5 (codify durability + review)** — three sub-commits coupled by the `MAIN_CHECKOUT` capture (same pattern the `/audit` skill now uses):
   - (a) Orchestrator Phase 1 captures `MAIN_CHECKOUT` and passes it to executors via the spawn prompt.
   - (b) Executor Step 9 writes codifications to `$MAIN_CHECKOUT/docs/solutions/...` and drops the no-op `git add`/`git commit` for gitignored paths.
   - (c) Add the two structural sanity checks (frontmatter completeness, related-files validity) against the durable file in main.
5. **Gate 3 (per-todo advisor pre-check)** — largest design surface. Ship last so the simpler gates are settled and we can observe the advisor signal in isolation.

Each step's PR includes a one-line addition to the /todo skill's own changelog (or `docs/LEARNINGS.md` if the user prefers) so the workflow's evolution is traceable.

---

## Out of scope

- **Splitting the executor into Planner + Implementer agents.** Considered as Approach 2 during brainstorming; rejected as not justified without a specific failure pattern.
- **Front-loading mass research at the orchestrator level.** Approach 3 during brainstorming; same rationale.
- **Replacing kimi-review with advisor at Step 6.** kimi-review's diff-level review remains. Advisor adds approach-level review at Step 3.5 — they are complementary, not redundant.
- **Per-todo PR review gates.** PR review is a downstream human concern; /todo's job ends at PR creation.
- **Changing the 4-parallel cap.** Current cap is fine for system resources; gate redesign doesn't affect it.
- **Re-architecting Phase 0 cleanup.** Phase 0 is already robust per the SKILL.md design; gates don't touch it.
