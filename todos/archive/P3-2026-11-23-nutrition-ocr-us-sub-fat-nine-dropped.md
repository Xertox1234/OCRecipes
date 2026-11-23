---
title: "Nutrition OCR parser drops a 9 g saturated or trans fat read through a spaced g→9 unit"
status: done
priority: low
created: 2026-11-23
updated: 2026-11-23
assignee:
labels: [deferred, camera]
github_issue:
---

# Nutrition OCR parser drops a 9 g saturated or trans fat read through a spaced g→9 unit

## Summary

On a US panel, `Saturated Fat 9 9` and `Trans Fat 9 9` (9 g, with the recogniser's `g` → `9` substitution) parse to `null` whenever another line precedes them. Every other value in that shape is read.

## Background

Found on 2026-11-23 by property C1 in `client/lib/__tests__/nutrition-ocr-parser.property.test.ts`, and deferred because that change adds tests only.

The `saturatedFat` and `transFat` patterns in `FIELD_PATTERNS` each have a two-word branch (`saturated\s+fat`) and a line-anchored bare branch (`(?:^|\n)\s*saturated`). The bare branch starts one character earlier, at the newline, so the leftmost match is its own: it captures the word `Fat` as the value and the first `9` as a spaced substituted unit. `extractNumber("Fat")` is `NaN`, so the field is dropped.

Verified with the parser directly:

- `"Total Fat 12g\nSaturated Fat 9 9"` → `saturatedFat: null`
- `"Total Fat 12g\nTrans Fat 9 9 0%"` → `transFat: null`
- `"Trans Fat 9 9"` (first line, so no newline to anchor on) → `transFat: 9`

The field is lost, not misread, so nothing wrong reaches the food log; the cost is recall and one tenth of `confidence`.

## Acceptance Criteria

- [x] `"Total Fat 12g\nSaturated Fat 9 9"` parses `saturatedFat` to 9, outside `directReads`
- [x] `"Total Fat 12g\nTrans Fat 9 9"` parses `transFat` to 9, outside `directReads`
- [x] `isDroppedSubFatNine` and its use in property C1 are removed, and C1 passes without it
- [x] The existing example suite passes unchanged

## Implementation Notes

The bare branch must not accept a value that is not numeric-looking, or must not win over the two-word branch on the same line. Either keeps the one-line rule the parser's comments set out.

A related, more serious defect in the same patterns was reported to the owner on 2026-11-23 and is not covered here: `\s+` inside the two-word names crosses a newline, so `"SANS GRASTRANS\nFat / Lipides 44g"` reads `transFat = 44` as a direct read (property B2, guard `nameSpansTwoLines`). If the owner asks for that fix, do both together.

## Scope Contract

- **Mechanisms to use:** the existing regex patterns in `FIELD_PATTERNS` — nothing new
- **Files in scope:** `client/lib/nutrition-ocr-parser.ts`, `client/lib/__tests__/nutrition-ocr-parser.test.ts`, `client/lib/__tests__/nutrition-ocr-parser.property.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- These patterns feed `directReads` and the label-override payload; a looser match can turn a dropped field into a wrong one.

## Updates

### 2026-11-23

- Initial creation
- Fixed on branch `claude/nutrition-ocr-name-one-line` together with the cross-line name defect (owner ruling 2026-11-23: one separate PR for both). The bare `saturated` / `trans` forms now refuse a following `Fat`, so the two-word branch takes the line.
- Criterion 2 is covered by property C1 (no Daily Value) and by the example `"Total Fat 12g\nTrans Fat 9 9 0%"`.
