---
title: "Three prose docs still describe the harness tag alternation as `worktree`-only after the `worktrees?` widen"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness, docs]
github_issue:
---

# Three prose docs still describe the harness tag alternation as `worktree`-only

## Summary

`P2-2026-08-13-injection-glob-tier-ranked-by-date-not-specificity` widened `domain_tag_pattern()`'s
harness alternation (both in `.claude/hooks/inject-patterns.sh` and its mirror in
`scripts/check-solution-frontmatter.js`) from `worktree` to `worktrees?`. Three prose docs still
describe the alternation as accepting only the literal `worktree`, understating the actual
capability.

## Background

Surfaced by the round-2 code-reviewer pass on that todo's PR. Not a correctness bug — the code is
more permissive than the docs claim, so no reader is misled into thinking something works when it
doesn't, only the reverse (undersold capability) — but worth a cleanup pass since one of the three
(`SKILL.md`) is read on every `/codify` invocation.

## Acceptance Criteria

- [ ] `.claude/skills/codify/SKILL.md` — update the harness-alternation description to include the
      plural form
- [ ] `docs/solutions/README.md` — same
- [ ] `docs/solutions/conventions/merging-corpus-docs-must-union-routing-metadata-2026-08-10.md` —
      same
- [ ] Wording matches what `scripts/check-solution-frontmatter.js`'s own error message now says:
      `worktree(s)`

## Implementation Notes

Each doc currently reads something like `"tooling"/"pg-lab"/"worktree"/"agents" all select the
harness pool` — change `worktree` to `worktree(s)` (or `worktrees?`, whichever reads more
naturally in context) in each of the three locations.

## Scope Contract

- **Mechanisms to use:** prose edit only — no code, no frontmatter schema change
- **Files in scope:** `.claude/skills/codify/SKILL.md`, `docs/solutions/README.md`,
  `docs/solutions/conventions/merging-corpus-docs-must-union-routing-metadata-2026-08-10.md`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The code-side widening (PR from `P2-2026-08-13-injection-glob-tier-ranked-by-date-not-specificity`) is the fix this cleans up prose after.

## Risks

- None — cosmetic doc accuracy only.

## Updates

### 2026-08-16

- Filed from the round-2 code-reviewer SUGGESTION on the injection glob-tier ranking PR.
