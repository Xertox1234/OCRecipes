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

## Creating a New TODO

1. Copy `TEMPLATE.md` to a new file with the next sequential number
2. Fill in all required fields in the YAML frontmatter
3. Write a clear description and acceptance criteria
4. Add implementation notes if known

## Updating TODOs

- Update `status` as work progresses
- Add notes in the Updates section with date
- Link to relevant PRs or commits when done
