---
title: Multi-task refactor — verify the intermediate tsc error set is exactly the planned-deferred callers
track: knowledge
category: best-practices
module: shared
tags: [refactoring, typescript, tsc, expand-contract, multi-task, verification, red-tree]
symptoms: ['A staged signature-change refactor reaches "green" but a masked failure shipped in an earlier task', 'Intermediate commits of a multi-task refactor fail check:types and nobody can say which errors are expected']
applies_to: ['**/*.ts', '**/*.tsx']
created: '2026-07-10'
---

# Multi-task refactor — verify the intermediate tsc error set is exactly the planned-deferred callers

## When this applies

Any signature-change refactor split across multiple tasks/commits (expand/contract style) where intermediate states intentionally do not compile project-wide.

## Rule

After each red-tree task, independently confirm the tsc error set is **exactly** the known-deferred callers and nothing else:

```bash
npx tsc --noEmit 2>&1 | grep -E 'error TS' | sort -u
```

Compare the output against the documented deferred-caller list from the plan. Extra errors mean the task broke something beyond its scope; missing errors mean a caller was silently migrated (or skipped) off-plan.

## Why

An intentionally non-compiling window destroys the usual "tsc green = safe" signal. Without the exact-set check, any new breakage introduced mid-refactor hides inside the expected red until the final task — at which point "green finally returned" can mean "the masked failure was papered over" rather than "all-clear". Pinning the error set restores a verifiable invariant to each intermediate step, making the red window safe rather than reckless.

## Exceptions

Single-commit refactors that compile at every step don't need this — the normal type gate suffices.

## Related Files

- `.claude/hooks/pre-push` — the push-time gate this discipline temporarily supersedes during a red window

## See Also

- [mutation target and break threshold selection](mutation-target-and-break-threshold-selection-2026-06-27.md) — same philosophy: prove the gate would catch the failure, don't assume
