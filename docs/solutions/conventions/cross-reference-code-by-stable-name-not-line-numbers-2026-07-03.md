---
title: Cross-reference code from live comments by stable name, never by file:line ranges
track: knowledge
category: conventions
module: shared
tags: [comments, documentation, cross-references, drift, maintenance, mirrors]
created: '2026-07-03'
---

# Cross-reference code from live comments by stable name, never by file:line ranges

## Rule

When a comment in live code points at a block in another file (a mirrored loop, a paired
gate, a counterpart config), anchor the reference by a **stable name** — a job name, step
name, function name, script path plus mode — never by line numbers.

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

## Exceptions

- Point-in-time documents — `docs/solutions/` files, todos, audit reports, commit
  messages — may cite `file:line` freely: they carry a `created:` date and are read as
  evidence of a moment, not as live pointers.
- Editor-clickable `file:line` references in review output and session replies are fine;
  they are consumed immediately, not maintained.

## Related Files

- `.github/workflows/ci.yml` — "Hook self-tests" step comment (the de-rotted example)

## See Also

- [bounded CLI fetch must not comment current headroom](bounded-cli-fetch-guard-count-equals-limit-2026-07-02.md) — sibling rule: comments encoding volatile facts (headroom, counts, line numbers) rot silently
