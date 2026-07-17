<!-- Filename: P3-2026-07-16-blocked-until-machine-checkable-gate.md -->

---

title: "Make todo date gates machine-checkable (blocked_until frontmatter) so orchestrators can't dispatch past them"
status: done
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

- [x] A frontmatter convention for date gates exists (e.g. `blocked_until:
  YYYY-MM-DD`, optionally `blocked_reason:`) and is documented in
      `todos/TEMPLATE.md` and `todos/README.md`. (`todos/README.md` → new
      "Date & Human-Led Gates" section; `todos/TEMPLATE.md` → commented-out
      optional fields.)
- [x] The `/todo` and `/todo-fast` skills (and any triage step that flips
      status) check the field and skip/refuse dispatch when the gate date is in
      the future — including under a `/goal` directive; only the user naming
      the specific todo interactively may override. (`.claude/skills/todo/SKILL.md`
      Phase 2 step 3a — no override, ever; `.claude/skills/todo-fast/SKILL.md`
      Phase 0 step 4 — the one legitimate interactive-confirmation override, which
      cannot be satisfied by dispatch-prompt wording or a `/goal` directive;
      `.claude/agents/todo-executor.md` Step 2 item 1a — backstop for a direct
      dispatch that bypassed both skills, no override at that layer.)
- [x] A human-led-only marker (e.g. `human_led: true` or a `labels:` entry) is
      honored the same way: never autonomously dispatched. (Same three call
      sites; `human_led: true` never expires even after `blocked_until` passes —
      enforced by `scripts/todo-gate-check.sh`, checked first in `check_one()`.)
- [x] `todos/P3-2026-07-05-pg-injection-ranking-layer.md` is migrated to the
      new fields as the first consumer (`blocked_until: 2026-08-05`). Already
      satisfied by PR #650 (main commit 30ae1451) — verified by reading the
      file's frontmatter (`blocked_until: 2026-08-05`, `blocked_reason: "..."`,
      `human_led: true`); not re-touched here.

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

### 2026-07-16 — Implemented

- Added `scripts/todo-gate-check.sh` (deterministic, fail-closed: exit 0 clear /
  1 gated / 2 error-treat-as-gated; single-file and `todos/`-scan modes),
  covered by `scripts/__tests__/todo-gate-check.test.ts` (19 cases, including
  quoted-value and inline-comment fail-closed regressions caught by review).
- Wired the check into `.claude/skills/todo/SKILL.md` Phase 2 (no override,
  ever — batch runs never target one gated todo), `.claude/skills/todo-fast/SKILL.md`
  Phase 0 (the one legitimate interactive-confirmation override — explicitly
  unsatisfiable by dispatch-prompt wording or a `/goal` directive), and
  `.claude/agents/todo-executor.md` Step 2 (backstop for a direct dispatch that
  bypassed both skills — no override at that layer). Added `REASON_CODE:
GATE_BLOCKED` to the shared enum and a new Phase 5 "Gated" listing group,
  synced into `docs/todo-automation-runbook.md`'s `/goal` DONE enumeration.
- Documented the convention in `todos/README.md` ("Date & Human-Led Gates")
  and `todos/TEMPLATE.md`.
- Two review rounds (code-reviewer): round 1 found a CRITICAL — quoted
  `human_led: "true"` silently failed the gate open — fixed with the same
  quote-stripping `blocked_until` already used. Round 2 found the same failure
  class was still open for unrecognized `human_led` values (e.g. a trailing
  inline comment); fixed to fail-closed, mirroring `blocked_until`'s
  PARSE_ERROR branch. Also caught and fixed: an unguarded worktree
  `node_modules` (broken provisioning, unrelated to this diff — repaired
  locally by symlinking the main checkout's, per `/todo-fast`'s own pattern)
  that was masking real test results.
