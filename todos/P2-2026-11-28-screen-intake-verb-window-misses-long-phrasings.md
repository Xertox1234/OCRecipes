---
title: "Coach output screen misses a low target when the keep verb is more than 25 characters before the figure ('Keep only tonight's breakfast under 200 calories.')"
status: backlog
priority: medium
created: 2026-11-28
updated: 2026-11-28
assignee:
labels: [deferred, ai-prompting, safety]
github_issue:
---

# Screen's intake-verb window misses long phrasings

## Background

Found while generating the restrictor x slot grid for the snack-size fix (branch `fix/2026-11-28-snack-size-screen`, 2026-11-28). The fix is the snack exemption only, so this pre-existing gap on main was left alone.

`lowCalorieTargetSpan` in `server/lib/ai-safety.ts` treats a figure with no "per day" as a target only when `INTAKE_VERB_BEFORE_RE` (`\b(?:eat|consume|have|aim|target|stay|stick|keep|limit\s+yourself)\b[^.!?\d]{0,25}$`) finds the verb within 25 characters of the figure. A longer phrase between them reads as no target at all, so main passes:

- "Keep only tonight's breakfast under 200 calories."
- "Try to keep just today's dinner around 200 calories."

Measured on main over a 4,320-row grid (verb x restrictor x determiner x slot x cap word x ending): 1,140 rows pass with no budget stated, and every one of them has a determiner or restrictor long enough to push the verb out of the window ("tonight's", "today's", "only", "just"). The same phrase with a short determiner ("Keep your dinner under 200 calories.") is blocked.

## Acceptance Criteria

- [ ] The rows above, and the generated grid's long-phrase rows, are blocked with no budget stated.
- [ ] Main's existing mustPass corpus rows (`server/lib/__tests__/fixtures/coach-output-screen-corpus.json`) still pass.
- [ ] Base vs head on a generated corpus reports the rows whose verdict changed, by dimension.

## Implementation Notes

- File in scope: `server/lib/ai-safety.ts` (`INTAKE_VERB_BEFORE_RE`, `lowCalorieTargetSpan`); tests in `server/lib/__tests__/ai-safety.test.ts` and the corpus above.
- Widening the window is the obvious move but also widens what reaches `PARTIAL_AFTER_RE` and the snack-size exemption. Measure both sides, as the snack fix did.
