---
name: audit
description: Run a structured code audit with manifest tracking, per-fix verification, and pattern codification
---

You are running a structured code audit. The scope is: $ARGUMENTS (defaults to "full" if empty).

This workflow enforces finding tracking, per-fix verification, and a persistent audit trail. **Never skip steps.**

## Phase 1: Setup

1. Record the current baseline:
   - Run `npm run test:run` — note pass count
   - Run `npm run check:types` — note error count
   - Run `npm run lint` — note error/warning count
2. Check `docs/audits/CHANGELOG.md` for previous audit findings that may still be relevant
3. Create a new manifest file: `docs/audits/YYYY-MM-DD-[scope].md` using the template from `docs/audits/TEMPLATE.md`
4. Record the baseline in the manifest header

## Phase 2: Discovery

1. Launch specialized audit agents **in parallel** based on scope:
   - `full` or `pre-launch`: all 5 domains (security, performance, data-integrity, architecture, code-quality)
   - Named scope: only the matching domain(s)
2. As each agent completes, **deduplicate** its findings against:
   - The previous audit's manifest (if one exists) — mark already-fixed items as `false-positive`
   - Other agents in this run — combine duplicates into single findings
3. For each **genuinely new finding**, verify it exists in the current code:
   - Read the file at the reported line
   - Grep for the pattern the agent flagged
   - If the code doesn't match the finding, mark `false-positive` with evidence
4. Write all verified findings to the manifest with status `open`
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

## Phase 7: Codify (patterns & learnings)

After fixes are committed, extract reusable knowledge using the pattern-codifier agent (`.claude/agents/pattern-codifier.md`).

1. Review the manifest for codification candidates. Look for:
   - **Patterns** — Fixes that established reusable approaches (used/needed in 3+ places, non-obvious, project-specific)
   - **Learnings** — Findings that revealed gotchas, bugs with interesting root causes, or security/performance lessons
   - **Code reviewer updates** — New checks the code-reviewer agent should enforce going forward
2. For each candidate, apply the pattern-codifier's decision matrix:
   - Recurring solution → **Pattern** → add to appropriate `docs/patterns/*.md` file
   - Bug/gotcha/unexpected behavior → **Learning** → add to `docs/LEARNINGS.md`
   - New check needed → **Code reviewer update** → add to `.claude/agents/code-reviewer.md`
3. Run the pattern-codifier as a subagent with this prompt structure:
   ```
   Review the audit manifest at docs/audits/[manifest-file].md.
   For each verified fix, determine if it should be codified as a pattern,
   learning, or code reviewer update. Follow the workflow in
   .claude/agents/pattern-codifier.md. Only codify items that meet the
   criteria (recurring, non-obvious, project-specific). Skip standard fixes.
   ```
4. Review the codifier's output and apply changes to docs
5. Commit documentation separately:
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
