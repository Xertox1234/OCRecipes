---
title: "Sweep remaining __DEV__ console.* calls to logger (H7 follow-up)"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [reliability, observability, deferred]
github_issue:
---

# Remaining **DEV** console.\* sweep (H7 follow-up)

## Summary

PR #288 migrated the exemplar `if (__DEV__) console.warn` at `ScanScreen.tsx:304` to `logger.error`. The broader set of `__DEV__`-gated `console.*` calls in other screens was explicitly deferred — those still vanish in prod bundles.

## Background

Reliability audit Class 10 (H7): client logs gated on `__DEV__` are invisible in production. PR #288 fixed the named example and established the `logger` module (`client/lib/logger.ts`) as the migration target. The remaining occurrences are low-severity (non-critical paths), deferred to avoid scope creep in the audit PR.

## Acceptance Criteria

- [ ] All `if (__DEV__) console.*` patterns in `client/` are replaced with the appropriate `logger.*` call.
- [ ] Unconditional `console.log`/`console.warn`/`console.error` in non-test client files are evaluated and either migrated to `logger.*` or removed if truly debug-only.
- [ ] No new `__DEV__`-gated console calls introduced (point this out in the PR description so reviewers know to check).

## Implementation Notes

- Find candidates: `grep -rn "__DEV__" client/ --include="*.ts" --include="*.tsx"` and `grep -rn "console\." client/ --include="*.ts" --include="*.tsx" | grep -v "__tests__"`.
- Migration: `if (__DEV__) console.warn(msg, x)` → `logger.warn(msg, x)` (dev-only already, so `logger.warn` is equivalent and prod-safe).
- `if (__DEV__) console.error(...)` → `logger.error(msg, err)` (also routes to reporter in prod).
- Import: `import { logger } from "@/lib/logger"`.
- Skip `client/lib/logger.ts` itself (intentional `console.*` calls inside).

## Dependencies

- `client/lib/logger.ts` must exist (PR #288 merged) ✓

## Risks

- Low — mechanical find-and-replace. No logic change.

## Updates

### 2026-05-31

- Created from PR #288 deferred warning. ScanScreen:304 migrated; broader sweep deferred from the audit scope.
