---
title: "A pattern doc the telemetry shows as never delivered usually lost the 4-slot race, not its relevance — simulate the injector's pick over every tracked file before pruning or retagging"
track: knowledge
category: conventions
tags: [harness, pattern-injection, pg-lab, telemetry, docs-solutions]
module: shared
applies_to: [".claude/hooks/inject-patterns.sh", "scripts/pg-lab/injection-report.sh", "docs/solutions/**"]
created: 2026-10-25
---

# A never-delivered pattern doc usually lost the slot race

## Rule

Do not read `scripts/pg-lab/injection-report.sh`'s "never delivered" list as "unused, safe to prune".
First run a copy of the injector's pick logic over every tracked file and sort the docs by **why**
they were not picked. Only the "undeliverable for a fixable reason" group is worth editing.

## Why

The 2026-10-23 prune todo started from 671 of 1,022 docs never delivered in 60 days. A simulation of
`inject-patterns.sh` over all 3,312 tracked files (its picks matched the real hook) sorted them as:

| Reason | Docs |
| --- | --- |
| Lose the 4-slot race to newer docs with the same broad glob (`SOLUTIONS_PER_DOMAIN=4`) | 378 |
| Deliverable, but their files were not edited in the window | 177 |
| Fixable: dead glob, wrong tag, multi-line `applies_to`, unmapped path | 34 |
| No `applies_to` at all | 33 |
| Narrow glob, still outranked | 30 |
| Cited by name in a rules file (telemetry logs only the 4 picked refs) | 18 |

A doc that is never picked takes no room in what an edit sees, so pruning it changes nothing. Only a
hook change (more slots, or different ranking) would move the 378. The owner chose to fix the fixable
docs and record the rest (#1550, #1551: deliverable docs 429 → 475 of 1,007).

The exact-match tier is crowded too: `shared/schema.ts` is named by 40 docs, `package.json` by 15,
`server/index.ts` by 14, so a new doc naming one of those also loses to newer ones.

## Examples

- When writing a new doc, name the narrowest file its lesson belongs to in `applies_to`. A broad glob
  (`server/**`) joins the largest race.
- A process lesson with no file of its own (git, CI, zsh habits) will not be delivered by any edit.
  Keep it as searchable knowledge rather than inventing an `applies_to` for it.

## Exceptions

- A rarely edited but critical doc (a prod runbook) shows as never delivered for the "not edited"
  reason. Keep it.

## Related Files

- `.claude/hooks/inject-patterns.sh` — tiers (exact > glob > general), `SOLUTIONS_PER_DOMAIN`, `reserve_bug_slot`
- `scripts/pg-lab/injection-report.sh` — the never-delivered report
- `todos/archive/P3-2026-10-23-prune-never-injected-pattern-docs.md` — full numbers

## See Also

- [rules files stay terse](rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md) — the other half of the injection budget
