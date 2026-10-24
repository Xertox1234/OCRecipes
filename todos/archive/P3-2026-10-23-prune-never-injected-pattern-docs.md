---
title: "Prune or merge pattern docs that pattern injection never delivers"
status: done
priority: low
created: 2026-10-23
updated: 2026-10-24
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

- [x] Re-run `scripts/pg-lab/injection-report.sh --days 60` and save the never-delivered list.
- [x] For each never-delivered doc, decide: **merge** (a newer doc covers it, so fold in anything unique), **retag**
      (its `tags:` don't match the paths where its lesson applies — fix the tags), **retire** (move to
      `docs/legacy-patterns/` or delete if wrong/obsolete), or **keep** (rare but still valid, e.g. incident runbooks).
- [x] `docs/rules/lsp.md` gets a specific answer: why it never fires and whether its domain mapping in
      `scripts/lib/path-domains.ts` is missing.
- [x] Batches of ≤ 50 docs per PR so review stays one pass.
- [x] After the last batch, re-run the report. The never-delivered share is recorded in the final PR
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

### 2026-10-24 — done (#1550 + batch 2)

- **The premise did not hold.** 60-day report: 671 of 1,022 docs never delivered (telemetry covers the
  whole window; it started 2026-07-06, and `deferred` rows count as delivered). A copy of the
  injector's pick logic run over all 3,312 tracked files (its picks match the real hook) sorted them:
  177 deliverable but their files were not edited; 18 cited by name in a rules file (telemetry logs
  only the 4 picked refs, so these always show but look undelivered); 1 `docs/rules/lsp.md`; **378 lose
  the 4-slot race** to newer docs with the same broad glob; 34 undeliverable for a fixable reason; 33
  with no `applies_to`; 30 narrow-glob docs still outranked. A doc that is never delivered takes no
  room, so pruning changes nothing an edit sees. Only a hook change (more slots or different ranking)
  would; owner chose to fix the fixable docs and record the rest (2026-10-24).
- **`docs/rules/lsp.md`:** no path maps to an `lsp` domain, by design. It is a tool rule, not a path
  rule; the DISCIPLINE preamble's one-line pointer (`inject-patterns.sh`, "LSP-first … See
  docs/rules/lsp.md") is how it reaches every edit. Not a missing mapping.
- **Batch 1 (#1550, 34 docs):** mapped `server/index.ts` + `server/utils/**` (they matched no rule), 24
  retags, 2 OCR docs re-pointed at `client/lib/nutrition-ocr-parser.ts`, 3 dead
  `__tests__/**/` globs, 1 multi-line `applies_to`, 1 dead `*Modal*` glob. 20 of 34 now delivered;
  13 lose the slot race in the exact-match tier (`package.json` is named by 15 docs, `server/index.ts`
  by 14, `shared/schema.ts` by 40); 1 is an `android/**` runbook (generated, never edited), kept.
- **Batch 2 (33 docs):** 22 got an `applies_to` naming the files their body is about (2 also a tag);
  all 22 now delivered. 11 process lessons (git, CI, zsh, worktree, codify order) have no file their
  lesson belongs to and stay as searchable knowledge.
- **Final share, simulated on 3,311 files:** 475 of 1,007 solution docs can be delivered by some edit
  (was 429). 519 cannot and are not cited by a rules file; nearly all of them are the slot-cap
  population. The telemetry report will only show the change as those files get edited.
