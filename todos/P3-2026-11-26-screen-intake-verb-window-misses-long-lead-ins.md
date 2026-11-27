---
title: "Coach output screen: an intake verb more than 25 characters before a low calorie figure is not seen"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, ai-prompting, safety]
github_issue:
---

# Screen: intake verb window misses long lead-ins

## Summary

`INTAKE_VERB_BEFORE_RE` in `server/lib/ai-safety.ts` requires the verb (eat, have, aim, keep...) within 25 characters before the calorie figure. "Have nothing but breakfast of 300 calories." puts it 30 characters away, so the sentence is not screened. Main behaves the same, so this is not a regression. Found while writing screen corpus rows (2026-11-26; see todos/P2-2026-11-26-screen-blocks-snack-size-advice.md).

## Acceptance Criteria

- [ ] "Have nothing but breakfast of 300 calories." is blocked.
- [ ] Every current mustPass row in `server/lib/__tests__/fixtures/coach-output-screen-corpus.json` still passes; widening the window is the obvious fix and the false-positive risk it carries is what this check guards.
- [ ] One new mustPass control with a long lead-in that is ordinary advice.
