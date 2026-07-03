---
title: Commit Subject Drift — A Promised Fix That Wasn't
track: bug
category: logic-errors
module: server
severity: medium
tags: [code-review, audit, merge-conflict, regression, process]
symptoms: [Commit message advertises a fix that the current code does not actually implement, Earlier audit todo is marked closed but the symptom is still present, Merge conflict resolution silently dropped part of the change]
applies_to: [server/services/nutrition-coach.ts]
created: '2026-04-17'
---

# Commit Subject Drift — A Promised Fix That Wasn't

## Problem

A previous audit flagged that Coach Pro's tool-call execution was serial (`for...of` + `await`) and deferred the fix to a todo. A follow-up commit titled "Coach Pro service extraction — cross-route import, parallel tools, handler decomposition" landed, marking the todo as addressed. The next audit re-discovered that `server/services/nutrition-coach.ts:355-377` still had the serial loop — the "parallel tools" portion of the commit subject never actually shipped. It was reverted during merge conflict resolution.

## Symptoms

- Tool-call latency in Coach Pro unchanged after the "parallel tools" commit
- Todo file marked done, commit subject claims the fix, code still has the regression
- Grep for `for.*await.*executeToolCall` still hits the unchanged loop

## Root Cause

Merge conflict resolution preserved the easier-to-merge side of a multi-change commit, silently dropping the parallel-tools refactor. The commit subject — written before the conflict — still claimed all three changes. Audit closure relied on the commit subject and todo status, not on re-reading the code.

## Solution

Re-apply the parallel `Promise.all` refactor and verify by grepping for the serial pattern. For audit follow-up: do not trust commit subjects — grep the code for the symptom regex and confirm the change actually landed.

## Prevention

- Audits should verify that commits implement what their subjects claim. Use a symbol-level grep (e.g. `for.*await.*executeToolCall`) as the verification step, not a commit-message read.
- When resolving merge conflicts on a multi-change commit, list each change in the subject and re-confirm presence in the final tree before pushing.
- When closing an audit todo, paste the grep command and its empty output into the todo's closing note so future audits can re-run the check.

## Related Files

- `server/services/nutrition-coach.ts` — restored parallel `Promise.all` for tool calls
- Commit `b41245f` (landed but partially reverted), commit `75c84bb` (merge conflict resolution), fix landed in commit `7cbc8ed`

## See Also

- [Protocol handler bug — fix all consumers](./protocol-handler-bug-fix-all-consumers-2026-05-13.md)
- [Promise.allSettled with cap](../design-patterns/promise-allsettled-with-cap-2026-05-13.md)
