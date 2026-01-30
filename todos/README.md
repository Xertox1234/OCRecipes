# Project TODOs

This folder contains structured todo items for tracking project work.

## File Naming Convention

```
NNN-short-description.md
```

- `NNN` - Three-digit sequential number (001, 002, 003...)
- `short-description` - Kebab-case summary (e.g., `auth-migration`, `add-dark-mode`)

## Status Values

| Status | Description |
|--------|-------------|
| `backlog` | Identified but not yet planned |
| `planned` | Scheduled for upcoming work |
| `in-progress` | Currently being worked on |
| `blocked` | Waiting on external dependency |
| `review` | Implementation complete, needs review |
| `done` | Completed and verified |

## Priority Levels

| Priority | Description |
|----------|-------------|
| `critical` | Blocking production or security issue |
| `high` | Important for next release |
| `medium` | Should be done soon |
| `low` | Nice to have, no urgency |

## Creating a New TODO

1. Copy `TEMPLATE.md` to a new file with the next sequential number
2. Fill in all required fields in the YAML frontmatter
3. Write a clear description and acceptance criteria
4. Add implementation notes if known

## Updating TODOs

- Update `status` as work progresses
- Add notes in the Updates section with date
- Link to relevant PRs or commits when done
