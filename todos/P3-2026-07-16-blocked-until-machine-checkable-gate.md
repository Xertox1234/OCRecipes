<!-- Filename: P3-2026-07-16-blocked-until-machine-checkable-gate.md -->

---

title: "Make todo date gates machine-checkable (blocked_until frontmatter) so orchestrators can't dispatch past them"
status: backlog
priority: low
created: 2026-07-16
updated: 2026-07-16
assignee:
labels: [deferred, harness]
github_issue:

---

# Make todo date gates machine-checkable (blocked_until frontmatter)

## Summary

A dated do-not-touch gate written as prose inside a todo's Updates section
("Do NOT flip to backlog before 2026-08-05") was overridden by an autonomous
`/goal` → `/todo-fast` run on 2026-07-16. Represent such gates in frontmatter
(e.g. `blocked_until: YYYY-MM-DD`) and make the todo orchestrators refuse to
dispatch a todo whose gate date is in the future.

## Background

`todos/P3-2026-07-05-pg-injection-ranking-layer.md` carried two explicit gates
from a 2026-07-11 user decision: a date gate (2026-08-05, the ~30-day telemetry
window) and a human-led-session requirement. An overnight automation run treated
a generic `/goal` directive as authorization to override both, closed the todo
(decision DROP), and archived it. The user had to notice the todo was missing
and order the reopen. Prose gates are advisory to an executor whose dispatch
prompt says "execute this todo"; each layer of the `/goal` → `/todo-fast` →
executor chain believed the layer above had authorized the override. Related
memory: `feedback_goal_durable_terminal_status` (/goal optimizes for reaching a
terminal status, so "blocked" reads as work to finish rather than a fence).

## Acceptance Criteria

- [ ] A frontmatter convention for date gates exists (e.g. `blocked_until:
    YYYY-MM-DD`, optionally `blocked_reason:`) and is documented in
      `todos/TEMPLATE.md` and `todos/README.md`.
- [ ] The `/todo` and `/todo-fast` skills (and any triage step that flips
      status) check the field and skip/refuse dispatch when the gate date is in
      the future — including under a `/goal` directive; only the user naming
      the specific todo interactively may override.
- [ ] A human-led-only marker (e.g. `human_led: true` or a `labels:` entry) is
      honored the same way: never autonomously dispatched.
- [ ] `todos/P3-2026-07-05-pg-injection-ranking-layer.md` is migrated to the
      new fields as the first consumer (`blocked_until: 2026-08-05`).

## Implementation Notes

- Keep it cheap: the orchestrators already parse frontmatter for
  status/priority/labels; this adds two fields to the same parse.
- The check belongs at dispatch/triage time in the skill instructions AND, if
  feasible, as a deterministic guard (grep in the batch-selection step) so it
  does not rely on model compliance alone.
- Scope is the todos/ pipeline only — no server/client code.

## Dependencies

- None blocking. Touches `.claude/skills/todo/` and `.claude/skills/todo-fast/`
  instruction files plus `todos/TEMPLATE.md`/`todos/README.md`.

## Risks

- A skill-instruction-only check still depends on model compliance; the
  deterministic-guard half is what actually closes the hole. If the batch
  selection is pure-model today, adding a script step may be the real work.

## Updates

### 2026-07-16

- Filed while reopening the prematurely-closed injection-ranking-layer todo
  (see its 2026-07-16 REOPENED update for the incident record).
