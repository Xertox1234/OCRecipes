---
title: Grep-verify single-ownership after a source-of-truth consolidation — prose merges leave copies that have already diverged
track: knowledge
category: best-practices
module: shared
tags: [consolidation, deduplication, single-source-of-truth, refactor, review-checklist, drift, agents, skills]
applies_to: [.claude/agents/**/*.md, .claude/skills/**/*.md, docs/**/*.md]
created: '2026-07-02'
---

# Grep-verify single-ownership after a source-of-truth consolidation — prose merges leave copies that have already diverged

## When this applies

Any change that claims to reduce duplication to a single home: merging N reviewer
agents into M<N, extracting a shared helper and deleting the inline copies, unifying a
config, or declaring "this table is now the single source of truth; other surfaces
point here." The claim is an **invariant the diff asserts but nothing enforces** — for
prose/docs there is no compiler to reject a re-stated rule, and for code a leftover
copy still compiles. Verify it mechanically before you believe it.

## Smell patterns

- A PR description says "content now lives in exactly one file" / "other surfaces are
  pointers now" — treat that as a claim to test, not a fact.
- A hand-merge of several source files into one target (union-of-checklists,
  dedupe-by-eye). The eye misses near-verbatim restatements.
- Two files that each carry the "same" rule where one has picked up a later edit
  (a newer audit-date citation, an added edge-case paragraph) and the other has not.
- A routing/lookup table restated inline in a second file "for convenience" instead of
  a pointer to the one canonical table.

## Why

Deduplication is only real if each distinctive unit has exactly one home. A prose merge
does not give you that automatically — it gives you a plausible-looking union in which
copies can survive, and copies do not merely risk *future* drift: a hand-merge can ship
them **already diverged in the same PR**. In the #490 reviewer-roster consolidation
(15→5), the singleton-cache-init rule was merged into two new files; only one copy
carried the later `2026-06-25` reset/rebuild extension, so the "duplicate" was stale on
arrival. "Are the copies identical today?" is the wrong test (they can be, and still
drift tomorrow, and here one already had). The right test is "**how many homes does this
unit have?**" — the answer must be one.

The mechanical check: for each distinctive, load-bearing token — a rule sentence, an
audit-date citation, a function/identifier name — grep the target set and require
exactly one match file.

```bash
# each of these must print exactly ONE file
grep -ln "parseInt(req.userId" .claude/agents/*.md
grep -ln "initPromise" .claude/agents/*.md
grep -ln "accessibilityViewIsModal" .claude/agents/*.md
```

A token that lands in two files is either an undeleted copy (delete the wrong one) or a
legitimately shared concept that should live in one owner with the other file pointing at
it. When the unit is a table or routing map, the fix is a **pointer, not a paraphrase** —
a restated table is the very duplication the consolidation claimed to remove.

## Examples

- **#490 roster consolidation** — after the merge, single-ownership spot-checks
  (`parseInt` / singleton-init / premium-gate-parity / `accessibilityViewIsModal` /
  `expo-camera` each → exactly one agent file) caught rules duplicated across
  `code-reviewer` and the domain reviewers; the fix trimmed the baseline and moved each
  rule to its one owner.
- **LSP block** — 9 verbatim copies across agent files collapsed to a one-line pointer
  at `docs/rules/lsp.md`; the cop script that policed the 9 copies for drift was then
  deletable because there was nothing left to drift.
- **Routing tables done right** — the domain→reviewer map lives once in
  `.claude/skills/codify/SKILL.md` Step 2/Step 5; `audit/SKILL.md` and
  `todo-executor.md` carry pointers, not copies.

## Exceptions

- Intentional independent copies that legitimately may differ (a client and a server
  constant that are allowed to diverge) are fine — but then they are **not** "a single
  source of truth" and must not be described as one. If two copies must stay in lockstep
  but genuinely cannot share a file, add a drift-check test; do not rely on review.

## Related Files

- `.claude/agents/` — the 5-reviewer roster (`code-reviewer`, `server-reviewer`,
  `mobile-reviewer`, `ai-reviewer`, `security-auditor`) produced by the #490 merge
- `.claude/skills/codify/SKILL.md` — Step 2/Step 5 canonical routing table (single home)
- `docs/rules/lsp.md` — single home for the LSP guidance the agent files point at

## See Also

- [../conventions/machine-routed-values-need-enum-not-prose-2026-07-02.md](../conventions/machine-routed-values-need-enum-not-prose-2026-07-02.md) — a routing table keyed on a vocabulary owned by another file is the drift this checklist catches
- [../conventions/agent-file-edits-take-effect-on-reload-not-save-2026-07-02.md](../conventions/agent-file-edits-take-effect-on-reload-not-save-2026-07-02.md) — verifying a consolidated agent roster is complicated by when agent-file edits actually load
