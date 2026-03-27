# Audit: [TITLE]

> **Date:** YYYY-MM-DD
> **Trigger:** [Why this audit was run]
> **Domains:** [security, performance, data-integrity, architecture, code-quality]
> **Baseline:** X tests passing | Y type errors | Z lint errors

## Findings

Each finding has a lifecycle: `open` → `fixing` → `verified` or `deferred` or `false-positive`.

**Status key:**

- `open` — Found but not yet addressed
- `fixing` — Work in progress
- `verified` — Fix applied AND confirmed by test/grep/type-check
- `deferred` — Intentionally postponed (must link to todo)
- `false-positive` — Agent was wrong or issue was already fixed

### Critical

| ID  | Finding       | File(s)     | Status | Verification |
| --- | ------------- | ----------- | ------ | ------------ |
| C1  | [description] | `path:line` | open   | —            |

### High

| ID  | Finding       | File(s)     | Status | Verification |
| --- | ------------- | ----------- | ------ | ------------ |
| H1  | [description] | `path:line` | open   | —            |

### Medium

| ID  | Finding       | File(s)     | Status | Verification |
| --- | ------------- | ----------- | ------ | ------------ |
| M1  | [description] | `path:line` | open   | —            |

### Low

| ID  | Finding       | File(s)     | Status | Verification |
| --- | ------------- | ----------- | ------ | ------------ |
| L1  | [description] | `path:line` | open   | —            |

## Deferred Items

Items marked `deferred` must have a linked todo and rationale.

| ID  | Todo | Rationale |
| --- | ---- | --------- |
| —   | —    | —         |

## Summary

| Severity  | Found | Verified | Deferred | False-positive | Open  |
| --------- | ----- | -------- | -------- | -------------- | ----- |
| Critical  | 0     | 0        | 0        | 0              | 0     |
| High      | 0     | 0        | 0        | 0              | 0     |
| Medium    | 0     | 0        | 0        | 0              | 0     |
| Low       | 0     | 0        | 0        | 0              | 0     |
| **Total** | 0     | 0        | 0        | 0              | **0** |

## Fix Commits

| Commit | Description |
| ------ | ----------- |
| —      | —           |

## Codification (Phase 7)

Completed after fixes are committed. Each row links to the docs change.

### Patterns Extracted

| Finding | Pattern | Added To             |
| ------- | ------- | -------------------- |
| —       | —       | `docs/patterns/?.md` |

### Learnings Extracted

| Finding | Learning Title | Category                                                     |
| ------- | -------------- | ------------------------------------------------------------ |
| —       | —              | Bug Post-Mortem / Gotcha / Security / Performance / Decision |

### Code Reviewer Updates

| Finding | New Check Added |
| ------- | --------------- |
| —       | —               |

**Codification commit:** `[SHA]`

## Post-Audit Notes

[Any process improvements or observations]
