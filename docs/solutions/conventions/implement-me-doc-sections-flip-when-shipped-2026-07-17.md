---
title: "A doc section that instructs 'implement X' must flip to 'X is shipped — extend it' in the same change that ships X"
track: knowledge
category: conventions
module: shared
tags: [documentation, skills, codification, staleness, docs-lifecycle, review]
symptoms: ["skill or rules doc still says 'implement/promote/add' something the codebase now contains", "future agent re-implements an existing shared pattern because the doc told it to", "doc snippet prescribes an approach that diverges from what actually shipped"]
created: 2026-07-17
---

# A doc section that instructs "implement X" must flip to "X is shipped — extend it" in the same change that ships X

## Rule

When a change implements something a skill, rules file, or solution doc describes as missing ("implement in…", "promote to a named…", "add a…"), the SAME change must update that doc from recipe to reference: name where X now lives, how to opt in, and replace "implement" phrasing with "extend, don't re-implement". Land both in one commit/squash so the doc is never false at any commit on main.

## Smell patterns

- A PR ships a pattern whose authoring skill/doc still carries the implementation recipe for it.
- Doc guidance ("translateX compensation") differing from the shipped approach (`transformOrigin: "left"`) because the doc predates the implementation.
- "Implement it" phrasing surviving in secondary surfaces — a mistakes table, a house rule — after the main section was flipped.

## Why

Docs that instruct implementation are read as work orders by future agents: an unflipped section directs them to duplicate a shipped shared component (or "re-promote" an existing token), and a stale recipe teaches an approach the codebase has since bettered. The flip is cheap at ship time (the author knows exactly what changed) and expensive later (it takes a review to notice, as with `/review` of PR #658 catching the interaction-feel skill's staleness against PR #660).

Verification matters: in the motivating case, a deliberate flip edit still left two residual "implement it" phrasings in secondary sections — found only by an application-check (a fresh reader asked "what would you do?"). Grep the whole doc for the pattern's name; don't just rewrite the main section.

## Examples

- PR #660: `.claude/skills/interaction-feel/SKILL.md` "Missing patterns (implement in the shared TextInput)" → "Shipped focus patterns (extend, don't re-implement)", pointing at `TextInput.tsx` / `text-input-utils.ts` / `focusTimingConfig`; the mistakes-table Fix cell and a house rule were flipped too after an application-check caught them.

## Exceptions

- A pattern shipped only partially: keep the unshipped remainder as an explicit "not yet implemented" section (PR #660 kept the error shake that way) — the flip applies per-pattern, not per-doc.

## Related Files

- `.claude/skills/interaction-feel/SKILL.md` — the motivating flip

## See Also

- [Widened status trigger, stale hardcoded copy](../logic-errors/widened-status-trigger-stale-hardcoded-copy-2026-07-16.md) — the same split-brain failure inside code: changing one surface without its companion
