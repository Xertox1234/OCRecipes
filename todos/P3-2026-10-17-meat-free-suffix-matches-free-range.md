---
title: "Diet conflicts: 'meat free-range' wrongly reads as 'meat-free'"
status: backlog
priority: low
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, nutrition]
github_issue:
---

# Diet conflicts: 'meat free-range' wrongly reads as 'meat-free'

## Summary

The meat-free check in `shared/constants/diet-conflicts.ts` treats any "free" after "meat" as "meat-free", including "free-range". So an ingredient line like "meat free-range" clears the meat flag, and the recipe could show a Vegetarian icon it should not.

## Background

Found by the code reviewer on PR #1491 (diet-conflict keyword gaps) and deferred under the one-review-pass rule. The pattern is `MEAT_FREE_SUFFIX = /^[\s-]+free(?:$|[\s,;/()-])/`. The trailing `-` in the class lets "free-range" match. Only the bare keyword "meat" goes through this check, and the phrase is unusual in real ingredient text, so this is low severity. But it is the unsafe direction: diet icons are absence claims, and this hides a real meat word.

## Acceptance Criteria

- [ ] "meat free-range" (and "meat free range") still flags `meat`
- [ ] "meat-free", "meat free", "meat-free mince", "meat-free, vegan" still do NOT flag
- [ ] Tests in `shared/constants/__tests__/diet-conflicts.test.ts` cover both lists
- [ ] Note for the owner: after merge, re-run the prod allergen/diet backfill only if it already ran

## Implementation Notes

- File: `shared/constants/diet-conflicts.ts` (`MEAT_FREE_SUFFIX`, used in `conflictKeywordHits`).
- The reviewer suggested ending the pattern at `free(?:$|[\s,;/()])` (drop `-` from the class). Check "meat-free-x" shapes first, e.g. "meat-free-style", before adopting it. Another option is a negative lookahead for `-?range`.
