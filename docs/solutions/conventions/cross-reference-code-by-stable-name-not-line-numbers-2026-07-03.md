---
title: Cross-reference code from live comments by stable name, never by file:line ranges
track: knowledge
category: conventions
module: shared
tags: [harness, architecture, comments, documentation, cross-references, drift, maintenance, mirrors]
created: '2026-07-03'
last_updated: '2026-08-28'
---

# Cross-reference code from live comments by stable name, never by file:line ranges

## Rule

When a comment in live code points at a block in another file (a mirrored loop, a paired
gate, a counterpart config), anchor the reference by a **stable name** — a job name, step
name, function name, script path plus mode — never by line numbers.

The same failure mode shows up one level up, in live *procedural* docs: a `SKILL.md` or
agent-prompt phase that cross-references another phase's **numbered step** ("run only after
Phase 6 step 6") is a positional reference exactly like a line number — merge two steps in
that list, or split one into two, and every out-of-list reference to a step number silently
points at the wrong instruction, with nothing to catch it. Prefer naming the step by what it
*does* ("Phase 6's authoritative suite gate", "the CHANGELOG append step") over its ordinal
position, or — when the number is unavoidable because two lists must stay in lockstep — name
both the semantic anchor and the number together so a reader can tell if they've drifted
apart.

## Why

Line numbers rot silently: any insertion above the target shifts the block, nothing
detects the stale pointer, and the maintainer who follows it lands on unrelated code —
worst exactly when it matters, mid-sync of two mirrored implementations. In the PR #495
review, `# Mirror of scripts/preflight.sh:98-104` was the **only** `file.sh:NN`
cross-reference in the repo's live code (grep confirmed it is not house style), and it was
already destined to rot given preflight.sh's churn rate. Names survive edits; line numbers
survive only until the next one.

## Examples

- Bad: `# Mirror of scripts/preflight.sh:98-104 — same glob, same git-env stripping`
- Good: `# Mirror of the hook-test loop in scripts/preflight.sh (full mode) — same glob, same git-env stripping`
- Good: `scripts/preflight.sh` referencing its CI counterpart by job name — `CI's "Lint · Types · Patterns" job runs the .claude/hooks/test-*.sh suite` — a name that survives workflow-file edits.
- Bad: `.claude/skills/audit/SKILL.md` Phase 5 saying "...written only after Phase 6's authoritative suite gate (Phase 6 step 6)". When PR #867 merged two Phase 6 list items (the MEDIUM and LOW handling bullets) into one, every subsequent item shifted up by one — the suite-gate step moved from 5 to 4, the CHANGELOG-append step from 6 to 5 — and this forward reference, already ambiguous under two readings before the edit (see the code-reviewer finding on that PR), was updated to the wrong number by a mechanical "shift by one" rather than being reconciled against what it actually meant.
- Good: naming both anchor and number when they must stay in lockstep — "...written only after Phase 6's authoritative suite gate (Phase 6 step 4); the CHANGELOG append itself is Phase 6 step 5" — a reader (or the next editor) can tell from the words alone which step is which, so a future renumbering that only fixes the number and not the words still gets caught by inspection.

## Exceptions

- Point-in-time documents — `docs/solutions/` files, todos, audit reports, commit
  messages — may cite `file:line` freely: they carry a `created:` date and are read as
  evidence of a moment, not as live pointers.
- Editor-clickable `file:line` references in review output and session replies are fine;
  they are consumed immediately, not maintained.

## Related Files

- `.github/workflows/ci.yml` — "Hook self-tests" step comment (the de-rotted example)
- `.claude/skills/audit/SKILL.md` Phase 5 — the numbered-step cross-reference example above

## See Also

- [bounded CLI fetch must not comment current headroom](bounded-cli-fetch-guard-count-equals-limit-2026-07-02.md) — sibling rule: comments encoding volatile facts (headroom, counts, line numbers) rot silently
