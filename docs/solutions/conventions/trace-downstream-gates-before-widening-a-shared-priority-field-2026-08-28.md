---
title: Before widening what auto-files by severity, trace every gate that already reads that same field
track: knowledge
category: conventions
module: shared
tags: [harness, workflow, automation, todo, priority, policy]
applies_to: [".claude/skills/**", ".claude/agents/**", "scripts/todo-automerge-guard.sh"]
created: '2026-08-28'
---

# Before widening what auto-files by severity, trace every gate that already reads that same field

## Rule

Before editing a policy that decides which severities get filed, checked, or otherwise
admitted into a system — even a pure-prose edit to a document like `CLAUDE.md` — grep for
every OTHER place that already keys a decision off the same field. A field that looks like
a single input to one decision may already be a shared input to a second, independent
decision with a different consequence.

## Why

`CLAUDE.md`'s "Deferred Item Todos" rule decides which severities get auto-filed as a todo
(previously Low only; a pending change proposed widening it to Medium+Low, moving the
human-prompt gate to High/Critical). That reads like a pure documentation change — it
governs what an agent writes to `todos/`, nothing else.

But `scripts/todo-automerge-guard.sh`, `.claude/agents/todo-executor.md`, and
`.claude/skills/todo/SKILL.md` (its `MERGE_ELIGIBLE` reporting enum) already read the SAME
`priority:` frontmatter field to decide something else entirely: whether a todo's PR is
allowed to auto-merge unattended. All three treated `low` and `medium` identically
(`case "$prio" in low|medium) : ;;`) — a historical accident of how the auto-merge lane was
originally scoped, unrelated to the auto-file policy being edited. Widening the auto-file
tier to include Medium, with zero code changes anywhere, would have proportionally grown the
population of PRs merging without human review — the exact opposite of what the auto-file
change was trying to achieve (more scrutiny on real findings, not less).

The coupling was invisible from the CLAUDE.md diff alone. It only surfaced because the
planning phase explicitly asked "what else reads `priority:` as a gate?" before touching the
prose — not because the todo proposing the change anticipated it (though its own acceptance
criteria did flag the auto-merge guard as worth checking, which is what prompted the trace).

## Examples

- Bad: edit `CLAUDE.md`'s severity threshold, ship it, and only later notice PRs are
  auto-merging that nobody meant to auto-merge.
- Good: before editing, run `grep -rn "priority" scripts/ .claude/agents/ .claude/skills/`
  (or the equivalent for whatever field is being widened) and read every hit's *consequence*,
  not just whether it restates the same rule. A restatement needs updating to match; a
  **different decision keyed off the same field** needs a deliberate, separate call — carve
  it out, accept the coupling, or decouple the fields — made by whoever owns the policy, not
  silently inherited from the prose edit.
- Good: when the deliberate call is "carve it out" (this repo's actual choice — Medium was
  removed from the auto-merge lane in the same change that added it to the auto-file lane),
  make the code change and the policy change land together, in the dependency order that
  matters: land the code narrowing FIRST, the widened policy SECOND — otherwise there's a
  window where the old code still auto-merges what the new policy just started auto-filing.

## Exceptions

- A field genuinely used by only one decision doesn't need this trace — the risk is
  specifically when a field is read by more than one gate that evolved independently.
- If the two decisions are meant to always move together (by design, not accident), document
  that coupling explicitly at both read sites so a future editor doesn't have to rediscover
  it by tracing greps.

## Related Files

- `CLAUDE.md` → "Deferred Item Todos"
- `scripts/todo-automerge-guard.sh` (the `case "$prio" in low) : ;;` gate)
- `.claude/agents/todo-executor.md` (Step 10's routing bullets)
- `.claude/skills/todo/SKILL.md` (the `MERGE_ELIGIBLE` reporting enum)

## See Also

- [documented mirror invariant desyncs when only one side is edited](../logic-errors/documented-mirror-invariant-desyncs-when-only-one-side-is-edited-2026-08-16.md) — sibling rule: a rule that must hold across two sites doesn't hold itself just because it's written down
- [relaxing a shared contract requires auditing its dependents](relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — same principle in a different domain: enumerate consumers of a shared precondition before loosening it, whether the "contract" is a TS union or a YAML frontmatter field
