---
title: "When a todo's Implementation Notes contradict its Acceptance Criteria, the criteria win — scope the mechanism to the path the criteria allow and record the reconciliation in the todo"
track: knowledge
category: conventions
module: shared
tags: [harness, agents, tooling, todos]
applies_to: ["todos/**/*.md", ".claude/agents/todo-executor.md", ".claude/skills/todo*/**"]
created: '2026-09-22'
---

# When a todo's Implementation Notes contradict its Acceptance Criteria, the criteria win — scope the mechanism to the path the criteria allow and record the reconciliation in the todo

## Rule

A todo's **Acceptance Criteria** are its contract; **Implementation Notes** are its author's best
guess at the mechanism. When following the notes literally would fail a criterion, implement the
criterion, not the note — and write one Updates bullet saying which note was overridden, why,
and what shape the mechanism took instead. Never edit the criteria to match the note, and never
leave the contradiction unmentioned for the reviewer to rediscover.

## Smell patterns

- A note that says "unconditionally", "whatever X looks like", "in every case" next to a
  criterion that lists a control which must keep its current behaviour.
- An implementation that satisfies the note and then needs a special case to keep the
  criterion's control green.
- A reviewer asking why the mechanism is narrower than the note said, with no answer in the todo.

## Why

The stamp-writer P1 (`todos/archive/P1-2026-09-22-stamp-writer-takes-contract-bearing-text-over-its-own-objection.md`)
said in its notes: compute whether any hand-back carries an objection and, if so, "exit 0 without
writing, whatever `$MSG` looks like". Its criterion 3 required that one objection hand-back behind
a plain WRAPPER keep recording `verdict: findings`. Those cannot both hold: the unconditional
check swallows the wrapper path's only honest record. The criterion is the contract the user
signed off; the note was an over-generalisation of the shape that mattered (the contract-bearing
text path, where the transcript had never been consulted). Scoping the new guard to that path
satisfied every criterion, and the Updates entry recorded the choice so the reviewer could check
it instead of re-deriving it.

The alternative — implementing the note and then patching the criterion's control — produces a
mechanism nobody specified, with a special case that reads as a bug to the next reader.

## Examples

- **Do:** "The notes said X; criterion N requires Y; X violates Y on input Z; implemented Y-shaped
  mechanism M; the control for Z is case K." — one bullet under Updates, dated.
- **Do:** treat a note that names a specific line number or code shape as a hint that may have
  rotted since filing; verify the shape before building on it.
- **Don't:** tick the criterion and move on because the note was followed.
- **Don't:** rewrite the criterion to fit the mechanism. If the criterion is genuinely wrong,
  that is a decision for the person who filed it — surface it, do not resolve it silently.

## Exceptions

- A criterion that is itself a DECISION rather than a spec (two directions with opposite costs)
  is a `human_led` / `blocked_reason` case, not a notes-vs-criteria conflict; stop and ask.
- If the notes and criteria conflict on something a measurement can settle (a count, a
  reachability claim), measure and record the number rather than choosing by authority.

## Related Files

- `todos/TEMPLATE.md` — the section names this rule refers to
- `.claude/agents/todo-executor.md` — Step 1 parses both sections; Step 11 reports deviations
- `todos/archive/P1-2026-09-22-stamp-writer-takes-contract-bearing-text-over-its-own-objection.md`
  — the worked example

## See Also

- [a defect spec's acceptance criteria must be derived from source, not symptom](spec-acceptance-criteria-from-source-not-symptom-2026-07-26.md) — how criteria should be written in the first place
- [a todo whose acceptance criteria need a human decision must carry the human-led gate](todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md) — the exception above
- [a precedence control pinned the laundering shape](../code-quality/a-precedence-control-pinned-the-laundering-shape-re-pin-the-property-not-the-fixture-2026-09-22.md) — the other thing the same criterion protected
