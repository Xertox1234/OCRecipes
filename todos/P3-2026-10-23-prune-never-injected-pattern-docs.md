---
title: "Prune or merge pattern docs that pattern injection never delivers"
status: backlog
priority: low
created: 2026-10-23
updated: 2026-10-23
assignee:
labels: [harness, deferred, docs]
github_issue:
---

# Prune or merge pattern docs that pattern injection never delivers

## Summary

75% of the pattern corpus was not injected even once in the last 30 days. Merge duplicates and retire
docs that no edit ever triggers, so the docs that do get injected are the useful ones.

## Background

`scripts/pg-lab/injection-report.sh` (run 2026-10-23, 30-day window, corpus 1,022 docs) listed
**768 docs never delivered** in the window, including `docs/rules/lsp.md`. Injection output is capped,
so stale docs that match an edit take room from useful ones. The 2026-06-02 harness benchmark flagged the
same weakness: injected docs are a soft signal that weakens as the corpus grows.

Adds no CI time (docs only; it may slightly shorten `check-solution-frontmatter` runs).

## Acceptance Criteria

- [ ] Re-run `scripts/pg-lab/injection-report.sh --days 60` and save the never-delivered list.
- [ ] For each never-delivered doc, decide: **merge** (a newer doc covers it, so fold in anything unique), **retag**
      (its `tags:` don't match the paths where its lesson applies — fix the tags), **retire** (move to
      `docs/legacy-patterns/` or delete if wrong/obsolete), or **keep** (rare but still valid, e.g. incident runbooks).
- [ ] `docs/rules/lsp.md` gets a specific answer: why it never fires and whether its domain mapping in
      `scripts/lib/path-domains.ts` is missing.
- [ ] Batches of ≤ 50 docs per PR so review stays one pass.
- [ ] After the last batch, re-run the report. The never-delivered share is recorded in the final PR
      body (the denominator is the corpus size at that time).

## Implementation Notes

- Matching is a `^tags:` frontmatter grep (`.claude/hooks/inject-patterns.sh`). Tags must stay single-line
  inline-flow (`scripts/check-solution-frontmatter.js`).
- Retagging is often better than deleting. A doc can be valid but tagged with a domain no path maps to.
- If `path-domains.ts` changes, regenerate with `npm run build:domain-map` and
  `npm run build:copilot-instructions`.

## Scope Contract

- **Mechanisms to use:** the existing injection report, frontmatter tags, and `docs/legacy-patterns/` archive.
- **Files in scope:** `docs/solutions/**`, `docs/rules/*.md`, `docs/legacy-patterns/**`, and (only for a
  missing domain mapping) `scripts/lib/path-domains.ts` plus its generated outputs.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PG Lab database reachable (the report fails loudly otherwise).

## Risks

- A doc that's rarely triggered but critical (e.g. a prod-migration runbook) shows up as unused. Prefer `keep`
  or `retag` over deleting a doc that records a real incident.

## Updates

### 2026-10-23

- Created from the harness-effectiveness review.
