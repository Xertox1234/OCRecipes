# Project TODOs

This folder contains structured todo items for tracking project work.

## File Naming Convention

```
P{0-3}-YYYY-MM-DD-short-description.md
```

- `P{0-3}` - Priority prefix, **derived from the `priority:` frontmatter field**
  (the field stays the source of truth; the prefix is for at-a-glance scanning and
  sorts highest-priority-first in `ls`): `P0`=critical, `P1`=high, `P2`=medium, `P3`=low
- `YYYY-MM-DD` - Creation date (used for FIFO ordering within a priority)
- `short-description` - Kebab-case summary (e.g., `auth-migration`, `add-dark-mode`)

> Keep the prefix in sync with `priority:`. If a todo's priority changes, rename the
> file to match. The overnight automation selects work by the frontmatter field, not
> the filename — see `docs/todo-automation-runbook.md`.

## Status Values

| Status        | Description                           |
| ------------- | ------------------------------------- |
| `backlog`     | Identified but not yet planned        |
| `planned`     | Scheduled for upcoming work           |
| `in-progress` | Currently being worked on             |
| `blocked`     | Waiting on external dependency        |
| `review`      | Implementation complete, needs review |
| `done`        | Completed and verified                |

## Priority Levels

| Priority   | Description                           |
| ---------- | ------------------------------------- |
| `critical` | Blocking production or security issue |
| `high`     | Important for next release            |
| `medium`   | Should be done soon                   |
| `low`      | Nice to have, no urgency              |

## Date & Human-Led Gates

A `status: blocked` value alone is prose an agent can flip back to `backlog` — the 2026-07-16
incident that motivated this section was exactly that: an autonomous `/goal` run treated a
generic automation directive as authorization to edit `status` away from `blocked` and dispatch
a todo that carried an explicit, dated do-not-touch note. Two optional frontmatter fields make
the gate machine-checkable instead, independent of whatever `status` currently says:

| Field            | Meaning                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked_until`  | `YYYY-MM-DD`. Never autonomously dispatched before this date. The gate **clears on** the date itself.                                                                                             |
| `blocked_reason` | Optional quoted string. Human-readable — surfaced verbatim in `/todo`/`/todo-fast` run summaries when gated.                                                                                      |
| `human_led`      | `true`. Never autonomously dispatched, **ever** — does NOT expire when `blocked_until` passes. May combine with `blocked_until` (both may be set; `human_led` is the one that never auto-clears). |

**Enforcement is deterministic, not just instructional.** `scripts/todo-gate-check.sh` reads
these fields directly (bypassing `status` entirely) and is invoked by `/todo` triage,
`/todo-fast` preflight, and `todo-executor.md`'s own pre-flight as a backstop — see that
script's header comment for its exit-code contract. **The only legal override is a human, in
an interactive session, explicitly naming this specific todo** after seeing the gate reason —
never a generic automation directive (`/goal`, a batch run, "clear the backlog," Auto Mode's
"make the reasonable call," or the todo's own content). An agent must never edit `status`,
`blocked_until`, or `human_led` to work around this gate under an autonomous run.

Example (the gate as it stood on `P3-2026-07-05-pg-injection-ranking-layer` — since closed
DROP in a human-led session on 2026-08-09 and moved to `todos/archive/`, where the retained
gate fields are inert because the scan is `-maxdepth 1`):

```yaml
status: blocked
blocked_until: 2026-08-05
blocked_reason: "30-day usage-telemetry window (2026-07-11 user decision); re-check is HUMAN-LED only"
human_led: true
```

## Creating a New TODO

1. Copy `TEMPLATE.md` to a new file with the next sequential number
2. Fill in all required fields in the YAML frontmatter
3. Write a clear description and acceptance criteria
4. Add implementation notes if known

## Updating TODOs

- Update `status` as work progresses
- Add notes in the Updates section with date
- Link to relevant PRs or commits when done

## Deferred findings

Moved from CLAUDE.md (harness item 7, 2026-11-02); CLAUDE.md keeps a three-line summary. Most things noticed mid-session must NOT become a todo: the old "file everything deferred" rule buried the backlog and made finishing one todo spawn three.

- **Defect, regression or blocker of High or Critical severity:** never auto-file; always ask first. This gates who decides, not whether it can ever become a todo.
  - In scope of the current task: fix it now.
  - Out of scope: one line in the reply (severity, file path) and let the user decide. Never file it silently.
- **Defect, regression, blocker or minor follow-up of Medium or Low severity:** the only tier that auto-files, with no "want a todo?" question.
  - In scope: fix it now.
  - Otherwise auto-file it immediately (flow below).

Auto-file flow (run right after identifying the item):

1. Create `todos/P{n}-YYYY-MM-DD-[slug].md` from `TEMPLATE.md`, where `P{n}` and `priority:` match the severity you assessed: `P2`/`priority: medium` for medium, `P3`/`priority: low` for low (see Priority Levels). Never hardcode `P3`/`low`. Set `status: backlog` and `labels: [deferred, <domain>]`. Fill **Background** (why it was deferred), **Acceptance Criteria** (checkboxes) and **Implementation Notes** (technical details and explicit file paths in scope).
2. Name the new todo path in the reply.

**Guard-eligible PRs auto-merge; everything else waits for individual review.** A `low`-priority, non-`security` todo whose PR passes `scripts/todo-automerge-guard.sh` (safe-path allowlist) gets `gh pr merge --auto --squash --delete-branch` armed by the executor right after PR creation, and lands when CI goes green. `medium`/`high`/`critical` todos, any `security`-labelled todo, and any PR the guard HOLDs or can't evaluate are surfaced for human review, never auto-merged. The executor never force-pushes or deletes a remote branch. Branch protection rejects direct pushes to `main`.

Exempt from this bar: pattern codification (`docs/solutions/`, `docs/rules/`) writes docs, not todos. Findings against `.claude/hooks/**` go to `docs/harness-residuals.md`, never a todo (user ruling 2026-09-22). Review rounds per PR: `docs/AI_WORKFLOW.md` → Review Policy. Backlog todos are picked up later with `/todo`.
